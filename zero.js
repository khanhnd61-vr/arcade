// Zero for the Play section: a short side-scrolling stage in the manner of
// Mega Man X, with Zero as the player. Run with the arrows, jump with X, dash
// with C and swing the Z-Saber with Z; slide down walls and kick off them to
// climb. Mettaurs, bats and turrets guard the way to a shuttered gate at the
// far end, behind which a guard mech waits. Zero has a life bar, three lives
// and a checkpoint or two; the best score is kept.
(() => {
  const root = document.querySelector('[data-zero]');
  if (!root) return;

  // The stage has its own units: one unit is one pixel of the 320 x 240 screen,
  // which is scaled to whatever size the canvas gets.
  const W = 320;
  const H = 240;
  const TILE = 16;
  const ROWS = 15;
  const GRAVITY = 900; // units per second squared
  const JUMP = -320; // upward speed given by a jump (about 57 units of height)
  const JUMP_CUT = -110; // the upward speed left when the jump key is let go early
  const MAX_FALL = 380;
  const RUN = 108;
  const DASH = 230;
  const DASH_MS = 420; // how long a dash carries on the ground
  const WALL_SLIDE = 72; // top speed sliding down a wall
  const WALL_GRACE = 90; // ms after leaving a wall during which a wall kick still counts
  const KICK_MS = 160; // ms a wall kick holds its direction
  const COYOTE = 80; // ms after stepping off a ledge during which a jump still counts
  const BUFFER = 110; // ms a jump pressed just before landing is kept
  const SLASH_MS = 210;
  const SLASH_GAP = 60; // ms between slashes
  const SLASH_DMG = 3;
  const BODY_W = 12; // Zero's hit box, in units
  const BODY_H = 24;
  const MAX_HP = 16;
  const INV_MS = 1100; // invincible after a hit
  const KNOCK_MS = 240;
  const DIE_MS = 1300;
  const LIVES = 3;
  const HEAL = 8; // what a small energy capsule gives back
  const WARN_MS = 1600; // the boss alarm
  const BOSS_HP = 36;
  const BOSS_INV = 320; // ms the mech shrugs off further hits after one
  const BOSS_DIE_MS = 1700;
  const CAM_EASE = 80;
  const RESTART_GRACE = 800; // ms after the end before a held key can restart
  const BEST_KEY = 'zero-best';
  const KEYS = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
  const JUMP_KEYS = new Set(['KeyX', 'Space', 'ArrowUp', 'KeyW']);
  const SLASH_KEYS = new Set(['KeyZ', 'KeyJ']);
  const DASH_KEYS = new Set(['KeyC', 'ShiftLeft', 'ShiftRight', 'KeyK']);
  const PAUSE_KEYS = new Set(['KeyP', 'Escape']);
  const START_KEYS = new Set(['Enter', 'NumpadEnter', 'Space', 'KeyZ', 'KeyX']);
  const RUNNING = new Set(['playing', 'dying']);
  const SCORES = { met: 100, bat: 150, turret: 200, boss: 2000, capsule: 50 };

  // The stage, a screen (20 x 15 tiles) at a time, left to right. # is a solid
  // block, = a thin platform that can be jumped through, ^ spikes, S where Zero
  // starts, c a checkpoint, h a small energy capsule, M a Mettaur, B a bat that
  // hangs from the ceiling, T a turret, G the boss gate and X where the mech lands.
  const STAGE = [
    ['#...................', '#...................', '#...................', '#...................', '#...................',
      '#...................', '#...................', '#...................', '#...................', '#...................',
      '#...................', '#...................', '#.S...........M.....', '####################', '####################'],
    ['....................', '....................', '....................', '....................', '....................',
      '....................', '................B...', '....................', '....................', '....................',
      '....................', '............####....', '...........M####....', '######...###########', '######...###########'],
    ['....................', '....................', '....................', '....................', '....................',
      '....................', '....................', '....................', '....................', '....................',
      '....................', '....==..............', '..........M.....h.c.', '##.......###########', '##.......###########'],
    ['....................', '....................', '....................', '....................', '....................',
      '................B...', '....................', '....................', '....................', '......##............',
      '......##............', '......##............', '......##......T.....', '####################', '####################'],
    ['....................', '....................', '....................', '....................', '....................',
      '....................', '....................', '...........B........', '....................', '....................',
      '....................', '...==...==...==.....', '....................', '##^^^^^^^^^^^^^^^###', '####################'],
    ['....................', '....................', '....................', '....................', '....................',
      '....................', '....................', '..........B.........', '........#####.......', '......M.#####..h....',
      '......###########...', '....#############...', '..M.#############.c.', '####################', '####################'],
    ['....................', '....................', '....................', '....................', '....................',
      '....................', '....................', '.............B......', '....................', '................##..',
      '................##..', '.......###......##..', '..T....###......##..', '####...###...#######', '####...###...#######'],
    ['...................#', '...................#', '...................#', '...................#', '...................#',
      '...................#', '...................#', '...................#', '...................#', '...................#',
      '...................G', '........=====......G', '..c.h.....M....M.h.G', '###################G', '####################'],
    ['...................#', '...................#', '...................#', '...................#', '...................#',
      '...................#', '...................#', '...................#', '...................#', '...................#',
      '...................#', '...................#', '............X......#', '####################', '####################'],
  ];

  const stage = root.querySelector('[data-stage]');
  const screen = root.querySelector('[data-screen]');
  const overlay = root.querySelector('[data-overlay]');
  const msg = root.querySelector('[data-msg]');
  const startBtn = root.querySelector('[data-start]');
  const out = (k) => root.querySelector(`[data-out="${k}"]`);
  const ctx = screen.getContext('2d');
  const touch = window.matchMedia?.('(pointer: coarse)');

  const loadBest = () => {
    try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; }
  };
  const saveBest = (n) => {
    try { localStorage.setItem(BEST_KEY, String(n)); } catch { /* storage unavailable */ }
  };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);
  const overlap = (a, b) => a.x - a.w / 2 < b.x + b.w / 2 && a.x + a.w / 2 > b.x - b.w / 2 && a.y - a.h < b.y && a.y > b.y - b.h;

  /* ---------- The stage ---------- */

  const rows = Array.from({ length: ROWS }, (_, r) => STAGE.map((s) => s[r]).join(''));
  const COLS = rows[0].length;
  const LEVEL_W = COLS * TILE;
  const grid = rows.map((r) => [...r]);
  const spawns = []; // where the enemies stand at the start, rebuilt on every life
  const capsules = [];
  const checkpoints = [];
  let start = { x: 24, y: 208 };
  let gateX = 0; // the gate's column, in tiles
  let arenaX = 0; // where the view locks for the boss, in units
  let bossAt = { x: 0, y: 0 };
  grid.forEach((row, ty) => row.forEach((ch, tx) => {
    const cx = tx * TILE + TILE / 2;
    const feet = (ty + 1) * TILE;
    if (ch === 'S') start = { x: cx, y: feet };
    else if (ch === 'M') spawns.push({ type: 'met', x: cx, y: feet });
    else if (ch === 'B') spawns.push({ type: 'bat', x: cx, y: ty * TILE + 8 });
    else if (ch === 'T') spawns.push({ type: 'turret', x: cx, y: feet });
    else if (ch === 'h') capsules.push({ x: cx, y: feet, tx, ty });
    else if (ch === 'c') checkpoints.push({ x: cx, y: feet });
    else if (ch === 'G') { gateX = tx; arenaX = (tx + 1) * TILE; }
    else if (ch === 'X') bossAt = { x: cx, y: feet };
    if ('SMBThcX'.includes(ch)) row[tx] = '.';
  }));

  const tileAt = (tx, ty) => (ty < 0 || ty >= ROWS ? '.' : tx < 0 || tx >= COLS ? '#' : grid[ty][tx]);
  const gate = { shut: false, open: 1 }; // open runs from 0 (closed) to 1
  const solid = (ch) => ch === '#' || (ch === 'G' && gate.shut);

  // Move a box (centre x, feet y) sideways, stopping at solid tiles. Returns the side of the wall hit.
  const moveX = (b, dx) => {
    if (!dx) return 0;
    const edge = dx > 0 ? b.x + b.w / 2 + dx : b.x - b.w / 2 + dx;
    const tx = Math.floor(edge / TILE);
    const top = Math.floor((b.y - b.h + 1) / TILE);
    const bottom = Math.floor((b.y - 1) / TILE);
    for (let ty = top; ty <= bottom; ty++) {
      if (solid(tileAt(tx, ty))) {
        b.x = dx > 0 ? tx * TILE - b.w / 2 : (tx + 1) * TILE + b.w / 2;
        return dx > 0 ? 1 : -1;
      }
    }
    b.x += dx;
    return 0;
  };
  // Move a box up or down. Returns 1 on landing, -1 on hitting a ceiling.
  const moveY = (b, dy) => {
    const left = Math.floor((b.x - b.w / 2 + 0.5) / TILE);
    const right = Math.floor((b.x + b.w / 2 - 0.5) / TILE);
    if (dy > 0) {
      const nb = b.y + dy;
      const ty = Math.floor(nb / TILE);
      for (let tx = left; tx <= right; tx++) {
        const ch = tileAt(tx, ty);
        if (solid(ch) || (ch === '=' && b.y <= ty * TILE)) {
          b.y = ty * TILE;
          return 1;
        }
      }
      b.y = nb;
    } else if (dy < 0) {
      const nt = b.y - b.h + dy;
      const ty = Math.floor(nt / TILE);
      for (let tx = left; tx <= right; tx++) {
        if (solid(tileAt(tx, ty))) {
          b.y = (ty + 1) * TILE + b.h;
          return -1;
        }
      }
      b.y = nt + b.h;
    }
    return 0;
  };
  // Is there floor (or a thin platform) right under this point?
  const floorAt = (x, y) => {
    const ch = tileAt(Math.floor(x / TILE), Math.floor(y / TILE));
    return solid(ch) || ch === '=';
  };
  const onSpikes = (b) => {
    const left = Math.floor((b.x - b.w / 2 + 2) / TILE);
    const right = Math.floor((b.x + b.w / 2 - 2) / TILE);
    const top = Math.floor((b.y - b.h + 4) / TILE);
    const bottom = Math.floor((b.y - 1) / TILE);
    for (let ty = top; ty <= bottom; ty++) for (let tx = left; tx <= right; tx++) {
      if (tileAt(tx, ty) === '^' && b.y > ty * TILE + 6) return true;
    }
    return false;
  };

  /* ---------- Pixel art ---------- */

  const PAL = {
    r: '#d8343f', R: '#8a1f2b', y: '#e0a83a', h: '#f7dd7f', f: '#f1c9a3', k: '#1b1626', w: '#f4f4f8', b: '#4ab3f0',
    Y: '#f2c14e', D: '#c48f1e', p: '#8c5bd6', P: '#5a3a94',
  };
  // Zero, 16 x 24 facing right, his hair trailing behind: r red armour, y the gold crest, b the gem,
  // h hair, f face, k the black undersuit, w the white chest plates.
  const HEAD = [
    '......rrrrr.....', '.....rrrrrrr....', '....rrryyyrrr...', '...hrryybyyrr...', '..hhrrrrrrrrr...',
    '.hhhrr.ffff.r...', '.hhhhr.fkfk.r...', '.hhhh..ffff.....', '.hhhh..fff......', '..hhh..rr.......',
  ];
  const TORSO = ['..hhh.rrrrrr....', '..hhhrrwwrrr....', '..hhhrrwwrrk....', '...hh.rrrr.k....', '...hhkkkkkkr....'];
  const LEGS_STAND = ['....hkk.kk......', '....hkk.kk......', '.....kk.kk......', '.....kk.kk......', '.....rr.rr......', '.....rr.rr......', '.....rr.rr......', '....rrr.rrr.....', '....rrr.rrr.....'];
  const LEGS_RUN1 = ['....hkk.kk......', '....hkk.kk......', '....kk...kk.....', '...kk.....kk....', '...kk.....kk....', '..rr.......rr...', '..rr.......rr...', '.rrr.......rrr..', '.rrr.......rrr..'];
  const LEGS_RUN2 = ['....hkk.kk......', '....hkkkkk......', '.....kkkk.......', '.....kk.kk......', '.....kk.kk......', '.....rr.rr......', '.....rr.rr......', '....rrr.rrr.....', '....rrr.rrr.....'];
  const LEGS_RUN3 = ['....hkk.kk......', '....hkk.kk......', '.....kk..kk.....', '....kk....kk....', '....kk....kk....', '...rr......rr...', '...rr......rr...', '..rrr......rrr..', '..rrr......rrr..'];
  const POSES = {
    stand: [...HEAD, ...TORSO, ...LEGS_STAND],
    run1: [...HEAD, ...TORSO, ...LEGS_RUN1],
    run2: [...HEAD, ...TORSO, ...LEGS_RUN2],
    run3: [...HEAD, ...TORSO, ...LEGS_RUN3],
    jump: [...HEAD, '..hhh.rrrrrr.k..', '..hhhrrwwrrrk...', '..hhhrrwwrrr....', '...hh.rrrr......', '...hhkkkkkk.....',
      '....hkk.kkk.....', '....hkk..kk.....', '....kk....kk....', '...kk......rr...', '...rr......rr...', '..rrr......rrr..', '..rrr...........', '................', '................'],
    slash: [...HEAD, '..hhh.rrrrrr....', '..hhhrrwwrrrkkrr', '..hhhrrwwrrr....', '...hh.rrrr......', '...hhkkkkkk.....', ...LEGS_RUN3],
    dash: ['................', '................', '................', '................', '.......rrrrr....', '......rrrrrrr...', '.....rrryyyrrr..',
      '.hh.hrryybyyrr..', 'hhhhhrrrrrrrrr..', 'hhhhhhr.ffff.r..', '.hhhhhr.fkfk.r..', '..hhhhh.ffff....', '...hhhh.fff.....', '....hh.rrrrrr...',
      '.....hrrwwrrrrk.', '.....hrrwwrrr.k.', '.....kkkkkkk.rr.', '....kkk.kkkk....', '...kk.....kkk...', '...kk......kkk..', '..kk........kk..',
      '.rr..........rr.', '.rr..........rr.', 'rrr..........rrr'],
  };
  // The enemies: a Mettaur under its hard hat, and a bat with its wings up and down.
  const MET = ['.....YYYYYY.....', '...YYYYYYYYYY...', '..YYYYYYYYYYYY..', '..YYYYYYYYYYYY..', '.YYYYYYYYYYYYYY.', '.YYYYYYYYYYYYYY.', 'YDDDDDDDDDDDDDDY',
    '..kkkkkkkkkkkk..', '..kkwwkkkkwwkk..', '..kkkkkkkkkkkk..', '...kkkkkkkkkk...', '....DD....DD....', '...DDD....DDD...'];
  const BAT = [
    ['pp............pp', 'ppp..........ppp', 'pppp..pppp..pppp', '.pppppppppppppp.', '..pppprpprpppp..', '...pppppppppp...', '....PP....PP....'],
    ['................', '......pppp......', '....pppppppp....', '..pppprpprpppp..', 'pppppppppppppppp', 'pp..pppppppp..pp', '.....PP..PP.....'],
  ];
  const render = (art, flip) => {
    const c = document.createElement('canvas');
    c.width = art[0].length;
    c.height = art.length;
    const g = c.getContext('2d');
    if (flip) {
      g.translate(c.width, 0);
      g.scale(-1, 1);
    }
    art.forEach((row, y) => [...row].forEach((ch, x) => {
      if (!PAL[ch]) return;
      g.fillStyle = PAL[ch];
      g.fillRect(x, y, 1, 1);
    }));
    return c;
  };
  const SPRITES = Object.fromEntries(Object.entries(POSES).map(([k, art]) => [k, [render(art, true), render(art)]]));
  const MET_SPRITE = [render(MET, true), render(MET)];
  const BAT_SPRITES = BAT.map((f) => render(f));

  /* ---------- State ---------- */

  let state = 'idle'; // idle | playing | dying | paused | over | won
  let before = 'playing'; // what the pause interrupted
  let best = loadBest();
  let score = 0;
  let lives = LIVES;
  let raf = 0;
  let lastTime = 0;
  let scale = 1;
  let camX = 0;
  let played = 0; // ms of play, for the hint and the time bonus
  let diedAt = 0;
  let endedAt = 0;
  let checkpoint = start;
  let enemies = [];
  let bullets = [];
  let particles = [];
  let orbs = []; // the rings of light Zero bursts into
  let taken = new Set(); // capsules used up (by index)
  let passed = new Set(); // checkpoints lit
  const zero = {
    x: 0, y: 0, w: BODY_W, h: BODY_H, vx: 0, vy: 0, dir: 1, ground: false, sinceGround: 0, buffer: 0, jumping: false,
    wall: 0, sinceWall: 0, kick: 0, kickDir: 0, dash: 0, dashing: false, dashJump: false, slash: 0, slashGap: 0, slashHits: null,
    inv: 0, knock: 0, hurt: 0, run: 0, hp: MAX_HP,
  };
  const boss = { active: false, phase: '', x: 0, y: 0, w: 34, h: 40, vx: 0, vy: 0, hp: BOSS_HP, dir: -1, t: 0, inv: 0, flash: 0, shots: 0, diedAt: 0 };
  const held = []; // directions held, most recent last
  let jumpHeld = false;
  let dashHeld = false;

  const makeEnemy = (s) => {
    const e = { ...s, alive: true, t: rand(0, 1000), flash: 0 };
    if (s.type === 'met') Object.assign(e, { w: 14, h: 13, hp: 3, dir: -1, vy: 0, wait: 0, dmg: 3 });
    else if (s.type === 'bat') Object.assign(e, { w: 14, h: 7, hp: 2, awake: false, vx: 0, vy: 0, dmg: 2 });
    else Object.assign(e, { w: 16, h: 16, hp: 4, dir: -1, cool: 900, dmg: 3 });
    return e;
  };

  const placeZero = (at) => {
    Object.assign(zero, {
      x: at.x, y: at.y, vx: 0, vy: 0, dir: 1, ground: false, sinceGround: 0, buffer: 0, jumping: false, wall: 0, sinceWall: 999,
      kick: 0, kickDir: 0, dash: 0, dashing: false, dashJump: false, slash: 0, slashGap: 0, slashHits: null, inv: 0, knock: 0, hurt: 0, run: 0, hp: MAX_HP,
    });
    held.length = 0;
    jumpHeld = false;
    dashHeld = false;
  };

  // A fresh life: back to the checkpoint, every enemy back in place, the gate open again.
  const respawn = () => {
    placeZero(checkpoint);
    enemies = spawns.map(makeEnemy);
    bullets = [];
    particles = [];
    orbs = [];
    Object.assign(boss, { active: false, phase: '', hp: BOSS_HP, inv: 0, flash: 0, t: 0, vx: 0, vy: 0 });
    gate.shut = false;
    gate.open = 1;
    camX = clamp(zero.x - W * 0.42, 0, LEVEL_W - W);
  };

  const reset = () => {
    score = 0;
    lives = LIVES;
    played = 0;
    checkpoint = start;
    taken = new Set();
    passed = new Set();
    respawn();
  };

  const puff = (x, y, n, col = 'rgba(255, 242, 225, .7)') => {
    for (let i = 0; i < n; i++) particles.push({ x: x + rand(-5, 5), y: y - rand(0, 3), vx: rand(-45, 45), vy: rand(-60, -10), life: rand(200, 360), col });
  };
  const sparks = (x, y, n, col = '#78f08a') => {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(60, 160);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(180, 320), col, g: 0 });
    }
  };
  const bang = (x, y) => {
    sparks(x, y, 10, '#f2c14e');
    sparks(x, y, 6, '#fffaf2');
  };

  /* ---------- Drawing ---------- */

  const drawBackdrop = (t) => {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#0f1020');
    grad.addColorStop(1, '#2a1a3e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    // A ruined skyline far off, then girders nearer by, each scrolling slower than the stage.
    const far = camX * 0.25;
    const first = Math.floor(far / 24);
    for (let i = first; i <= first + 14; i++) {
      const hgt = 36 + ((i * 37) % 70);
      const x = i * 24 - far;
      ctx.fillStyle = '#1a1830';
      ctx.fillRect(x, 208 - hgt, 20, hgt);
      ctx.fillStyle = '#242042';
      ctx.fillRect(x, 208 - hgt, 20, 2);
      for (let j = 0; j < hgt / 10; j++) for (let k = 0; k < 3; k++) {
        if ((i * 7 + j * 3 + k * 5) % 5 < 2) {
          ctx.fillStyle = ((i + j + k) % 7 === 0 && Math.floor(t / 600) % 2) ? '#1a1830' : '#4b4a7a';
          ctx.fillRect(x + 3 + k * 6, 212 - hgt + j * 10, 2, 3);
        }
      }
    }
    const mid = camX * 0.5;
    ctx.fillStyle = '#211c3a';
    ctx.fillRect(0, 150, W, 4);
    ctx.fillRect(0, 196, W, 3);
    const g0 = Math.floor(mid / 48);
    for (let i = g0; i <= g0 + 8; i++) {
      const x = i * 48 - mid;
      ctx.fillRect(x, 154, 3, 42);
      ctx.fillStyle = '#2a2448';
      ctx.fillRect(x + 8, 160, 1, 30);
      ctx.fillRect(x + 20, 160, 1, 30);
      ctx.fillStyle = '#211c3a';
    }
    ctx.fillStyle = 'rgba(217, 52, 63, .06)';
    ctx.fillRect(0, 200, W, 40);
  };

  const drawTiles = () => {
    const first = Math.floor(camX / TILE);
    for (let tx = first; tx <= first + W / TILE; tx++) for (let ty = 0; ty < ROWS; ty++) {
      const ch = tileAt(tx, ty);
      const px = tx * TILE;
      const py = ty * TILE;
      if (ch === '#') {
        const topOpen = !solid(tileAt(tx, ty - 1));
        ctx.fillStyle = '#3b3f52';
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = '#4b5066';
        ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
        ctx.fillStyle = '#2a2e3d';
        ctx.fillRect(px + 7, py + 1, 2, TILE - 2);
        ctx.fillRect(px + 1, py + 8, TILE - 2, 1);
        ctx.fillStyle = '#6b7585';
        ctx.fillRect(px + 2, py + 2, 1, 1);
        ctx.fillRect(px + 13, py + 2, 1, 1);
        ctx.fillRect(px + 2, py + 13, 1, 1);
        ctx.fillRect(px + 13, py + 13, 1, 1);
        if (topOpen) {
          ctx.fillStyle = '#9aa5b5';
          ctx.fillRect(px, py, TILE, 2);
        }
      } else if (ch === '=') {
        ctx.fillStyle = 'rgba(0, 0, 0, .25)';
        ctx.fillRect(px, py + 4, TILE, 2);
        ctx.fillStyle = '#5c7a8a';
        ctx.fillRect(px, py, TILE, 4);
        ctx.fillStyle = '#8fb8c4';
        ctx.fillRect(px, py, TILE, 2);
        ctx.fillStyle = '#b8d2dc';
        ctx.fillRect(px + 2, py, 4, 1);
      } else if (ch === '^') {
        ctx.fillStyle = '#9aa5b5';
        for (let i = 0; i < 3; i++) {
          const sx = px + i * 5 + 1;
          ctx.beginPath();
          ctx.moveTo(sx, py + TILE);
          ctx.lineTo(sx + 2.5, py + 2);
          ctx.lineTo(sx + 5, py + TILE);
          ctx.closePath();
          ctx.fill();
        }
        ctx.fillStyle = '#c3ccd8';
        for (let i = 0; i < 3; i++) ctx.fillRect(px + i * 5 + 3, py + 3, 1, 4);
      }
    }
  };

  const drawGate = (t) => {
    const px = gateX * TILE;
    const lift = gate.open * 44;
    ctx.fillStyle = '#2a2e3d';
    ctx.fillRect(px - 2, 160, 20, 48);
    ctx.fillStyle = '#5c7a8a';
    ctx.fillRect(px - 2, 158, 20, 3);
    ctx.save();
    ctx.beginPath();
    ctx.rect(px, 161, TILE, 47);
    ctx.clip();
    for (let i = 0; i < 6; i++) {
      const y = 161 + i * 8 - lift;
      ctx.fillStyle = '#8fb8c4';
      ctx.fillRect(px, y, TILE, 6);
      ctx.fillStyle = '#b8d2dc';
      ctx.fillRect(px, y, TILE, 1);
      ctx.fillStyle = '#5c7a8a';
      ctx.fillRect(px, y + 5, TILE, 1);
    }
    ctx.restore();
    const lamp = gate.shut ? '#d8343f' : (Math.floor(t / 400) % 2 ? '#78f08a' : '#4ca858');
    ctx.fillStyle = lamp;
    ctx.fillRect(px + 6, 155, 4, 2);
  };

  const drawCapsules = (t) => {
    capsules.forEach((c, i) => {
      if (taken.has(i)) return;
      const bob = Math.round(Math.sin(t / 300 + i) * 1.5);
      const x = c.x - 4;
      const y = c.y - 10 + bob;
      ctx.fillStyle = 'rgba(0, 0, 0, .3)';
      ctx.fillRect(x, c.y - 2, 8, 2);
      ctx.fillStyle = '#f2c14e';
      ctx.fillRect(x, y, 8, 8);
      ctx.fillStyle = '#fffaf2';
      ctx.fillRect(x + 1, y + 1, 6, 3);
      ctx.fillStyle = Math.floor(t / 250) % 2 ? '#78f08a' : '#4ca858';
      ctx.fillRect(x + 2, y + 5, 4, 2);
    });
  };

  const drawCheckpoints = (t) => {
    checkpoints.forEach((c, i) => {
      const lit = passed.has(i);
      ctx.fillStyle = '#3b3f52';
      ctx.fillRect(c.x - 3, c.y - 18, 6, 18);
      ctx.fillStyle = '#6b7585';
      ctx.fillRect(c.x - 5, c.y - 3, 10, 3);
      ctx.fillStyle = lit ? (Math.floor(t / 300) % 2 ? '#78f08a' : '#4ca858') : '#5c7a8a';
      ctx.fillRect(c.x - 2, c.y - 16, 4, 5);
    });
  };

  const drawEnemy = (e, t) => {
    if (!e.alive) return;
    const x = Math.round(e.x);
    const y = Math.round(e.y);
    if (e.flash > 0) {
      ctx.save();
      ctx.globalAlpha = 0.55;
    }
    if (e.type === 'met') {
      ctx.fillStyle = 'rgba(0, 0, 0, .3)';
      ctx.fillRect(x - 6, y - 1, 12, 2);
      ctx.drawImage(MET_SPRITE[e.dir > 0 ? 1 : 0], x - 8, y - 13);
      if (e.wait > 0) {
        ctx.fillStyle = '#d8343f';
        ctx.fillRect(x - 4, y - 5, 2, 1);
        ctx.fillRect(x + 2, y - 5, 2, 1);
      }
    } else if (e.type === 'bat') {
      const frame = e.awake ? Math.floor(t / 110) % 2 : 1;
      ctx.drawImage(BAT_SPRITES[frame], x - 8, y - 7);
    } else {
      ctx.fillStyle = 'rgba(0, 0, 0, .3)';
      ctx.fillRect(x - 7, y - 1, 14, 2);
      ctx.fillStyle = '#3b3f52';
      ctx.fillRect(x - 8, y - 6, 16, 6);
      ctx.fillStyle = '#6b7585';
      ctx.fillRect(x - 7, y - 16, 14, 10);
      ctx.fillStyle = '#9aa5b5';
      ctx.fillRect(x - 6, y - 15, 12, 3);
      ctx.fillStyle = '#2a2e3d';
      ctx.fillRect(x + (e.dir > 0 ? 3 : -11), y - 12, 8, 4); // the barrel
      ctx.fillStyle = e.cool < 300 ? '#fffaf2' : '#d8343f';
      ctx.fillRect(x - 2, y - 12, 4, 3); // the eye
    }
    if (e.flash > 0) ctx.restore();
  };

  const drawBoss = (t) => {
    if (!boss.active || boss.phase === 'warning' || boss.phase === 'gone') return;
    const x = Math.round(boss.x);
    const y = Math.round(boss.y);
    const white = boss.flash > 0;
    const body = white ? '#fffaf2' : '#5a3a94';
    const dark = white ? '#fffaf2' : '#3b2763';
    const steel = white ? '#fffaf2' : '#6b7585';
    const light = white ? '#fffaf2' : '#9aa5b5';
    const jumping = boss.phase === 'jump' || boss.phase === 'drop';
    if (boss.phase === 'dead') {
      ctx.globalAlpha = Math.max(0, 1 - (t - boss.diedAt) / BOSS_DIE_MS);
    }
    ctx.fillStyle = 'rgba(0, 0, 0, .3)';
    ctx.fillRect(x - 14, y - 2, 28, 3);
    // Legs, drawn tucked in the air.
    ctx.fillStyle = steel;
    const legH = jumping ? 7 : 12;
    ctx.fillRect(x - 13, y - legH, 9, legH);
    ctx.fillRect(x + 4, y - legH, 9, legH);
    ctx.fillStyle = dark;
    ctx.fillRect(x - 15, y - 3, 12, 3);
    ctx.fillRect(x + 3, y - 3, 12, 3);
    // Body.
    ctx.fillStyle = dark;
    ctx.fillRect(x - 17, y - legH - 22, 34, 22);
    ctx.fillStyle = body;
    ctx.fillRect(x - 15, y - legH - 21, 30, 19);
    ctx.fillStyle = light;
    ctx.fillRect(x - 12, y - legH - 18, 24, 2);
    // The arm cannon on the side facing Zero.
    ctx.fillStyle = steel;
    ctx.fillRect(x + (boss.dir > 0 ? 12 : -26), y - legH - 14, 14, 7);
    ctx.fillStyle = boss.phase === 'shoot' ? '#f2c14e' : dark;
    ctx.fillRect(x + (boss.dir > 0 ? 24 : -28), y - legH - 12, 4, 3);
    // Head and visor.
    ctx.fillStyle = dark;
    ctx.fillRect(x - 9, y - legH - 34, 18, 13);
    ctx.fillStyle = body;
    ctx.fillRect(x - 8, y - legH - 33, 16, 11);
    ctx.fillStyle = white ? '#fffaf2' : (Math.floor(t / 200) % 2 ? '#78f08a' : '#4ab3f0');
    ctx.fillRect(x + (boss.dir > 0 ? -2 : -8), y - legH - 30, 10, 3);
    ctx.fillStyle = dark;
    ctx.fillRect(x - 11, y - legH - 32, 3, 6); // the ear pods
    ctx.fillRect(x + 8, y - legH - 32, 3, 6);
    ctx.globalAlpha = 1;
  };

  const drawBullet = (b) => {
    const x = Math.round(b.x);
    const y = Math.round(b.y);
    ctx.fillStyle = b.boss ? '#f2c14e' : '#d8343f';
    ctx.fillRect(x - 3, y - 2, 6, 4);
    ctx.fillStyle = '#fffaf2';
    ctx.fillRect(x - 1, y - 1, 2, 2);
  };

  const drawZero = (t) => {
    const z = zero;
    if (state === 'dying') return;
    if (z.inv > 0 && Math.floor(t / 60) % 2) return; // flickers after a hit
    let pose = 'stand';
    if (z.slash > 0) pose = 'slash';
    else if (z.dashing) pose = 'dash';
    else if (!z.ground) pose = 'jump';
    else if (Math.abs(z.vx) > 10) pose = ['run1', 'run2', 'run3', 'run2'][Math.floor(z.run / 80) % 4];
    const face = z.wall ? -z.wall : z.dir; // sliding down a wall, Zero faces it
    const sprite = SPRITES[pose][face > 0 ? 1 : 0];
    const sx = Math.round(z.x - 8);
    const sy = Math.round(z.y - 24);
    if (z.ground) {
      ctx.fillStyle = 'rgba(0, 0, 0, .3)';
      ctx.fillRect(sx + 3, sy + 24, 10, 2);
    }
    ctx.drawImage(sprite, sx, sy);
    if (z.slash > 0) {
      // The Z-Saber sweeps from over the shoulder down and forward.
      const k = 1 - z.slash / SLASH_MS;
      const cx = z.x + z.dir * 4;
      const cy = z.y - 12;
      const from = -Math.PI * 0.62;
      const to = Math.PI * 0.42;
      const a = from + (to - from) * Math.min(1, k * 1.25);
      const sweep = (ang) => (z.dir > 0 ? ang : Math.PI - ang);
      ctx.lineCap = 'round';
      ctx.strokeStyle = `rgba(120, 240, 138, ${0.55 * (1 - k * 0.6)})`;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(cx, cy, 26, sweep(from), sweep(a), z.dir < 0);
      ctx.stroke();
      ctx.strokeStyle = `rgba(230, 255, 230, ${0.8 * (1 - k * 0.5)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 26, sweep(from), sweep(a), z.dir < 0);
      ctx.stroke();
      // The blade itself.
      const bx = cx + Math.cos(sweep(a)) * 32;
      const by = cy + Math.sin(sweep(a)) * 32;
      ctx.strokeStyle = '#78f08a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(sweep(a)) * 6, cy + Math.sin(sweep(a)) * 6);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.strokeStyle = '#e6ffe6';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(sweep(a)) * 8, cy + Math.sin(sweep(a)) * 8);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
  };

  const drawBar = (x, hp, max, col, label) => {
    const h = max * 3 + 3;
    ctx.fillStyle = '#1b1626';
    ctx.fillRect(x, 18, 10, h);
    ctx.fillStyle = '#9aa5b5';
    ctx.fillRect(x, 18, 10, 1);
    ctx.fillRect(x, 18 + h - 1, 10, 1);
    ctx.fillRect(x, 18, 1, h);
    ctx.fillRect(x + 9, 18, 1, h);
    for (let i = 0; i < max; i++) {
      ctx.fillStyle = i < hp ? col : '#2b2e40';
      ctx.fillRect(x + 2, 18 + h - 3 - i * 3, 6, 2);
    }
    ctx.fillStyle = '#2b2e40';
    ctx.fillRect(x - 1, 18 + h, 12, 10);
    ctx.fillStyle = '#fffaf2';
    ctx.font = '600 8px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 5, 18 + h + 5);
  };

  const draw = (t = performance.now()) => {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.imageSmoothingEnabled = false;
    drawBackdrop(t);
    ctx.translate(-Math.round(camX), 0);
    drawTiles();
    drawCheckpoints(t);
    drawCapsules(t);
    drawGate(t);
    enemies.forEach((e) => drawEnemy(e, t));
    drawBoss(t);
    bullets.forEach(drawBullet);
    drawZero(t);
    particles.forEach((p) => {
      ctx.fillStyle = p.col;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
    });
    orbs.forEach((o) => {
      ctx.fillStyle = '#fffaf2';
      ctx.beginPath();
      ctx.arc(o.x, o.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(120, 240, 138, .6)';
      ctx.beginPath();
      ctx.arc(o.x, o.y, 4, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.translate(Math.round(camX), 0);
    // The life bars, the score and, for a moment, the keys.
    drawBar(8, zero.hp, MAX_HP, '#78f08a', 'Z');
    if (boss.active && boss.phase !== 'warning') drawBar(24, boss.hp, BOSS_HP, '#d8343f', 'B');
    ctx.font = '600 10px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(15, 16, 32, .6)';
    ctx.fillRect(W - 74, 6, 68, 14);
    ctx.fillStyle = '#fffaf2';
    ctx.fillText(String(score).padStart(6, '0'), W - 10, 8);
    for (let i = 0; i < lives; i++) {
      ctx.fillStyle = '#d8343f';
      ctx.fillRect(W - 74 + i * 9, 24, 6, 6);
      ctx.fillStyle = '#f7dd7f';
      ctx.fillRect(W - 73 + i * 9, 25, 2, 4);
    }
    if (boss.phase === 'warning' && Math.floor(t / 220) % 2) {
      ctx.font = '700 22px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#d8343f';
      ctx.fillText('WARNING', W / 2 + 1, H / 2 + 1);
      ctx.fillStyle = '#f2c14e';
      ctx.fillText('WARNING', W / 2, H / 2);
    }
    if (state === 'playing' && played < 4500) {
      ctx.font = '500 9px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = `rgba(255, 242, 225, ${Math.min(1, (4500 - played) / 500) * 0.9})`;
      ctx.fillText(touch?.matches ? 'arrows run · ⤒ jump · ⚔ saber · » dash' : 'arrows run · X jump · Z saber · C dash', W / 2, H - 50);
    }
  };

  const updateStats = () => {
    out('score').textContent = score;
    out('best').textContent = best || '-';
    out('lives').textContent = lives;
    out('time').textContent = `${Math.floor(played / 60000)}:${String(Math.floor(played / 1000) % 60).padStart(2, '0')}`;
  };

  /* ---------- Play ---------- */

  const showOverlay = (text, label) => {
    msg.textContent = text;
    startBtn.textContent = label;
    overlay.hidden = false;
  };

  const die = (t) => {
    if (state !== 'playing') return;
    state = 'dying';
    diedAt = t;
    held.length = 0;
    zero.slash = 0;
    zero.dashing = false;
    // Zero bursts into two rings of light, as a Reploid does.
    orbs = [];
    for (let ring = 0; ring < 2; ring++) for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + ring * Math.PI / 8;
      orbs.push({ x: zero.x, y: zero.y - 12, vx: Math.cos(a) * (ring ? 40 : 75), vy: Math.sin(a) * (ring ? 40 : 75) });
    }
  };

  const award = (key) => window.arcadeMons?.award(key); // a monster for a first-time achievement, see rewards.csv

  const finish = (won) => {
    state = won ? 'won' : 'over';
    endedAt = performance.now();
    cancelAnimationFrame(raf);
    if (won) score += Math.max(0, 2000 - Math.floor(played / 1000) * 10); // quicker is better
    if (won) {
      award('zero.boss');
      if (lives === LIVES) award('zero.perfect');
    }
    const record = score > best;
    if (record) {
      best = score;
      saveBest(best);
    }
    updateStats();
    draw();
    if (won) showOverlay(`${record ? 'New best! ' : ''}Mission complete. The mech is scrap and the gate is open. Score ${score}.`, 'Play again');
    else showOverlay(`${record ? 'New best! ' : ''}Mission failed. Zero is out of lives with ${score} points.`, 'Try again');
  };

  const hurtZero = (dmg, fromX, t) => {
    const z = zero;
    if (state !== 'playing' || z.inv > 0) return;
    z.hp -= dmg;
    sparks(z.x, z.y - 12, 5, '#d8343f');
    if (z.hp <= 0) {
      z.hp = 0;
      die(t);
      return;
    }
    z.inv = INV_MS;
    z.knock = KNOCK_MS;
    z.hurt = KNOCK_MS;
    z.vx = (z.x < fromX ? -1 : 1) * 90;
    z.vy = -130;
    z.ground = false;
    z.dashing = false;
    z.dashJump = false;
    z.slash = 0;
  };

  const shoot = (x, y, tx, ty, speed, fromBoss, spread = 0) => {
    const a = Math.atan2(ty - y, tx - x) + spread;
    bullets.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, boss: fromBoss, dmg: fromBoss ? 3 : 2, life: 2600 });
  };

  const jump = () => {
    const z = zero;
    z.vy = JUMP;
    z.ground = false;
    z.sinceGround = COYOTE + 1;
    z.buffer = 0;
    z.jumping = true;
    if (z.dashing) {
      z.dashJump = true; // a dash jump keeps the dash's speed in the air
      z.dashing = false;
      z.dash = 0;
    }
    puff(z.x, z.y, 3);
  };
  const wallKick = () => {
    const z = zero;
    z.vy = JUMP;
    z.kick = KICK_MS;
    z.kickDir = -z.wall;
    z.dir = z.kickDir;
    z.buffer = 0;
    z.jumping = true;
    z.dashJump = dashHeld;
    z.sinceWall = WALL_GRACE + 1;
    puff(z.x + z.wall * 6, z.y - 12, 4);
    z.wall = 0;
  };

  const updateZero = (ms, t) => {
    const dt = ms / 1000;
    const z = zero;
    z.inv = Math.max(0, z.inv - ms);
    z.knock = Math.max(0, z.knock - ms);
    z.hurt = Math.max(0, z.hurt - ms);
    z.kick = Math.max(0, z.kick - ms);
    z.slashGap = Math.max(0, z.slashGap - ms);
    z.buffer -= ms;
    if (z.slash > 0) {
      z.slash -= ms;
      if (z.slash <= 0) z.slashGap = SLASH_GAP;
    }
    const frozen = boss.phase === 'warning';

    // Running, dashing and wall kicks decide the sideways speed.
    const dir = held[held.length - 1];
    if (z.knock > 0 || frozen) {
      if (frozen) z.vx = 0;
    } else if (z.kick > 0) {
      z.vx = z.kickDir * (z.dashJump ? DASH : RUN);
    } else if (z.dashing) {
      z.dash -= ms;
      z.vx = z.dir * DASH;
      if (z.dash <= 0 || !dashHeld) z.dashing = false;
    } else if (dir) {
      const s = dir === 'right' ? 1 : -1;
      z.dir = s;
      z.vx = s * (z.dashJump && !z.ground ? DASH : RUN);
    } else {
      z.vx = 0;
      if (!z.ground && z.dashJump) z.vx = z.dir * DASH * 0.7;
    }
    if (z.ground) z.run += Math.abs(z.vx) > 10 ? ms : 0;

    // Jumps: from the ground, soon after leaving it, or off a wall.
    z.sinceGround += ms;
    z.sinceWall += ms;
    if (z.buffer > 0 && !frozen && z.knock === 0) {
      if (z.ground || z.sinceGround <= COYOTE) jump();
      else if (z.wall || z.sinceWall <= WALL_GRACE) {
        if (!z.wall) z.wall = z.lastWall;
        wallKick();
      }
    }
    // Gravity always pulls, so standing on a floor registers as a landing every frame.
    z.vy = Math.min(MAX_FALL, z.vy + GRAVITY * dt);

    const hitWall = moveX(z, z.vx * dt);
    if (hitWall) {
      if (z.dashing) z.dashing = false;
      z.dashJump = false;
    }
    const wasGround = z.ground;
    const land = moveY(z, z.vy * dt);
    z.ground = land === 1;
    if (land === 1) {
      if (!wasGround && z.vy > 60) puff(z.x, z.y, 4);
      z.vy = 0;
      z.jumping = false;
      z.dashJump = false;
      z.kick = 0;
      z.sinceGround = 0;
    } else if (land === -1) z.vy = 0;
    if (z.ground && !z.dashing && z.dashJump) z.dashJump = false;
    if (z.ground) z.wall = 0;

    // Sliding down a wall: in the air, pushing into it, on the way down.
    if (!z.ground && hitWall && dir && (dir === 'right') === (hitWall > 0) && z.vy > 0 && z.knock === 0) {
      z.wall = hitWall;
      z.lastWall = hitWall;
      z.sinceWall = 0;
      z.vy = Math.min(z.vy, WALL_SLIDE);
      if (Math.floor(t / 90) % 3 === 0) particles.push({ x: z.x + hitWall * 6, y: z.y - rand(2, 20), vx: -hitWall * 15, vy: -30, life: 200, col: 'rgba(255, 242, 225, .7)' });
    } else if (z.wall && (!hitWall || !dir)) {
      z.wall = 0;
    }

    // Hazards.
    if (onSpikes(z)) {
      zero.hp = 0;
      die(t);
      return;
    }
    if (z.y - BODY_H > H + 8) {
      zero.hp = 0;
      die(t);
      return;
    }

    // Capsules and checkpoints.
    capsules.forEach((c, i) => {
      if (taken.has(i)) return;
      if (overlap(z, { x: c.x, y: c.y, w: 8, h: 10 })) {
        taken.add(i);
        z.hp = Math.min(MAX_HP, z.hp + HEAL);
        score += SCORES.capsule;
        sparks(c.x, c.y - 5, 6, '#f2c14e');
        out('score').textContent = score;
      }
    });
    checkpoints.forEach((c, i) => {
      if (!passed.has(i) && z.x > c.x) {
        passed.add(i);
        checkpoint = { x: c.x, y: c.y };
        award('zero.checkpoint');
        sparks(c.x, c.y - 14, 5);
      }
    });

    // The gate: it lifts as Zero comes near and shuts once he is through.
    const gx = gateX * TILE;
    if (!boss.active) {
      const near = z.x > gx - 60 && z.x < gx + 20;
      gate.open = clamp(gate.open + (near ? 1 : -1) * ms / 350, 0, 1);
      if (z.x > arenaX + 20 && z.ground) {
        boss.active = true;
        boss.phase = 'warning';
        boss.t = 0;
        gate.open = 0;
        gate.shut = true;
        award('zero.gate');
        z.vx = 0;
      }
    }
  };

  // The Z-Saber reaches well ahead of Zero, as a saber should.
  const slashBox = () => ({ x: zero.x + zero.dir * 24, y: zero.y + 2, w: 44, h: 30 });

  const updateEnemies = (ms, t) => {
    const dt = ms / 1000;
    const z = zero;
    const slashing = z.slash > 0 ? slashBox() : null;
    enemies.forEach((e) => {
      if (!e.alive) return;
      e.flash = Math.max(0, e.flash - ms);
      const near = e.x > camX - 40 && e.x < camX + W + 40;
      if (!near) return;
      if (e.type === 'met') {
        e.wait = Math.max(0, e.wait - ms);
        e.t += ms;
        if (e.wait === 0) {
          const ahead = e.x + e.dir * 9;
          if (!floorAt(ahead, e.y + 2) || moveX(e, e.dir * 28 * dt)) e.dir = -e.dir;
          if (e.t > 2600 && Math.abs(z.x - e.x) < 150) {
            e.t = 0;
            e.wait = 700;
            e.dir = z.x < e.x ? -1 : 1;
          }
        } else if (e.wait < 350 && !e.shot) {
          e.shot = true;
          shoot(e.x + e.dir * 8, e.y - 6, e.x + e.dir * 40, e.y - 6, 120, false);
        }
        if (e.wait === 0) e.shot = false;
        e.vy = Math.min(MAX_FALL, e.vy + GRAVITY * dt);
        if (moveY(e, e.vy * dt)) e.vy = 0;
      } else if (e.type === 'bat') {
        if (!e.awake && Math.abs(z.x - e.x) < 96 && z.y > e.y) e.awake = true;
        if (e.awake) {
          e.t += ms;
          const wantY = z.y - 18 + Math.sin(e.t / 260) * 22;
          e.vx += ((z.x > e.x ? 1 : -1) * 70 - e.vx) * Math.min(1, dt * 2.5);
          e.vy += ((wantY - e.y) * 3 - e.vy) * Math.min(1, dt * 3);
          e.vy = clamp(e.vy, -90, 90);
          e.x += e.vx * dt;
          e.y = clamp(e.y + e.vy * dt, 8, H);
        }
      } else {
        e.dir = z.x < e.x ? -1 : 1;
        e.cool -= ms;
        if (e.cool <= 0 && Math.abs(z.x - e.x) < 170) {
          e.cool = 1800;
          shoot(e.x + e.dir * 8, e.y - 10, z.x, z.y - 12, 135, false);
        }
      }
      // The saber, then Zero running into them.
      if (slashing && !z.slashHits.has(e) && overlap(slashing, e)) {
        z.slashHits.add(e);
        e.hp -= SLASH_DMG;
        e.flash = 120;
        sparks(e.x, e.y - e.h / 2, 5);
        if (e.type !== 'turret') e.x += z.dir * 6;
        if (e.hp <= 0) {
          e.alive = false;
          score += SCORES[e.type];
          bang(e.x, e.y - e.h / 2);
          out('score').textContent = score;
        }
      }
      if (e.alive && overlap(z, e)) hurtZero(e.dmg, e.x, t);
    });

    bullets.forEach((b) => {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= ms;
      if (solid(tileAt(Math.floor(b.x / TILE), Math.floor(b.y / TILE)))) b.life = 0;
      if (b.life <= 0) return;
      if (slashing && overlap(slashing, { x: b.x, y: b.y + 2, w: 6, h: 4 })) {
        b.life = 0; // the saber cuts shots out of the air
        sparks(b.x, b.y, 4, '#fffaf2');
        return;
      }
      if (overlap(z, { x: b.x, y: b.y + 2, w: 6, h: 4 })) {
        b.life = 0;
        hurtZero(b.dmg, b.x, t);
      }
    });
    bullets = bullets.filter((b) => b.life > 0 && b.x > camX - 40 && b.x < camX + W + 40);
  };

  const updateBoss = (ms, t) => {
    if (!boss.active) return;
    const dt = ms / 1000;
    const z = zero;
    boss.t += ms;
    boss.inv = Math.max(0, boss.inv - ms);
    boss.flash = Math.max(0, boss.flash - ms);
    if (boss.phase === 'warning') {
      if (boss.t >= WARN_MS) {
        boss.phase = 'drop';
        boss.x = bossAt.x;
        boss.y = -10;
        boss.vy = 0;
        boss.dir = -1;
        boss.t = 0;
      }
      return;
    }
    if (boss.phase === 'dead') {
      if (Math.floor(t / 120) !== Math.floor((t - ms) / 120)) bang(boss.x + rand(-16, 16), boss.y - rand(0, 40));
      if (t - boss.diedAt >= BOSS_DIE_MS) {
        boss.phase = 'gone';
        finish(true);
      }
      return;
    }
    boss.dir = z.x < boss.x ? -1 : 1;
    if (boss.phase === 'drop' || boss.phase === 'jump') {
      boss.vy = Math.min(MAX_FALL, boss.vy + GRAVITY * dt);
      moveX(boss, boss.vx * dt);
      if (moveY(boss, boss.vy * dt) === 1) {
        boss.vy = 0;
        boss.vx = 0;
        puff(boss.x - 12, boss.y, 5);
        puff(boss.x + 12, boss.y, 5);
        boss.phase = 'walk';
        boss.t = 0;
        boss.until = rand(900, 1600);
      }
    } else if (boss.phase === 'walk') {
      // It closes to a saber's length, backs off if Zero crowds it, and leaps clean over him
      // when it cannot; then it shoots or leaps.
      const gap = Math.abs(z.x - boss.x);
      boss.vx = gap > 48 ? boss.dir * 42 : gap < 30 ? -boss.dir * 60 : 0;
      const stuck = boss.vx && moveX(boss, boss.vx * dt);
      if (boss.t >= boss.until || (gap < 26 && boss.t > 300 && stuck)) {
        boss.t = 0;
        boss.shots = 0;
        if (Math.random() < 0.45 || gap > 120 || gap < 30) {
          boss.phase = 'jump';
          boss.vy = -360;
          boss.vx = boss.dir * (gap > 100 ? 110 : 170);
        } else {
          boss.phase = 'shoot';
          boss.vx = 0;
        }
      }
    } else if (boss.phase === 'shoot') {
      // Three shots fanned towards Zero, then back to walking.
      if (boss.t >= 350 + boss.shots * 160 && boss.shots < 3) {
        const spread = (boss.shots - 1) * 0.28;
        shoot(boss.x + boss.dir * 26, boss.y - 22, z.x, z.y - 12, 150, true, spread);
        boss.shots++;
      }
      if (boss.t >= 1200) {
        boss.phase = 'walk';
        boss.t = 0;
        boss.until = rand(700, 1300);
      }
    }
    // Gravity keeps the mech on the floor while it walks or shoots.
    if (boss.phase === 'walk' || boss.phase === 'shoot') {
      boss.vy = Math.min(MAX_FALL, boss.vy + GRAVITY * dt);
      if (moveY(boss, boss.vy * dt) === 1) boss.vy = 0;
    }
    const hitbox = { x: boss.x, y: boss.y, w: 30, h: 38 };
    if (z.slash > 0 && boss.inv === 0 && overlap(slashBox(), hitbox)) {
      boss.hp -= SLASH_DMG;
      boss.inv = BOSS_INV;
      boss.flash = 100;
      sparks(z.x + z.dir * 20, z.y - 14, 6);
      if (boss.hp <= 0) {
        boss.hp = 0;
        boss.phase = 'dead';
        boss.diedAt = t;
        score += SCORES.boss;
        bullets = [];
        out('score').textContent = score;
      }
    }
    if (overlap(z, hitbox)) hurtZero(3, boss.x, t);
  };

  const update = (ms, t) => {
    const dt = ms / 1000;
    particles.forEach((p) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += (p.g ?? 300) * dt;
      p.life -= ms;
    });
    particles = particles.filter((p) => p.life > 0);
    orbs.forEach((o) => {
      o.x += o.vx * dt;
      o.y += o.vy * dt;
    });

    if (state === 'dying') {
      if (t - diedAt >= DIE_MS) {
        lives--;
        if (lives <= 0) {
          finish(false);
        } else {
          respawn();
          state = 'playing';
          updateStats();
        }
      }
      return;
    }
    if (state !== 'playing') return;
    played += ms;
    if (Math.floor(played / 1000) !== Math.floor((played - ms) / 1000)) updateStats();

    updateZero(ms, t);
    if (state !== 'playing') return;
    updateEnemies(ms, t);
    updateBoss(ms, t);

    // The view follows Zero, and locks on the arena once the boss is up.
    const want = boss.active ? arenaX : clamp(zero.x - W * 0.42, 0, LEVEL_W - W);
    camX += (want - camX) * Math.min(1, ms / CAM_EASE);
  };

  const tick = (t) => {
    if (!RUNNING.has(state)) return;
    const dt = Math.max(0, Math.min(50, t - lastTime));
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

  const startGame = () => {
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
    dashHeld = false;
    zero.dashing = false;
    draw();
    showOverlay('Paused', 'Resume');
  };

  const resume = () => {
    state = before;
    if (state === 'dying') diedAt = performance.now();
    run();
  };

  const startOrResume = () => (state === 'paused' ? resume() : startGame());

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
    zero.buffer = BUFFER;
  };
  const releaseJump = () => {
    jumpHeld = false;
    if (state === 'playing' && zero.jumping && zero.vy < JUMP_CUT) zero.vy = JUMP_CUT;
  };
  const pressSlash = () => {
    const z = zero;
    if (state !== 'playing' || z.slash > 0 || z.slashGap > 0 || z.knock > 0 || boss.phase === 'warning') return;
    z.slash = SLASH_MS;
    z.slashHits = new Set();
    if (z.dashing) z.dashing = false;
  };
  const pressDash = () => {
    const z = zero;
    if (state !== 'playing' || dashHeld) return;
    dashHeld = true;
    if (z.ground && !z.dashing && z.knock === 0 && boss.phase !== 'warning') {
      z.dashing = true;
      z.dash = DASH_MS;
      z.slash = 0;
      puff(z.x - z.dir * 6, z.y, 4);
    }
  };
  const releaseDash = () => { dashHeld = false; };

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
      } else if (SLASH_KEYS.has(e.code)) {
        e.preventDefault();
        if (!e.repeat) pressSlash();
      } else if (DASH_KEYS.has(e.code)) {
        e.preventDefault();
        if (!e.repeat) pressDash();
      } else if (PAUSE_KEYS.has(e.code)) {
        e.preventDefault();
        if (!e.repeat) pause();
      }
      return;
    }
    if (state === 'dying') {
      if (KEYS[e.code] || JUMP_KEYS.has(e.code) || SLASH_KEYS.has(e.code)) e.preventDefault();
      return;
    }
    // Idle, paused or over: Enter, Space, Z or X starts; while paused, the pause and arrow keys resume too.
    const go = START_KEYS.has(e.code) || (state === 'paused' && (PAUSE_KEYS.has(e.code) || KEYS[e.code] || JUMP_KEYS.has(e.code)));
    if (!go) return;
    e.preventDefault();
    if (e.repeat || ((state === 'over' || state === 'won') && performance.now() - endedAt < RESTART_GRACE)) return;
    startOrResume();
  });
  root.addEventListener('keyup', (e) => {
    if (KEYS[e.code]) unhold(KEYS[e.code]);
    else if (JUMP_KEYS.has(e.code)) releaseJump();
    else if (DASH_KEYS.has(e.code)) releaseDash();
  });
  window.addEventListener('blur', () => { held.length = 0; jumpHeld = false; dashHeld = false; });

  // A click on the screen gives it the keyboard.
  screen.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    stage.focus({ preventScroll: true });
  });

  // Touch pad: hold a direction to keep running; jump, saber and dash are the three middle buttons.
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
      else if (act === 'slash') pressSlash();
      else if (act === 'dash') pressDash();
      else if (state === 'paused') resume();
      else pause();
    });
    if (act === 'jump') ['pointerup', 'pointerleave', 'pointercancel'].forEach((type) => b.addEventListener(type, releaseJump));
    if (act === 'dash') ['pointerup', 'pointerleave', 'pointercancel'].forEach((type) => b.addEventListener(type, releaseDash));
  });

  startBtn.addEventListener('click', startOrResume);

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
    const w = Math.round(screen.clientWidth * (window.devicePixelRatio || 1));
    if (!w) return;
    screen.width = w;
    screen.height = Math.round((w * H) / W);
    scale = w / W;
    draw();
  };
  // The dungeon (dungeon.js) puts this window away and brings it back.
  root.addEventListener('scene-exit', pause);
  root.addEventListener('scene-enter', fit);
  if ('ResizeObserver' in window) new ResizeObserver(fit).observe(screen);

  reset();
  updateStats();
  showOverlay('Run right, cut down the Mavericks and scrap the mech behind the gate.', 'Start mission');
  fit();
})();
