// Snake for the Play section: steer the snake around the board, eat the apples
// and keep away from the walls and your own tail. Every apple makes the snake
// longer and a little faster. Easy is a gentle crawl, medium a brisk walk,
// and hard starts fast and ends faster. The best score is kept per mode.
(() => {
  const root = document.querySelector('[data-snake]');
  if (!root) return;

  // The board has its own units; the canvas is scaled to whatever size it gets.
  const COLS = 24;
  const ROWS = 16;
  const CELL = 20;
  const W = COLS * CELL;
  const H = ROWS * CELL;
  const START_LEN = 4;
  const DIE_MS = 700; // the snake blinks this long before the game is over
  const RESTART_GRACE = 600; // ms after a crash before a held key can restart
  const SWIPE = 18; // px a finger must travel on the board to count as a swipe
  const BEST_KEY = 'snake-best';
  const MODES = {
    // Cells per second at the start and at most, and how much each apple adds.
    easy: { start: 4, top: 8, ramp: 0.15, idle: 'Eat the apples and keep away from your tail.' },
    medium: { start: 7, top: 14, ramp: 0.3, idle: 'A brisker snake, and faster with every apple.' },
    hard: { start: 10, top: 18, ramp: 0.3, idle: 'Fast from the start, and faster with every apple.' },
  };
  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
  const KEYS = {
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  };
  const PAUSE_KEYS = new Set(['KeyP', 'Escape']);
  const START_KEYS = new Set(['Enter', 'NumpadEnter', 'Space', 'KeyZ']);
  const RUNNING = new Set(['ready', 'playing', 'dying']);

  const stage = root.querySelector('[data-stage]');
  const board = root.querySelector('[data-board]');
  const overlay = root.querySelector('[data-overlay]');
  const msg = root.querySelector('[data-msg]');
  const startBtn = root.querySelector('[data-start]');
  const modeBtns = root.querySelectorAll('[data-mode]');
  const out = (k) => root.querySelector(`[data-out="${k}"]`);
  const ctx = board.getContext('2d');
  const touch = window.matchMedia?.('(pointer: coarse)');

  const loadBest = (m) => {
    try { return Number(localStorage.getItem(`${BEST_KEY}-${m}`)) || 0; } catch { return 0; }
  };
  const saveBest = (m, n) => {
    try { localStorage.setItem(`${BEST_KEY}-${m}`, String(n)); } catch { /* storage unavailable */ }
  };

  /* ---------- State ---------- */

  let mode = 'easy';
  let cfg = MODES[mode];
  let state = 'idle'; // idle | ready | playing | dying | paused | over
  let before = 'ready'; // what the pause interrupted
  let snake = []; // [x, y] cells, head first
  let dir = 'right';
  let queue = []; // turns waiting for the next steps
  let apple = null;
  let grow = 0; // segments still to be added to the tail
  let speed = cfg.start; // cells per second
  let acc = 0; // ms owed to the next step
  let score = 0;
  let best = loadBest(mode);
  let runs = 0;
  let diedAt = 0;
  let overAt = 0;
  let raf = 0;
  let lastTime = 0;
  let scale = 1;
  let swipe = null; // where a finger went down on the board

  /* ---------- Drawing ---------- */

  const rrect = (x, y, w, h, r) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  const drawApple = () => {
    if (!apple) return;
    const cx = apple[0] * CELL + CELL / 2;
    const cy = apple[1] * CELL + CELL / 2 + 1;
    ctx.fillStyle = '#d9745a';
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff2e1';
    ctx.fillRect(cx - 3, cy - 4, 2, 2); // shine
    ctx.fillStyle = '#5c7a5e';
    ctx.fillRect(cx - 1, cy - 9, 2, 3); // stem
    ctx.fillStyle = '#8db07e';
    ctx.beginPath();
    ctx.ellipse(cx + 3, cy - 8, 4, 2, -0.5, 0, Math.PI * 2); // leaf
    ctx.fill();
  };

  const drawSnake = () => {
    // Body segments are rounded squares, joined so the snake reads as one piece.
    ctx.fillStyle = '#8db07e';
    snake.forEach(([x, y], i) => {
      const px = x * CELL;
      const py = y * CELL;
      rrect(px + 2, py + 2, CELL - 4, CELL - 4, 5);
      ctx.fill();
      const next = snake[i + 1];
      if (!next) return;
      const dx = next[0] - x;
      const dy = next[1] - y;
      if (Math.abs(dx) + Math.abs(dy) !== 1) return; // never joined across a wrap
      if (dx) ctx.fillRect(Math.min(px, next[0] * CELL) + CELL - 4, py + 2, 8, CELL - 4);
      else ctx.fillRect(px + 2, Math.min(py, next[1] * CELL) + CELL - 4, CELL - 4, 8);
    });
    // The head is paler, with two eyes looking the way it goes.
    const [hx, hy] = snake[0];
    const px = hx * CELL;
    const py = hy * CELL;
    ctx.fillStyle = '#b8d2a8';
    rrect(px + 2, py + 2, CELL - 4, CELL - 4, 6);
    ctx.fill();
    const [dx, dy] = DIRS[dir];
    const eyes = dx ? [[CELL / 2 + dx * 3, 6], [CELL / 2 + dx * 3, CELL - 6]] : [[6, CELL / 2 + dy * 3], [CELL - 6, CELL / 2 + dy * 3]];
    ctx.fillStyle = '#2b1a08';
    eyes.forEach(([ex, ey]) => ctx.fillRect(px + ex - 1.5, py + ey - 1.5, 3, 3));
  };

  const draw = (t = performance.now()) => {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = '#34503c';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255, 242, 225, .05)';
    for (let x = 1; x < COLS; x++) ctx.fillRect(x * CELL, 0, 1, H);
    for (let y = 1; y < ROWS; y++) ctx.fillRect(0, y * CELL, W, 1);
    drawApple();
    // A crashed snake blinks before the game is over.
    if (state !== 'dying' || Math.floor((t - diedAt) / 110) % 2 === 0) drawSnake();

    if (state === 'ready') {
      ctx.font = '500 12px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255, 242, 225, .85)';
      ctx.fillText(touch?.matches ? 'swipe or tap an arrow to start' : 'press an arrow to start', W / 2, H / 2 + CELL * 2.5);
    }
  };

  const updateStats = () => {
    out('score').textContent = score;
    out('best').textContent = best;
    out('length').textContent = snake.length;
  };

  /* ---------- Play ---------- */

  const placeApple = () => {
    const taken = new Set(snake.map(([x, y]) => y * COLS + x));
    const free = [];
    for (let i = 0; i < COLS * ROWS; i++) if (!taken.has(i)) free.push(i);
    if (!free.length) {
      apple = null;
      return;
    }
    const i = free[Math.floor(Math.random() * free.length)];
    apple = [i % COLS, Math.floor(i / COLS)];
  };

  const showOverlay = (text, label) => {
    msg.textContent = text;
    startBtn.textContent = label;
    overlay.hidden = false;
  };

  const award = (key) => window.arcadeMons?.award(key); // a monster for a first-time achievement, see rewards.csv

  const finish = (filled) => {
    state = 'over';
    if (filled) award('snake.full');
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
    if (filled) showOverlay(`The whole board is snake! ${score} apples.`, 'Play again');
    else if (record) showOverlay(`New best: ${score} apples!`, 'Play again');
    else if (score === 0) showOverlay(`Not one apple. Best ${best}.`, 'Play again');
    else showOverlay(`${score} apple${score === 1 ? '' : 's'}. Best ${best}.`, 'Play again');
  };

  const die = () => {
    state = 'dying';
    diedAt = performance.now();
  };

  // One move of the head; the tail follows unless an apple was just eaten.
  const step = () => {
    if (queue.length) dir = queue.shift();
    const [dx, dy] = DIRS[dir];
    const nx = snake[0][0] + dx;
    const ny = snake[0][1] + dy;
    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) {
      die();
      return;
    }
    // The tail moves out of the way this step, unless the snake is growing.
    const last = snake.length - 1;
    if (snake.some(([x, y], i) => x === nx && y === ny && (i < last || grow > 0))) {
      die();
      return;
    }
    snake.unshift([nx, ny]);
    if (apple && nx === apple[0] && ny === apple[1]) {
      score++;
      grow++;
      if (score === 20 || score === 50) award(`snake.${mode}.${score}`);
      speed = Math.min(cfg.top, speed + cfg.ramp);
      placeApple();
      updateStats();
    }
    if (grow > 0) grow--;
    else snake.pop();
    if (!apple) finish(true); // nowhere left to put an apple: the board is full
  };

  // Queue a turn; the snake can never double straight back on itself.
  const turn = (d) => {
    if (state === 'ready') {
      if (d === OPPOSITE[dir]) return;
      dir = d;
      state = 'playing';
      acc = 0;
      return;
    }
    if (state !== 'playing') return;
    const last = queue.length ? queue[queue.length - 1] : dir;
    if (d === last || d === OPPOSITE[last] || queue.length >= 2) return;
    queue.push(d);
  };

  const update = (dt, t) => {
    if (state === 'dying') {
      if (t - diedAt >= DIE_MS) finish(false);
      return;
    }
    if (state !== 'playing') return;
    acc += dt;
    const interval = 1000 / speed;
    while (acc >= interval && state === 'playing') {
      acc -= interval;
      step();
    }
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

  const reset = () => {
    const y = Math.floor(ROWS / 2);
    const x = Math.floor(COLS / 2);
    snake = [];
    for (let i = 0; i < START_LEN; i++) snake.push([x - i, y]);
    dir = 'right';
    queue = [];
    grow = 0;
    speed = cfg.start;
    acc = 0;
    score = 0;
    placeApple();
  };

  // The snake waits in the middle until the first turn sets it going.
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
      if (KEYS[e.code]) {
        e.preventDefault();
        turn(KEYS[e.code]);
      } else if (PAUSE_KEYS.has(e.code)) {
        e.preventDefault();
        if (!e.repeat) pause();
      }
      return;
    }
    if (state === 'dying') {
      if (KEYS[e.code]) e.preventDefault();
      return;
    }
    // Idle, paused or over: Enter, Space or Z starts; while paused, the pause and arrow keys resume too.
    const go = START_KEYS.has(e.code) || (state === 'paused' && (PAUSE_KEYS.has(e.code) || KEYS[e.code]));
    if (!go) return;
    e.preventDefault();
    // A short grace period stops a key still held from the crash restarting at once.
    if (e.repeat || (state === 'over' && performance.now() - overAt < RESTART_GRACE)) return;
    startOrResume();
  });

  // Swipe across the board to turn; a plain tap while waiting sets the snake going.
  board.addEventListener('pointerdown', (e) => {
    if (state !== 'ready' && state !== 'playing') return;
    e.preventDefault();
    stage.focus({ preventScroll: true });
    swipe = [e.clientX, e.clientY];
  });
  board.addEventListener('pointerup', (e) => {
    if (!swipe) return;
    const dx = e.clientX - swipe[0];
    const dy = e.clientY - swipe[1];
    swipe = null;
    if (Math.hypot(dx, dy) < SWIPE) {
      if (state === 'ready') turn(dir);
      return;
    }
    turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  });
  board.addEventListener('pointercancel', () => { swipe = null; });

  // Touch pad: the four directions and pause.
  root.querySelectorAll('[data-dir]').forEach((b) => b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    turn(b.dataset.dir);
  }));
  root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (state === 'paused') resume();
    else pause();
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
    const w = Math.round(board.clientWidth * (window.devicePixelRatio || 1));
    if (!w) return;
    board.width = w;
    board.height = Math.round((w * H) / W);
    scale = w / W;
    draw();
  };
  // The dungeon (dungeon.js) puts this window away and brings it back.
  root.addEventListener('scene-exit', pause);
  root.addEventListener('scene-enter', fit);
  if ('ResizeObserver' in window) new ResizeObserver(fit).observe(board);

  setMode('easy');
  fit();
})();
