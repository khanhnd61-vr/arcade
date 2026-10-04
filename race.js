// Race for the Play section: an OutRun-style road racer seen from behind the
// car. Three laps of a looping circuit against five rivals, with slower
// traffic to weave through. Hold Up to accelerate and Down to brake, steer
// with Left and Right; the curves push the car outwards, so ease off or steer
// into them, and leave the road or hit a car and the speed is gone. The time
// for the three laps is the score, kept per mode, and the finishing place is
// shown at the end. Hard has quicker rivals, more traffic and sharper curves.
(() => {
  const root = document.querySelector('[data-race]');
  if (!root) return;

  // The view has its own units; the canvas is scaled to whatever size it gets.
  const W = 400;
  const H = 300;
  const SEG = 200; // length of one road segment, in world units
  const RUMBLE = 3; // segments per stripe of kerb
  const ROAD_W = 2000; // half the road's width, in world units
  const LANES = 3;
  const CAM_H = 1000; // the camera's height over the road
  const FOV = 100; // degrees
  const CAM_DEPTH = 1 / Math.tan(((FOV / 2) * Math.PI) / 180);
  const PLAYER_Z = CAM_H * CAM_DEPTH; // how far ahead of the camera the car sits
  const DRAW = 180; // segments drawn ahead
  const FOG = 4;
  const STEP = 1 / 60; // the physics runs in fixed steps, so a slow frame cannot skip a car
  const MAX_SPEED = SEG / STEP; // one segment per step
  const ACCEL = MAX_SPEED / 5;
  const BRAKE = -MAX_SPEED;
  const DECEL = -MAX_SPEED / 5;
  const OFF_DECEL = -MAX_SPEED / 2;
  const OFF_LIMIT = MAX_SPEED / 4; // top speed on the grass
  const CENTRIFUGAL = 0.3;
  const LAPS = 3;
  const RIVALS = 5;
  const COUNT_MS = 3000; // the lights: 3, 2, 1, go
  const BANNER_MS = 1400; // how long a lap banner stays up
  const RESTART_GRACE = 800; // ms after the end before a held key can restart
  const BEST_KEY = 'race-best';
  const INK = '#2b1a08';
  const COLORS = {
    sky: ['#8fb8c4', '#d8e6ea'], light: { road: '#6b7585', grass: '#8db07e', rumble: '#fffaf2', lane: '#fffaf2' },
    dark: { road: '#646d7d', grass: '#7fa271', rumble: '#d9745a' },
    start: { road: '#fffaf2', grass: '#8db07e', rumble: '#fffaf2' },
  };
  // Rivals' cruising speeds as a share of the top speed, the number of slower cars on the
  // road, how sharp the curves are and the lane width the rivals keep to.
  const MODES = {
    normal: { rivals: [0.78, 0.82, 0.86, 0.89, 0.92], traffic: 14, curve: 1, idle: 'Three laps against five rivals. Hold ↑ to go, steer with ← and →.' },
    hard: { rivals: [0.86, 0.89, 0.92, 0.94, 0.96], traffic: 26, curve: 1.3, idle: 'Quick rivals, thick traffic and sharp bends. Keep it on the road.' },
  };
  // The circuit, as stretches of road: segments easing into the curve, holding it and
  // easing out, and the curve itself (positive bends right).
  const COURSE = [
    [0, 60, 0, 0], [30, 40, 30, 2], [0, 30, 0, 0], [25, 25, 25, -3], [25, 25, 25, 3], [0, 50, 0, 0],
    [40, 60, 40, -4], [0, 30, 0, 0], [30, 50, 30, 5], [20, 20, 20, -2], [0, 80, 0, 0], [30, 40, 30, -5],
    [25, 25, 25, 2], [25, 25, 25, -2], [0, 40, 0, 0], [40, 40, 40, 4], [0, 60, 0, 0],
  ];
  const STEER_KEYS = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
  const GAS_KEYS = new Set(['ArrowUp', 'KeyW', 'KeyZ']);
  const BRAKE_KEYS = new Set(['ArrowDown', 'KeyS', 'KeyX']);
  const PAUSE_KEYS = new Set(['KeyP', 'Escape', 'Space']);
  const START_KEYS = new Set(['Enter', 'NumpadEnter', 'Space', 'KeyZ']);
  const RUNNING = new Set(['count', 'playing']);

  const stage = root.querySelector('[data-stage]');
  const track = root.querySelector('[data-track]');
  const overlay = root.querySelector('[data-overlay]');
  const msg = root.querySelector('[data-msg]');
  const startBtn = root.querySelector('[data-start]');
  const modeBtns = root.querySelectorAll('[data-mode]');
  const out = (k) => root.querySelector(`[data-out="${k}"]`);
  const ctx = track.getContext('2d');
  const touch = window.matchMedia?.('(pointer: coarse)');

  const loadBest = () => {
    try { return JSON.parse(localStorage.getItem(BEST_KEY)) || {}; } catch { return {}; }
  };
  const saveBest = () => {
    try { localStorage.setItem(BEST_KEY, JSON.stringify(best)); } catch { /* storage unavailable */ }
  };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeIn = (a, b, t) => a + (b - a) * t ** 2;
  const easeInOut = (a, b, t) => a + (b - a) * (-Math.cos(t * Math.PI) / 2 + 0.5);
  const fmtTime = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${Math.floor((ms % 1000) / 100)}`;
  const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][n % 10 > 3 || Math.floor(n / 10) === 1 ? 0 : n % 10]}`;
  // Do two things on the road overlap, given their middles and widths (in road half widths)?
  const overlap = (x1, w1, x2, w2, pct = 1) => {
    const half = (pct / 2);
    return !(x1 + w1 * half < x2 - w2 * half || x1 - w1 * half > x2 + w2 * half);
  };

  /* ---------- Sprites ---------- */

  // Everything by the road and on it is drawn once into a small canvas and scaled by distance.
  // Each has a width and height in road half widths, so a car is 0.3 of the half width.
  const make = (w, h, draw) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'), w, h);
    return c;
  };
  const car = (body, { truck = false, lights = '#a44a3a' } = {}) => make(truck ? 84 : 60, truck ? 72 : 44, (g, w, h) => {
    const dark = 'rgba(0, 0, 0, .3)';
    g.fillStyle = INK;
    g.fillRect(2, h - 14, 14, 14); // the wheels
    g.fillRect(w - 16, h - 14, 14, 14);
    g.fillStyle = body;
    if (truck) {
      g.fillRect(4, 2, w - 8, h - 20); // the box
      g.fillStyle = dark;
      g.fillRect(4, 2, w - 8, 3);
      g.fillRect(8, h - 30, w - 16, 10); // the shadow under its lip
      g.fillStyle = body;
      g.fillRect(6, h - 18, w - 12, 8); // the cab's rear
    } else {
      g.fillRect(4, h - 26, w - 8, 16); // the body
      g.fillRect(12, 4, w - 24, h - 30); // the roof
      g.fillStyle = dark;
      g.fillRect(12, 4, w - 24, 2);
      g.fillStyle = '#1e2130';
      g.fillRect(15, 7, w - 30, 10); // the rear window
      g.fillStyle = 'rgba(255, 255, 255, .25)';
      g.fillRect(17, 8, 8, 2);
    }
    g.fillStyle = lights;
    g.fillRect(6, h - 22, 8, 4); // the lights
    g.fillRect(w - 14, h - 22, 8, 4);
    g.fillStyle = dark;
    g.fillRect(4, h - 12, w - 8, 4); // the bumper
    g.fillStyle = '#9aa5b5';
    g.fillRect(w / 2 - 6, h - 15, 12, 3); // the number plate
  });
  const tree = (leaf) => make(60, 96, (g) => {
    g.fillStyle = '#6b4420';
    g.fillRect(26, 60, 8, 36);
    g.fillStyle = leaf;
    [[30, 54, 26], [20, 36, 20], [40, 36, 20], [30, 20, 18]].forEach(([x, y, r]) => {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    });
    g.fillStyle = 'rgba(255, 255, 255, .15)';
    g.beginPath();
    g.arc(24, 24, 8, 0, Math.PI * 2);
    g.fill();
  });
  const pine = make(48, 108, (g) => {
    g.fillStyle = '#6b4420';
    g.fillRect(20, 84, 8, 24);
    g.fillStyle = '#5c7a5e';
    [[84, 36], [60, 30], [38, 22]].forEach(([base, half]) => {
      g.beginPath();
      g.moveTo(24, base - half * 1.6);
      g.lineTo(24 + half * 0.66, base);
      g.lineTo(24 - half * 0.66, base);
      g.closePath();
      g.fill();
    });
  });
  const bush = make(42, 30, (g) => {
    g.fillStyle = '#5c7a5e';
    [[12, 20, 10], [26, 18, 12], [20, 10, 9]].forEach(([x, y, r]) => {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    });
    g.fillStyle = '#8db07e';
    g.beginPath();
    g.arc(18, 12, 4, 0, Math.PI * 2);
    g.fill();
  });
  const boulder = make(48, 36, (g) => {
    g.fillStyle = '#6b7585';
    g.beginPath();
    g.moveTo(2, 34);
    g.lineTo(8, 14);
    g.lineTo(22, 2);
    g.lineTo(38, 8);
    g.lineTo(46, 34);
    g.closePath();
    g.fill();
    g.fillStyle = '#9aa5b5';
    g.beginPath();
    g.moveTo(10, 14);
    g.lineTo(22, 4);
    g.lineTo(34, 9);
    g.lineTo(28, 18);
    g.closePath();
    g.fill();
  });
  const sign = make(84, 72, (g) => {
    g.fillStyle = '#6b4420';
    g.fillRect(10, 40, 6, 32);
    g.fillRect(68, 40, 6, 32);
    g.fillStyle = INK;
    g.fillRect(0, 0, 84, 44);
    g.fillStyle = '#f4c15d';
    g.fillRect(3, 3, 78, 38);
    g.fillStyle = INK;
    g.font = '700 20px "Space Grotesk", system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('ARCADE', 42, 23);
  });
  const flag = make(36, 96, (g) => {
    g.fillStyle = '#9aa5b5';
    g.fillRect(2, 0, 4, 96);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 3; j++) {
        g.fillStyle = (i + j) % 2 ? INK : '#fffaf2';
        g.fillRect(6 + i * 7, 2 + j * 7, 7, 7);
      }
    }
  });
  const SPRITES = {
    tree: { img: tree('#5c7a5e'), w: 1.0, h: 1.6 },
    oak: { img: tree('#8db07e'), w: 1.1, h: 1.7 },
    pine: { img: pine, w: 0.8, h: 1.8 },
    bush: { img: bush, w: 0.7, h: 0.5 },
    boulder: { img: boulder, w: 0.6, h: 0.45 },
    sign: { img: sign, w: 1.2, h: 1.0 },
    flag: { img: flag, w: 0.3, h: 0.8 },
    player: { img: car('#d9745a'), w: 0.3, h: 0.22 },
    braking: { img: car('#d9745a', { lights: '#ff5a4a' }), w: 0.3, h: 0.22 },
    truck: { img: car('#c9b899', { truck: true }), w: 0.42, h: 0.36 },
  };
  const RIVAL_COLORS = ['#6f8fc0', '#8db07e', '#b48cb0', '#f4c15d', '#8fb8c4'];
  const TRAFFIC_COLORS = ['#fffaf2', '#9aa5b5', '#b48c6a', '#3b2f5e', '#5c7a5e'];
  const carSprite = (col) => ({ img: car(col), w: 0.3, h: 0.22 });
  const RIVAL_SPRITES = RIVAL_COLORS.map(carSprite);
  const TRAFFIC_SPRITES = TRAFFIC_COLORS.map(carSprite);
  const ROADSIDE = ['tree', 'tree', 'oak', 'pine', 'pine', 'bush', 'bush', 'boulder'];

  // A strip of hills for the horizon, drawn twice side by side so it can scroll with the bends.
  const HILLS = make(W * 2, 60, (g, w, h) => {
    const band = (col, base, amp, period, phase) => {
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(0, h);
      for (let x = 0; x <= w; x += 4) {
        const y = base - amp * (Math.sin((x / w) * Math.PI * 2 * period + phase) + 0.5 * Math.sin((x / w) * Math.PI * 2 * period * 2.3 + 1));
        g.lineTo(x, y);
      }
      g.lineTo(w, h);
      g.closePath();
      g.fill();
    };
    band('#5c7a5e', 34, 10, 2, 0.5);
    band('#4f6f5a', 46, 8, 3, 2.2);
  });

  /* ---------- State ---------- */

  let mode = 'normal';
  let cfg = MODES[mode];
  let state = 'idle'; // idle | count | playing | paused | over
  let before = 'playing'; // what the pause interrupted
  let best = loadBest(); // fastest three laps per mode, in ms
  let segments = [];
  let trackLength = 0;
  let cars = []; // every car but the player's
  let rivals = [];
  let position = 0; // the camera along the track
  let playerX = 0; // across the road, in half widths: -1 and 1 are the edges
  let speed = 0;
  let lap = 1;
  let raceTime = 0; // ms since the lights went out
  let countLeft = 0; // ms of the countdown to go
  let bannerAt = -Infinity; // when the last lap banner went up
  let banner = '';
  let place = 1;
  let endedAt = 0;
  let skyOffset = 0; // the horizon slides with the bends
  let carry = 0; // time waiting for the next physics step
  let raf = 0;
  let lastTime = 0;
  let scale = 1;
  const keys = { left: false, right: false, gas: false, brake: false };
  const held = new Set();

  const findSegment = (z) => segments[Math.floor(z / SEG) % segments.length];
  const increase = (start, by, max) => {
    let v = start + by;
    while (v >= max) v -= max;
    while (v < 0) v += max;
    return v;
  };
  const accelerate = (v, a, dt) => v + a * dt;

  // Lay the circuit from COURSE, then scatter the roadside and park the cars.
  const buildTrack = () => {
    segments = [];
    const add = (curve) => {
      const n = segments.length;
      segments.push({
        index: n,
        p1: { world: { z: n * SEG }, camera: {}, screen: {} },
        p2: { world: { z: (n + 1) * SEG }, camera: {}, screen: {} },
        curve,
        sprites: [],
        cars: [],
        color: Math.floor(n / RUMBLE) % 2 ? COLORS.dark : COLORS.light,
      });
    };
    COURSE.forEach(([enter, hold, leave, curve]) => {
      const c = curve * cfg.curve;
      for (let i = 0; i < enter; i++) add(easeIn(0, c, i / enter));
      for (let i = 0; i < hold; i++) add(c);
      for (let i = 0; i < leave; i++) add(easeInOut(c, 0, i / leave));
    });
    trackLength = segments.length * SEG;
    // The start line: two white segments with a flag either side of the road.
    for (let i = 0; i < 2; i++) segments[i].color = COLORS.start;
    segments[1].sprites.push({ sprite: SPRITES.flag, offset: -1.25 }, { sprite: SPRITES.flag, offset: 1.1 });
    for (let n = 6; n < segments.length; n += 3 + Math.floor(Math.random() * 4)) {
      const side = Math.random() < 0.5 ? -1 : 1;
      segments[n].sprites.push({ sprite: SPRITES[pick(ROADSIDE)], offset: side * rand(1.15, 2.6) });
      if (Math.random() < 0.3) segments[n].sprites.push({ sprite: SPRITES[pick(ROADSIDE)], offset: -side * rand(1.3, 3) });
    }
    for (let n = 120; n < segments.length - 20; n += 160) segments[n].sprites.push({ sprite: SPRITES.sign, offset: n % 320 ? -1.4 : 1.25 });

    cars = [];
    const park = (c) => {
      const seg = findSegment(c.z);
      c.percent = (c.z % SEG) / SEG;
      seg.cars.push(c);
      cars.push(c);
    };
    // The rivals line up on a grid ahead of the player, slowest at the front.
    rivals = cfg.rivals.map((share, i) => ({
      rival: true, sprite: RIVAL_SPRITES[i], z: PLAYER_Z + (RIVALS - i) * SEG * 2.2, offset: i % 2 ? 0.45 : -0.45,
      speed: 0, cruise: share * MAX_SPEED, wobble: Math.random() * Math.PI * 2, laps: 0, finished: false,
    }));
    rivals.forEach(park);
    // Traffic drifts along the lanes, well clear of the grid.
    const lane = () => (Math.floor(Math.random() * LANES) - 1) * (2 / LANES) + rand(-0.1, 0.1);
    for (let i = 0; i < cfg.traffic; i++) {
      const truck = Math.random() < 0.25;
      park({
        sprite: truck ? SPRITES.truck : pick(TRAFFIC_SPRITES), z: rand(trackLength * 0.08, trackLength * 0.96), offset: lane(),
        speed: MAX_SPEED * (truck ? rand(0.22, 0.3) : rand(0.3, 0.46)), cruise: 0, laps: 0,
      });
    }
    cars.forEach((c) => { if (!c.rival) c.cruise = c.speed; });
  };

  // Where a car stands over the whole race, in world units.
  const total = (c) => c.laps * trackLength + c.z;
  const playerTotal = () => (lap - 1) * trackLength + position + PLAYER_Z;
  const standing = () => 1 + rivals.filter((r) => total(r) > playerTotal()).length;

  /* ---------- Physics ---------- */

  // How a car steers: round the player or a slower car ahead, or back towards the road.
  const carSteer = (c, oldSeg, playerSeg, dt) => {
    const w = c.sprite.w;
    if ((oldSeg.index - playerSeg.index + segments.length) % segments.length > DRAW) return 0;
    for (let i = 1; i < 20; i++) {
      const seg = segments[(oldSeg.index + i) % segments.length];
      if (seg === playerSeg && c.speed > speed && overlap(playerX, SPRITES.player.w, c.offset, w, 1.2)) {
        const dir = playerX > 0.5 ? -1 : playerX < -0.5 ? 1 : c.offset > playerX ? 1 : -1;
        return ((dir * 1) / i) * ((c.speed - speed) / MAX_SPEED) * dt * 60;
      }
      for (const other of seg.cars) {
        if (other !== c && c.speed > other.speed && overlap(c.offset, w, other.offset, other.sprite.w, 1.2)) {
          const dir = other.offset > 0.5 ? -1 : other.offset < -0.5 ? 1 : c.offset > other.offset ? 1 : -1;
          return ((dir * 1) / i) * ((c.speed - other.speed) / MAX_SPEED) * dt * 60;
        }
      }
    }
    if (c.offset < -0.9) return 0.1 * dt * 60;
    if (c.offset > 0.9) return -0.1 * dt * 60;
    return 0;
  };

  const moveCars = (dt, playerSeg) => {
    cars.forEach((c) => {
      const oldSeg = findSegment(c.z);
      if (c.rival) {
        if (state === 'playing') {
          c.wobble += dt * 0.8;
          const want = c.cruise * (1 + 0.025 * Math.sin(c.wobble)) * (c.finished ? 0.6 : 1);
          c.speed = clamp(accelerate(c.speed, c.speed < want ? MAX_SPEED / 3 : -MAX_SPEED / 3, dt), 0, Math.max(c.speed, want));
        }
      }
      c.offset += carSteer(c, oldSeg, playerSeg, dt);
      const z = c.z + dt * c.speed;
      if (z >= trackLength) {
        c.laps++;
        if (c.rival && c.laps >= LAPS) c.finished = true;
      }
      c.z = increase(c.z, dt * c.speed, trackLength);
      c.percent = (c.z % SEG) / SEG;
      const newSeg = findSegment(c.z);
      if (oldSeg !== newSeg) {
        oldSeg.cars.splice(oldSeg.cars.indexOf(c), 1);
        newSeg.cars.push(c);
      }
    });
  };

  const step = (dt) => {
    const playerSeg = findSegment(position + PLAYER_Z);
    const pct = speed / MAX_SPEED;
    const dx = dt * 2 * pct;
    const was = position;
    moveCars(dt, playerSeg);
    if (state !== 'playing') return;

    position = increase(position, dt * speed, trackLength);
    if (keys.left) playerX -= dx;
    if (keys.right) playerX += dx;
    playerX -= dx * pct * playerSeg.curve * CENTRIFUGAL;
    skyOffset = increase(skyOffset, 0.4 * playerSeg.curve * pct * dt * 60, W * 2);

    if (keys.gas) speed = accelerate(speed, ACCEL, dt);
    else if (keys.brake) speed = accelerate(speed, BRAKE, dt);
    else speed = accelerate(speed, DECEL, dt);

    if (playerX < -1 || playerX > 1) {
      if (speed > OFF_LIMIT) speed = accelerate(speed, OFF_DECEL, dt);
      for (const s of playerSeg.sprites) {
        const w = s.sprite.w;
        if (overlap(playerX, SPRITES.player.w, s.offset + (w / 2) * (s.offset > 0 ? 1 : -1), w)) {
          speed = MAX_SPEED / 5;
          position = increase(playerSeg.p1.world.z, -PLAYER_Z, trackLength);
          break;
        }
      }
    }
    for (const c of playerSeg.cars) {
      if (speed > c.speed && overlap(playerX, SPRITES.player.w, c.offset, c.sprite.w, 0.8)) {
        speed = c.speed * (c.speed / speed);
        position = increase(c.z, -PLAYER_Z, trackLength);
        break;
      }
    }
    playerX = clamp(playerX, -3, 3);
    speed = clamp(speed, 0, MAX_SPEED);

    // Over the line: the position wraps round to the start. A collision also sets it back a
    // little within a segment, so only a jump of at least half the track counts.
    if (position < was - trackLength / 2) {
      lap++;
      if (lap > LAPS) finish();
      else {
        banner = lap === LAPS ? 'FINAL LAP' : `LAP ${lap}`;
        bannerAt = raceTime;
      }
    }
  };

  const update = (dt) => {
    if (state === 'count') {
      countLeft -= dt * 1000;
      if (countLeft <= 0) {
        state = 'playing';
        banner = 'GO!';
        bannerAt = 0;
      }
    } else raceTime += dt * 1000;
    carry += dt;
    let n = 0;
    while (carry >= STEP && n++ < 4) {
      step(STEP);
      carry -= STEP;
    }
    carry = Math.min(carry, STEP);
    place = standing();
    updateStats();
  };

  /* ---------- Drawing ---------- */

  const project = (p, camX, camZ) => {
    p.camera.x = -camX;
    p.camera.y = -CAM_H;
    p.camera.z = p.world.z - camZ;
    p.screen.scale = CAM_DEPTH / p.camera.z;
    p.screen.x = Math.round(W / 2 + (p.screen.scale * p.camera.x * W) / 2);
    p.screen.y = Math.round(H / 2 - (p.screen.scale * p.camera.y * H) / 2);
    p.screen.w = Math.round((p.screen.scale * ROAD_W * W) / 2);
  };

  const poly = (x1, y1, x2, y2, x3, y3, x4, y4, col) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.lineTo(x4, y4);
    ctx.closePath();
    ctx.fill();
  };

  const drawSegment = (seg, fog) => {
    const { p1, p2 } = seg;
    const x1 = p1.screen.x;
    const y1 = p1.screen.y;
    const w1 = p1.screen.w;
    const x2 = p2.screen.x;
    const y2 = p2.screen.y;
    const w2 = p2.screen.w;
    const r1 = w1 / Math.max(6, 2 * LANES);
    const r2 = w2 / Math.max(6, 2 * LANES);
    const l1 = w1 / Math.max(32, 8 * LANES);
    const l2 = w2 / Math.max(32, 8 * LANES);
    ctx.fillStyle = seg.color.grass;
    ctx.fillRect(0, y2, W, y1 - y2);
    poly(x1 - w1 - r1, y1, x1 - w1, y1, x2 - w2, y2, x2 - w2 - r2, y2, seg.color.rumble);
    poly(x1 + w1 + r1, y1, x1 + w1, y1, x2 + w2, y2, x2 + w2 + r2, y2, seg.color.rumble);
    poly(x1 - w1, y1, x1 + w1, y1, x2 + w2, y2, x2 - w2, y2, seg.color.road);
    if (seg.color.lane) {
      const lw1 = (w1 * 2) / LANES;
      const lw2 = (w2 * 2) / LANES;
      let lx1 = x1 - w1 + lw1;
      let lx2 = x2 - w2 + lw2;
      for (let lane = 1; lane < LANES; lane++) {
        poly(lx1 - l1 / 2, y1, lx1 + l1 / 2, y1, lx2 + l2 / 2, y2, lx2 - l2 / 2, y2, seg.color.lane);
        lx1 += lw1;
        lx2 += lw2;
      }
    }
    if (fog < 1) {
      ctx.fillStyle = `rgba(216, 230, 234, ${1 - fog})`;
      ctx.fillRect(0, y2, W, y1 - y2);
    }
  };

  // A sprite scaled by distance, its bottom edge at destY, clipped where nearer road hides it.
  const drawSprite = (sprite, sc, destX, destY, offX, offY, clipY) => {
    const destW = ((sprite.w * sc * W) / 2) * ROAD_W;
    const destH = ((sprite.h * sc * W) / 2) * ROAD_W;
    const x = destX + destW * offX;
    const y = destY + destH * offY;
    const clipH = clipY ? Math.max(0, y + destH - clipY) : 0;
    if (clipH >= destH || destW < 1 || destW > W * 3) return; // too far, or right under the camera
    const img = sprite.img;
    ctx.drawImage(img, 0, 0, img.width, img.height - (img.height * clipH) / destH, x, y, destW, destH - clipH);
  };

  const drawBackground = () => {
    const sky = ctx.createLinearGradient(0, 0, 0, H / 2);
    sky.addColorStop(0, COLORS.sky[0]);
    sky.addColorStop(1, COLORS.sky[1]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H / 2 + 2);
    ctx.fillStyle = '#fff2e1';
    ctx.beginPath();
    ctx.arc(W * 0.72 - skyOffset * 0.1, 48, 16, 0, Math.PI * 2);
    ctx.fill();
    const hx = -Math.round(skyOffset) % (W * 2);
    ctx.drawImage(HILLS, hx, H / 2 - 56);
    ctx.drawImage(HILLS, hx + W * 2, H / 2 - 56);
    if (hx > 0) ctx.drawImage(HILLS, hx - W * 2, H / 2 - 56);
  };

  const drawRoad = () => {
    const base = findSegment(position);
    const basePct = (position % SEG) / SEG;
    const playerSeg = findSegment(position + PLAYER_Z);
    let maxy = H;
    let x = 0;
    let dx = -(base.curve * basePct);
    for (let n = 0; n < DRAW; n++) {
      const seg = segments[(base.index + n) % segments.length];
      seg.looped = seg.index < base.index;
      seg.fog = 1 / Math.exp(((n / DRAW) ** 2) * FOG);
      seg.clip = maxy;
      const camZ = position - (seg.looped ? trackLength : 0);
      project(seg.p1, playerX * ROAD_W - x, camZ);
      project(seg.p2, playerX * ROAD_W - x - dx, camZ);
      x += dx;
      dx += seg.curve;
      if (seg.p1.camera.z <= CAM_DEPTH || seg.p2.screen.y >= seg.p1.screen.y || seg.p2.screen.y >= maxy) continue;
      drawSegment(seg, seg.fog);
      maxy = seg.p1.screen.y;
    }
    for (let n = DRAW - 1; n > 0; n--) {
      const seg = segments[(base.index + n) % segments.length];
      for (const c of seg.cars) {
        const sc = lerp(seg.p1.screen.scale, seg.p2.screen.scale, c.percent);
        const sx = lerp(seg.p1.screen.x, seg.p2.screen.x, c.percent) + (sc * c.offset * ROAD_W * W) / 2;
        const sy = lerp(seg.p1.screen.y, seg.p2.screen.y, c.percent);
        drawSprite(c.sprite, sc, sx, sy, -0.5, -1, seg.clip);
      }
      for (const s of seg.sprites) {
        const sc = seg.p1.screen.scale;
        const sx = seg.p1.screen.x + (sc * s.offset * ROAD_W * W) / 2;
        drawSprite(s.sprite, sc, sx, seg.p1.screen.y, s.offset < 0 ? -1 : 0, -1, seg.clip);
      }
    }
    // The player's car, at the foot of the view, bouncing a little with speed and leaning into the turns.
    const pct = speed / MAX_SPEED;
    const bounce = 1.5 * Math.random() * pct * (Math.random() < 0.5 ? -1 : 1);
    const sprite = keys.brake && speed > 0 ? SPRITES.braking : SPRITES.player;
    const lean = (keys.left ? -1 : keys.right ? 1 : 0) * pct * 0.08;
    ctx.save();
    ctx.translate(W / 2, H - 8);
    ctx.rotate(lean);
    ctx.fillStyle = 'rgba(0, 0, 0, .25)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 58, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    drawSprite(sprite, CAM_DEPTH / PLAYER_Z, 0, bounce, -0.5, -1, 0);
    ctx.restore();
    if (playerSeg && (playerX < -1 || playerX > 1) && speed > 0) { // dust off the grass
      ctx.fillStyle = 'rgba(141, 176, 126, .6)';
      for (let i = 0; i < 5; i++) ctx.fillRect(W / 2 - 60 + Math.random() * 120, H - 16 - Math.random() * 14, 3, 3);
    }
  };

  const drawHud = () => {
    ctx.fillStyle = 'rgba(43, 26, 8, .55)';
    ctx.fillRect(0, 0, W, 22);
    ctx.font = '600 11px "JetBrains Mono", ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff2e1';
    ctx.textAlign = 'left';
    ctx.fillText(`LAP ${Math.min(lap, LAPS)}/${LAPS}`, 10, 11);
    ctx.textAlign = 'center';
    ctx.fillText(fmtTime(raceTime), W / 2, 11);
    ctx.textAlign = 'right';
    ctx.fillStyle = place === 1 ? '#f4c15d' : '#fff2e1';
    ctx.fillText(`${ordinal(place)} / ${RIVALS + 1}`, W - 10, 11);
    ctx.textAlign = 'right';
    ctx.font = '700 22px "Space Grotesk", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255, 242, 225, .9)';
    ctx.fillText(String(Math.round((speed / MAX_SPEED) * 320)), W - 34, H - 22);
    ctx.font = '600 10px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillText('km/h', W - 8, H - 20);
    if (state === 'count') {
      const n = Math.ceil(countLeft / 1000);
      ctx.font = '700 64px "Space Grotesk", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = INK;
      ctx.fillText(String(n), W / 2 + 3, H / 2 - 17);
      ctx.fillStyle = n === 1 ? '#f4c15d' : '#d9745a';
      ctx.fillText(String(n), W / 2, H / 2 - 20);
    } else if (banner && raceTime - bannerAt < BANNER_MS) {
      const k = (raceTime - bannerAt) / BANNER_MS;
      ctx.globalAlpha = k > 0.75 ? (1 - k) / 0.25 : 1;
      ctx.font = '700 40px "Space Grotesk", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = INK;
      ctx.fillText(banner, W / 2 + 2, H / 2 - 18);
      ctx.fillStyle = '#f4c15d';
      ctx.fillText(banner, W / 2, H / 2 - 20);
      ctx.globalAlpha = 1;
    }
    if (state === 'idle') {
      ctx.font = '500 11px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255, 242, 225, .7)';
      ctx.fillText(touch?.matches ? 'hold GO to accelerate, the arrows to steer' : '↑ accelerates, ↓ brakes, ← → steer', W / 2, H - 50);
    }
  };

  const draw = () => {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawBackground();
    drawRoad();
    drawHud();
  };

  const updateStats = () => {
    out('lap').textContent = `${Math.min(lap, LAPS)} / ${LAPS}`;
    out('time').textContent = fmtTime(raceTime);
    out('place').textContent = ordinal(place);
    out('speed').textContent = `${Math.round((speed / MAX_SPEED) * 320)} km/h`;
    out('best').textContent = best[mode] ? fmtTime(best[mode]) : '-';
  };

  /* ---------- Flow ---------- */

  const showOverlay = (text, label) => {
    msg.textContent = text;
    startBtn.textContent = label;
    overlay.hidden = false;
  };

  const award = (key) => window.arcadeMons?.award(key); // a monster for a first-time achievement, see rewards.csv

  const finish = () => {
    state = 'over';
    endedAt = performance.now();
    cancelAnimationFrame(raf);
    held.clear();
    Object.keys(keys).forEach((k) => { keys[k] = false; });
    place = standing();
    award(`race.${mode}.finish`);
    if (place <= 3) award(`race.${mode}.podium`);
    if (place === 1) award(`race.${mode}.first`);
    const ms = Math.round(raceTime);
    let note = '';
    if (!best[mode] || ms < best[mode]) {
      best[mode] = ms;
      saveBest();
      note = ' A new best!';
    }
    updateStats();
    draw();
    showOverlay(`${ordinal(place)} place in ${fmtTime(ms)}.${note}`, 'Race again');
  };

  const tick = (t) => {
    if (!RUNNING.has(state)) return;
    const dt = Math.max(0, Math.min(50, t - lastTime)) / 1000;
    lastTime = t;
    update(dt);
    if (RUNNING.has(state)) {
      draw();
      raf = requestAnimationFrame(tick);
    }
  };

  const resume = () => {
    state = before;
    stage.focus({ preventScroll: true });
    overlay.hidden = true;
    lastTime = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  };

  const start = () => {
    buildTrack();
    position = 0;
    playerX = 0;
    speed = 0;
    lap = 1;
    raceTime = 0;
    carry = 0;
    skyOffset = 0;
    banner = '';
    place = RIVALS + 1;
    countLeft = COUNT_MS;
    before = 'count';
    updateStats();
    resume();
  };

  const pause = () => {
    if (!RUNNING.has(state)) return;
    before = state;
    state = 'paused';
    cancelAnimationFrame(raf);
    held.clear();
    Object.keys(keys).forEach((k) => { keys[k] = false; });
    draw();
    showOverlay('Paused', 'Resume');
  };

  const startOrResume = () => (state === 'paused' ? resume() : start());

  const setMode = (name) => {
    mode = name;
    cfg = MODES[mode];
    modeBtns.forEach((b) => {
      const on = b.dataset.mode === name;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    cancelAnimationFrame(raf);
    held.clear();
    Object.keys(keys).forEach((k) => { keys[k] = false; });
    state = 'idle';
    buildTrack();
    position = 0;
    playerX = 0;
    speed = 0;
    lap = 1;
    raceTime = 0;
    place = 1;
    banner = '';
    updateStats();
    draw();
    showOverlay(cfg.idle, 'Start race');
  };

  /* ---------- Input ---------- */

  const press = (code, down) => {
    if (STEER_KEYS[code]) keys[STEER_KEYS[code]] = down;
    else if (GAS_KEYS.has(code)) keys.gas = down;
    else if (BRAKE_KEYS.has(code)) keys.brake = down;
    else return false;
    return true;
  };

  root.addEventListener('keydown', (e) => {
    if (e.target.closest('button') && (e.code === 'Enter' || e.code === 'Space')) return;
    if (!RUNNING.has(state)) {
      const ok = START_KEYS.has(e.code) || (state === 'paused' && PAUSE_KEYS.has(e.code));
      if (!ok) return;
      e.preventDefault();
      if (e.repeat || (state === 'over' && performance.now() - endedAt < RESTART_GRACE)) return;
      startOrResume();
      return;
    }
    if (PAUSE_KEYS.has(e.code)) {
      e.preventDefault();
      if (!e.repeat) pause();
    } else if (press(e.code, true)) {
      e.preventDefault();
      held.add(e.code);
    }
  });
  root.addEventListener('keyup', (e) => {
    held.delete(e.code);
    press(e.code, false);
  });

  // Touch pad: hold the arrows to steer, GO to accelerate and the brake to slow down.
  root.querySelectorAll('[data-dir], [data-act]').forEach((b) => {
    const what = b.dataset.dir || b.dataset.act;
    if (what === 'pause') {
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); pause(); });
      return;
    }
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (!RUNNING.has(state)) return;
      keys[what] = true;
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((type) => b.addEventListener(type, () => { keys[what] = false; }));
  });

  startBtn.addEventListener('click', startOrResume);
  modeBtns.forEach((b) => b.addEventListener('click', () => { if (b.dataset.mode !== mode) setMode(b.dataset.mode); }));

  // Pause whenever the player's attention goes elsewhere.
  root.addEventListener('focusout', (e) => {
    if (e.relatedTarget && !root.contains(e.relatedTarget)) pause();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!root.contains(e.target)) pause();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
  });
  window.addEventListener('blur', pause);

  const fit = () => {
    const w = Math.round(track.clientWidth * (window.devicePixelRatio || 1));
    if (!w) return;
    track.width = w;
    track.height = Math.round((w * H) / W);
    scale = w / W;
    draw();
  };
  // The dungeon (dungeon.js) puts this window away and brings it back.
  root.addEventListener('scene-exit', pause);
  root.addEventListener('scene-enter', fit);
  if ('ResizeObserver' in window) new ResizeObserver(fit).observe(track);

  setMode('normal');
  fit();
})();
