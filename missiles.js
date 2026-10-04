// Missiles! for the Play section, after Macaque's mobile game: a little
// propeller plane flies on over an endless patchwork of fields while homing
// missiles come in from off screen and chase it. The player only steers; the
// plane never stops. Missiles are faster than the plane but turn worse, so the
// way to live is to pull tight turns that make them fly into each other, or to
// keep ahead until they run out of fuel. Stars scattered over the land are the
// score, and over all runs they unlock planes that fly faster or turn tighter.
// A shield and a speed boost turn up now and then. Normal and fast modes set
// how quick the missiles are; the best score is kept per mode.
(() => {
  const root = document.querySelector('[data-missiles]');
  if (!root) return;

  // The sky has its own units; the canvas is scaled to whatever size it gets.
  const W = 480;
  const H = 360;
  const PLANE_R = 8; // the plane's body, for collisions
  const MISSILE_R = 6;
  const STAR_R = 11; // how close the plane must pass a star to pick it up
  const PICK_R = 14; // the same for a power-up
  const STARS_NEAR = 6; // stars kept scattered around the plane
  const STAR_NEAR_D = 150; // closest a new star appears
  const STAR_FAR_D = 460; // furthest a new star appears
  const DROP_D = 760; // things this far behind are forgotten
  const PICK_EVERY = 13; // seconds between power-ups
  const SHIELD_FOR = 5; // seconds a shield lasts
  const BOOST_FOR = 4; // seconds a speed boost lasts
  const BOOST = 1.45; // how much faster the boost makes the plane
  const LAUNCH_D = 330; // how far away, just off screen, missiles start
  const FUEL = 5.5; // seconds a missile flies before it blows up on its own
  const RAMP = 120; // seconds over which the launches reach their fastest
  const CAM_LEAD = 48; // how far ahead of the plane the view looks
  const DIE_MS = 1000; // the wreck burns this long before the game is over
  const RESTART_GRACE = 800; // ms after a crash before a held key can restart
  const BEST_KEY = 'missiles-best';
  const STARS_KEY = 'missiles-stars'; // stars gathered over every run; they unlock planes
  const PLANE_KEY = 'missiles-plane';
  // Missiles: speed and turn rate (radians per second), seconds between launches at the
  // start and after RAMP seconds, and how many fly at once to begin with.
  const MODES = {
    normal: { speed: 160, turn: 1.4, first: 3.5, last: 1.0, most: 6, idle: 'Steer the plane and let the missiles catch each other.' },
    fast: { speed: 180, turn: 1.55, first: 3.0, last: 0.8, most: 7, idle: 'Faster missiles, and more of them. Good luck.' },
  };
  const PLANES = [
    { id: 'baron', name: 'Baron', blurb: 'Steady and sure', speed: 150, turn: 3.3, color: '#d9745a', need: 0 },
    { id: 'swift', name: 'Swift', blurb: 'Fast, turns wide', speed: 185, turn: 2.7, color: '#6f8fc0', need: 60 },
    { id: 'nimble', name: 'Nimble', blurb: 'Slow, turns tight', speed: 135, turn: 4.5, color: '#f4c15d', need: 150 },
  ];
  const LEFT_KEYS = new Set(['ArrowLeft', 'KeyA']);
  const RIGHT_KEYS = new Set(['ArrowRight', 'KeyD']);
  const PAUSE_KEYS = new Set(['KeyP', 'Escape']);
  const START_KEYS = new Set(['Enter', 'NumpadEnter', 'Space', 'KeyZ']);
  const RUNNING = new Set(['ready', 'playing', 'dying']);
  const INK = '#2b1a08';
  const FIELD = 80; // one field of the patchwork, in sky units
  const GREENS = ['#8db07e', '#99b78a', '#a8b89c', '#86a877'];
  const CLOUD = 240; // the sky is cut into cells this big; some hold a cloud
  const CLOUD_PARALLAX = 1.3; // clouds are nearer the camera, so they pass faster than the ground

  const stage = root.querySelector('[data-stage]');
  const sky = root.querySelector('[data-sky]');
  const overlay = root.querySelector('[data-overlay]');
  const msg = root.querySelector('[data-msg]');
  const startBtn = root.querySelector('[data-start]');
  const modeBtns = root.querySelectorAll('[data-mode]');
  const planeBtns = root.querySelectorAll('[data-plane]');
  const out = (k) => root.querySelector(`[data-out="${k}"]`);
  const ctx = sky.getContext('2d');
  const touch = window.matchMedia?.('(pointer: coarse)');

  const load = (key, fallback) => {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  };
  const save = (key, value) => {
    try { localStorage.setItem(key, String(value)); } catch { /* storage unavailable */ }
  };
  const loadBest = (m) => Number(load(`${BEST_KEY}-${m}`, 0)) || 0;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const TAU = Math.PI * 2;
  // An angle brought into (-pi, pi].
  const wrap = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  // A fixed pseudo-random number for a cell of the map, so the land looks the same every time it scrolls past.
  const hash = (x, y) => {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  };

  /* ---------- State ---------- */

  let mode = 'normal';
  let cfg = MODES[mode];
  let total = Number(load(STARS_KEY, 0)) || 0; // stars over every run
  let spec = PLANES.find((p) => p.id === load(PLANE_KEY, 'baron') && p.need <= total) || PLANES[0];
  let state = 'idle'; // idle | ready | playing | dying | paused | over
  let before = 'ready'; // what the pause interrupted
  let score = 0; // stars this run
  let best = loadBest(mode);
  let runs = 0;
  let dodged = 0; // missiles that blew up without hitting the plane
  let time = 0; // seconds survived
  let anim = 0; // seconds the scene has been moving, for the propeller, flames and bobbing
  let stars = []; // { x, y }
  let missiles = []; // { x, y, a, speed, fuel, trail: [{ x, y, t }] }
  let booms = []; // { x, y, t, big }
  let sparks = []; // { x, y, vx, vy, t, life, color }
  let pick = null; // { x, y, kind: 'shield' | 'boost' }
  let nextLaunch = 0; // seconds until the next missile
  let nextPick = 0; // seconds until the next power-up
  let unlocked = null; // a plane unlocked this run
  let flash = 0; // white flash on a crash, 1 -> 0
  let diedAt = 0;
  let overAt = 0;
  let raf = 0;
  let lastTime = 0;
  let scale = 1;
  const plane = { x: 0, y: 0, a: -Math.PI / 2, shield: 0, boost: 0, trail: [] };
  const cam = { x: 0, y: 0 };
  const held = new Set(); // steering keys down
  let pad = 0; // -1 while the left pad button is held, 1 for the right
  let aim = null; // where the pointer is held on the sky, in sky units

  // The launches get quicker and the missiles a little faster as the run goes on.
  const curve = () => Math.min(1, time / RAMP);
  const launchEvery = () => cfg.first + (cfg.last - cfg.first) * curve();
  const missileSpeed = () => cfg.speed * (1 + 0.12 * curve());
  const mostMissiles = () => cfg.most + Math.floor(time / 45);

  /* ---------- Drawing ---------- */

  const rrect = (x, y, w, h, r) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
  };
  const starPath = (x, y, r) => {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const ang = -Math.PI / 2 + (i * Math.PI) / 5;
      const rad = i % 2 ? r * 0.45 : r;
      ctx.lineTo(x + Math.cos(ang) * rad, y + Math.sin(ang) * rad);
    }
    ctx.closePath();
  };

  // The patchwork of fields, with the odd wood and pond, and lanes along some field edges.
  const drawGround = (left, top) => {
    const x0 = Math.floor(left / FIELD);
    const y0 = Math.floor(top / FIELD);
    for (let iy = y0; iy * FIELD < top + H; iy++) {
      for (let ix = x0; ix * FIELD < left + W; ix++) {
        const h = hash(ix, iy);
        const px = Math.round(ix * FIELD - left);
        const py = Math.round(iy * FIELD - top);
        ctx.fillStyle = GREENS[h % 4];
        ctx.fillRect(px, py, FIELD, FIELD);
        if (h % 9 === 0) {
          ctx.fillStyle = '#5c7a5e';
          rrect(px + 12 + (h >>> 8) % 10, py + 12 + (h >>> 12) % 10, 40, 36, 12);
        } else if (h % 11 === 0) {
          ctx.fillStyle = '#8fb8c4';
          rrect(px + 20, py + 24, 36, 28, 14);
        }
        ctx.fillStyle = '#c9b899';
        if (h & 1) ctx.fillRect(px, py + FIELD - 2, FIELD, 2);
        if (h & 2) ctx.fillRect(px + FIELD - 2, py, 2, FIELD);
      }
    }
  };

  // Clouds pass over everything, nearer than the ground and so faster.
  const drawClouds = (left, top) => {
    const cl = cam.x * CLOUD_PARALLAX - W / 2;
    const ct = cam.y * CLOUD_PARALLAX - H / 2;
    const x0 = Math.floor(cl / CLOUD) - 1;
    const y0 = Math.floor(ct / CLOUD) - 1;
    ctx.fillStyle = 'rgba(255, 250, 242, .72)';
    for (let iy = y0; iy * CLOUD < ct + H; iy++) {
      for (let ix = x0; ix * CLOUD < cl + W; ix++) {
        const h = hash(ix + 7, iy - 3);
        if (h % 3) continue;
        const x = ix * CLOUD + (h >>> 4) % 150 - cl;
        const y = iy * CLOUD + (h >>> 12) % 150 - ct;
        const w = 44 + (h >>> 20) % 40;
        ctx.fillRect(x, y + 6, w, 10);
        ctx.fillRect(x + 10, y, w - 20, 8);
        ctx.fillRect(x + 4, y + 3, w - 8, 4);
      }
    }
  };

  // The plane, nose along +x: tail, wings, fuselage and a spinning propeller, with one
  // outline around the lot. As a shadow it is one dark silhouette.
  const drawPlane = (x, y, a, shadow) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    const parts = [[-13, -6, 4, 12], [-3, -14, 8, 28], [-13, -3, 25, 6]];
    ctx.fillStyle = shadow ? 'rgba(43, 26, 8, .22)' : INK;
    parts.forEach(([px, py, w, h]) => rrect(px - 1, py - 1, w + 2, h + 2, 2.5));
    if (!shadow) {
      ctx.fillStyle = spec.color;
      parts.forEach(([px, py, w, h]) => rrect(px, py, w, h, 1.5));
      ctx.fillStyle = '#fff2e1';
      ctx.beginPath();
      ctx.arc(2, 0, 2.2, 0, TAU);
      ctx.fill();
      ctx.fillStyle = INK;
      ctx.translate(13, 0);
      ctx.rotate(anim * 40);
      ctx.fillRect(-1, -7, 2, 14);
    }
    ctx.restore();
  };

  const drawMissile = (m) => {
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(m.a);
    ctx.fillStyle = INK;
    ctx.fillRect(-10, -5, 4, 10); // fins
    rrect(-9, -3, 17, 6, 2);
    ctx.fillStyle = '#6e5536';
    ctx.fillRect(-9, -4, 2, 8);
    ctx.fillStyle = '#c9b899';
    rrect(-8, -2, 14, 4, 1.5);
    ctx.fillStyle = '#d9745a';
    ctx.beginPath();
    ctx.moveTo(4, -2);
    ctx.lineTo(7, 0);
    ctx.lineTo(4, 2);
    ctx.closePath();
    ctx.fill();
    // The flame flickers between two lengths and colours.
    const flick = Math.floor(anim * 30 + m.x) % 2;
    ctx.fillStyle = flick ? '#f4c15d' : '#d9745a';
    ctx.beginPath();
    ctx.moveTo(-9, -2);
    ctx.lineTo(-14 - flick * 3, 0);
    ctx.lineTo(-9, 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  // Smoke behind a missile, or the boost's flame behind the plane: dots that swell and fade.
  const drawTrail = (trail, life, color) => {
    trail.forEach((p) => {
      const k = p.t / life;
      ctx.globalAlpha = (1 - k) * 0.55;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2 + k * 6, 0, TAU);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  };

  const drawStar = (s) => {
    const y = s.y + Math.sin(anim * 3 + s.x * 0.05) * 2;
    starPath(s.x, y, 9);
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.fillStyle = '#f4c15d';
    ctx.fill();
  };

  const drawPick = (p) => {
    const y = p.y + Math.sin(anim * 3 + p.x * 0.05) * 2;
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(p.x, y, 12, 0, TAU);
    ctx.fill();
    ctx.fillStyle = p.kind === 'shield' ? '#6f8fc0' : '#e2a963';
    ctx.beginPath();
    ctx.arc(p.x, y, 10, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#fff2e1';
    if (p.kind === 'shield') {
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#fff2e1';
      ctx.beginPath();
      ctx.arc(p.x, y, 5.5, Math.PI * 0.9, Math.PI * 1.9);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(p.x + 2, y - 7);
      ctx.lineTo(p.x - 4, y + 1);
      ctx.lineTo(p.x, y + 1);
      ctx.lineTo(p.x - 2, y + 7);
      ctx.lineTo(p.x + 4, y - 1);
      ctx.lineTo(p.x, y - 1);
      ctx.closePath();
      ctx.fill();
    }
  };

  const drawBooms = () => {
    booms.forEach((b) => {
      const life = b.big ? 0.8 : 0.5;
      const k = b.t / life;
      if (k < 0.25) {
        ctx.fillStyle = '#fff2e1';
        ctx.beginPath();
        ctx.arc(b.x, b.y, (b.big ? 22 : 12) * (1 - k * 2), 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = b.big ? 4 : 3;
      ctx.strokeStyle = k < 0.5 ? '#f4c15d' : '#d9745a';
      ctx.beginPath();
      ctx.arc(b.x, b.y, 6 + k * (b.big ? 60 : 36), 0, TAU);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
    sparks.forEach((s) => {
      ctx.globalAlpha = 1 - s.t / s.life;
      ctx.fillStyle = s.color;
      ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
    });
    ctx.globalAlpha = 1;
  };

  // Missiles beyond the edge of the view show as arrowheads on that edge; a power-up as a dot.
  const drawMarkers = (left, top) => {
    const edge = (sx, sy) => {
      if (sx >= 0 && sx <= W && sy >= 0 && sy <= H) return null;
      const px = clamp(sx, 12, W - 12);
      const py = clamp(sy, 12, H - 12);
      return [px, py, Math.atan2(sy - py, sx - px)];
    };
    missiles.forEach((m) => {
      const at = edge(m.x - left, m.y - top);
      if (!at) return;
      ctx.save();
      ctx.translate(at[0], at[1]);
      ctx.rotate(at[2]);
      ctx.beginPath();
      ctx.moveTo(7, 0);
      ctx.lineTo(-5, -6);
      ctx.lineTo(-5, 6);
      ctx.closePath();
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.fillStyle = '#d9745a';
      ctx.fill();
      ctx.restore();
    });
    const at = pick && edge(pick.x - left, pick.y - top);
    if (at) {
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(at[0], at[1], 6, 0, TAU);
      ctx.fill();
      ctx.fillStyle = pick.kind === 'shield' ? '#6f8fc0' : '#e2a963';
      ctx.beginPath();
      ctx.arc(at[0], at[1], 4, 0, TAU);
      ctx.fill();
    }
  };

  const drawHud = () => {
    if (state === 'idle') return;
    ctx.font = '700 32px "Space Grotesk", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const text = String(score);
    const tw = ctx.measureText(text).width;
    const x = W / 2 - (tw + 26) / 2;
    starPath(x + 10, 30, 10);
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.fillStyle = '#f4c15d';
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeText(text, x + 26, 30);
    ctx.fillStyle = '#fff2e1';
    ctx.fillText(text, x + 26, 30);
    ctx.font = '500 12px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.lineWidth = 3;
    ctx.strokeText(`${Math.floor(time)}s`, W - 12, 18);
    ctx.fillText(`${Math.floor(time)}s`, W - 12, 18);
  };

  const draw = () => {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const left = cam.x - W / 2;
    const top = cam.y - H / 2;
    drawGround(left, top);

    ctx.save();
    ctx.translate(-left, -top);
    stars.forEach(drawStar);
    if (pick) drawPick(pick);
    const alive = state !== 'dying' && state !== 'over';
    if (alive) drawPlane(plane.x + 10, plane.y + 14, plane.a, true);
    missiles.forEach((m) => drawTrail(m.trail, 0.7, '#fff2e1'));
    drawTrail(plane.trail, 0.4, '#f4c15d');
    missiles.forEach(drawMissile);
    if (alive) {
      drawPlane(plane.x, plane.y, plane.a, false);
      if (plane.shield > 0) {
        // The bubble blinks through its last second and a half.
        const on = plane.shield > 1.5 || Math.floor(plane.shield * 6) % 2;
        ctx.globalAlpha = on ? 0.75 : 0.25;
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#6f8fc0';
        ctx.beginPath();
        ctx.arc(plane.x, plane.y, 22 + Math.sin(anim * 6) * 1.5, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    drawBooms();
    ctx.restore();

    drawClouds(left, top);
    drawMarkers(left, top);
    drawHud();

    if (state === 'ready') {
      ctx.font = '500 12px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(43, 26, 8, .85)';
      const sx = plane.x - left;
      const sy = plane.y - top + 44;
      ctx.fillText(touch?.matches ? 'hold a side of the pad to steer' : 'steer with the arrow keys', sx, sy);
      ctx.fillText(touch?.matches ? 'or drag on the sky' : 'or hold the mouse down on the sky', sx, sy + 16);
    }
    if (flash > 0) {
      ctx.fillStyle = `rgba(255, 250, 242, ${flash * 0.7})`;
      ctx.fillRect(0, 0, W, H);
    }
  };

  const updateStats = () => {
    out('score').textContent = score;
    out('best').textContent = best;
    out('dodged').textContent = dodged;
    out('stars').textContent = total;
  };

  // The plane picker: locked planes show the stars they need; the chosen one is marked.
  const showPlanes = () => {
    planeBtns.forEach((b) => {
      const p = PLANES.find((q) => q.id === b.dataset.plane);
      if (!p) return;
      const locked = p.need > total;
      b.disabled = locked;
      b.style.setProperty('--plane', p.color);
      b.querySelector('[data-blurb]').textContent = locked ? `Locked: ${p.need} stars` : p.blurb;
      const on = p === spec;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });
  };

  /* ---------- Play ---------- */

  // A point a way off from the plane, mostly out ahead of it.
  const spotNear = (lo, hi) => {
    const ahead = Math.random() < 0.7;
    const ang = ahead ? plane.a + (Math.random() * 2 - 1) * 1.1 : Math.random() * TAU;
    const d = lo + Math.random() * (hi - lo);
    return { x: plane.x + Math.cos(ang) * d, y: plane.y + Math.sin(ang) * d };
  };

  // Missiles come from somewhere behind the plane, never head on, so there is always time to react.
  const launch = () => {
    const ang = plane.a + Math.PI + (Math.random() * 2 - 1) * 1.4;
    const x = plane.x + Math.cos(ang) * LAUNCH_D;
    const y = plane.y + Math.sin(ang) * LAUNCH_D;
    missiles.push({
      x, y, a: Math.atan2(plane.y - y, plane.x - x),
      speed: missileSpeed() * (0.94 + Math.random() * 0.12), // a little spread, so they do not stack
      fuel: FUEL, trail: [],
    });
  };

  const boom = (x, y, big) => {
    booms.push({ x, y, t: 0, big });
    const n = big ? 22 : 10;
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * TAU;
      const v = 40 + Math.random() * (big ? 160 : 100);
      sparks.push({
        x, y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, t: 0, life: 0.35 + Math.random() * 0.4,
        color: ['#f4c15d', '#d9745a', '#2b1a08', '#fff2e1'][i % 4],
      });
    }
  };

  // A missile gone without hitting the plane counts as dodged.
  const destroy = (m) => {
    boom(m.x, m.y, false);
    m.dead = true;
    dodged++;
  };

  // The plane's wreck burns for a moment; the missiles carry on and mostly find each other.
  const die = () => {
    state = 'dying';
    diedAt = performance.now();
    flash = 1;
    held.clear();
    pad = 0;
    aim = null;
    boom(plane.x, plane.y, true);
  };

  // The first steer sets the missiles coming.
  const begin = () => {
    state = 'playing';
    nextLaunch = 1.2;
    nextPick = PICK_EVERY * 0.6;
  };

  const steerInput = () => {
    let s = pad;
    if ([...held].some((k) => LEFT_KEYS.has(k))) s -= 1;
    if ([...held].some((k) => RIGHT_KEYS.has(k))) s += 1;
    return clamp(s, -1, 1);
  };

  const ageTrail = (trail, life, dt) => {
    trail.forEach((p) => { p.t += dt; });
    while (trail.length && trail[0].t > life) trail.shift();
  };
  const leaveTrail = (trail, x, y) => {
    const last = trail[trail.length - 1];
    if (!last || Math.hypot(x - last.x, y - last.y) > 5) trail.push({ x, y, t: 0 });
  };

  const update = (dt) => {
    anim += dt;
    flash = Math.max(0, flash - dt * 3);
    booms.forEach((b) => { b.t += dt; });
    booms = booms.filter((b) => b.t < (b.big ? 0.8 : 0.5));
    sparks.forEach((s) => {
      s.t += dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= 1 - dt * 3;
      s.vy *= 1 - dt * 3;
    });
    sparks = sparks.filter((s) => s.t < s.life);
    ageTrail(plane.trail, 0.4, dt);
    missiles.forEach((m) => ageTrail(m.trail, 0.7, dt));

    if (state !== 'dying') {
      // Steering: the keys and the pad turn at full rate; a held pointer turns the plane towards itself.
      const s = steerInput();
      if (s) plane.a += s * spec.turn * dt;
      else if (aim) {
        const want = Math.atan2(aim.y + cam.y - H / 2 - plane.y, aim.x + cam.x - W / 2 - plane.x);
        plane.a += clamp(wrap(want - plane.a), -spec.turn * dt, spec.turn * dt);
      }
      plane.a = wrap(plane.a);
      if (state === 'ready' && (s || aim)) begin();
      const v = spec.speed * (plane.boost > 0 ? BOOST : 1);
      plane.x += Math.cos(plane.a) * v * dt;
      plane.y += Math.sin(plane.a) * v * dt;
      plane.shield = Math.max(0, plane.shield - dt);
      plane.boost = Math.max(0, plane.boost - dt);
      if (plane.boost > 0) leaveTrail(plane.trail, plane.x - Math.cos(plane.a) * 14, plane.y - Math.sin(plane.a) * 14);
    }

    if (state === 'playing') {
      time += dt;

      // Stars: keep a few scattered about, and pick up any the plane passes.
      stars = stars.filter((st) => dist(st, plane) < DROP_D);
      while (stars.length < STARS_NEAR) stars.push(spotNear(STAR_NEAR_D, STAR_FAR_D));
      const got = stars.filter((st) => dist(st, plane) < STAR_R + PLANE_R);
      if (got.length) {
        stars = stars.filter((st) => !got.includes(st));
        got.forEach((st) => {
          score += 1;
          total += 1;
          if (score === 20 || score === 50) award(`missiles.${mode}.${score}`);
          for (let i = 0; i < 6; i++) {
            const ang = Math.random() * TAU;
            sparks.push({ x: st.x, y: st.y, vx: Math.cos(ang) * 60, vy: Math.sin(ang) * 60, t: 0, life: 0.3, color: '#f4c15d' });
          }
        });
        save(STARS_KEY, total);
        const fresh = PLANES.find((p) => p.need > total - got.length && p.need <= total);
        if (fresh) {
          unlocked = fresh;
          award(`missiles.${fresh.id}`);
          showPlanes();
        }
      }

      // One power-up at a time, now and then.
      nextPick -= dt;
      if (!pick && nextPick <= 0) pick = { ...spotNear(STAR_NEAR_D, STAR_FAR_D), kind: Math.random() < 0.5 ? 'shield' : 'boost' };
      if (pick && dist(pick, plane) < PICK_R + PLANE_R) {
        if (pick.kind === 'shield') plane.shield = SHIELD_FOR;
        else plane.boost = BOOST_FOR;
        pick = null;
        nextPick = PICK_EVERY;
      } else if (pick && dist(pick, plane) > DROP_D) {
        pick = null;
        nextPick = 3;
      }

      // Missiles: launch, chase, burn fuel, run into each other.
      nextLaunch -= dt;
      if (nextLaunch <= 0 && missiles.length < mostMissiles()) {
        launch();
        nextLaunch = launchEvery();
      }
      missiles.forEach((m) => {
        const want = Math.atan2(plane.y - m.y, plane.x - m.x);
        m.a += clamp(wrap(want - m.a), -cfg.turn * dt, cfg.turn * dt);
        m.x += Math.cos(m.a) * m.speed * dt;
        m.y += Math.sin(m.a) * m.speed * dt;
        m.fuel -= dt;
        leaveTrail(m.trail, m.x - Math.cos(m.a) * 10, m.y - Math.sin(m.a) * 10);
        if (m.fuel <= 0) destroy(m);
      });
      for (let i = 0; i < missiles.length; i++) {
        for (let j = i + 1; j < missiles.length; j++) {
          const a = missiles[i];
          const b = missiles[j];
          if (a.dead || b.dead || dist(a, b) > MISSILE_R * 2) continue;
          destroy(a);
          destroy(b);
        }
      }
      missiles.forEach((m) => {
        if (m.dead || dist(m, plane) > MISSILE_R + PLANE_R) return;
        if (plane.shield > 0) destroy(m); // the shield blows it up
        else die();
      });
      if (missiles.some((m) => m.dead)) {
        missiles = missiles.filter((m) => !m.dead);
        updateStats();
      }
    } else if (state === 'dying') {
      // The missiles keep hunting the wreck and blow up as they reach it.
      missiles.forEach((m) => {
        const want = Math.atan2(plane.y - m.y, plane.x - m.x);
        m.a += clamp(wrap(want - m.a), -cfg.turn * dt, cfg.turn * dt);
        m.x += Math.cos(m.a) * m.speed * dt;
        m.y += Math.sin(m.a) * m.speed * dt;
        leaveTrail(m.trail, m.x - Math.cos(m.a) * 10, m.y - Math.sin(m.a) * 10);
        if (dist(m, plane) < MISSILE_R + PLANE_R + 4) {
          boom(m.x, m.y, false);
          m.dead = true;
        }
      });
      missiles = missiles.filter((m) => !m.dead);
      if (performance.now() - diedAt >= DIE_MS) finish();
    }

    // The view looks a little ahead of the plane and eases after it.
    const lead = state === 'dying' ? 0 : CAM_LEAD;
    const tx = plane.x + Math.cos(plane.a) * lead;
    const ty = plane.y + Math.sin(plane.a) * lead;
    const k = Math.min(1, dt * 5);
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;
  };

  const showOverlay = (text, label) => {
    msg.textContent = text;
    startBtn.textContent = label;
    overlay.hidden = false;
  };

  const award = (key) => window.arcadeMons?.award(key); // a monster for a first-time achievement, see rewards.csv

  const finish = () => {
    state = 'over';
    overAt = performance.now();
    cancelAnimationFrame(raf);
    runs++;
    const record = score > best;
    if (record) {
      best = score;
      save(`${BEST_KEY}-${mode}`, best);
    }
    updateStats();
    draw();
    const secs = Math.floor(time);
    let text = record ? `New best: ${score} stars in ${secs}s!` : `${score} stars in ${secs}s, ${dodged} missiles down. Best ${best}.`;
    if (unlocked) text += ` The ${unlocked.name} is yours to fly.`;
    showOverlay(text, 'Play again');
  };

  const tick = (t) => {
    if (!RUNNING.has(state)) return;
    const dt = Math.max(0, Math.min(50, t - lastTime)) / 1000; // the first frame stamp can predate run()
    lastTime = t;
    update(dt);
    draw();
    if (RUNNING.has(state)) raf = requestAnimationFrame(tick);
  };

  const run = () => {
    stage.focus({ preventScroll: true });
    overlay.hidden = true;
    lastTime = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  };

  const reset = () => {
    score = 0;
    dodged = 0;
    time = 0;
    stars = [];
    missiles = [];
    booms = [];
    sparks = [];
    pick = null;
    unlocked = null;
    flash = 0;
    held.clear();
    pad = 0;
    aim = null;
    Object.assign(plane, { x: 0, y: 0, a: -Math.PI / 2, shield: 0, boost: 0, trail: [] });
    cam.x = plane.x;
    cam.y = plane.y - CAM_LEAD;
  };

  // The plane flies on over empty land until the first steer sets the missiles coming.
  const start = () => {
    reset();
    state = 'ready';
    updateStats();
    run();
  };

  const pause = () => {
    if (state !== 'ready' && state !== 'playing') return;
    before = state;
    state = 'paused';
    held.clear();
    pad = 0;
    aim = null;
    cancelAnimationFrame(raf);
    draw();
    showOverlay('Paused', 'Resume');
  };

  const resume = () => {
    state = before;
    run();
  };

  const startOrResume = () => (state === 'paused' ? resume() : start());

  // Switching mode or plane abandons the current run.
  const idle = (text) => {
    cancelAnimationFrame(raf);
    state = 'idle';
    reset();
    updateStats();
    draw();
    showOverlay(text, 'Start game');
  };

  const setMode = (name) => {
    mode = name;
    cfg = MODES[name];
    modeBtns.forEach((b) => {
      const on = b.dataset.mode === name;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    best = loadBest(name);
    idle(cfg.idle);
  };

  const setPlane = (p) => {
    spec = p;
    save(PLANE_KEY, p.id);
    showPlanes();
    idle(`The ${p.name}: ${p.blurb.toLowerCase()}.`);
  };

  /* ---------- Input ---------- */

  // Keys only reach the game while it has focus, so the page scrolls normally otherwise.
  root.addEventListener('keydown', (e) => {
    if (e.target.closest('button') && (e.code === 'Enter' || e.code === 'Space')) return;
    const steer = LEFT_KEYS.has(e.code) || RIGHT_KEYS.has(e.code);
    if (state === 'ready' || state === 'playing') {
      if (steer) {
        e.preventDefault();
        held.add(e.code);
      } else if (PAUSE_KEYS.has(e.code)) {
        e.preventDefault();
        if (!e.repeat) pause();
      }
      return;
    }
    if (state === 'dying') {
      if (steer) e.preventDefault();
      return;
    }
    // Idle, paused or over: Enter, Space or Z starts; while paused, the pause keys resume too.
    const go = START_KEYS.has(e.code) || (state === 'paused' && PAUSE_KEYS.has(e.code));
    if (!go) return;
    e.preventDefault();
    // A short grace period stops a key still held from the crash restarting at once.
    if (e.repeat || (state === 'over' && performance.now() - overAt < RESTART_GRACE)) return;
    startOrResume();
  });
  root.addEventListener('keyup', (e) => held.delete(e.code));

  // Hold the pointer on the sky and the plane turns towards it; drag to lead it about.
  const skyPoint = (e) => {
    const r = sky.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  stage.addEventListener('pointerdown', (e) => {
    if (state !== 'ready' && state !== 'playing') return;
    e.preventDefault();
    stage.focus({ preventScroll: true });
    try { stage.setPointerCapture(e.pointerId); } catch { /* no capture, so the drag ends at the edge */ }
    aim = skyPoint(e);
  });
  stage.addEventListener('pointermove', (e) => {
    if (aim) aim = skyPoint(e);
  });
  const release = () => { aim = null; };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);

  // Touch pad: hold a side to turn that way, and pause in the middle.
  root.querySelectorAll('[data-turn]').forEach((b) => {
    const press = (e) => {
      e.preventDefault();
      if (state !== 'ready' && state !== 'playing') return;
      pad = b.dataset.turn === 'left' ? -1 : 1;
    };
    const lift = () => { pad = 0; };
    b.addEventListener('pointerdown', press);
    b.addEventListener('pointerup', lift);
    b.addEventListener('pointercancel', lift);
    b.addEventListener('pointerleave', lift);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  });
  root.querySelectorAll('[data-act="pause"]').forEach((b) => b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (state === 'paused') resume();
    else pause();
  }));

  startBtn.addEventListener('click', startOrResume);
  modeBtns.forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.mode !== mode) setMode(b.dataset.mode);
  }));
  planeBtns.forEach((b) => b.addEventListener('click', () => {
    const p = PLANES.find((q) => q.id === b.dataset.plane);
    if (p && p !== spec && p.need <= total) setPlane(p);
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
    const w = Math.round(sky.clientWidth * (window.devicePixelRatio || 1));
    if (!w) return;
    sky.width = w;
    sky.height = Math.round((w * H) / W);
    scale = w / W;
    draw();
  };
  // The dungeon (dungeon.js) puts this window away and brings it back.
  root.addEventListener('scene-exit', pause);
  root.addEventListener('scene-enter', fit);
  if ('ResizeObserver' in window) new ResizeObserver(fit).observe(sky);

  showPlanes();
  setMode('normal');
  fit();
})();
