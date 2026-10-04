// Flappy Bird for the Play section: press Space, click or tap to flap, and
// steer the bird through the gaps between the pipes. Normal has roomy gaps;
// hard narrows them and speeds everything up. The best score is kept per mode.
(() => {
  const root = document.querySelector('[data-flappy]');
  if (!root) return;

  // The sky has its own units; the canvas is scaled to whatever size it gets.
  const W = 320;
  const H = 480;
  const GROUND = 64; // height of the ground strip
  const SKY_H = H - GROUND; // where the ground starts
  const BIRD_X = 100; // the bird's middle never moves sideways
  const REST_Y = SKY_H / 2 - 20; // where the bird hovers before the first flap
  const GRAVITY = 1500; // units per second squared
  const FLAP = -390; // upward speed given by one flap
  const MAX_FALL = 640;
  const PIPE_W = 52;
  const CAP_H = 24; // the lip at a pipe's mouth
  const CAP_OUT = 3; // how far the lip sticks out each side
  const BIRD_R = 11; // the bird's body, for collisions
  const MARGIN = 56; // closest a gap comes to the top of the sky or the ground
  const DRIFT = 150; // most a gap moves up or down from the one before
  const PX = 2.5; // one sprite pixel, in sky units
  const RESTART_GRACE = 800; // ms after a crash before a held key can restart
  const BEST_KEY = 'flappy-best';
  const MODES = {
    normal: { gap: 120, speed: 135, spacing: 200, idle: 'Flap through the gaps in the pipes.' },
    hard: { gap: 96, speed: 175, spacing: 180, idle: 'Narrow gaps, fast pipes. Good luck.' },
  };
  const FLAP_KEYS = new Set(['Space', 'ArrowUp', 'KeyW', 'KeyZ', 'KeyX']);
  const PAUSE_KEYS = new Set(['KeyP', 'Escape']);
  const START_KEYS = new Set(['Enter', 'NumpadEnter', 'Space', 'KeyZ']);
  const RUNNING = new Set(['ready', 'playing', 'dying']);
  // Clouds: x, y and width of each, repeating every CLOUD_SPAN units.
  const CLOUDS = [[20, 60, 56], [150, 110, 72], [290, 40, 48], [420, 150, 60]];
  const CLOUD_SPAN = 520;

  const stage = root.querySelector('[data-stage]');
  const sky = root.querySelector('[data-sky]');
  const overlay = root.querySelector('[data-overlay]');
  const msg = root.querySelector('[data-msg]');
  const startBtn = root.querySelector('[data-start]');
  const modeBtns = root.querySelectorAll('[data-mode]');
  const out = (k) => root.querySelector(`[data-out="${k}"]`);
  const ctx = sky.getContext('2d');
  const touch = window.matchMedia?.('(pointer: coarse)');

  const loadBest = (m) => {
    try { return Number(localStorage.getItem(`${BEST_KEY}-${m}`)) || 0; } catch { return 0; }
  };
  const saveBest = (m, n) => {
    try { localStorage.setItem(`${BEST_KEY}-${m}`, String(n)); } catch { /* storage unavailable */ }
  };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /* ---------- Bird sprite ---------- */

  // 16 x 11 pixels, facing right: y body, c belly, r beak, w eye, k lines.
  // The wing (o) is stamped on at three heights for the flapping frames.
  const PAL = { y: '#f4c15d', o: '#e2a963', c: '#fff2e1', k: '#2b1a08', r: '#d9745a', w: '#fffaf2' };
  const BODY = [
    '......kkkkk.....',
    '.....kyyyyyk....',
    '....kyyyyyykkk..',
    '...kyyyyyykwwwk.',
    '..kyyyyyyykwkwk.',
    '.kyyyyyyyyyykkkk',
    '.kyyyyyyyyyrrrrr',
    '.kyyyyyyyyyyrrrk',
    '..kkkkkkyccccck.',
    '....kcccccccck..',
    '.....kkkkkkkk...',
  ];
  const WING = ['kkkkk.', 'kooook', 'kkkkk.'];
  const SPR_W = 16;
  const SPR_H = 11;
  const render = (wingY) => {
    const c = document.createElement('canvas');
    c.width = SPR_W;
    c.height = SPR_H;
    const g = c.getContext('2d');
    const dot = (ch, x, y) => {
      if (!PAL[ch]) return;
      g.fillStyle = PAL[ch];
      g.fillRect(x, y, 1, 1);
    };
    BODY.forEach((row, y) => [...row].forEach((ch, x) => dot(ch, x, y)));
    WING.forEach((row, dy) => [...row].forEach((ch, dx) => dot(ch, 1 + dx, wingY + dy)));
    return c;
  };
  const FRAMES = [render(3), render(5), render(7), render(5)]; // wing up, level, down, level

  /* ---------- State ---------- */

  let mode = 'normal';
  let cfg = MODES[mode];
  let state = 'idle'; // idle | ready | playing | dying | paused | over
  let before = 'ready'; // what the pause interrupted
  let score = 0;
  let best = loadBest(mode);
  let runs = 0;
  let pipes = []; // { x, gapY, passed }, left to right
  let dist = 0; // how far the world has scrolled, in units
  let time = 0; // seconds since the run began
  let frame = 1;
  let flash = 0; // white flash on a crash, 1 -> 0
  let raf = 0;
  let lastTime = 0;
  let overAt = 0;
  let scale = 1;
  const bird = { x: BIRD_X, y: REST_Y, vy: 0, angle: 0 };

  /* ---------- Drawing ---------- */

  const drawClouds = () => {
    ctx.fillStyle = 'rgba(255, 250, 242, .8)';
    const off = (dist * 0.2) % CLOUD_SPAN;
    CLOUDS.forEach(([cx, cy, cw]) => {
      let x = cx - off;
      if (x + cw < 0) x += CLOUD_SPAN;
      ctx.fillRect(x, cy + 6, cw, 10);
      ctx.fillRect(x + 10, cy, cw - 20, 8);
      ctx.fillRect(x + 4, cy + 3, cw - 8, 4);
    });
  };

  // Two rows of rounded hills, the nearer one moving faster.
  const drawHills = () => {
    ctx.fillStyle = '#bccbb1';
    let off = (dist * 0.35) % 96;
    for (let x = -off; x < W + 96; x += 96) {
      ctx.beginPath();
      ctx.arc(x, SKY_H + 12, 46, Math.PI, 0);
      ctx.fill();
    }
    ctx.fillStyle = '#a8b89c';
    off = (dist * 0.55) % 72;
    for (let x = -off - 36; x < W + 72; x += 72) {
      ctx.beginPath();
      ctx.arc(x, SKY_H + 14, 30, Math.PI, 0);
      ctx.fill();
    }
  };

  // One length of pipe: dark edge, body, a light stripe and a shaded side.
  const pipe = (x, y, w, h) => {
    ctx.fillStyle = '#2b1a08';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = '#5c7a5e';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#8db07e';
    ctx.fillRect(x + 5, y, 9, h);
    ctx.fillStyle = '#34503c';
    ctx.fillRect(x + w - 8, y, 7, h);
  };

  const drawPipe = (p) => {
    const top = p.gapY - cfg.gap / 2;
    const bot = p.gapY + cfg.gap / 2;
    pipe(p.x, -2, PIPE_W, top - CAP_H + 2);
    pipe(p.x - CAP_OUT, top - CAP_H, PIPE_W + 2 * CAP_OUT, CAP_H);
    pipe(p.x - CAP_OUT, bot, PIPE_W + 2 * CAP_OUT, CAP_H);
    pipe(p.x, bot + CAP_H, PIPE_W, SKY_H - bot - CAP_H + 2);
  };

  const drawGround = () => {
    ctx.fillStyle = '#2b1a08';
    ctx.fillRect(0, SKY_H, W, 2);
    ctx.fillStyle = '#8db07e';
    ctx.fillRect(0, SKY_H + 2, W, 10);
    ctx.fillStyle = '#5c7a5e';
    let off = dist % 24;
    for (let x = -off; x < W; x += 24) ctx.fillRect(x, SKY_H + 8, 12, 4);
    ctx.fillStyle = '#7d5c3a';
    ctx.fillRect(0, SKY_H + 12, W, GROUND - 12);
    ctx.fillStyle = '#775736';
    off = dist % 32;
    for (let x = -off; x < W; x += 32) {
      ctx.fillRect(x, SKY_H + 12, 16, 16);
      ctx.fillRect(x + 16, SKY_H + 28, 16, 16);
      ctx.fillRect(x, SKY_H + 44, 16, 16);
    }
  };

  const drawBird = () => {
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate(bird.angle);
    ctx.drawImage(FRAMES[frame], -(SPR_W * PX) / 2 + 2, -(SPR_H * PX) / 2, SPR_W * PX, SPR_H * PX);
    ctx.restore();
  };

  const drawScore = () => {
    if (state === 'idle') return;
    ctx.font = '700 44px "Space Grotesk", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 6;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#2b1a08';
    ctx.strokeText(String(score), W / 2, 28);
    ctx.fillStyle = '#fff2e1';
    ctx.fillText(String(score), W / 2, 28);
  };

  // The sky pales towards the horizon.
  const skyFill = ctx.createLinearGradient(0, 0, 0, SKY_H);
  skyFill.addColorStop(0, '#8fb8c4');
  skyFill.addColorStop(1, '#b7d2da');

  const draw = () => {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = skyFill;
    ctx.fillRect(0, 0, W, SKY_H);
    drawClouds();
    drawHills();
    pipes.forEach(drawPipe);
    drawGround();
    drawBird();
    drawScore();

    if (state === 'ready') {
      ctx.font = '500 12px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(43, 26, 8, .8)';
      ctx.fillText(touch?.matches ? 'tap to flap' : 'Space, click or tap to flap', W / 2, bird.y + 64);
    }
    if (flash > 0) {
      ctx.fillStyle = `rgba(255, 250, 242, ${flash * 0.7})`;
      ctx.fillRect(0, 0, W, H);
    }
  };

  const updateStats = () => {
    out('score').textContent = score;
    out('best').textContent = best;
    out('runs').textContent = runs;
  };

  /* ---------- Play ---------- */

  const spawnPipe = (x) => {
    const lo = MARGIN + cfg.gap / 2;
    const hi = SKY_H - MARGIN - cfg.gap / 2;
    const prev = pipes.length ? pipes[pipes.length - 1].gapY : SKY_H / 2;
    const gapY = clamp(prev + (Math.random() * 2 - 1) * DRIFT, lo, hi);
    pipes.push({ x, gapY, passed: false });
  };

  // Does the bird's body overlap this rectangle?
  const hitsRect = (x, y, w, h) => {
    const dx = bird.x - clamp(bird.x, x, x + w);
    const dy = bird.y - clamp(bird.y, y, y + h);
    return dx * dx + dy * dy < BIRD_R * BIRD_R;
  };
  const hitsPipe = (p) => {
    const top = p.gapY - cfg.gap / 2;
    const bot = p.gapY + cfg.gap / 2;
    const x = p.x - CAP_OUT;
    const w = PIPE_W + 2 * CAP_OUT;
    return hitsRect(x, -50, w, top + 50) || hitsRect(x, bot, w, SKY_H - bot);
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
      saveBest(mode, best);
    }
    updateStats();
    draw();
    if (record) showOverlay(`New best: ${score}!`, 'Play again');
    else if (score === 0) showOverlay(`Not past the first pipe. Best ${best}.`, 'Play again');
    else showOverlay(`Score ${score}. Best ${best}.`, 'Play again');
  };

  // A crash: the pipes stop and the bird tumbles to the ground.
  const die = () => {
    state = 'dying';
    flash = 1;
    bird.vy = Math.max(bird.vy, 120);
  };

  const flap = () => {
    if (state === 'ready') state = 'playing';
    else if (state !== 'playing') return;
    bird.vy = FLAP;
  };

  const update = (dt) => {
    time += dt;
    flash = Math.max(0, flash - dt * 3);
    if (state === 'ready') {
      dist += cfg.speed * dt;
      bird.y = REST_Y + Math.sin(time * 4) * 7;
      bird.angle = 0;
      frame = Math.floor(time * 8) % 4;
      return;
    }

    bird.vy = Math.min(MAX_FALL, bird.vy + GRAVITY * dt);
    bird.y += bird.vy * dt;
    const want = state === 'dying' ? 1.5 : clamp(bird.vy * 0.0024, -0.4, 1.5);
    bird.angle += (want - bird.angle) * Math.min(1, dt * 14);
    if (state === 'dying') {
      frame = 1;
      if (bird.y + BIRD_R >= SKY_H) {
        bird.y = SKY_H - BIRD_R;
        finish();
      }
      return;
    }

    if (bird.y < BIRD_R) {
      bird.y = BIRD_R;
      bird.vy = 0;
    }
    frame = Math.floor(time * 10) % 4;
    dist += cfg.speed * dt;
    pipes.forEach((p) => { p.x -= cfg.speed * dt; });
    if (pipes.length && pipes[0].x + PIPE_W + CAP_OUT < 0) pipes.shift();
    const last = pipes[pipes.length - 1];
    if (!last) spawnPipe(W + 40);
    else if (last.x <= W + 40 - cfg.spacing) spawnPipe(last.x + cfg.spacing);
    pipes.forEach((p) => {
      if (!p.passed && p.x + PIPE_W / 2 < bird.x) {
        p.passed = true;
        score++;
        if (score === 10 || score === 25 || score === 50) award(`flappy.${mode}.${score}`);
        updateStats();
      }
    });
    if (bird.y + BIRD_R >= SKY_H || pipes.some(hitsPipe)) die();
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
    pipes = [];
    dist = 0;
    time = 0;
    flash = 0;
    frame = 1;
    Object.assign(bird, { y: REST_Y, vy: 0, angle: 0 });
  };

  // The bird hovers until the first flap sets it going.
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
    cancelAnimationFrame(raf);
    draw();
    showOverlay('Paused', 'Resume');
  };

  const resume = () => {
    state = before;
    run();
  };

  const startOrResume = () => (state === 'paused' ? resume() : start());

  // Switching mode abandons the current run.
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
    showOverlay(cfg.idle, 'Start game');
  };

  /* ---------- Input ---------- */

  // Keys only reach the game while it has focus, so the page scrolls normally otherwise.
  root.addEventListener('keydown', (e) => {
    if (e.target.closest('button') && (e.code === 'Enter' || e.code === 'Space')) return;
    if (state === 'ready' || state === 'playing') {
      if (FLAP_KEYS.has(e.code)) {
        e.preventDefault();
        if (!e.repeat) flap();
      } else if (PAUSE_KEYS.has(e.code)) {
        e.preventDefault();
        if (!e.repeat) pause();
      }
      return;
    }
    if (state === 'dying') {
      if (FLAP_KEYS.has(e.code)) e.preventDefault();
      return;
    }
    // Idle, paused or over: Enter or Space starts; while paused, the pause and flap keys resume too.
    const go = START_KEYS.has(e.code) || (state === 'paused' && (PAUSE_KEYS.has(e.code) || FLAP_KEYS.has(e.code)));
    if (!go) return;
    e.preventDefault();
    // A short grace period stops a key still held from the crash restarting at once.
    if (e.repeat || (state === 'over' && performance.now() - overAt < RESTART_GRACE)) return;
    startOrResume();
  });

  // Click or tap the sky to flap.
  stage.addEventListener('pointerdown', (e) => {
    if (state !== 'ready' && state !== 'playing') return;
    e.preventDefault();
    stage.focus({ preventScroll: true });
    flap();
  });

  // Touch pad: a big flap button and pause.
  root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (b.dataset.act === 'pause') pause();
    else flap();
  }));

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

  setMode('normal');
  fit();
})();
