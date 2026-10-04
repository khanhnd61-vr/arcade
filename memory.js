// Memory for the Play section: a grid of cards laid face down, each monster
// from monsters.js on two of them. Turn over two at a time; a pair stays up,
// anything else turns back. Clear the board as fast as you can in as few
// moves as you can; the best time is kept per size, and the first clear at
// each size wins a monster (rewards.csv). Easy is twelve cards, medium
// sixteen and hard thirty.
(() => {
  const root = document.querySelector('[data-memory]');
  if (!root) return;

  const MODES = {
    easy: { cols: 4, rows: 3, idle: 'Twelve cards, six monsters. Find every pair.' },
    medium: { cols: 4, rows: 4, idle: 'Sixteen cards, eight monsters. Find every pair.' },
    hard: { cols: 6, rows: 5, idle: 'Thirty cards, fifteen monsters. Keep track of them all.' },
  };
  const FLIP_BACK = 900; // ms a mismatched pair stays up
  const CLEAR_WAIT = 700; // ms after the last pair before the board is declared clear
  const RESTART_GRACE = 800; // ms after the end before a held key can restart
  const BEST_KEY = 'memory-best';
  const MOVES = {
    ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1],
    ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0],
  };
  const FLIP_KEYS = new Set(['KeyZ', 'Space', 'Enter', 'NumpadEnter']);
  const PAUSE_KEYS = new Set(['KeyP', 'Escape']);
  const START_KEYS = new Set(['Enter', 'NumpadEnter', 'Space', 'KeyZ']);

  const stage = root.querySelector('[data-stage]');
  const board = root.querySelector('[data-board]');
  const overlay = root.querySelector('[data-overlay]');
  const msg = root.querySelector('[data-msg]');
  const startBtn = root.querySelector('[data-start]');
  const modeBtns = root.querySelectorAll('[data-mode]');
  const out = (k) => root.querySelector(`[data-out="${k}"]`);
  const mons = () => window.arcadeMons || null;

  const loadBest = () => {
    try { return JSON.parse(localStorage.getItem(BEST_KEY)) || {}; } catch { return {}; }
  };
  const saveBest = () => {
    try { localStorage.setItem(BEST_KEY, JSON.stringify(best)); } catch { /* storage unavailable */ }
  };
  const fmtTime = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

  /* ---------- State ---------- */

  let mode = 'easy';
  let cfg = MODES[mode];
  let best = loadBest(); // fastest clear per mode, in ms
  let state = 'idle'; // idle | playing | paused | won
  let cards = []; // { id, el, up, done }
  let up = []; // indexes of the cards turned up and not yet matched, at most two
  let moves = 0;
  let pairs = 0;
  let cursor = 0; // the card the keyboard is on
  let elapsed = 0; // ms banked while the clock was running
  let since = 0; // when the clock last started, 0 while stopped
  let clock = 0;
  let flipTimer = 0;
  let endedAt = 0;
  let names = null; // the monster list from monsters.js, once it has loaded
  let faceSize = 0;

  const now = () => elapsed + (since ? performance.now() - since : 0);
  const showTime = () => { out('time').textContent = fmtTime(now()); };
  const startClock = () => {
    if (since) return;
    since = performance.now();
    clearInterval(clock);
    clock = setInterval(showTime, 250);
  };
  const stopClock = () => {
    if (since) elapsed += performance.now() - since;
    since = 0;
    clearInterval(clock);
    showTime();
  };

  const updateStats = () => {
    out('moves').textContent = moves;
    out('pairs').textContent = `${pairs} / ${cards.length / 2}`;
    out('best').textContent = best[mode] ? fmtTime(best[mode]) : '-';
    showTime();
  };

  /* ---------- The board ---------- */

  // Which monsters are on the board: a fresh random handful each game.
  const deal = () => {
    const api = mons();
    const total = api ? api.TOTAL : 100;
    const pool = Array.from({ length: total }, (_, i) => i + 1);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const ids = pool.slice(0, (cfg.cols * cfg.rows) / 2);
    const deck = [...ids, ...ids];
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  };

  // The face of a card: the monster's front sprite, painted by monsters.js at the size the
  // card has on screen, so the sheet's uneven cells line up.
  const paintFace = (card) => {
    const api = mons();
    const face = card.el.querySelector('[data-face]');
    if (!api || !faceSize) {
      face.textContent = String(card.id);
      return;
    }
    face.textContent = '';
    api.paint(face, card.id, 'front', faceSize);
  };

  const fitFaces = () => {
    const first = cards[0]?.el;
    if (!first) return;
    const size = Math.round(Math.min(first.clientWidth, first.clientHeight) * 0.78);
    if (!size || size === faceSize) return;
    faceSize = size;
    cards.forEach(paintFace);
  };

  const layBoard = () => {
    const deck = deal();
    board.style.setProperty('--cols', cfg.cols);
    board.style.setProperty('--rows', cfg.rows);
    faceSize = 0;
    cards = deck.map((id, i) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'memory__card';
      el.dataset.card = i;
      el.setAttribute('aria-label', `Card ${i + 1}, face down`);
      const inner = document.createElement('span');
      inner.className = 'memory__inner';
      const back = document.createElement('span');
      back.className = 'memory__back';
      back.textContent = '?';
      const face = document.createElement('span');
      face.className = 'memory__face';
      face.dataset.face = '';
      inner.append(back, face);
      el.append(inner);
      return { id, el, up: false, done: false };
    });
    board.replaceChildren(...cards.map((c) => c.el));
    cursor = 0;
    showCursor();
    fitFaces();
  };

  const showCursor = () => {
    cards.forEach((c, i) => c.el.classList.toggle('is-cursor', i === cursor && state === 'playing'));
  };

  const turn = (i, faceUp) => {
    const c = cards[i];
    c.up = faceUp;
    c.el.classList.toggle('is-up', faceUp);
    c.el.setAttribute('aria-label', faceUp ? `Card ${i + 1}, monster ${c.id}` : `Card ${i + 1}, face down`);
  };

  // Put a mismatched pair back, at once or when the timer runs out.
  const settle = () => {
    clearTimeout(flipTimer);
    flipTimer = 0;
    if (up.length === 2) {
      up.forEach((i) => turn(i, false));
      up = [];
    }
  };

  const flip = (i) => {
    if (state !== 'playing') return;
    const c = cards[i];
    if (c.done || c.up) return;
    if (up.length === 2) settle();
    startClock();
    turn(i, true);
    up.push(i);
    if (up.length < 2) return;
    moves++;
    const [a, b] = up.map((k) => cards[k]);
    if (a.id === b.id) {
      a.done = true;
      b.done = true;
      a.el.classList.add('is-done');
      b.el.classList.add('is-done');
      up = [];
      pairs++;
      if (pairs === cards.length / 2) setTimeout(win, CLEAR_WAIT);
    } else {
      flipTimer = setTimeout(settle, FLIP_BACK);
    }
    updateStats();
  };

  /* ---------- Flow ---------- */

  const showOverlay = (text, label) => {
    msg.textContent = text;
    startBtn.textContent = label;
    overlay.hidden = false;
  };

  const monsterName = (id) => {
    const api = mons();
    const m = names?.find((x) => x.id === id);
    return `No. ${api ? api.no(id) : id}${m ? ` ${m.name}` : ''}`;
  };

  // The board is clear: bank the time and hand over this size's monster, the first time.
  const win = () => {
    if (state !== 'playing') return;
    state = 'won';
    endedAt = performance.now();
    stopClock();
    showCursor();
    const ms = Math.round(now());
    let note = '';
    if (!best[mode] || ms < best[mode]) {
      best[mode] = ms;
      saveBest();
      note = ' A new best!';
    }
    const won = mons()?.award(`memory.${mode}`);
    const prize = won ? ` ${monsterName(won.id)} joins your monsters!` : '';
    updateStats();
    showOverlay(`Cleared in ${fmtTime(ms)} with ${moves} moves.${note}${prize}`, 'Play again');
  };

  const start = () => {
    clearTimeout(flipTimer);
    clearInterval(clock);
    up = [];
    moves = 0;
    pairs = 0;
    elapsed = 0;
    since = 0;
    layBoard();
    state = 'playing';
    showCursor();
    updateStats();
    overlay.hidden = true;
    stage.focus({ preventScroll: true });
  };

  const pause = () => {
    if (state !== 'playing') return;
    state = 'paused';
    stopClock();
    showCursor();
    showOverlay('Paused', 'Resume');
  };

  const resume = () => {
    state = 'playing';
    overlay.hidden = true;
    showCursor();
    if (moves || up.length) startClock();
    stage.focus({ preventScroll: true });
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
    clearTimeout(flipTimer);
    stopClock();
    state = 'idle';
    up = [];
    moves = 0;
    pairs = 0;
    elapsed = 0;
    layBoard();
    updateStats();
    showOverlay(cfg.idle, 'Start game');
  };

  /* ---------- Input ---------- */

  const moveCursor = (dx, dy) => {
    const x = (cursor % cfg.cols + dx + cfg.cols) % cfg.cols;
    const y = (Math.floor(cursor / cfg.cols) + dy + cfg.rows) % cfg.rows;
    cursor = y * cfg.cols + x;
    showCursor();
  };

  root.addEventListener('keydown', (e) => {
    if (e.target.closest('button') && e.target.closest('.memory__card') === null && (e.code === 'Enter' || e.code === 'Space')) return;
    if (state !== 'playing') {
      const ok = START_KEYS.has(e.code) || (state === 'paused' && PAUSE_KEYS.has(e.code));
      if (!ok) return;
      e.preventDefault();
      if (e.repeat || (state === 'won' && performance.now() - endedAt < RESTART_GRACE)) return;
      startOrResume();
      return;
    }
    if (PAUSE_KEYS.has(e.code)) {
      e.preventDefault();
      if (!e.repeat) pause();
    } else if (MOVES[e.code]) {
      e.preventDefault();
      moveCursor(...MOVES[e.code]);
    } else if (FLIP_KEYS.has(e.code)) {
      e.preventDefault();
      if (!e.repeat) flip(cursor);
    }
  });

  board.addEventListener('click', (e) => {
    const el = e.target.closest('[data-card]');
    if (!el || state !== 'playing') return;
    cursor = Number(el.dataset.card);
    showCursor();
    flip(cursor);
    stage.focus({ preventScroll: true });
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

  // The dungeon (dungeon.js) puts this window away and brings it back.
  root.addEventListener('scene-exit', pause);
  root.addEventListener('scene-enter', () => {
    fitFaces();
    mons()?.load().then((list) => { names = list; }).catch(() => { /* the sprites still show; only the names are missing */ });
  });
  if ('ResizeObserver' in window) new ResizeObserver(fitFaces).observe(board);

  setMode('easy');
})();
