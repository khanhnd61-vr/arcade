// Climb for the Play section: a little climber scales a tower shaft with no
// top, jumping from ledge to ledge while lava rises up the shaft behind. Run
// with the arrows and jump with Up; let go early for a shorter hop. Some
// ledges slide from side to side and the cracked ones crumble a moment after
// they are stood on. Fall out of the bottom of the view, or into the lava,
// and the climb is over. The height is counted in metres; the best climb is
// kept per mode. Hard has narrower ledges, longer jumps and quicker lava.
(() => {
  const root = document.querySelector('[data-climb]');
  if (!root) return;

  // The shaft has its own units; the canvas is scaled to whatever size it gets.
  const W = 320;
  const H = 480;
  const WALL = 20; // width of each side wall
  const PX = 2; // one sprite pixel, in shaft units
  const GRAVITY = 1500; // units per second squared
  const JUMP = -540; // upward speed given by a jump (about 97 units of height)
  const JUMP_CUT = -220; // the upward speed left when the jump key is let go early
  const MAX_FALL = 700;
  const RUN = 190; // top running speed
  const ACCEL = 1900; // on the ground and in the air alike
  const BRAKE = 1500; // slowing down with no key held
  const COYOTE = 90; // ms after stepping off a ledge during which a jump still counts
  const BUFFER = 120; // ms a jump pressed just before landing is kept
  const BODY_W = 12; // the climber's hit box, in units
  const BODY_H = 22;
  const CAM_LINE = 0.42; // the view scrolls once the climber's head is above this fraction of it
  const CAM_EASE = 90; // ms for the view to catch up
  const METRE = 16; // units per metre of height
  const CRUMBLE_MS = 380; // how long a cracked ledge holds
  const LAVA_LAG = 100; // the lava is never further than this below the bottom of the view
  const LAVA_WAIT = 5000; // ms the lava holds still at the start if the climber does not move
  const DIE_MS = 750; // the fall or the splash plays this long before the game is over
  const RESTART_GRACE = 800; // ms after the end before a held key can restart
  const BEST_KEY = 'climb-best';
  const INK = '#2b1a08';
  // Ledges: the vertical gap and the width of each, the speed of the lava in
  // units per second, and from which heights (metres) sliding and crumbling
  // ledges start to appear.
  const MODES = {
    normal: { gap: [44, 84], width: [52, 76], lava: 24, moveFrom: 12, crumbleFrom: 25, idle: 'Jump from ledge to ledge. The lava is coming up behind you.' },
    hard: { gap: [56, 88], width: [40, 60], lava: 42, moveFrom: 5, crumbleFrom: 12, idle: 'Narrow ledges, long jumps, quick lava. Keep moving.' },
  };
  const KEYS = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
  const JUMP_KEYS = new Set(['ArrowUp', 'KeyW', 'Space', 'KeyZ', 'KeyX']);
  const PAUSE_KEYS = new Set(['KeyP', 'Escape']);
  const START_KEYS = new Set(['Enter', 'NumpadEnter', 'Space', 'KeyZ']);
  const RUNNING = new Set(['playing', 'dying']);

  const stage = root.querySelector('[data-stage]');
  const tower = root.querySelector('[data-tower]');
  const overlay = root.querySelector('[data-overlay]');
  const msg = root.querySelector('[data-msg]');
  const startBtn = root.querySelector('[data-start]');
  const modeBtns = root.querySelectorAll('[data-mode]');
  const out = (k) => root.querySelector(`[data-out="${k}"]`);
  const ctx = tower.getContext('2d');
  const touch = window.matchMedia?.('(pointer: coarse)');

  const loadBest = (m) => {
    try { return Number(localStorage.getItem(`${BEST_KEY}-${m}`)) || 0; } catch { return 0; }
  };
  const saveBest = (m, n) => {
    try { localStorage.setItem(`${BEST_KEY}-${m}`, String(n)); } catch { /* storage unavailable */ }
  };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);

  /* ---------- Pixel art ---------- */

  // The climber, 8 x 11 pixels facing right: r hat, f face, k eyes and boots,
  // b jacket, p the pack on their back, t trousers. Four poses.
  const PAL = { r: '#d9745a', f: '#fff2e1', k: INK, b: '#6f8fc0', p: '#8b5a2b', t: '#4b2e0f' };
  const HEAD = ['..rrrr..', '.rrrrrr.', '..ffff..', '..fkfk..', '..ffff..'];
  const POSES = {
    stand: [...HEAD, 'p.bbbb..', 'ppbbbbf.', 'p.bbbb..', '..tttt..', '..t..t..', '..k..k..'],
    run1: [...HEAD, 'p.bbbb..', 'ppbbbbf.', 'p.bbbb..', '..tttt..', '.tt..tt.', '.k....k.'],
    run2: [...HEAD, 'p.bbbb..', 'ppbbbbf.', 'p.bbbb..', '..tttt..', '..tttt..', '..k..k..'],
    jump: [...HEAD, 'p.bbbbf.', 'ppbbbb..', 'p.bbbb..', '..tttt..', '..tt.t..', '..k...k.'],
  };
  const render = (rows, flip) => {
    const c = document.createElement('canvas');
    c.width = 8 * PX;
    c.height = 11 * PX;
    const g = c.getContext('2d');
    if (flip) {
      g.translate(c.width, 0);
      g.scale(-1, 1);
    }
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (!PAL[ch]) return;
      g.fillStyle = PAL[ch];
      g.fillRect(x * PX, y * PX, PX, PX);
    }));
    return c;
  };
  const SPRITES = Object.fromEntries(Object.entries(POSES).map(([k, rows]) => [k, [render(rows, true), render(rows)]]));

  /* ---------- State ---------- */

  let mode = 'normal';
  let cfg = MODES[mode];
  let state = 'idle'; // idle | playing | dying | paused | over
  let before = 'playing'; // what the pause interrupted
  let best = loadBest(mode);
  let runs = 0;
  let raf = 0;
  let lastTime = 0;
  let scale = 1;
  let groundY = H - 24; // the floor the climb starts from, in shaft units
  let camY = 0; // top of the view, in shaft units (smaller is higher)
  let lavaY = 0; // the lava's surface
  let peak = 0; // the greatest height reached, in metres
  let started = 0; // ms of play so far, for the opening hint
  let diedAt = 0;
  let how = ''; // 'fell' or 'burned'
  let ledges = [];
  let particles = []; // dust: x, y, vx, vy, life
  const climber = { x: 0, y: 0, vx: 0, vy: 0, dir: 1, ground: null, sinceGround: 0, buffer: 0, jumping: false, run: 0 };
  const held = []; // directions held, most recent last
  let jumpHeld = false;

  const heightOf = (y) => Math.max(0, (groundY - y) / METRE);

  // How far sideways a jump can carry the climber while rising `gap` units: the
  // time in the air until they are that high again on the way down, at top speed,
  // with a margin for the player.
  const reach = (gap) => {
    const t = (-JUMP + Math.sqrt(Math.max(0, JUMP * JUMP - 2 * GRAVITY * gap))) / GRAVITY;
    return t * RUN * 0.85;
  };

  const addLedge = () => {
    const prev = ledges[ledges.length - 1];
    const gap = rand(...cfg.gap);
    const w = Math.round(rand(...cfg.width));
    const y = Math.round(prev.y - gap);
    const prevMid = prev.x + prev.w / 2;
    const span = reach(gap) + (prev.w + w) / 2 - 8;
    const lo = Math.max(WALL, prevMid - span - w / 2);
    const hi = Math.min(W - WALL - w, prevMid + span - w / 2);
    const x = Math.round(rand(lo, hi));
    const h = heightOf(y);
    const roll = Math.random();
    let type = 'stone';
    if (h > cfg.crumbleFrom && prev.type !== 'crumble' && roll < 0.22) type = 'crumble';
    else if (h > cfg.moveFrom && roll < 0.45) type = 'move';
    const ledge = { x, y, w, h: 10, type, gone: false, crumbleAt: 0, fallVy: 0 };
    if (type === 'move') {
      ledge.x0 = x;
      ledge.range = Math.min(rand(30, 70), x - WALL, W - WALL - w - x);
      ledge.speed = rand(1.2, 2.2);
      ledge.phase = rand(0, Math.PI * 2);
    }
    ledges.push(ledge);
  };

  const fillLedges = () => {
    while (ledges[ledges.length - 1].y > camY - 120) addLedge();
  };

  const reset = () => {
    camY = 0;
    groundY = H - 24;
    lavaY = groundY + 140;
    peak = 0;
    started = 0;
    how = '';
    ledges = [{ x: WALL, y: groundY, w: W - 2 * WALL, h: 24, type: 'floor', gone: false, crumbleAt: 0, fallVy: 0 }];
    particles = [];
    Object.assign(climber, { x: W / 2, y: groundY, vx: 0, vy: 0, dir: 1, ground: ledges[0], sinceGround: 0, buffer: 0, jumping: false, run: 0 });
    held.length = 0;
    jumpHeld = false;
    fillLedges();
  };

  const puff = (n, up) => {
    for (let i = 0; i < n; i++) {
      particles.push({ x: climber.x + rand(-6, 6), y: climber.y - rand(0, 3), vx: rand(-50, 50), vy: up ? rand(-40, 10) : rand(-70, -20), life: rand(220, 380) });
    }
  };

  /* ---------- Drawing ---------- */

  const drawShaft = (t) => {
    ctx.fillStyle = '#1e2130';
    ctx.fillRect(0, 0, W, H);
    // The brickwork at the back, scrolling with the view.
    const off = ((camY % 32) + 32) % 32;
    ctx.fillStyle = '#242839';
    for (let y = -off; y < H; y += 16) ctx.fillRect(WALL, y, W - 2 * WALL, 1);
    for (let y = -off, i = 0; y < H + 16; y += 16, i++) {
      for (let x = WALL + ((i % 2) ? 16 : 0); x < W - WALL; x += 32) ctx.fillRect(x, y, 1, 16);
    }
    // The side walls, in heavier stone, with a torch every so often.
    [[0, WALL], [W - WALL, WALL]].forEach(([x0, w]) => {
      ctx.fillStyle = '#3b3f52';
      ctx.fillRect(x0, 0, w, H);
      ctx.fillStyle = '#4b5066';
      for (let y = -off, i = 0; y < H + 16; y += 16, i++) {
        const shift = (i % 2) ? 8 : 0;
        ctx.fillRect(x0 + 1, y + 1, shift ? 7 : 11, 14);
        ctx.fillRect(x0 + (shift ? 10 : 14), y + 1, shift ? 9 : 5, 14);
      }
      ctx.fillStyle = '#2a2e3d';
      ctx.fillRect(x0 === 0 ? WALL - 1 : x0, 0, 1, H);
    });
    // Torches, alternating sides every 160 units, and a height mark every 10 metres.
    const top = Math.floor(camY / 160) - 1;
    const bottom = Math.ceil((camY + H) / 160) + 1;
    for (let i = top; i <= bottom; i++) {
      const sy = i * 160 + 40 - camY;
      const x = (i % 2 ? WALL - 8 : W - WALL + 2);
      ctx.fillStyle = INK;
      ctx.fillRect(x + 2, sy, 2, 7);
      const alt = Math.floor(t / 200 + i) % 2;
      ctx.fillStyle = '#e2a963';
      ctx.fillRect(x + 1, sy - 4 + alt, 4, 4);
      ctx.fillStyle = '#f4c15d';
      ctx.fillRect(x + 2, sy - 5 + alt, 2, 4);
      ctx.fillStyle = 'rgba(244, 193, 93, .08)';
      ctx.fillRect(x - 10, sy - 14, 26, 26);
    }
    ctx.font = '600 9px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const first = Math.max(10, Math.ceil(heightOf(camY + H) / 10) * 10);
    const last = Math.floor(heightOf(camY) / 10) * 10;
    for (let m = first; m <= last; m += 10) {
      const sy = groundY - m * METRE - camY;
      ctx.fillStyle = '#2a2e3d';
      ctx.fillRect(1, sy - 6, WALL - 2, 12);
      ctx.fillStyle = 'rgba(255, 242, 225, .6)';
      ctx.fillText(String(m), WALL / 2, sy + 1);
      ctx.fillStyle = 'rgba(255, 242, 225, .25)';
      ctx.fillRect(WALL, sy, W - 2 * WALL, 1);
    }
  };

  const drawLedge = (l, t) => {
    const sy = l.y - camY;
    if (sy > H + 30 || sy + l.h < -10) return;
    let sx = l.x;
    if (l.type === 'crumble' && l.crumbleAt && !l.gone) sx += Math.round(Math.sin(t / 18) * 1.5);
    ctx.globalAlpha = l.gone ? 0.6 : 1;
    if (l.type === 'floor') {
      ctx.fillStyle = '#6b7585';
      ctx.fillRect(sx, sy, l.w, l.h);
      ctx.fillStyle = '#9aa5b5';
      for (let x = sx; x < sx + l.w; x += 24) {
        ctx.fillRect(x + 1, sy + 1, 22, 10);
        ctx.fillRect(x + 13, sy + 13, 22, 10);
      }
      ctx.fillStyle = '#c3ccd8';
      ctx.fillRect(sx, sy, l.w, 2);
      ctx.globalAlpha = 1;
      return;
    }
    const body = l.type === 'crumble' ? '#b48c6a' : l.type === 'move' ? '#8fb8c4' : '#9aa5b5';
    const light = l.type === 'crumble' ? '#d2ad8a' : l.type === 'move' ? '#b8d2dc' : '#c3ccd8';
    const dark = l.type === 'crumble' ? '#6b4420' : l.type === 'move' ? '#5c7a8a' : '#6b7585';
    ctx.fillStyle = 'rgba(0, 0, 0, .3)';
    ctx.fillRect(sx + 2, sy + l.h, l.w - 2, 3);
    ctx.fillStyle = dark;
    ctx.fillRect(sx, sy, l.w, l.h);
    ctx.fillStyle = body;
    ctx.fillRect(sx + 1, sy + 1, l.w - 2, l.h - 3);
    ctx.fillStyle = light;
    ctx.fillRect(sx + 1, sy + 1, l.w - 2, 2);
    ctx.fillStyle = dark;
    for (let x = sx + 12; x < sx + l.w - 6; x += 16) ctx.fillRect(x, sy + 4, 1, l.h - 6); // the joints
    if (l.type === 'move') {
      // Little arrows at either end.
      ctx.fillStyle = INK;
      ctx.fillRect(sx + 3, sy + 5, 3, 1);
      ctx.fillRect(sx + 3, sy + 4, 1, 3);
      ctx.fillRect(sx + l.w - 6, sy + 5, 3, 1);
      ctx.fillRect(sx + l.w - 4, sy + 4, 1, 3);
    } else if (l.type === 'crumble') {
      ctx.fillStyle = dark;
      const mid = sx + Math.floor(l.w / 2);
      [[mid - 3, 1], [mid - 2, 2], [mid - 2, 3], [mid - 1, 4], [mid, 5], [mid, 6], [mid + 1, 7], [mid + 6, 1], [mid + 5, 2], [mid - 8, 6], [mid - 7, 7]]
        .forEach(([x, dy]) => ctx.fillRect(x, sy + dy, 1, 1));
    }
    ctx.globalAlpha = 1;
  };

  const drawClimber = (t) => {
    const c = climber;
    let pose = 'stand';
    if (!c.ground) pose = 'jump';
    else if (Math.abs(c.vx) > 20) pose = Math.floor(c.run / 110) % 2 ? 'run2' : 'run1';
    const sprite = SPRITES[pose][c.dir > 0 ? 1 : 0];
    const sx = Math.round(c.x - 4 * PX);
    const sy = Math.round(c.y - camY - 11 * PX);
    if (state === 'dying' && how === 'fell') {
      ctx.save();
      ctx.translate(sx + 4 * PX, sy + 6 * PX);
      ctx.rotate(((t - diedAt) / DIE_MS) * Math.PI * 2 * c.dir);
      ctx.drawImage(SPRITES.jump[c.dir > 0 ? 1 : 0], -4 * PX, -6 * PX);
      ctx.restore();
      return;
    }
    if (c.ground) {
      ctx.fillStyle = 'rgba(0, 0, 0, .3)';
      ctx.fillRect(sx + 2, sy + 11 * PX, 12, 2);
    }
    ctx.drawImage(sprite, sx, sy);
  };

  const drawLava = (t) => {
    const sy = lavaY - camY;
    if (sy > H + 40) return;
    // A glow on the walls just above the surface.
    const grad = ctx.createLinearGradient(0, sy - 60, 0, sy);
    grad.addColorStop(0, 'rgba(217, 116, 90, 0)');
    grad.addColorStop(1, 'rgba(217, 116, 90, .35)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, sy - 60, W, 60);
    ctx.fillStyle = '#d9745a';
    ctx.fillRect(0, sy + 2, W, H - sy);
    ctx.fillStyle = '#f4c15d';
    for (let x = 0; x < W; x += 8) {
      const wave = Math.round(Math.sin(t / 220 + x / 14) * 2);
      ctx.fillRect(x, sy + wave, 8, 4);
      ctx.fillStyle = '#d9745a';
      ctx.fillRect(x, sy + wave + 4, 8, 1);
      ctx.fillStyle = '#f4c15d';
    }
    // Bubbles that rise and pop.
    for (let i = 0; i < 6; i++) {
      const k = ((t / 900 + i * 0.37) % 1);
      const bx = ((i * 97 + Math.floor(t / 900 + i * 0.37) * 53) % (W - 20)) + 10;
      const by = sy + 26 - k * 22;
      ctx.fillStyle = k > 0.85 ? '#fff2e1' : '#e2a963';
      const r = k > 0.85 ? 3 : 2;
      ctx.fillRect(bx - r / 2, by - r / 2, r, r);
    }
    if (state === 'dying' && how === 'burned') {
      const k = Math.min(1, (t - diedAt) / 300);
      ctx.fillStyle = `rgba(244, 193, 93, ${0.5 * (1 - k)})`;
      ctx.fillRect(0, 0, W, H);
    }
  };

  const draw = (t = performance.now()) => {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.imageSmoothingEnabled = false;
    drawShaft(t);
    ledges.forEach((l) => drawLedge(l, t));
    ctx.fillStyle = 'rgba(255, 242, 225, .7)';
    particles.forEach((p) => ctx.fillRect(Math.round(p.x), Math.round(p.y - camY), 2, 2));
    drawClimber(t);
    drawLava(t);
    // The height, and a hint for the first few seconds.
    ctx.font = '600 14px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(30, 33, 48, .7)';
    ctx.fillRect(W / 2 - 34, 6, 68, 22);
    ctx.fillStyle = '#fff2e1';
    ctx.fillText(`${Math.floor(peak)} m`, W / 2, 10);
    if (state === 'playing' && started < 3500) {
      ctx.font = '500 11px "JetBrains Mono", ui-monospace, monospace';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = `rgba(255, 242, 225, ${Math.min(1, (3500 - started) / 500) * 0.9})`;
      ctx.fillText(touch?.matches ? 'arrows to run, the big button to jump' : 'arrows to run, up to jump', W / 2, H - 60);
    }
  };

  const updateStats = () => {
    out('height').textContent = `${Math.floor(peak)} m`;
    out('best').textContent = best ? `${best} m` : '-';
    out('runs').textContent = runs;
  };

  /* ---------- Play ---------- */

  const showOverlay = (text, label) => {
    msg.textContent = text;
    startBtn.textContent = label;
    overlay.hidden = false;
  };

  const die = (cause, t) => {
    state = 'dying';
    how = cause;
    diedAt = t;
    held.length = 0;
    if (cause === 'burned') {
      climber.vy = 60;
      climber.vx = 0;
    }
  };

  const award = (key) => window.arcadeMons?.award(key); // a monster for a first-time achievement, see rewards.csv

  const finish = () => {
    state = 'over';
    cancelAnimationFrame(raf);
    runs++;
    const h = Math.floor(peak);
    const record = h > best;
    if (record) {
      best = h;
      saveBest(mode, best);
    }
    updateStats();
    draw();
    const what = how === 'burned' ? 'The lava caught you' : 'You fell';
    showOverlay(`${record ? 'New best! ' : ''}${what} at ${h} m.`, 'Climb again');
  };

  const jump = () => {
    const c = climber;
    c.vy = JUMP;
    c.ground = null;
    c.sinceGround = COYOTE + 1;
    c.buffer = 0;
    c.jumping = true;
    puff(3, true);
  };

  const update = (ms, t) => {
    const dt = ms / 1000;
    const c = climber;
    // Dust fades whatever is going on.
    particles.forEach((p) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 300 * dt;
      p.life -= ms;
    });
    particles = particles.filter((p) => p.life > 0);

    if (state === 'dying') {
      c.vy = Math.min(MAX_FALL, c.vy + (how === 'burned' ? 0 : GRAVITY) * dt);
      c.y += c.vy * dt;
      c.x += c.vx * dt;
      if (t - diedAt >= DIE_MS) finish();
      return;
    }
    if (state !== 'playing') return;
    started += ms;

    // The ledges that slide carry whoever stands on them; the cracked ones give way.
    ledges.forEach((l) => {
      if (l.gone) {
        l.fallVy += GRAVITY * 0.6 * dt;
        l.y += l.fallVy * dt;
        return;
      }
      if (l.type === 'move') {
        const nx = l.x0 + Math.sin(l.phase + t / 1000 * l.speed) * l.range;
        if (c.ground === l) c.x += nx - l.x;
        l.x = nx;
      } else if (l.type === 'crumble' && l.crumbleAt && t - l.crumbleAt >= CRUMBLE_MS) {
        l.gone = true;
        if (c.ground === l) c.ground = null;
      }
    });

    // Running: the held key accelerates, nothing held slows down.
    const dir = held[held.length - 1];
    if (dir) {
      const s = dir === 'right' ? 1 : -1;
      c.vx = clamp(c.vx + s * ACCEL * dt, -RUN, RUN);
      c.dir = s;
    } else {
      const s = Math.sign(c.vx);
      c.vx -= s * BRAKE * dt;
      if (Math.sign(c.vx) !== s) c.vx = 0;
    }
    if (c.ground) c.run += Math.abs(c.vx) > 20 ? ms : 0;

    // Still standing on something?
    if (c.ground) {
      const l = c.ground;
      if (l.gone || c.x + BODY_W / 2 <= l.x || c.x - BODY_W / 2 >= l.x + l.w) c.ground = null;
      else c.sinceGround = 0;
    }
    c.sinceGround += ms;
    c.buffer -= ms;
    if (c.buffer > 0 && (c.ground || c.sinceGround <= COYOTE)) jump();
    if (!c.ground) c.vy = Math.min(MAX_FALL, c.vy + GRAVITY * dt);

    c.x += c.vx * dt;
    if (c.x - BODY_W / 2 < WALL) { c.x = WALL + BODY_W / 2; c.vx = 0; }
    if (c.x + BODY_W / 2 > W - WALL) { c.x = W - WALL - BODY_W / 2; c.vx = 0; }
    const prevY = c.y;
    c.y += c.vy * dt;
    // Landing: the feet cross the top of a ledge on the way down.
    if (c.vy >= 0 && !c.ground) {
      let hit = null;
      ledges.forEach((l) => {
        if (l.gone) return;
        if (c.x + BODY_W / 2 <= l.x || c.x - BODY_W / 2 >= l.x + l.w) return;
        if (prevY <= l.y + 0.5 && c.y >= l.y && (!hit || l.y < hit.y)) hit = l;
      });
      if (hit) {
        c.y = hit.y;
        c.vy = 0;
        c.ground = hit;
        c.sinceGround = 0;
        c.jumping = false;
        if (hit.type === 'crumble' && !hit.crumbleAt) hit.crumbleAt = t;
        puff(4, false);
      }
    } else if (c.ground && c.ground.type === 'crumble' && !c.ground.crumbleAt) c.ground.crumbleAt = t;

    // The view follows upward only; the lava climbs behind.
    const h = heightOf(c.y);
    if (h > peak) {
      if (Math.floor(h) !== Math.floor(peak)) out('height').textContent = `${Math.floor(h)} m`;
      [50, 150, 300].forEach((m) => { if (peak < m && h >= m) award(`climb.${mode}.${m}`); });
      peak = h;
    }
    const head = c.y - BODY_H;
    const want = Math.min(camY, head - H * CAM_LINE);
    camY += (want - camY) * Math.min(1, ms / CAM_EASE);
    // The lava waits for the first jump, or a few seconds, then climbs faster the higher the climb goes.
    if (peak > 0 || started > LAVA_WAIT) lavaY -= Math.min(140, cfg.lava + peak * 0.25) * dt;
    lavaY = Math.min(lavaY, camY + H + LAVA_LAG);
    fillLedges();
    ledges = ledges.filter((l) => l.y < camY + H + 200);

    if (c.y - 6 > lavaY) die('burned', t);
    else if (c.y - BODY_H > camY + H + 10) die('fell', t);
  };

  const tick = (t) => {
    if (!RUNNING.has(state)) return;
    const dt = Math.max(0, Math.min(50, t - lastTime)); // the first frame stamp can predate run()
    lastTime = t;
    update(dt, t);
    draw(t);
    if (RUNNING.has(state)) raf = requestAnimationFrame(tick);
  };

  const run = () => {
    stage.focus({ preventScroll: true });
    overlay.hidden = true;
    lastTime = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  };

  const start = () => {
    reset();
    state = 'playing';
    updateStats();
    run();
  };

  const pause = () => {
    if (!RUNNING.has(state)) return;
    before = state;
    state = 'paused';
    cancelAnimationFrame(raf);
    held.length = 0;
    jumpHeld = false;
    draw();
    showOverlay('Paused', 'Resume');
  };

  const resume = () => {
    state = before;
    if (state === 'dying') diedAt = performance.now();
    run();
  };

  const startOrResume = () => (state === 'paused' ? resume() : start());

  // Switching mode abandons the current climb.
  const setMode = (name) => {
    mode = name;
    cfg = MODES[name];
    modeBtns.forEach((b) => {
      const on = b.dataset.mode === name;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    cancelAnimationFrame(raf);
    state = 'idle';
    best = loadBest(name);
    reset();
    updateStats();
    draw();
    showOverlay(cfg.idle, 'Start climbing');
  };

  /* ---------- Input ---------- */

  const unhold = (dir) => {
    const i = held.indexOf(dir);
    if (i >= 0) held.splice(i, 1);
  };
  const hold = (dir) => {
    unhold(dir);
    held.push(dir);
  };
  const pressJump = () => {
    if (state !== 'playing' || jumpHeld) return;
    jumpHeld = true;
    climber.buffer = BUFFER;
  };
  const releaseJump = () => {
    jumpHeld = false;
    if (state === 'playing' && climber.jumping && climber.vy < JUMP_CUT) climber.vy = JUMP_CUT;
  };

  // Keys only reach the game while it has focus, so the page scrolls normally otherwise.
  root.addEventListener('keydown', (e) => {
    if (e.target.closest('button') && (e.code === 'Enter' || e.code === 'Space')) return;
    if (state === 'playing') {
      if (KEYS[e.code]) {
        e.preventDefault();
        if (!e.repeat) hold(KEYS[e.code]);
      } else if (JUMP_KEYS.has(e.code)) {
        e.preventDefault();
        if (!e.repeat) pressJump();
      } else if (PAUSE_KEYS.has(e.code)) {
        e.preventDefault();
        if (!e.repeat) pause();
      }
      return;
    }
    if (state === 'dying') {
      if (KEYS[e.code] || JUMP_KEYS.has(e.code)) e.preventDefault();
      return;
    }
    // Idle, paused or over: Enter, Space or Z starts; while paused, the pause and arrow keys resume too.
    const go = START_KEYS.has(e.code) || (state === 'paused' && (PAUSE_KEYS.has(e.code) || KEYS[e.code] || JUMP_KEYS.has(e.code)));
    if (!go) return;
    e.preventDefault();
    if (e.repeat || (state === 'over' && performance.now() - diedAt - DIE_MS < RESTART_GRACE)) return;
    startOrResume();
  });
  root.addEventListener('keyup', (e) => {
    if (KEYS[e.code]) unhold(KEYS[e.code]);
    else if (JUMP_KEYS.has(e.code)) releaseJump();
  });
  window.addEventListener('blur', () => { held.length = 0; jumpHeld = false; });

  // A click or a finger on the tower jumps, like the keys.
  tower.addEventListener('pointerdown', (e) => {
    if (state !== 'playing') return;
    e.preventDefault();
    stage.focus({ preventScroll: true });
    pressJump();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((type) => tower.addEventListener(type, releaseJump));

  // Touch pad: hold a direction to keep running; the big button jumps, the last one pauses.
  root.querySelectorAll('[data-dir]').forEach((b) => {
    const dir = b.dataset.dir;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (state === 'playing') hold(dir);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((type) => b.addEventListener(type, () => unhold(dir)));
  });
  root.querySelectorAll('[data-act]').forEach((b) => {
    const act = b.dataset.act;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (act === 'jump') pressJump();
      else if (state === 'paused') resume();
      else pause();
    });
    if (act === 'jump') ['pointerup', 'pointerleave', 'pointercancel'].forEach((type) => b.addEventListener(type, releaseJump));
  });

  startBtn.addEventListener('click', startOrResume);
  modeBtns.forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.mode !== mode) setMode(b.dataset.mode);
  }));

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
    const w = Math.round(tower.clientWidth * (window.devicePixelRatio || 1));
    if (!w) return;
    tower.width = w;
    tower.height = Math.round((w * H) / W);
    scale = w / W;
    draw();
  };
  // The dungeon (dungeon.js) puts this window away and brings it back.
  root.addEventListener('scene-exit', pause);
  root.addEventListener('scene-enter', fit);
  if ('ResizeObserver' in window) new ResizeObserver(fit).observe(tower);

  setMode('normal');
  fit();
})();
