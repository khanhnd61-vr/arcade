// Minesweeper for the Play section: dig up every cell that hides no mine. A
// number counts the mines in the eight cells around it; flag the ones you are
// sure of, and dig around a number once its flags are all placed. The first dig
// is always safe, and the best time is kept per level.
(() => {
  const root = document.querySelector('[data-mines]');
  if (!root) return;

  const CELL = 24; // one cell, in board units; the canvas is scaled to whatever size it gets
  const LEVELS = {
    easy: { cols: 9, rows: 9, mines: 10 },
    medium: { cols: 16, rows: 16, mines: 40 },
    hard: { cols: 30, rows: 16, mines: 99 },
  };
  const HOLD = 450; // ms a touch must be held to plant a flag
  const BEST_KEY = 'mines-best';
  const NUMBERS = ['', '#6f8fc0', '#5c7a5e', '#d9745a', '#3b2f5e', '#a44a3a', '#4f6f8a', '#2b1a08', '#9a8a78'];
  const AROUND = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  const MOVES = {
    ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1],
    ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0],
  };
  const DIG_KEYS = new Set(['KeyZ', 'Space', 'Enter', 'NumpadEnter']);
  const FLAG_KEYS = new Set(['KeyX', 'KeyF']);

  const stage = root.querySelector('[data-stage]');
  const field = root.querySelector('[data-field]');
  const overlay = root.querySelector('[data-overlay]');
  const msg = root.querySelector('[data-msg]');
  const levelBtns = root.querySelectorAll('[data-level]');
  const modeBtn = root.querySelector('[data-act="mode"]');
  const out = (k) => root.querySelector(`[data-out="${k}"]`);
  const ctx = field.getContext('2d');

  const loadBest = () => {
    try { return JSON.parse(localStorage.getItem(BEST_KEY)) || {}; } catch { return {}; }
  };
  const saveBest = () => {
    try { localStorage.setItem(BEST_KEY, JSON.stringify(best)); } catch { /* storage unavailable */ }
  };

  /* ---------- State ---------- */

  let level = 'easy';
  let cfg = LEVELS[level];
  let best = loadBest(); // best time per level, in ms
  let cols = 0;
  let rows = 0;
  let W = 0; // the board, in units
  let H = 0;
  let mine = null; // one byte per cell: is there a mine under it
  let open = null; // has it been dug
  let flag = null; // is it flagged
  let count = null; // mines in the eight cells around it
  let state = 'fresh'; // fresh (no mines laid yet) | playing | won | lost
  let opened = 0;
  let flags = 0;
  let hit = -1; // the mine that went off
  let cursor = null; // [x, y] of the keyboard cursor
  let press = null; // [x, y] the pointer is held down on
  let hold = null; // { timer, done } while a touch is held, waiting to become a flag
  let flagMode = false; // the touch pad's mode: tap plants a flag instead of digging
  let games = 0; // boards finished, won or lost
  let wins = 0;
  let scale = 1;
  let elapsed = 0; // ms banked while the clock was running
  let since = 0; // when the clock last started, 0 while stopped
  let clock = 0;
  let hiddenStop = false; // clock stopped only because the board was put away

  const idx = (x, y) => y * cols + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;
  const neighbours = (x, y) => AROUND.map(([dx, dy]) => [x + dx, y + dy]).filter(([nx, ny]) => inside(nx, ny));

  const fmtTime = (ms) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const now = () => elapsed + (since ? performance.now() - since : 0);
  const showTime = () => { out('time').textContent = fmtTime(now()); };
  const startClock = () => {
    if (since || state !== 'playing') return;
    since = performance.now();
    clock = setInterval(showTime, 250);
  };
  const stopClock = () => {
    if (!since) return;
    elapsed = now();
    since = 0;
    clearInterval(clock);
  };

  const updateStats = () => {
    out('mines').textContent = cfg.mines - flags;
    out('best').textContent = best[level] ? fmtTime(best[level]) : '-';
    out('won').textContent = `${wins} / ${games}`;
    showTime();
  };

  /* ---------- Drawing ---------- */

  const closedCell = (px, py, down) => {
    if (down) {
      ctx.fillStyle = '#fff2e1';
      ctx.fillRect(px + 1, py + 1, CELL - 1, CELL - 1);
      return;
    }
    ctx.fillStyle = '#e8d6bd';
    ctx.fillRect(px, py, CELL, CELL);
    ctx.fillStyle = '#fffaf2';
    ctx.fillRect(px, py, CELL, 2);
    ctx.fillRect(px, py, 2, CELL);
    ctx.fillStyle = '#c9b899';
    ctx.fillRect(px, py + CELL - 2, CELL, 2);
    ctx.fillRect(px + CELL - 2, py, 2, CELL);
  };

  const drawMine = (px, py) => {
    const cx = px + CELL / 2;
    const cy = py + CELL / 2;
    ctx.fillStyle = '#2b1a08';
    ctx.fillRect(cx - 1, cy - 8, 2, 16); // spikes
    ctx.fillRect(cx - 8, cy - 1, 16, 2);
    ctx.fillRect(cx - 6, cy - 6, 2, 2);
    ctx.fillRect(cx + 4, cy - 6, 2, 2);
    ctx.fillRect(cx - 6, cy + 4, 2, 2);
    ctx.fillRect(cx + 4, cy + 4, 2, 2);
    ctx.beginPath();
    ctx.arc(cx, cy, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fffaf2';
    ctx.fillRect(cx - 3, cy - 3, 2, 2); // glint
  };

  const drawFlag = (px, py) => {
    ctx.fillStyle = '#2b1a08';
    ctx.fillRect(px + 12, py + 5, 2, 13); // pole
    ctx.fillRect(px + 8, py + 17, 9, 2); // base
    ctx.fillStyle = '#d9745a';
    ctx.beginPath();
    ctx.moveTo(px + 14, py + 4);
    ctx.lineTo(px + 6, py + 8.5);
    ctx.lineTo(px + 14, py + 13);
    ctx.closePath();
    ctx.fill();
  };

  const drawCross = (px, py) => {
    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(px + 5, py + 5);
    ctx.lineTo(px + CELL - 5, py + CELL - 5);
    ctx.moveTo(px + CELL - 5, py + 5);
    ctx.lineTo(px + 5, py + CELL - 5);
    ctx.stroke();
  };

  const drawCell = (x, y) => {
    const i = idx(x, y);
    const px = x * CELL;
    const py = y * CELL;
    const lost = state === 'lost';
    if (open[i]) {
      ctx.fillStyle = i === hit ? '#d9745a' : '#fff2e1';
      ctx.fillRect(px + 1, py + 1, CELL - 1, CELL - 1);
      if (mine[i]) drawMine(px, py);
      else if (count[i]) {
        ctx.fillStyle = NUMBERS[count[i]];
        ctx.fillText(String(count[i]), px + CELL / 2, py + CELL / 2 + 1);
      }
      return;
    }
    if (flag[i]) {
      closedCell(px, py, false);
      if (lost && !mine[i]) {
        drawMine(px, py);
        drawCross(px, py);
      } else drawFlag(px, py);
      return;
    }
    if (lost && mine[i]) {
      ctx.fillStyle = '#fff2e1';
      ctx.fillRect(px + 1, py + 1, CELL - 1, CELL - 1);
      drawMine(px, py);
      return;
    }
    // A closed cell under the pointer, or next to a number being pressed, sinks in.
    const down = press && (
      (press[0] === x && press[1] === y)
      || (open[idx(...press)] && Math.abs(press[0] - x) <= 1 && Math.abs(press[1] - y) <= 1)
    );
    closedCell(px, py, Boolean(down));
  };

  const draw = () => {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = '#c9b899'; // the grid lines show through between the cells
    ctx.fillRect(0, 0, W, H);
    ctx.font = '700 15px "Space Grotesk", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) drawCell(x, y);
    if (cursor && (state === 'fresh' || state === 'playing')) {
      ctx.strokeStyle = '#f4c15d';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(cursor[0] * CELL + 2, cursor[1] * CELL + 2, CELL - 3, CELL - 3);
    }
  };

  /* ---------- Play ---------- */

  const showOverlay = (text, label) => {
    msg.textContent = text;
    overlay.querySelector('[data-new]').textContent = label;
    overlay.hidden = false;
  };

  const newGame = () => {
    cols = cfg.cols;
    rows = cfg.rows;
    W = cols * CELL;
    H = rows * CELL;
    const n = cols * rows;
    mine = new Uint8Array(n);
    open = new Uint8Array(n);
    flag = new Uint8Array(n);
    count = new Uint8Array(n);
    state = 'fresh';
    opened = 0;
    flags = 0;
    hit = -1;
    cursor = null;
    press = null;
    stopClock();
    elapsed = 0;
    overlay.hidden = true;
    updateStats();
    fit();
  };

  // The mines are only laid on the first dig, keeping that cell and its neighbours clear.
  const layMines = (sx, sy) => {
    const n = cols * rows;
    const safe = new Set(neighbours(sx, sy).map(([x, y]) => idx(x, y)));
    safe.add(idx(sx, sy));
    const spots = [];
    for (let i = 0; i < n; i++) if (!safe.has(i)) spots.push(i);
    for (let k = 0; k < cfg.mines; k++) {
      const j = k + Math.floor(Math.random() * (spots.length - k));
      [spots[k], spots[j]] = [spots[j], spots[k]];
      mine[spots[k]] = 1;
    }
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        count[idx(x, y)] = neighbours(x, y).filter(([nx, ny]) => mine[idx(nx, ny)]).length;
      }
    }
    state = 'playing';
    startClock();
  };

  const lose = (i) => {
    state = 'lost';
    hit = i;
    open[i] = 1;
    stopClock();
    games++;
    updateStats();
    draw();
    const safe = cols * rows - cfg.mines;
    showOverlay(`Boom, that one was a mine. ${Math.floor((opened / safe) * 100)}% of the field was clear.`, 'Try again');
  };

  const award = (key) => window.arcadeMons?.award(key); // a monster for a first-time achievement, see rewards.csv

  const win = () => {
    state = 'won';
    stopClock();
    for (let i = 0; i < mine.length; i++) if (mine[i]) flag[i] = 1;
    flags = cfg.mines;
    games++;
    wins++;
    const t = now();
    award(`mines.${level}`);
    if (level === 'hard' && t < 180000) award('mines.hard-fast');
    const record = !best[level] || t < best[level];
    if (record) {
      best[level] = t;
      saveBest();
    }
    updateStats();
    draw();
    showOverlay(record ? `Cleared in ${fmtTime(t)}, a new best!` : `Cleared in ${fmtTime(t)}. Best ${fmtTime(best[level])}.`, 'Play again');
  };

  // Dig a cell; an empty one opens everything around it too.
  const reveal = (x, y) => {
    const i = idx(x, y);
    if (open[i] || flag[i]) return;
    if (state === 'fresh') layMines(x, y);
    if (state !== 'playing') return;
    if (mine[i]) {
      lose(i);
      return;
    }
    const stack = [[x, y]];
    open[i] = 1;
    opened++;
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (count[idx(cx, cy)]) continue;
      for (const [nx, ny] of neighbours(cx, cy)) {
        const j = idx(nx, ny);
        if (open[j] || flag[j]) continue;
        open[j] = 1;
        opened++;
        stack.push([nx, ny]);
      }
    }
    if (opened === cols * rows - cfg.mines) win();
  };

  // Dig around a number whose flags are all placed.
  const chord = (x, y) => {
    const i = idx(x, y);
    if (!open[i] || !count[i]) return;
    const near = neighbours(x, y);
    const placed = near.filter(([nx, ny]) => flag[idx(nx, ny)]).length;
    if (placed !== count[i]) return;
    for (const [nx, ny] of near) {
      if (state !== 'playing') break;
      reveal(nx, ny);
    }
  };

  const toggleFlag = (x, y) => {
    const i = idx(x, y);
    if (open[i] || (state !== 'fresh' && state !== 'playing')) return;
    flag[i] ^= 1;
    flags += flag[i] ? 1 : -1;
    updateStats();
  };

  // Z, a click or a tap: dig a closed cell, or dig around an open number.
  const act = (x, y) => {
    if (state !== 'fresh' && state !== 'playing') return;
    if (open[idx(x, y)]) chord(x, y);
    else reveal(x, y);
    if (state === 'playing') updateStats();
  };

  const setMode = (on) => {
    flagMode = on;
    modeBtn.textContent = on ? 'Flag' : 'Dig';
    modeBtn.setAttribute('aria-pressed', String(on));
    modeBtn.classList.toggle('is-flag', on);
  };

  // Switching level abandons the current game.
  const setLevel = (name) => {
    level = name;
    cfg = LEVELS[name];
    levelBtns.forEach((b) => {
      const on = b.dataset.level === name;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    root.style.setProperty('--cols', cfg.cols);
    root.style.setProperty('--rows', cfg.rows);
    newGame();
  };

  /* ---------- Input ---------- */

  const cellAt = (e) => {
    const r = field.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * cols);
    const y = Math.floor(((e.clientY - r.top) / r.height) * rows);
    return inside(x, y) ? [x, y] : null;
  };
  const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];
  const endHold = () => {
    if (hold) clearTimeout(hold.timer);
    hold = null;
  };
  const release = () => {
    endHold();
    if (!press) return;
    press = null;
    draw();
  };

  field.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    stage.focus({ preventScroll: true });
    if (state !== 'fresh' && state !== 'playing') return;
    const cell = cellAt(e);
    if (!cell) return;
    cursor = null;
    if (e.button === 2 || (e.button === 0 && flagMode)) {
      toggleFlag(...cell);
      draw();
      return;
    }
    if (e.button === 1) {
      chord(...cell);
      draw();
      return;
    }
    if (e.button !== 0) return;
    press = cell;
    endHold();
    if (e.pointerType !== 'mouse') {
      // A held touch plants a flag instead of digging.
      hold = {
        done: false,
        timer: setTimeout(() => {
          hold.done = true;
          press = null;
          toggleFlag(...cell);
          navigator.vibrate?.(30);
          draw();
        }, HOLD),
      };
    }
    draw();
  });
  field.addEventListener('pointermove', (e) => {
    if (!press || !(e.buttons & 1)) return;
    const cell = cellAt(e);
    if (same(cell, press)) return;
    endHold(); // moved off the cell: a scroll or a slip, not a flag
    press = cell;
    draw();
  });
  field.addEventListener('pointerup', (e) => {
    const flagged = hold?.done;
    endHold();
    if (flagged || !press) return;
    const cell = cellAt(e);
    press = null;
    if (cell) act(...cell);
    draw();
  });
  field.addEventListener('pointercancel', release);
  field.addEventListener('pointerleave', release);
  field.addEventListener('contextmenu', (e) => e.preventDefault());

  // Keys only reach the game while it has focus, so the page scrolls normally otherwise.
  root.addEventListener('keydown', (e) => {
    if (e.target.closest('button') && (e.code === 'Enter' || e.code === 'Space')) return;
    if (e.code === 'KeyN') {
      e.preventDefault();
      if (!e.repeat) newGame();
      return;
    }
    if (state !== 'fresh' && state !== 'playing') {
      if (DIG_KEYS.has(e.code) && !e.repeat) {
        e.preventDefault();
        newGame();
      }
      return;
    }
    if (MOVES[e.code]) {
      e.preventDefault();
      const [dx, dy] = MOVES[e.code];
      cursor = cursor
        ? [(cursor[0] + dx + cols) % cols, (cursor[1] + dy + rows) % rows]
        : [Math.floor(cols / 2), Math.floor(rows / 2)];
      press = null;
      draw();
    } else if (DIG_KEYS.has(e.code) || FLAG_KEYS.has(e.code)) {
      e.preventDefault();
      if (e.repeat) return;
      if (!cursor) cursor = [Math.floor(cols / 2), Math.floor(rows / 2)];
      if (FLAG_KEYS.has(e.code)) toggleFlag(...cursor);
      else act(...cursor);
      draw();
    }
  });

  // Touch pad: switch between digging and flagging, or start over.
  root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (b.dataset.act === 'mode') setMode(!flagMode);
    else newGame();
  }));
  root.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', newGame));
  levelBtns.forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.level !== level) setLevel(b.dataset.level);
  }));

  const fit = () => {
    const w = Math.round(field.clientWidth * (window.devicePixelRatio || 1));
    if (!w) return;
    field.width = w;
    field.height = Math.round((w * H) / W);
    scale = w / W;
    draw();
  };

  // The clock only runs while the board is on screen: not while the page is
  // hidden, and not while the dungeon (dungeon.js) has this window put away.
  const sleep = () => {
    hiddenStop = hiddenStop || Boolean(since);
    stopClock();
  };
  const wake = () => {
    if (!hiddenStop || document.hidden || root.hidden) return;
    hiddenStop = false;
    startClock();
  };
  document.addEventListener('visibilitychange', () => (document.hidden ? sleep() : wake()));
  root.addEventListener('scene-exit', sleep);
  root.addEventListener('scene-enter', () => {
    wake();
    fit();
  });
  if ('ResizeObserver' in window) new ResizeObserver(fit).observe(field);

  setMode(false);
  setLevel(level);
})();
