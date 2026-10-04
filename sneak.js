// Sneak for the Play section: a little thief creeps through five guarded rooms
// at night, picks up every gem and slips out of the door. Guards walk their
// rounds, or stand and turn on the spot, and each carries a lantern that lights
// a cone of floor ahead of them. Step into the light and you are caught and
// the level starts over; walls and crates block the light, and the shadows on
// the floor hide you altogether. The clock runs over the whole run; the best
// time to clear all five levels is kept per mode. Hard gives the guards
// quicker feet and brighter lanterns.
(() => {
  const root = document.querySelector('[data-sneak]');
  if (!root) return;

  // The room has its own units; the canvas is scaled to whatever size it gets.
  const COLS = 20;
  const ROWS = 13;
  const CELL = 24;
  const W = COLS * CELL;
  const H = ROWS * CELL;
  const MOVE_MS = 140; // ms per step while a direction is held
  const CAUGHT_MS = 900; // the "!" hangs over the guard this long before the level restarts
  const CLEAR_MS = 700; // the open door glows this long before the next level
  const RESTART_GRACE = 500; // ms after a catch before a held key can restart
  const BEST_KEY = 'sneak-best';
  // Guards: ms per step on patrol, ms between a sentry's turns, and how far a lantern reaches.
  const MODES = {
    normal: { walk: 420, turn: 840, range: 4, idle: 'Take every gem and reach the door without stepping into the light.' },
    hard: { walk: 280, turn: 560, range: 5, idle: 'Quicker guards and brighter lanterns. Stay in the dark.' },
  };
  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const TURNS = ['up', 'right', 'down', 'left']; // a sentry turns clockwise
  const KEYS = {
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  };
  const PAUSE_KEYS = new Set(['KeyP', 'Escape']);
  const START_KEYS = new Set(['Enter', 'NumpadEnter', 'Space', 'KeyZ']);
  const RUNNING = new Set(['playing', 'caught', 'cleared']);
  const INK = '#2b1a08';

  // The levels, one character per cell: # wall, c crate (both block the way and
  // the light), ~ a patch of shadow to hide in, * a gem, S where the thief
  // starts and E the door out. Guards walk back and forth along `path` (a
  // list of corners, each in line with the next) or, with a single cell and
  // `face`, stand there and turn on the spot.
  const LEVELS = [
    {
      name: 'The hallway',
      map: [
        '####################',
        '#S........#........#',
        '#.........#..*.....#',
        '#.........#........#',
        '#...cc....#........#',
        '#.........#.....cc.#',
        '#.........#........#',
        '#........####..#####',
        '#.....*............#',
        '#..................#',
        '#....cc.....~~.....#',
        '#.................E#',
        '####################',
      ],
      guards: [{ path: [[2, 9], [17, 9]] }],
    },
    {
      name: 'The vault',
      map: [
        '####################',
        '#S.......#....*....#',
        '#........#.........#',
        '#...cc...#..cc.cc..#',
        '#........#.........#',
        '#....~...#.........#',
        '#........#.........#',
        '#####.######...#####',
        '#..................#',
        '#.*.....cc.....~...#',
        '#..................#',
        '#.....cc.........E.#',
        '####################',
      ],
      guards: [
        { path: [[4, 1], [4, 6]] },
        { path: [[15, 5]], face: 'left' },
        { path: [[2, 8], [17, 8]] },
      ],
    },
    {
      name: 'Crossed paths',
      map: [
        '####################',
        '#..........*.......#',
        '#.cc...~.......cc..#',
        '#..................#',
        '#......cc....~.....#',
        '#S.................#',
        '#..................#',
        '#....~......cc.....#',
        '#..................#',
        '#..cc.......~......#',
        '#..................#',
        '#*...............E.#',
        '####################',
      ],
      guards: [
        { path: [[9, 1], [9, 11]] },
        { path: [[1, 7], [18, 7]] },
        { path: [[14, 1], [14, 5]] },
      ],
    },
    {
      name: 'Night shift',
      map: [
        '####################',
        '#S.....#.....#.....#',
        '#......#.....#.....#',
        '#..~...#.*...#..*..#',
        '#......#.....#.....#',
        '#...####..#####....#',
        '#..................#',
        '#.......~..........#',
        '#..####.....####...#',
        '#..#..*.........#..#',
        '#..#............#..#',
        '#..#....cc....~.#.E#',
        '####################',
      ],
      guards: [
        { path: [[11, 2]], face: 'down' },
        { path: [[16, 1], [16, 4]] },
        { path: [[1, 6], [18, 6]] },
        { path: [[5, 10], [14, 10]] },
      ],
    },
    {
      name: 'The treasury',
      map: [
        '####################',
        '#*.......##.......*#',
        '#..~.....##........#',
        '#........##..cc....#',
        '#...cc...##........#',
        '#..................#',
        '#........~.........#',
        '#......cc...cc.....#',
        '#..................#',
        '#..~.....##.....~..#',
        '#........##........#',
        '#*......E##......S.#',
        '####################',
      ],
      guards: [
        { path: [[2, 2], [7, 2], [7, 4], [2, 4]] },
        { path: [[12, 1], [17, 1], [17, 4], [12, 4]] },
        { path: [[1, 8], [18, 8]] },
        { path: [[9, 6]], face: 'right' },
        { path: [[3, 10], [7, 10]] },
      ],
    },
  ];

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
  const clock = (ms) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  /* ---------- Pixel art ---------- */

  // Sprites are 12 x 12 cells of 2 x 2 pixels, one character each.
  const PAL = {
    k: '#3b2f5e', m: '#5e4a86', f: '#fff2e1', e: INK, b: '#8b5a2b', // the thief: cloak, hood, face, eyes, sack
    h: '#9aa5b5', s: '#6b7585', r: '#d9745a', g: '#f4c15d', // the guard: steel, dark steel, tabard, trim
    c: '#8fb8c4', d: '#6f8fc0', w: '#fffaf2', // the gem
  };
  const THIEF = {
    down: [
      '....mmmm....', '...mkkkkm...', '..mkkkkkkm..', '..mkffffkm..', '..mkfefekm..', '..mkffffkm..',
      '...kkkkkk...', '..kkkkkkkkb.', '..kkkkkkkbb.', '..kkkkkkkkb.', '...kkkkkk...', '...ee..ee...',
    ],
    up: [
      '....mmmm....', '...mkkkkm...', '..mkkkkkkm..', '..mkkkkkkm..', '..mkkkkkkm..', '..mkkkkkkm..',
      '...kkkkkk...', '.bkkkkkkkk..', '.bbkkkkkkk..', '.bkkkkkkkk..', '...kkkkkk...', '...ee..ee...',
    ],
    right: [
      '....mmmm....', '...mkkkkm...', '..mkkkkkkm..', '..mkkkfffm..', '..mkkkfeff..', '..mkkkffff..',
      '...kkkkkk...', '.bkkkkkkkk..', '.bbkkkkkkk..', '.bkkkkkkkk..', '...kkkkkk...', '...ee..ee...',
    ],
  };
  const GUARD = {
    down: [
      '....hhhh....', '...hhhhhh...', '...hhhhhh...', '...sffffs...', '...sfefes...', '....ffff....',
      '..rrrrrrrr..', '.hrrrggrrrh.', '.hrrrggrrrh.', '..rrrrrrrr..', '..ss....ss..', '..ee....ee..',
    ],
    up: [
      '....hhhh....', '...hhhhhh...', '...hhhhhh...', '...shhhhs...', '...shhhhs...', '....ssss....',
      '..rrrrrrrr..', '.hrrrrrrrrh.', '.hrrrrrrrrh.', '..rrrrrrrr..', '..ss....ss..', '..ee....ee..',
    ],
    right: [
      '....hhhh....', '...hhhhhh...', '...hhhhhh...', '...shhfffs..', '...shhfeff..', '....ssffff..',
      '..rrrrrrrr..', '.hrrrrrggrh.', '.hrrrrrggrh.', '..rrrrrrrr..', '..ss....ss..', '..ee....ee..',
    ],
  };
  const GEM = [
    '............', '............', '............', '...cccccc...', '..cwwcccdc..', '.cwcccccddc.',
    '.ccccccdddc.', '..cccccddd..', '...ccdddd...', '....cddd....', '.....cd.....', '............',
  ];
  const render = (rows, flip) => {
    const c = document.createElement('canvas');
    c.width = CELL;
    c.height = CELL;
    const g = c.getContext('2d');
    if (flip) {
      g.translate(CELL, 0);
      g.scale(-1, 1);
    }
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (!PAL[ch]) return;
      g.fillStyle = PAL[ch];
      g.fillRect(x * 2, y * 2, 2, 2);
    }));
    return c;
  };
  const sprites = (body) => ({
    down: render(body.down), up: render(body.up), right: render(body.right), left: render(body.right, true),
  });
  const THIEF_SPRITES = sprites(THIEF);
  const GUARD_SPRITES = sprites(GUARD);
  const GEM_SPRITE = render(GEM);

  /* ---------- State ---------- */

  let mode = 'normal';
  let cfg = MODES[mode];
  let state = 'idle'; // idle | playing | caught | cleared | paused | over
  let before = 'playing'; // what the pause interrupted
  let levelNo = 0;
  let level = null; // the parsed level: grid, start, exit, gems left, guards
  let thief = { x: 0, y: 0, dir: 'down' };
  let gems = []; // [x, y] still to be taken
  let guards = []; // live guards: { x, y, dir, from: [x, y], at: 0..1 progress of the step, ... }
  let elapsed = 0; // ms of play this run
  let caughtCount = 0;
  let caughtBy = null; // the guard whose light found the thief
  let eventAt = 0; // when the catch or the clear happened
  let best = loadBest(mode);
  let raf = 0;
  let lastTime = 0;
  let scale = 1;
  const held = []; // directions held, most recent last
  let moveAcc = 0; // ms until the next held step
  let pointerDir = null; // the direction a finger on the board is pushing

  const parse = (def) => {
    const grid = def.map.map((row) => [...row]);
    const found = { gems: [], start: null, exit: null };
    grid.forEach((row, y) => row.forEach((ch, x) => {
      if (ch === '*') found.gems.push([x, y]);
      else if (ch === 'S') found.start = [x, y];
      else if (ch === 'E') found.exit = [x, y];
      if (ch === '*' || ch === 'S' || ch === 'E') grid[y][x] = '.';
    }));
    return { ...found, grid, guards: def.guards, name: def.name };
  };
  const solid = (x, y) => {
    const ch = level.grid[y]?.[x];
    return ch === undefined || ch === '#' || ch === 'c';
  };
  const shadowAt = (x, y) => level.grid[y]?.[x] === '~';

  // Each guard keeps its place along its path and the direction it faces; the
  // drawn position slides from `from` to (x, y) over one step.
  const makeGuards = () => guards = level.guards.map((g) => {
    const [x, y] = g.path[0];
    const next = g.path[1];
    const dir = g.face || (next ? (next[0] > x ? 'right' : next[0] < x ? 'left' : next[1] > y ? 'down' : 'up') : 'down');
    return { x, y, dir, from: [x, y], at: 1, path: g.path, leg: 0, fwd: 1, sentry: g.path.length === 1, turn: TURNS.indexOf(dir), wait: 0 };
  });

  // One step along the path, turning round at either end.
  const stepGuard = (g) => {
    let target = g.path[g.leg + g.fwd];
    if (!target) {
      g.fwd = -g.fwd;
      target = g.path[g.leg + g.fwd];
    }
    const dx = Math.sign(target[0] - g.x);
    const dy = Math.sign(target[1] - g.y);
    g.dir = dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'down' : 'up';
    g.from = [g.x, g.y];
    g.x += dx;
    g.y += dy;
    g.at = 0;
    if (g.x === target[0] && g.y === target[1]) g.leg += g.fwd;
  };

  // The cells a lantern lights: a cone that widens with distance, cut off by
  // walls and crates. Each cell is seen along the straight line from the guard.
  const seen = (g) => {
    const [dx, dy] = DIRS[g.dir];
    const lit = [];
    for (let d = 1; d <= cfg.range; d++) {
      const half = Math.floor(d / 2);
      for (let o = -half; o <= half; o++) {
        const x = g.x + dx * d + dy * o;
        const y = g.y + dy * d + dx * o;
        if (solid(x, y)) continue;
        if (clear(g.x, g.y, x, y)) lit.push([x, y, d]);
      }
    }
    return lit;
  };
  const clear = (x0, y0, x1, y1) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 4;
    for (let i = 1; i < steps; i++) {
      const x = Math.floor(x0 + 0.5 + ((x1 - x0) * i) / steps);
      const y = Math.floor(y0 + 0.5 + ((y1 - y0) * i) / steps);
      if (solid(x, y)) return false;
    }
    return true;
  };

  /* ---------- Drawing ---------- */

  const drawFloor = () => {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const px = x * CELL;
        const py = y * CELL;
        const ch = level.grid[y][x];
        if (ch === '#') {
          ctx.fillStyle = '#2a2e3d';
          ctx.fillRect(px, py, CELL, CELL);
          ctx.fillStyle = '#5a6278';
          const shift = y % 2 ? 6 : 0;
          [[1, 1, 10], [13, 1, 10], [1, 13, 10], [13, 13, 10]].forEach(([bx, by, bw], i) => {
            const sx = (bx + (i >= 2 ? shift : 0)) % CELL;
            ctx.fillRect(px + sx, py + by, Math.min(bw, CELL - sx - 1), 10);
          });
          ctx.fillStyle = '#6b7589';
          ctx.fillRect(px + 1, py + 1, 10, 1);
          ctx.fillRect(px + 13, py + 1, 10, 1);
          continue;
        }
        ctx.fillStyle = (x + y) % 2 ? '#3b3f52' : '#373b4d';
        ctx.fillRect(px, py, CELL, CELL);
        ctx.fillStyle = 'rgba(0, 0, 0, .15)';
        ctx.fillRect(px, py + CELL - 1, CELL, 1);
        ctx.fillRect(px + CELL - 1, py, 1, CELL);
        if (ch === '~') {
          ctx.fillStyle = '#20233a';
          ctx.fillRect(px, py, CELL, CELL);
          ctx.fillStyle = '#2a2d48';
          ctx.fillRect(px + 4, py + 6, 2, 2);
          ctx.fillRect(px + 15, py + 14, 2, 2);
          ctx.fillRect(px + 9, py + 18, 2, 2);
        } else if (ch === 'c') {
          ctx.fillStyle = 'rgba(0, 0, 0, .25)';
          ctx.fillRect(px + 2, py + 20, 20, 3);
          ctx.fillStyle = '#6b4420';
          ctx.fillRect(px + 2, py + 3, 20, 18);
          ctx.fillStyle = '#8b5a2b';
          ctx.fillRect(px + 4, py + 5, 16, 14);
          ctx.fillStyle = '#6b4420';
          ctx.fillRect(px + 4, py + 11, 16, 2);
          ctx.fillRect(px + 11, py + 5, 2, 14);
          ctx.fillStyle = '#a06a35';
          ctx.fillRect(px + 4, py + 5, 16, 1);
        }
      }
    }
    // The door out: an arch, dark until every gem is taken, then lit from within.
    const [ex, ey] = level.exit;
    const px = ex * CELL;
    const py = ey * CELL;
    const open = gems.length === 0;
    ctx.fillStyle = INK;
    ctx.fillRect(px + 3, py + 4, 18, 20);
    ctx.fillRect(px + 5, py + 2, 14, 2);
    ctx.fillStyle = open ? '#f4c15d' : '#4b2e0f';
    ctx.fillRect(px + 5, py + 4, 14, 20);
    if (open) {
      ctx.fillStyle = '#fff2e1';
      ctx.fillRect(px + 9, py + 6, 6, 18);
    } else {
      ctx.fillStyle = '#6b4420';
      ctx.fillRect(px + 8, py + 4, 1, 20);
      ctx.fillRect(px + 15, py + 4, 1, 20);
      ctx.fillStyle = '#f4c15d';
      ctx.fillRect(px + 13, py + 13, 2, 2); // the handle
    }
  };

  const drawLight = (t) => {
    guards.forEach((g) => {
      seen(g).forEach(([x, y, d]) => {
        const flicker = 0.04 * Math.sin(t / 90 + x * 3 + y);
        ctx.fillStyle = `rgba(244, 193, 93, ${Math.max(0.1, 0.42 - d * 0.07 + flicker)})`;
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      });
    });
  };

  const drawGuard = (g, t) => {
    const k = g.at;
    const px = (g.from[0] + (g.x - g.from[0]) * k) * CELL;
    const py = (g.from[1] + (g.y - g.from[1]) * k) * CELL;
    const bob = g.sentry ? 0 : Math.round(Math.sin(k * Math.PI * 2) * 1);
    ctx.fillStyle = 'rgba(0, 0, 0, .3)';
    ctx.beginPath();
    ctx.ellipse(px + CELL / 2, py + CELL - 1, 8, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.drawImage(GUARD_SPRITES[g.dir], px, py - bob);
    // The lantern, held out on the side the guard faces.
    const [dx, dy] = DIRS[g.dir];
    const lx = px + CELL / 2 - 3 + dx * 9;
    const ly = py + 11 - bob + dy * 8;
    ctx.fillStyle = INK;
    ctx.fillRect(lx, ly, 6, 7);
    ctx.fillStyle = Math.floor(t / 120) % 3 ? '#f4c15d' : '#fff2e1';
    ctx.fillRect(lx + 1, ly + 1, 4, 5);
    if (state === 'caught' && caughtBy === g) {
      // "!" over the guard who saw the thief.
      ctx.fillStyle = INK;
      ctx.fillRect(px + 7, py - 14, 10, 12);
      ctx.fillStyle = '#d9745a';
      ctx.fillRect(px + 8, py - 13, 8, 10);
      ctx.fillStyle = '#fff2e1';
      ctx.fillRect(px + 11, py - 11, 2, 4);
      ctx.fillRect(px + 11, py - 6, 2, 2);
    }
  };

  const drawThief = (t) => {
    const px = thief.x * CELL;
    const py = thief.y * CELL;
    ctx.fillStyle = 'rgba(0, 0, 0, .3)';
    ctx.beginPath();
    ctx.ellipse(px + CELL / 2, py + CELL - 1, 8, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    const hidden = shadowAt(thief.x, thief.y) && state === 'playing';
    ctx.globalAlpha = hidden ? 0.55 : 1;
    ctx.drawImage(THIEF_SPRITES[thief.dir], px, py);
    ctx.globalAlpha = 1;
    if (state === 'cleared') {
      // Sparkles as the thief slips out of the door.
      ctx.fillStyle = `rgba(255, 242, 225, ${0.5 + 0.5 * Math.sin(t / 80)})`;
      [[2, 4], [19, 7], [5, 18], [17, 20], [10, 1]].forEach(([sx, sy]) => ctx.fillRect(px + sx, py + sy, 2, 2));
    }
  };

  const draw = (t = performance.now()) => {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.imageSmoothingEnabled = false;
    if (!level) return;
    drawFloor();
    drawLight(t);
    gems.forEach(([x, y]) => {
      const bob = Math.round(Math.sin(t / 300 + x) * 1);
      ctx.fillStyle = 'rgba(0, 0, 0, .25)';
      ctx.fillRect(x * CELL + 7, y * CELL + 21, 10, 2);
      ctx.drawImage(GEM_SPRITE, x * CELL, y * CELL + bob);
    });
    // The guards and the thief, those lower down drawn last so they overlap the others.
    const actors = [...guards.map((g) => ({ y: g.from[1] + (g.y - g.from[1]) * g.at, draw: () => drawGuard(g, t) })), { y: thief.y, draw: () => drawThief(t) }];
    actors.sort((a, b) => a.y - b.y).forEach((a) => a.draw());
    if (state === 'caught') {
      const k = Math.min(1, (t - eventAt) / 200);
      ctx.fillStyle = `rgba(217, 116, 90, ${0.35 * (1 - k)})`;
      ctx.fillRect(0, 0, W, H);
    }
    // The level's name, in the corner.
    ctx.font = '500 11px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255, 242, 225, .55)';
    ctx.fillText(`${levelNo + 1}. ${level.name}`, 6, 5);
    if (state === 'playing' && elapsed < 3000 && levelNo === 0) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255, 242, 225, .85)';
      ctx.fillText(touch?.matches ? 'hold an arrow, or a finger on the room' : 'hold an arrow to creep', W / 2, H - 14);
    }
  };

  const updateStats = () => {
    out('level').textContent = `${levelNo + 1} / ${LEVELS.length}`;
    out('loot').textContent = `${level ? level.gems.length - gems.length : 0} / ${level ? level.gems.length : 0}`;
    out('time').textContent = clock(elapsed);
    out('caught').textContent = caughtCount;
    out('best').textContent = best ? clock(best) : '-';
  };

  /* ---------- Play ---------- */

  const showOverlay = (text, label) => {
    msg.textContent = text;
    startBtn.textContent = label;
    overlay.hidden = false;
  };

  const loadLevel = (n) => {
    levelNo = n;
    level = parse(LEVELS[n]);
    gems = level.gems.map((g) => [...g]);
    [thief.x, thief.y] = level.start;
    thief.dir = 'down';
    makeGuards();
    held.length = 0;
    pointerDir = null;
    moveAcc = 0;
    caughtBy = null;
  };

  const caught = (g) => {
    state = 'caught';
    caughtBy = g;
    caughtCount++;
    eventAt = performance.now();
    updateStats();
  };

  const award = (key) => window.arcadeMons?.award(key); // a monster for a first-time achievement, see rewards.csv

  const cleared = () => {
    state = 'cleared';
    award(`sneak.${mode}.${levelNo + 1}`);
    eventAt = performance.now();
  };

  const finish = () => {
    state = 'over';
    cancelAnimationFrame(raf);
    const record = !best || elapsed < best;
    if (record) {
      best = elapsed;
      saveBest(mode, best);
    }
    updateStats();
    draw();
    const caughtNote = caughtCount ? `, caught ${caughtCount} time${caughtCount === 1 ? '' : 's'}` : ', never seen';
    showOverlay(`${record ? 'New best! ' : ''}Out with all the loot in ${clock(elapsed)}${caughtNote}.`, 'Play again');
  };

  // A guard walking into the thief, or the thief standing in a lantern's light, is a catch.
  const check = () => {
    for (const g of guards) {
      if (g.x === thief.x && g.y === thief.y) return caught(g);
      if (shadowAt(thief.x, thief.y)) continue;
      if (seen(g).some(([x, y]) => x === thief.x && y === thief.y)) return caught(g);
    }
    return null;
  };

  const step = (dir) => {
    if (state !== 'playing') return;
    thief.dir = dir;
    const [dx, dy] = DIRS[dir];
    const nx = thief.x + dx;
    const ny = thief.y + dy;
    if (solid(nx, ny)) return;
    thief.x = nx;
    thief.y = ny;
    const i = gems.findIndex(([x, y]) => x === nx && y === ny);
    if (i >= 0) {
      gems.splice(i, 1);
      updateStats();
    }
    if (check()) return;
    if (!gems.length && nx === level.exit[0] && ny === level.exit[1]) cleared();
  };

  const update = (dt, t) => {
    if (state === 'caught') {
      if (t - eventAt >= CAUGHT_MS) {
        loadLevel(levelNo);
        state = 'playing';
        updateStats();
      }
      return;
    }
    if (state === 'cleared') {
      if (t - eventAt < CLEAR_MS) return;
      if (levelNo + 1 < LEVELS.length) {
        loadLevel(levelNo + 1);
        state = 'playing';
        updateStats();
      } else finish();
      return;
    }
    if (state !== 'playing') return;
    elapsed += dt;
    // The guards: patrols step on a beat, sentries turn on a slower one.
    guards.forEach((g) => {
      if (g.sentry) {
        g.wait += dt;
        while (g.wait >= cfg.turn) {
          g.wait -= cfg.turn;
          g.turn = (g.turn + 1) % 4;
          g.dir = TURNS[g.turn];
        }
        return;
      }
      g.at = Math.min(1, g.at + dt / cfg.walk);
      g.wait += dt;
      while (g.wait >= cfg.walk) {
        g.wait -= cfg.walk;
        stepGuard(g);
        g.at = Math.min(1, g.wait / cfg.walk);
      }
    });
    if (check()) return;
    // The thief creeps one cell per beat while a direction is held.
    const dir = pointerDir || held[held.length - 1];
    if (dir) {
      moveAcc -= dt;
      if (moveAcc <= 0) {
        moveAcc = MOVE_MS;
        step(dir);
      }
    } else moveAcc = 0;
    if (Math.floor(elapsed / 1000) !== Math.floor((elapsed - dt) / 1000)) out('time').textContent = clock(elapsed);
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
    elapsed = 0;
    caughtCount = 0;
    loadLevel(0);
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
    pointerDir = null;
    draw();
    showOverlay('Paused', 'Resume');
  };

  const resume = () => {
    state = before;
    eventAt = performance.now(); // a catch or a clear that was paused shows again in full
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
    elapsed = 0;
    caughtCount = 0;
    loadLevel(0);
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
    moveAcc = MOVE_MS;
    step(dir); // the first step is at once; the rest follow on the beat
  };

  // Keys only reach the game while it has focus, so the page scrolls normally otherwise.
  root.addEventListener('keydown', (e) => {
    if (e.target.closest('button') && (e.code === 'Enter' || e.code === 'Space')) return;
    if (state === 'playing') {
      if (KEYS[e.code]) {
        e.preventDefault();
        if (!e.repeat) hold(KEYS[e.code]);
      } else if (PAUSE_KEYS.has(e.code)) {
        e.preventDefault();
        if (!e.repeat) pause();
      }
      return;
    }
    if (state === 'caught' || state === 'cleared') {
      if (KEYS[e.code]) e.preventDefault();
      return;
    }
    // Idle, paused or over: Enter, Space or Z starts; while paused, the pause and arrow keys resume too.
    const go = START_KEYS.has(e.code) || (state === 'paused' && (PAUSE_KEYS.has(e.code) || KEYS[e.code]));
    if (!go) return;
    e.preventDefault();
    if (e.repeat || (state === 'over' && performance.now() - eventAt < RESTART_GRACE)) return;
    startOrResume();
  });
  root.addEventListener('keyup', (e) => {
    if (KEYS[e.code]) unhold(KEYS[e.code]);
  });
  window.addEventListener('blur', () => { held.length = 0; });

  // A finger or the mouse on the board pushes the thief away from where it was put down.
  const pointerDirFor = (e) => {
    const r = board.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W - (thief.x + 0.5) * CELL;
    const y = ((e.clientY - r.top) / r.height) * H - (thief.y + 0.5) * CELL;
    if (Math.hypot(x, y) < CELL / 2) return null;
    return Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up');
  };
  board.addEventListener('pointerdown', (e) => {
    if (state !== 'playing') return;
    e.preventDefault();
    stage.focus({ preventScroll: true });
    const dir = pointerDirFor(e);
    if (!dir) return;
    pointerDir = dir;
    moveAcc = MOVE_MS;
    step(dir);
  });
  board.addEventListener('pointermove', (e) => {
    if (pointerDir) pointerDir = pointerDirFor(e) || pointerDir;
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((type) => board.addEventListener(type, () => { pointerDir = null; }));

  // Touch pad: hold a direction to keep creeping; the middle button pauses.
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

  setMode('normal');
  fit();
})();
