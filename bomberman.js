// Bomberman for the Play section: a little bomber in a walled arena of pillars
// and bricks, with slimes and imps roaming the lanes. Walk with the arrows and
// drop a bomb with Z; a bomb blows up a couple of seconds later in a cross
// that breaks bricks, sets off other bombs and kills whatever it touches, the
// bomber included. Some bricks hide extra bombs, longer blasts and quicker
// boots. Clear every enemy to move on to the next, fuller round; the clock
// gives two and a half minutes per round. Three lives; the best score is kept
// per mode. Hard has more and quicker enemies that come looking for you.
(() => {
  const root = document.querySelector('[data-bomber]');
  if (!root) return;

  // The arena has its own units; the canvas is scaled to whatever size it gets.
  const COLS = 15;
  const ROWS = 11;
  const CELL = 32;
  const W = COLS * CELL;
  const H = ROWS * CELL;
  const HALF = 12; // half the bomber's hit box, in units
  const ENEMY_HALF = 11;
  const WALK = 3.4; // cells per second to start with
  const WALK_UP = 0.5; // what each pair of boots adds
  const BOMB_MS = 2200; // the fuse
  const BLAST_MS = 450;
  const DIE_MS = 1000;
  const CLEAR_MS = 1600; // the pause after the last enemy goes
  const BANNER_MS = 1500; // how long the round number shows
  const ROUND_MS = 150000; // the clock, per round
  const LIVES = 3;
  const ITEMS = 6; // bricks hiding something, per round, at most
  const RESTART_GRACE = 800; // ms after the end before a held key can restart
  const BEST_KEY = 'bomber-best';
  const INK = '#2b1a08';
  const SCORES = { brick: 10, item: 50, slime: 100, imp: 200, round: 500 };
  // How many enemies the first round has and how many each round adds, the share of them that
  // are imps (quicker, and keener on the bomber), their speed in cells per second, how often an
  // enemy heads the bomber's way at a junction, and how much of the arena is bricks.
  const MODES = {
    easy: { enemies: 2, add: 1, imp: 0, speed: 1.4, smart: 0.1, soft: 0.5, idle: 'Blow up the slimes, and mind your own blasts.' },
    medium: { enemies: 3, add: 1, imp: 0.25, speed: 1.9, smart: 0.3, soft: 0.55, idle: 'More slimes, and imps that come looking for you.' },
    hard: { enemies: 4, add: 2, imp: 0.4, speed: 2.4, smart: 0.5, soft: 0.6, idle: 'A crowd of quick imps. Keep moving and keep a way out.' },
  };
  const FREE = 0;
  const HARD = 1;
  const SOFT = 2;
  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
  const KEYS = {
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  };
  const BOMB_KEYS = new Set(['Space', 'KeyZ', 'KeyX']);
  const PAUSE_KEYS = new Set(['KeyP', 'Escape']);
  const START_KEYS = new Set(['Enter', 'NumpadEnter', 'Space', 'KeyZ', 'KeyX']);
  const RUNNING = new Set(['playing', 'dying', 'cleared']);

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
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const cellOf = (v) => Math.floor(v / CELL);
  const centre = (c) => c * CELL + CELL / 2;
  const key = (x, y) => `${x},${y}`;

  /* ---------- State ---------- */

  let mode = 'easy';
  let cfg = MODES[mode];
  let state = 'idle'; // idle | playing | dying | cleared | paused | over
  let before = 'playing'; // what the pause interrupted
  let best = loadBest(mode);
  let score = 0;
  let round = 1;
  let lives = LIVES;
  let timeLeft = ROUND_MS;
  let roundAt = 0; // ms of play into this round, for the banner
  let diedAt = 0;
  let clearedAt = 0;
  let endedAt = 0;
  let how = ''; // what got the bomber: 'blast', 'enemy' or 'time'
  let pausedAt = 0;
  let raf = 0;
  let lastTime = 0;
  let scale = 1;
  let grid = [];
  let items = new Map(); // "x,y" -> 'bomb' | 'fire' | 'boots', hidden under a brick until it breaks
  let shown = new Map(); // the ones out in the open
  let bombs = [];
  let blasts = [];
  let enemies = [];
  let puffs = []; // brick dust: x, y, vx, vy, life
  const bomber = { x: 0, y: 0, dir: 'down', moving: false, anim: 0, bombs: 1, range: 2, boots: 0 };
  const held = []; // directions held, most recent last

  /* ---------- Arena ---------- */

  const hardAt = (x, y) => x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 || (x % 2 === 0 && y % 2 === 0);
  const bombAt = (x, y) => bombs.find((b) => b.x === x && b.y === y);
  // A cell nobody can walk into: a wall, a brick, or a bomb (the bomber may still be stepping off one).
  const solid = (x, y, who) => {
    const t = grid[y]?.[x];
    if (t === undefined || t !== FREE) return true;
    const b = bombAt(x, y);
    return Boolean(b && !(who === bomber && b.under));
  };
  // Does a box of half-size `half` at (x, y) stand clear of everything solid?
  const fits = (x, y, half, who) => {
    const x0 = cellOf(x - half);
    const x1 = cellOf(x + half - 0.01);
    const y0 = cellOf(y - half);
    const y1 = cellOf(y + half - 0.01);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) if (solid(cx, cy, who)) return false;
    return true;
  };

  const layRound = () => {
    grid = [];
    for (let y = 0; y < ROWS; y++) {
      const row = [];
      for (let x = 0; x < COLS; x++) row.push(hardAt(x, y) ? HARD : FREE);
      grid.push(row);
    }
    // Bricks everywhere but the bomber's corner, then a few of them hide something.
    const safe = new Set(['1,1', '2,1', '3,1', '1,2', '1,3']);
    const bricks = [];
    for (let y = 1; y < ROWS - 1; y++) {
      for (let x = 1; x < COLS - 1; x++) {
        if (grid[y][x] !== FREE || safe.has(key(x, y)) || Math.random() >= cfg.soft) continue;
        grid[y][x] = SOFT;
        bricks.push([x, y]);
      }
    }
    items = new Map();
    shown = new Map();
    const kinds = ['bomb', 'bomb', 'fire', 'fire', 'boots'];
    bricks.sort(() => Math.random() - 0.5).slice(0, ITEMS).forEach(([x, y]) => items.set(key(x, y), pick(kinds)));
    // Enemies on open floor, well away from the bomber.
    const open = [];
    for (let y = 1; y < ROWS - 1; y++) {
      for (let x = 1; x < COLS - 1; x++) if (grid[y][x] === FREE && x + y >= 7) open.push([x, y]);
    }
    open.sort(() => Math.random() - 0.5);
    const count = Math.min(open.length, cfg.enemies + (round - 1) * cfg.add);
    const imps = Math.round(count * Math.min(0.7, cfg.imp + (round - 1) * 0.12));
    const speed = Math.min(2.8, cfg.speed + (round - 1) * 0.1);
    enemies = open.slice(0, count).map(([x, y], i) => ({
      x: centre(x), y: centre(y), kind: i < imps ? 'imp' : 'slime', speed: Math.min(3.6, i < imps ? speed * 1.35 : speed),
      dir: pick(Object.keys(DIRS)), target: null, wait: 0, alive: true, diedAt: 0, wobble: Math.random() * 10,
    }));
    bombs = [];
    blasts = [];
    puffs = [];
    Object.assign(bomber, { x: centre(1), y: centre(1), dir: 'down', moving: false, anim: 0 });
    held.length = 0;
    timeLeft = ROUND_MS;
    roundAt = 0;
  };

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

  const drawFloor = () => {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const px = x * CELL;
        const py = y * CELL;
        const t = grid[y][x];
        if (t === HARD) {
          ctx.fillStyle = '#6b7585';
          ctx.fillRect(px, py, CELL, CELL);
          ctx.fillStyle = '#9aa5b5';
          ctx.fillRect(px + 2, py + 2, CELL - 4, CELL - 6);
          ctx.fillStyle = '#c3ccd8';
          ctx.fillRect(px + 2, py + 2, CELL - 4, 3);
          ctx.fillRect(px + 2, py + 2, 3, CELL - 6);
          ctx.fillStyle = '#4b5066';
          ctx.fillRect(px + 2, py + CELL - 4, CELL - 4, 2);
          ctx.fillRect(px + CELL - 4, py + 4, 2, CELL - 8);
          continue;
        }
        ctx.fillStyle = (x + y) % 2 ? '#6f8f62' : '#688a5c';
        ctx.fillRect(px, py, CELL, CELL);
        if (t === SOFT) {
          ctx.fillStyle = 'rgba(0, 0, 0, .22)';
          ctx.fillRect(px + 3, py + CELL - 3, CELL - 4, 3);
          ctx.fillStyle = '#8b5a2b';
          ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
          [[3, 3, 12], [17, 3, 12], [3, 11, 5], [10, 11, 12], [24, 11, 5], [3, 19, 12], [17, 19, 12]].forEach(([dx, dy, w]) => {
            ctx.fillStyle = '#b48c6a';
            ctx.fillRect(px + dx, py + dy, w, 6);
            ctx.fillStyle = '#d2ad8a';
            ctx.fillRect(px + dx, py + dy, w, 2);
          });
        }
      }
    }
  };

  const drawItems = (t) => {
    shown.forEach((kind, k) => {
      const [x, y] = k.split(',').map(Number);
      const px = x * CELL + CELL / 2;
      const py = y * CELL + CELL / 2 + Math.round(Math.sin(t / 240 + x) * 1.5);
      ctx.fillStyle = 'rgba(0, 0, 0, .22)';
      ctx.fillRect(px - 9, py + 10, 18, 3);
      ctx.fillStyle = INK;
      rrect(px - 11, py - 11, 22, 22, 4);
      ctx.fill();
      ctx.fillStyle = '#fffaf2';
      rrect(px - 9, py - 9, 18, 18, 3);
      ctx.fill();
      if (kind === 'bomb') {
        ctx.fillStyle = INK;
        ctx.beginPath();
        ctx.arc(px, py + 1, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(px - 1, py - 7, 3, 3);
        ctx.fillStyle = '#d9745a';
        ctx.fillRect(px + 2, py - 8, 2, 2);
      } else if (kind === 'fire') {
        ctx.fillStyle = '#d9745a';
        ctx.beginPath();
        ctx.moveTo(px, py - 8);
        ctx.quadraticCurveTo(px + 8, py - 1, px + 4, py + 7);
        ctx.lineTo(px - 4, py + 7);
        ctx.quadraticCurveTo(px - 8, py - 1, px, py - 8);
        ctx.fill();
        ctx.fillStyle = '#f4c15d';
        ctx.beginPath();
        ctx.moveTo(px, py - 2);
        ctx.quadraticCurveTo(px + 4, py + 2, px + 2, py + 7);
        ctx.lineTo(px - 2, py + 7);
        ctx.quadraticCurveTo(px - 4, py + 2, px, py - 2);
        ctx.fill();
      } else {
        ctx.fillStyle = '#6f8fc0';
        [[-6, -4], [-2, 0], [2, 4]].forEach(([dx, dy]) => {
          ctx.fillRect(px + dx - 1, py + dy - 4, 3, 2);
          ctx.fillRect(px + dx + 1, py + dy - 2, 3, 2);
          ctx.fillRect(px + dx - 1, py + dy, 3, 2);
        });
      }
    });
  };

  const drawBombs = (t) => {
    bombs.forEach((b) => {
      const px = centre(b.x);
      const py = centre(b.y);
      const left = b.at + BOMB_MS - t;
      const swell = 1 + 0.08 * Math.sin(t / (left < 700 ? 45 : 110));
      const r = 10 * swell;
      ctx.fillStyle = 'rgba(0, 0, 0, .25)';
      ctx.beginPath();
      ctx.ellipse(px, py + 11, r, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(px, py + 1, r + 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = left < 700 && Math.floor(t / 90) % 2 ? '#6b4420' : '#3b3f52';
      ctx.beginPath();
      ctx.arc(px, py + 1, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#6b7585';
      ctx.fillRect(px - 5, py - 5, 3, 3); // the shine
      ctx.fillStyle = INK;
      ctx.fillRect(px - 2, py - r - 4, 5, 4); // the cap
      ctx.fillStyle = '#b48c6a';
      ctx.fillRect(px + 2, py - r - 7, 2, 4); // the fuse
      ctx.fillRect(px + 3, py - r - 8, 3, 2);
      const spark = Math.floor(t / 80) % 2;
      ctx.fillStyle = '#f4c15d';
      ctx.fillRect(px + 5 - spark, py - r - 11 + spark, 4, 4);
      ctx.fillStyle = '#fff2e1';
      ctx.fillRect(px + 6, py - r - 10, 2, 2);
    });
  };

  // Each cell of a blast is a cross of bands: orange outside, yellow, then a white core.
  const drawBlasts = (t) => {
    blasts.forEach((bl) => {
      const k = (t - bl.at) / BLAST_MS; // 0 to 1
      const width = (k < 0.25 ? k / 0.25 : k > 0.7 ? (1 - k) / 0.3 : 1) * 0.5 + 0.5;
      bl.cells.forEach(({ x, y, type, dir }) => {
        const px = centre(x);
        const py = centre(y);
        const bands = [['#d9745a', 13], ['#f4c15d', 9], ['#fff2e1', 4]];
        bands.forEach(([col, half]) => {
          const h = half * width;
          ctx.fillStyle = col;
          if (type === 'centre') {
            ctx.fillRect(px - CELL / 2, py - h, CELL, h * 2);
            ctx.fillRect(px - h, py - CELL / 2, h * 2, CELL);
          } else {
            const [dx, dy] = DIRS[dir];
            const length = type === 'end' ? CELL / 2 + h : CELL;
            if (dx) ctx.fillRect(dx > 0 ? px - CELL / 2 : px + CELL / 2 - length, py - h, length, h * 2);
            else ctx.fillRect(px - h, dy > 0 ? py - CELL / 2 : py + CELL / 2 - length, h * 2, length);
            if (type === 'end') {
              ctx.beginPath();
              ctx.arc(px + dx * (CELL / 2 - h) * 0.4, py + dy * (CELL / 2 - h) * 0.4, h * 1.15, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        });
      });
    });
  };

  const drawEnemy = (e, t) => {
    const px = Math.round(e.x);
    let py = Math.round(e.y);
    let alpha = 1;
    let squash = 1;
    if (!e.alive) {
      const k = Math.min(1, (t - e.diedAt) / 600);
      alpha = 1 - k;
      squash = 1 - k * 0.6;
    }
    ctx.globalAlpha = alpha;
    const wob = Math.sin(t / 160 + e.wobble);
    ctx.fillStyle = 'rgba(0, 0, 0, .25)';
    ctx.beginPath();
    ctx.ellipse(px, py + 12, 10, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    if (e.kind === 'slime') {
      const h = (9 + wob) * squash;
      ctx.fillStyle = '#b48cb0';
      ctx.beginPath();
      ctx.ellipse(px, py + 3, 11 - wob * 0.5, h, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#d2b0cf';
      ctx.beginPath();
      ctx.ellipse(px - 3, py - 1, 4, 2.5 * squash, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = INK;
      ctx.fillRect(px - 5, py + 1, 3, 4 * squash);
      ctx.fillRect(px + 2, py + 1, 3, 4 * squash);
      ctx.fillStyle = '#fff2e1';
      ctx.fillRect(px - 4, py + 1, 1, 1);
      ctx.fillRect(px + 3, py + 1, 1, 1);
    } else {
      py += Math.round(wob * 1.5);
      ctx.fillStyle = '#d9745a';
      rrect(px - 9, py - 8 * squash, 18, 18 * squash, 6);
      ctx.fill();
      ctx.fillStyle = '#f4c15d';
      ctx.fillRect(px - 8, py - 12 * squash, 3, 5 * squash); // horns
      ctx.fillRect(px + 5, py - 12 * squash, 3, 5 * squash);
      ctx.fillStyle = INK;
      const look = e.dir === 'left' ? -2 : e.dir === 'right' ? 2 : 0;
      ctx.fillRect(px - 5 + look, py - 3, 3, 3);
      ctx.fillRect(px + 2 + look, py - 3, 3, 3);
      ctx.fillStyle = '#fff2e1';
      ctx.fillRect(px - 4, py + 3, 8, 2); // a grin
      ctx.fillStyle = INK;
      ctx.fillRect(px - 2, py + 3, 1, 2);
      ctx.fillRect(px + 1, py + 3, 1, 2);
    }
    ctx.globalAlpha = 1;
  };

  // The bomber, 20 x 28 units: round white head with a blue helmet and an antenna, white suit, red
  // belt, dark boots that alternate while walking. Eyes follow the direction faced.
  const drawBomber = (t) => {
    const b = bomber;
    const px = Math.round(b.x);
    const py = Math.round(b.y);
    if (state === 'dying') {
      const k = (t - diedAt) / DIE_MS;
      if (how === 'blast' && Math.floor(k * 14) % 2) return; // the blast leaves a flicker
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(how === 'enemy' ? Math.sin(k * 14) * 0.5 : k * Math.PI * 4);
      ctx.scale(1 - k * 0.5, 1 - k * 0.5);
      ctx.translate(-px, -py);
    }
    const stride = b.moving ? Math.floor(b.anim / 120) % 2 : 0;
    ctx.fillStyle = 'rgba(0, 0, 0, .25)';
    ctx.beginPath();
    ctx.ellipse(px, py + 12, 9, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = INK; // boots
    ctx.fillRect(px - 7, py + 7 + (stride ? 2 : 0), 6, 5 - (stride ? 2 : 0));
    ctx.fillRect(px + 1, py + 7 + (stride ? 0 : 2), 6, 5 - (stride ? 0 : 2));
    ctx.fillStyle = '#fffaf2'; // the suit
    rrect(px - 7, py - 2, 14, 11, 4);
    ctx.fill();
    ctx.fillStyle = '#d9745a';
    ctx.fillRect(px - 7, py + 4, 14, 2); // the belt
    ctx.fillStyle = INK;
    ctx.fillRect(px - 1, py + 4, 2, 2);
    ctx.fillStyle = '#fffaf2'; // gloves
    ctx.fillRect(px - 10, py + 1 + (stride ? 2 : 0), 3, 4);
    ctx.fillRect(px + 7, py + 1 + (stride ? 0 : 2), 3, 4);
    ctx.fillStyle = INK; // the head's outline
    ctx.beginPath();
    ctx.arc(px, py - 8, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fffaf2';
    ctx.beginPath();
    ctx.arc(px, py - 8, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6f8fc0'; // the helmet
    ctx.beginPath();
    ctx.arc(px, py - 8, 8, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(px - 8, py - 8, 16, 1);
    ctx.fillStyle = '#d9745a';
    ctx.fillRect(px - 1, py - 19, 3, 3); // the antenna
    ctx.fillStyle = '#6f8fc0';
    ctx.fillRect(px, py - 17, 1, 2);
    if (b.dir !== 'up') {
      const look = b.dir === 'left' ? -2 : b.dir === 'right' ? 2 : 0;
      ctx.fillStyle = INK;
      ctx.fillRect(px - 4 + look, py - 6, 2, 3);
      ctx.fillRect(px + 2 + look, py - 6, 2, 3);
      ctx.fillStyle = '#d9745a';
      ctx.fillRect(px - 6 + look, py - 3, 2, 1); // rosy cheeks
      ctx.fillRect(px + 4 + look, py - 3, 2, 1);
    }
    if (state === 'dying') ctx.restore();
  };

  const banner = (text, sub) => {
    ctx.fillStyle = 'rgba(43, 26, 8, .82)';
    ctx.fillRect(0, H / 2 - 30, W, 60);
    ctx.fillStyle = '#f4c15d';
    ctx.fillRect(0, H / 2 - 30, W, 2);
    ctx.fillRect(0, H / 2 + 28, W, 2);
    ctx.font = '700 20px "Space Grotesk", "JetBrains Mono", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff2e1';
    ctx.fillText(text, W / 2, H / 2 - (sub ? 8 : 0));
    if (sub) {
      ctx.font = '500 11px "JetBrains Mono", ui-monospace, monospace';
      ctx.fillStyle = 'rgba(255, 242, 225, .8)';
      ctx.fillText(sub, W / 2, H / 2 + 13);
    }
  };

  const draw = (t = performance.now()) => {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawFloor();
    drawItems(t);
    drawBombs(t);
    // Whoever is further down the arena is drawn later, so they stand in front.
    const folk = [...enemies.filter((e) => e.alive || t - e.diedAt < 600), bomber].sort((a, b) => a.y - b.y);
    folk.forEach((f) => (f === bomber ? drawBomber(t) : drawEnemy(f, t)));
    drawBlasts(t);
    ctx.fillStyle = '#d2ad8a';
    puffs.forEach((p) => ctx.fillRect(Math.round(p.x), Math.round(p.y), 3, 3));
    if (state === 'cleared') banner('Round cleared!', `+${SCORES.round} points`);
    else if (state === 'playing' && roundAt < BANNER_MS) {
      const hint = round === 1 ? (touch?.matches ? 'arrows to walk, the big button for a bomb' : 'arrows to walk, Z for a bomb') : '';
      ctx.globalAlpha = Math.min(1, (BANNER_MS - roundAt) / 300);
      banner(`Round ${round}`, hint);
      ctx.globalAlpha = 1;
    } else if (state === 'playing' && timeLeft < 20000 && Math.floor(t / 500) % 2) {
      ctx.font = '700 12px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#f4c15d';
      ctx.fillText('HURRY', W / 2, CELL / 2);
    }
  };

  const clock = (ms) => {
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const updateStats = () => {
    out('score').textContent = score.toLocaleString();
    out('best').textContent = best ? best.toLocaleString() : '-';
    out('round').textContent = round;
    out('lives').textContent = lives;
    out('time').textContent = clock(timeLeft);
  };

  /* ---------- Play ---------- */

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
    const record = score > best;
    if (record) {
      best = score;
      saveBest(mode, best);
    }
    updateStats();
    draw();
    const what = how === 'time' ? 'The clock ran out' : how === 'enemy' ? 'The enemies got you' : 'Caught in a blast';
    showOverlay(`${record ? 'New best! ' : ''}${what} in round ${round}. ${score.toLocaleString()} points.`, 'Play again');
  };

  const die = (cause, t) => {
    if (state !== 'playing') return;
    state = 'dying';
    how = cause;
    diedAt = t;
    held.length = 0;
    bomber.moving = false;
  };

  const dust = (x, y) => {
    for (let i = 0; i < 6; i++) {
      puffs.push({ x: centre(x) + (Math.random() - 0.5) * 20, y: centre(y) + (Math.random() - 0.5) * 20, vx: (Math.random() - 0.5) * 90, vy: -40 - Math.random() * 60, life: 300 + Math.random() * 200 });
    }
  };

  // A bomb goes off: its blast runs out along the four lanes until a wall stops it, breaking
  // the first brick it meets in each, setting off any bomb in its way and uncovering what the
  // bricks hid.
  const explode = (bomb, t) => {
    bombs = bombs.filter((b) => b !== bomb);
    const cells = [{ x: bomb.x, y: bomb.y, type: 'centre' }];
    Object.entries(DIRS).forEach(([dir, [dx, dy]]) => {
      for (let i = 1; i <= bomb.range; i++) {
        const x = bomb.x + dx * i;
        const y = bomb.y + dy * i;
        const tile = grid[y]?.[x];
        if (tile === undefined || tile === HARD) break;
        if (tile === SOFT) {
          grid[y][x] = FREE;
          score += SCORES.brick;
          dust(x, y);
          const hidden = items.get(key(x, y));
          if (hidden) {
            shown.set(key(x, y), hidden);
            items.delete(key(x, y));
          }
          cells.push({ x, y, type: 'end', dir });
          break;
        }
        cells.push({ x, y, type: i === bomb.range ? 'end' : 'arm', dir });
        const other = bombAt(x, y);
        if (other) {
          other.at = t - BOMB_MS; // goes off this same frame
          break;
        }
      }
    });
    blasts.push({ cells, at: t, set: new Set(cells.map((c) => key(c.x, c.y))) });
  };

  const dropBomb = (t) => {
    if (state !== 'playing') return;
    const x = cellOf(bomber.x);
    const y = cellOf(bomber.y);
    if (bombs.length >= bomber.bombs || bombAt(x, y) || grid[y][x] !== FREE) return;
    bombs.push({ x, y, at: t, range: bomber.range, under: true });
  };

  // Walk one axis; when something is in the way, slip towards whichever lane beside is open,
  // so brushing a corner steers the bomber round it instead of stopping dead.
  const walk = (dir, step) => {
    const b = bomber;
    const [dx, dy] = DIRS[dir];
    let left = step;
    while (left > 0) {
      const s = Math.min(1, left);
      if (!fits(b.x + dx * s, b.y + dy * s, HALF, b)) break;
      b.x += dx * s;
      b.y += dy * s;
      left -= s;
    }
    if (left <= 0) return;
    const cx = cellOf(b.x);
    const cy = cellOf(b.y);
    if (dx) {
      const off = b.y - centre(cy);
      const want = !solid(cx + dx, cy, b) ? centre(cy) : off && !solid(cx + dx, cy + Math.sign(off), b) ? centre(cy + Math.sign(off)) : null;
      if (want === null || want === b.y) return;
      const ny = b.y + Math.sign(want - b.y) * Math.min(left, Math.abs(want - b.y));
      if (fits(b.x, ny, HALF, b)) b.y = ny;
    } else {
      const off = b.x - centre(cx);
      const want = !solid(cx, cy + dy, b) ? centre(cx) : off && !solid(cx + Math.sign(off), cy + dy, b) ? centre(cx + Math.sign(off)) : null;
      if (want === null || want === b.x) return;
      const nx = b.x + Math.sign(want - b.x) * Math.min(left, Math.abs(want - b.x));
      if (fits(nx, b.y, HALF, b)) b.x = nx;
    }
  };

  // Enemies go lane to lane, cell centre to cell centre. At each centre they mostly carry on,
  // sometimes turn, and now and then (more in the harder modes, and always for an imp with the
  // bomber in sight) head the way that brings them closer to the bomber.
  const steer = (e) => {
    const cx = cellOf(e.x);
    const cy = cellOf(e.y);
    const open = Object.entries(DIRS).filter(([, [dx, dy]]) => !solid(cx + dx, cy + dy, e));
    if (!open.length) {
      e.target = null;
      e.wait = 300;
      return;
    }
    const bx = cellOf(bomber.x);
    const by = cellOf(bomber.y);
    const inSight = (bx === cx || by === cy) && !solidBetween(cx, cy, bx, by);
    const keen = e.kind === 'imp' && inSight ? 1 : cfg.smart;
    let choice;
    if (Math.random() < keen) {
      const dist = ([, [dx, dy]]) => Math.abs(cx + dx - bx) + Math.abs(cy + dy - by);
      choice = open.reduce((a, b) => (dist(b) < dist(a) ? b : a));
    } else {
      const ahead = open.find(([d]) => d === e.dir);
      const sides = open.filter(([d]) => d !== OPPOSITE[e.dir]);
      choice = ahead && Math.random() < 0.7 ? ahead : sides.length ? pick(sides) : open[0];
    }
    e.dir = choice[0];
    const [dx, dy] = choice[1];
    e.target = [centre(cx + dx), centre(cy + dy)];
  };
  const solidBetween = (x0, y0, x1, y1) => {
    const dx = Math.sign(x1 - x0);
    const dy = Math.sign(y1 - y0);
    for (let x = x0 + dx, y = y0 + dy; x !== x1 || y !== y1; x += dx, y += dy) if (grid[y]?.[x] !== FREE || bombAt(x, y)) return true;
    return false;
  };

  const update = (ms, t) => {
    const dt = ms / 1000;
    puffs.forEach((p) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 200 * dt;
      p.life -= ms;
    });
    puffs = puffs.filter((p) => p.life > 0);
    blasts = blasts.filter((bl) => t - bl.at < BLAST_MS);
    // Bombs count down whatever else is going on; a dying bomber's last bombs still go off, and
    // one blast sets off the next until none is due.
    let blown = false;
    for (let due = bombs.filter((b) => t - b.at >= BOMB_MS); due.length; due = bombs.filter((b) => t - b.at >= BOMB_MS)) {
      due.forEach((b) => { if (bombs.includes(b)) explode(b, t); });
      blown = true;
    }
    if (blown) out('score').textContent = score.toLocaleString();

    if (state === 'dying') {
      if (t - diedAt >= DIE_MS) {
        lives--;
        if (lives <= 0) {
          finish();
          return;
        }
        layRound();
        state = 'playing';
        updateStats();
      }
      return;
    }
    if (state === 'cleared') {
      if (t - clearedAt >= CLEAR_MS) {
        round++;
        layRound();
        state = 'playing';
        updateStats();
      }
      return;
    }
    if (state !== 'playing') return;
    roundAt += ms;
    const wasLeft = Math.ceil(timeLeft / 1000);
    timeLeft = Math.max(0, timeLeft - ms);
    if (Math.ceil(timeLeft / 1000) !== wasLeft) out('time').textContent = clock(timeLeft);
    if (timeLeft <= 0) {
      die('time', t);
      return;
    }

    // The bomber.
    const b = bomber;
    const dir = held[held.length - 1];
    if (dir) {
      b.dir = dir;
      b.moving = true;
      b.anim += ms;
      walk(dir, (WALK + b.boots * WALK_UP) * CELL * dt);
    } else b.moving = false;
    // A bomb is only walkable while the bomber is still on top of it.
    bombs.forEach((bomb) => {
      if (bomb.under && (Math.abs(b.x - centre(bomb.x)) >= CELL / 2 + HALF || Math.abs(b.y - centre(bomb.y)) >= CELL / 2 + HALF)) bomb.under = false;
    });
    const bx = cellOf(b.x);
    const by = cellOf(b.y);
    const got = shown.get(key(bx, by));
    if (got) {
      shown.delete(key(bx, by));
      score += SCORES.item;
      if (got === 'bomb') b.bombs = Math.min(6, b.bombs + 1);
      else if (got === 'fire') b.range = Math.min(7, b.range + 1);
      else b.boots = Math.min(4, b.boots + 1);
      out('score').textContent = score.toLocaleString();
    }

    // The enemies.
    enemies.forEach((e) => {
      if (!e.alive) return;
      if (e.wait > 0) {
        e.wait -= ms;
        return;
      }
      if (!e.target) steer(e);
      if (!e.target) return;
      const [tx, ty] = e.target;
      const step = e.speed * CELL * dt;
      const dx = tx - e.x;
      const dy = ty - e.y;
      const dist = Math.abs(dx) + Math.abs(dy);
      if (dist <= step) {
        e.x = tx;
        e.y = ty;
        e.target = null;
        // Already at the next centre: pick again at once so the pace never stutters.
        steer(e);
      } else {
        e.x += Math.sign(dx) * Math.min(step, Math.abs(dx));
        e.y += Math.sign(dy) * Math.min(step, Math.abs(dy));
        // A bomb dropped in the way turns them round.
        if (solid(cellOf(tx), cellOf(ty), e)) {
          e.target = [centre(cellOf(e.x)), centre(cellOf(e.y))];
          e.dir = OPPOSITE[e.dir];
        }
      }
    });

    // Blasts kill whatever stands in them; enemies kill the bomber by touch.
    const burning = new Set();
    blasts.forEach((bl) => bl.set.forEach((k) => burning.add(k)));
    let killed = 0;
    enemies.forEach((e) => {
      if (!e.alive) return;
      if (burning.has(key(cellOf(e.x), cellOf(e.y)))) {
        e.alive = false;
        e.diedAt = t;
        score += SCORES[e.kind];
        killed++;
      } else if (Math.abs(e.x - b.x) < HALF + ENEMY_HALF - 6 && Math.abs(e.y - b.y) < HALF + ENEMY_HALF - 6) die('enemy', t);
    });
    if (killed) out('score').textContent = score.toLocaleString();
    if (state === 'playing' && burning.has(key(bx, by))) die('blast', t);
    if (state === 'playing' && enemies.every((e) => !e.alive)) {
      state = 'cleared';
      clearedAt = t;
      award(`bomber.${mode}.${round}`); // rounds 3, 6 and (on hard) 10 have one
      score += SCORES.round;
      held.length = 0;
      b.moving = false;
      out('score').textContent = score.toLocaleString();
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

  const start = () => {
    score = 0;
    round = 1;
    lives = LIVES;
    Object.assign(bomber, { bombs: 1, range: 2, boots: 0 });
    layRound();
    state = 'playing';
    updateStats();
    run();
  };

  const pause = () => {
    if (!RUNNING.has(state)) return;
    before = state;
    state = 'paused';
    pausedAt = performance.now();
    cancelAnimationFrame(raf);
    held.length = 0;
    bomber.moving = false;
    draw();
    showOverlay('Paused', 'Resume');
  };

  // Fuses, blasts and the death and round timers all run on the clock, so a pause shifts them along.
  const resume = () => {
    const gap = performance.now() - pausedAt;
    bombs.forEach((b) => { b.at += gap; });
    blasts.forEach((b) => { b.at += gap; });
    enemies.forEach((e) => { e.diedAt += gap; });
    diedAt += gap;
    clearedAt += gap;
    state = before;
    run();
  };

  const startOrResume = () => (state === 'paused' ? resume() : start());

  // Switching mode abandons the current game.
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
    score = 0;
    round = 1;
    lives = LIVES;
    Object.assign(bomber, { bombs: 1, range: 2, boots: 0 });
    layRound();
    updateStats();
    draw();
    showOverlay(cfg.idle, 'Start game');
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

  // Keys only reach the game while it has focus, so the page scrolls normally otherwise.
  root.addEventListener('keydown', (e) => {
    if (e.target.closest('button') && (e.code === 'Enter' || e.code === 'Space')) return;
    if (state === 'playing') {
      if (KEYS[e.code]) {
        e.preventDefault();
        if (!e.repeat) hold(KEYS[e.code]);
      } else if (BOMB_KEYS.has(e.code)) {
        e.preventDefault();
        if (!e.repeat) dropBomb(performance.now());
      } else if (PAUSE_KEYS.has(e.code)) {
        e.preventDefault();
        if (!e.repeat) pause();
      }
      return;
    }
    if (state === 'dying' || state === 'cleared') {
      if (KEYS[e.code] || BOMB_KEYS.has(e.code)) e.preventDefault();
      else if (PAUSE_KEYS.has(e.code)) {
        e.preventDefault();
        if (!e.repeat) pause();
      }
      return;
    }
    // Idle, paused or over: Enter, Space, Z or X starts; while paused, the pause and arrow keys resume too.
    const go = START_KEYS.has(e.code) || (state === 'paused' && (PAUSE_KEYS.has(e.code) || KEYS[e.code]));
    if (!go) return;
    e.preventDefault();
    if (e.repeat || (state === 'over' && performance.now() - endedAt < RESTART_GRACE)) return;
    startOrResume();
  });
  root.addEventListener('keyup', (e) => {
    if (KEYS[e.code]) unhold(KEYS[e.code]);
  });
  window.addEventListener('blur', () => { held.length = 0; });

  // A tap on the arena drops a bomb, like the keys.
  board.addEventListener('pointerdown', (e) => {
    if (state !== 'playing') return;
    e.preventDefault();
    stage.focus({ preventScroll: true });
    dropBomb(performance.now());
  });

  // Touch pad: hold a direction to keep walking; the big button drops a bomb, the last one pauses.
  root.querySelectorAll('[data-dir]').forEach((b) => {
    const dir = b.dataset.dir;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (state === 'playing') hold(dir);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((type) => b.addEventListener(type, () => unhold(dir)));
  });
  root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (b.dataset.act === 'bomb') dropBomb(performance.now());
    else if (state === 'paused') resume();
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
