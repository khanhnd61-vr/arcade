// Block Breaker for the Play section: a paddle at the foot of a tall board, a
// ball, and rows of coloured bricks to knock out of it. Steer with the arrows
// or the mouse and launch with Space; the ball comes off the paddle at an angle
// set by where it lands. Silver bricks take two hits and steel ones never go.
// Some bricks drop a capsule: W widens the paddle for a while, S slows the
// ball, M splits it in three and a heart is one more ball. Clear the board to
// go on to the next, with the ball a little quicker each time. Three balls to
// start; the best score is kept per mode. Hard has a narrower paddle and a
// faster ball.
(() => {
  const root = document.querySelector('[data-breaker]');
  if (!root) return;

  // The board has its own units; the canvas is scaled to whatever size it gets.
  const W = 360;
  const H = 480;
  const COLS = 12;
  const BW = 28; // a brick
  const BH = 14;
  const LEFT = (W - COLS * BW) / 2;
  const TOP = 56; // where the bricks start; the strip above holds the level and the balls left
  const R = 5; // the ball
  const PADDLE_Y = H - 34;
  const PADDLE_H = 10;
  const PADDLE_SPEED = 460; // units per second, on the keys
  const MAX_ANGLE = 1.0; // radians from straight up that the paddle can send the ball
  const MIN_ANGLE = 0.14; // and the least, so a dead-centre hit still drifts sideways
  const MIN_RISE = 0.28; // the smallest share of the ball's speed that stays vertical
  const CAPSULE_FALL = 105;
  const WIDE_MS = 18000;
  const SLOW_MS = 12000;
  const MAX_BALLS = 6;
  const CLEAR_MS = 1600;
  const BANNER_MS = 1400;
  const LOSE_MS = 700; // the pause after the last ball drops out
  const LIVES = 3;
  const RESTART_GRACE = 800; // ms after the end before a held key can restart
  const BEST_KEY = 'breaker-best';
  const INK = '#2b1a08';
  const SCORES = { 1: 70, 2: 60, 3: 50, 4: 40, 5: 30, 6: 20, H: 100, capsule: 50, level: 500 };
  const COLORS = { 1: '#d9745a', 2: '#f4c15d', 3: '#8db07e', 4: '#6f8fc0', 5: '#b48cb0', 6: '#8fb8c4', H: '#9aa5b5', X: '#4b5066' };
  // The paddle's width, the ball's speed to begin with and how much each paddle hit adds, and
  // how often a brick drops a capsule.
  const MODES = {
    normal: { paddle: 64, speed: 250, ramp: 2.2, drop: 0.2, idle: 'Knock out every brick. Where the ball lands on the paddle sets its angle.' },
    hard: { paddle: 50, speed: 320, ramp: 3, drop: 0.14, idle: 'A narrow paddle and a quick ball. Fewer capsules fall.' },
  };
  // The boards, a character per brick: 1 to 6 the colours, H silver (two hits), X steel
  // (never breaks) and . a gap. They come round again, faster, once all are cleared.
  const LEVELS = [
    ['111111111111', '222222222222', '333333333333', '444444444444', '555555555555'],
    ['1.1.1.1.1.1.', '.2.2.2.2.2.2', '3.3.3.3.3.3.', '.4.4.4.4.4.4', '5.5.5.5.5.5.', '.6.6.6.6.6.6'],
    ['.....11.....', '....2222....', '...333333...', '..44444444..', '.5555555555.', '666666666666'],
    ['111111111111', '2H2H2H2H2H2H', '333333333333', '4H4H4H4H4H4H', '555555555555', '666666666666'],
    ['X1111111111X', 'X2222222222X', '.3333333333.', '.4444444444.', '..55555555..', '..66666666..', '...X....X...'],
    ['.....HH.....', '....1221....', '...123321...', '..12344321..', '.1234554321.', '..12344321..', '...123321...', '....1221....'],
    ['HHHHHHHHHHHH', '1..........1', '1.22222222.1', '1.2X3333X2.1', '1.22222222.1', '1..........1', 'HHHHHHHHHHHH'],
    ['11X11X11X11X', '22X22X22X22X', '33.33.33.33.', 'X44X44X44X44', 'X55X55X55X55', '.66.66.66.66'],
  ];
  const KEYS = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
  const LAUNCH_KEYS = new Set(['Space', 'ArrowUp', 'KeyW', 'KeyZ', 'KeyX']);
  const PAUSE_KEYS = new Set(['KeyP', 'Escape']);
  const START_KEYS = new Set(['Enter', 'NumpadEnter', 'Space', 'KeyZ', 'KeyX']);
  const RUNNING = new Set(['playing', 'cleared', 'lost']);

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
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);

  /* ---------- State ---------- */

  let mode = 'normal';
  let cfg = MODES[mode];
  let state = 'idle'; // idle | playing | cleared | lost | paused | over
  let before = 'playing'; // what the pause interrupted
  let best = loadBest(mode);
  let score = 0;
  let level = 1;
  let lostHere = false; // a ball lost on this board, which forfeits its perfect-clear reward
  let lives = LIVES;
  let hits = 0; // paddle hits since the ball was last launched, for the speed
  let levelAt = 0; // ms into this level, for the banner
  let clearedAt = 0;
  let lostAt = 0;
  let endedAt = 0;
  let wideLeft = 0; // ms of the wide paddle to go
  let slowLeft = 0; // ms of the slow ball to go
  let raf = 0;
  let lastTime = 0;
  let scale = 1;
  let bricks = [];
  let balls = []; // x, y, vx, vy, stuck (riding the paddle before launch), trail
  let capsules = []; // x, y, kind
  let shards = []; // x, y, vx, vy, life, colour
  const paddle = { x: W / 2, w: cfg.paddle };
  const held = []; // directions held, most recent last

  const paddleW = () => paddle.w * (wideLeft > 0 ? 1.5 : 1);
  const paddleLeft = () => clamp(paddle.x - paddleW() / 2, 4, W - 4 - paddleW());
  // The ball's speed climbs with the level and with every paddle hit, and a slow capsule reins it in.
  const speedNow = () => (Math.min(cfg.speed + 170, cfg.speed + (level - 1) * 18 + hits * cfg.ramp)) * (slowLeft > 0 ? 0.65 : 1);

  const layLevel = () => {
    const rows = LEVELS[(level - 1) % LEVELS.length];
    lostHere = false;
    bricks = [];
    rows.forEach((row, r) => [...row].forEach((ch, c) => {
      if (ch === '.') return;
      bricks.push({ x: LEFT + c * BW, y: TOP + r * BH, kind: ch, hp: ch === 'H' ? 2 : 1, alive: true });
    }));
    capsules = [];
    shards = [];
    wideLeft = 0;
    slowLeft = 0;
    levelAt = 0;
    newBall();
  };

  // A fresh ball riding the paddle, waiting to be launched.
  const newBall = () => {
    hits = 0;
    balls = [{ x: paddle.x, y: PADDLE_Y - R - 1, vx: 0, vy: 0, stuck: true, trail: [] }];
  };

  const launch = () => {
    const ball = balls.find((b) => b.stuck);
    if (!ball) return;
    const a = rand(0.25, 0.5) * (ball.x > W / 2 ? -1 : 1); // off towards the middle
    const s = speedNow();
    ball.vx = Math.sin(a) * s;
    ball.vy = -Math.cos(a) * s;
    ball.stuck = false;
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

  const drawBoard = () => {
    ctx.fillStyle = '#1e2130';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255, 242, 225, .035)';
    for (let x = LEFT; x <= W - LEFT; x += BW) ctx.fillRect(x, TOP, 1, H - TOP);
    for (let y = TOP; y < H; y += BH * 2) ctx.fillRect(LEFT, y, W - 2 * LEFT, 1);
    // The strip at the top: the level on the left, the balls in hand on the right.
    ctx.fillStyle = '#242839';
    ctx.fillRect(0, 0, W, TOP - 10);
    ctx.fillStyle = '#3b3f52';
    ctx.fillRect(0, TOP - 10, W, 2);
    ctx.font = '600 12px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255, 242, 225, .8)';
    ctx.fillText(`LEVEL ${level}`, 12, 23);
    ctx.textAlign = 'right';
    ctx.fillText(score.toLocaleString(), W - 12, 23);
    for (let i = 0; i < lives - 1; i++) {
      ctx.fillStyle = '#fffaf2';
      ctx.beginPath();
      ctx.arc(W / 2 + 30 - i * 14, 23, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const drawBricks = () => {
    bricks.forEach((b) => {
      if (!b.alive) return;
      const col = COLORS[b.kind];
      ctx.fillStyle = 'rgba(0, 0, 0, .3)';
      ctx.fillRect(b.x + 2, b.y + BH - 1, BW - 2, 2);
      ctx.fillStyle = col;
      ctx.fillRect(b.x + 1, b.y + 1, BW - 2, BH - 2);
      ctx.fillStyle = 'rgba(255, 255, 255, .3)';
      ctx.fillRect(b.x + 2, b.y + 1, BW - 4, 2);
      ctx.fillStyle = 'rgba(0, 0, 0, .18)';
      ctx.fillRect(b.x + 1, b.y + BH - 3, BW - 2, 2);
      if (b.kind === 'X') {
        ctx.fillStyle = '#9aa5b5';
        [[4, 4], [BW - 6, 4], [4, BH - 6], [BW - 6, BH - 6]].forEach(([dx, dy]) => ctx.fillRect(b.x + dx, b.y + dy, 2, 2)); // rivets
      } else if (b.kind === 'H' && b.hp === 1) {
        ctx.fillStyle = '#4b5066'; // a crack across a silver brick that has taken a hit
        [[6, 2], [8, 4], [10, 5], [11, 7], [13, 9], [14, 11], [9, 7], [16, 3], [18, 5]].forEach(([dx, dy]) => ctx.fillRect(b.x + dx, b.y + dy, 2, 1));
      }
    });
  };

  const drawPaddle = () => {
    const w = paddleW();
    const x = paddleLeft();
    ctx.fillStyle = 'rgba(0, 0, 0, .35)';
    rrect(x + 2, PADDLE_Y + 4, w, PADDLE_H, 5);
    ctx.fill();
    ctx.fillStyle = '#5c7a8a';
    rrect(x, PADDLE_Y, w, PADDLE_H, 5);
    ctx.fill();
    ctx.fillStyle = '#8fb8c4';
    rrect(x + 1, PADDLE_Y + 1, w - 2, PADDLE_H - 3, 4);
    ctx.fill();
    ctx.fillStyle = '#b8d2dc';
    ctx.fillRect(x + 8, PADDLE_Y + 2, w - 16, 2);
    ctx.fillStyle = wideLeft > 0 ? '#f4c15d' : '#d9745a';
    ctx.fillRect(x + 1, PADDLE_Y + 2, 5, PADDLE_H - 4); // the caps
    ctx.fillRect(x + w - 6, PADDLE_Y + 2, 5, PADDLE_H - 4);
  };

  const drawBalls = () => {
    balls.forEach((b) => {
      b.trail.forEach(([tx, ty], i) => {
        ctx.fillStyle = `rgba(255, 250, 242, ${0.08 + i * 0.06})`;
        ctx.beginPath();
        ctx.arc(tx, ty, R * (0.4 + i * 0.1), 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.fillStyle = slowLeft > 0 ? '#8fb8c4' : '#fffaf2';
      ctx.beginPath();
      ctx.arc(b.x, b.y, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, .8)';
      ctx.fillRect(b.x - 2, b.y - 3, 2, 2);
    });
  };

  const CAPSULE = { wide: ['#8db07e', 'W'], slow: ['#8fb8c4', 'S'], multi: ['#b48cb0', 'M'], life: ['#d9745a', '♥'] };
  const drawCapsules = (t) => {
    capsules.forEach((c) => {
      const [col, glyph] = CAPSULE[c.kind];
      ctx.fillStyle = 'rgba(0, 0, 0, .3)';
      rrect(c.x - 11, c.y - 5, 24, 14, 6);
      ctx.fill();
      ctx.fillStyle = col;
      rrect(c.x - 12, c.y - 7, 24, 14, 6);
      ctx.fill();
      ctx.fillStyle = `rgba(255, 255, 255, ${0.25 + 0.15 * Math.sin(t / 120)})`;
      rrect(c.x - 10, c.y - 6, 20, 5, 3);
      ctx.fill();
      ctx.font = '700 10px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = INK;
      ctx.fillText(glyph, c.x, c.y + 1);
    });
  };

  const banner = (text, sub) => {
    ctx.fillStyle = 'rgba(43, 26, 8, .85)';
    ctx.fillRect(0, H / 2 - 32, W, 64);
    ctx.fillStyle = '#f4c15d';
    ctx.fillRect(0, H / 2 - 32, W, 2);
    ctx.fillRect(0, H / 2 + 30, W, 2);
    ctx.font = '700 20px "Space Grotesk", "JetBrains Mono", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff2e1';
    ctx.fillText(text, W / 2, H / 2 - (sub ? 8 : 0));
    if (sub) {
      ctx.font = '500 11px "JetBrains Mono", ui-monospace, monospace';
      ctx.fillStyle = 'rgba(255, 242, 225, .8)';
      ctx.fillText(sub, W / 2, H / 2 + 14);
    }
  };

  const draw = (t = performance.now()) => {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawBoard();
    drawBricks();
    drawCapsules(t);
    shards.forEach((s) => {
      ctx.globalAlpha = Math.min(1, s.life / 200);
      ctx.fillStyle = s.col;
      ctx.fillRect(Math.round(s.x), Math.round(s.y), 3, 3);
    });
    ctx.globalAlpha = 1;
    drawPaddle();
    drawBalls();
    if (state === 'cleared') banner(`Level ${level} cleared!`, `+${SCORES.level} points`);
    else if (state === 'playing' && levelAt < BANNER_MS) {
      ctx.globalAlpha = Math.min(1, (BANNER_MS - levelAt) / 300);
      banner(`Level ${level}`, bricks.some((b) => b.kind === 'X') ? 'steel bricks never break' : bricks.some((b) => b.kind === 'H') ? 'silver bricks take two hits' : '');
      ctx.globalAlpha = 1;
    } else if (state === 'playing' && balls.some((b) => b.stuck)) {
      ctx.font = '500 11px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = `rgba(255, 242, 225, ${0.6 + 0.3 * Math.sin(t / 300)})`;
      ctx.fillText(touch?.matches ? 'tap to launch' : 'space to launch', W / 2, PADDLE_Y - 40);
    }
  };

  const updateStats = () => {
    out('score').textContent = score.toLocaleString();
    out('best').textContent = best ? best.toLocaleString() : '-';
    out('level').textContent = level;
    out('lives').textContent = lives;
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
    showOverlay(`${record ? 'New best! ' : ''}Out of balls on level ${level}. ${score.toLocaleString()} points.`, 'Play again');
  };

  const burst = (b) => {
    const col = COLORS[b.kind];
    for (let i = 0; i < 7; i++) {
      shards.push({ x: b.x + rand(2, BW - 2), y: b.y + rand(2, BH - 2), vx: rand(-90, 90), vy: rand(-120, 20), life: rand(250, 450), col });
    }
  };

  // A brick is struck: silver cracks first, steel only rings, the rest go, and may drop a capsule.
  const strike = (b) => {
    if (b.kind === 'X') return;
    b.hp--;
    if (b.hp > 0) return;
    b.alive = false;
    score += SCORES[b.kind];
    burst(b);
    if (Math.random() < cfg.drop && capsules.length < 3) {
      const roll = Math.random();
      const kind = roll < 0.08 ? 'life' : roll < 0.4 ? 'wide' : roll < 0.7 ? 'slow' : 'multi';
      capsules.push({ x: b.x + BW / 2, y: b.y + BH / 2, kind });
    }
    out('score').textContent = score.toLocaleString();
  };

  const catchCapsule = (c) => {
    score += SCORES.capsule;
    if (c.kind === 'wide') wideLeft = WIDE_MS;
    else if (c.kind === 'slow') slowLeft = SLOW_MS;
    else if (c.kind === 'life') {
      lives++;
      out('lives').textContent = lives;
    } else {
      // Each ball in flight splits into three, up to the limit.
      const flying = balls.filter((b) => !b.stuck);
      flying.forEach((b) => {
        for (const a of [-0.45, 0.45]) {
          if (balls.length >= MAX_BALLS) return;
          const cos = Math.cos(a);
          const sin = Math.sin(a);
          balls.push({ x: b.x, y: b.y, vx: b.vx * cos - b.vy * sin, vy: b.vx * sin + b.vy * cos, stuck: false, trail: [] });
        }
      });
    }
    out('score').textContent = score.toLocaleString();
  };

  // Keep the ball at its proper speed and never too flat, or it would skate along the bricks for ever.
  const trim = (b) => {
    const s = speedNow();
    const mag = Math.hypot(b.vx, b.vy) || 1;
    b.vx *= s / mag;
    b.vy *= s / mag;
    if (Math.abs(b.vy) < s * MIN_RISE) {
      b.vy = (b.vy < 0 ? -1 : 1) * s * MIN_RISE;
      b.vx = Math.sign(b.vx || 1) * Math.sqrt(Math.max(0, s * s - b.vy * b.vy));
    }
  };

  // One ball, one small step: the walls, the bricks (one per step, bounced off the side it came
  // from), then the paddle.
  const moveBall = (b, dt) => {
    const px = b.x;
    const py = b.y;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.x - R < 0) { b.x = R; b.vx = Math.abs(b.vx); }
    if (b.x + R > W) { b.x = W - R; b.vx = -Math.abs(b.vx); }
    if (b.y - R < TOP - 10) { b.y = TOP - 10 + R; b.vy = Math.abs(b.vy); }
    for (const brick of bricks) {
      if (!brick.alive) continue;
      if (b.x + R <= brick.x || b.x - R >= brick.x + BW || b.y + R <= brick.y || b.y - R >= brick.y + BH) continue;
      const fromSide = px + R <= brick.x || px - R >= brick.x + BW;
      const fromAbove = py + R <= brick.y || py - R >= brick.y + BH;
      if (fromSide && !fromAbove) b.vx = -b.vx;
      else if (fromAbove && !fromSide) b.vy = -b.vy;
      else {
        const inX = Math.min(b.x + R - brick.x, brick.x + BW - (b.x - R));
        const inY = Math.min(b.y + R - brick.y, brick.y + BH - (b.y - R));
        if (inX < inY) b.vx = -b.vx;
        else b.vy = -b.vy;
      }
      b.x = px;
      b.y = py;
      strike(brick);
      trim(b);
      break;
    }
    // The paddle: only a falling ball bounces, and where it lands sets the angle.
    const left = paddleLeft();
    const w = paddleW();
    if (b.vy > 0 && b.y + R >= PADDLE_Y && py + R <= PADDLE_Y + PADDLE_H && b.x + R > left && b.x - R < left + w) {
      b.y = PADDLE_Y - R;
      const rel = clamp((b.x - (left + w / 2)) / (w / 2), -1, 1);
      // Never straight up, or the ball would shuttle up and down one column for ever.
      const side = rel ? Math.sign(rel) : Math.random() < 0.5 ? -1 : 1;
      const a = side * Math.max(MIN_ANGLE, Math.abs(rel) * MAX_ANGLE);
      hits++;
      const s = speedNow();
      b.vx = Math.sin(a) * s;
      b.vy = -Math.cos(a) * s;
    }
  };

  const update = (ms, t) => {
    const dt = ms / 1000;
    shards.forEach((s) => {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 300 * dt;
      s.life -= ms;
    });
    shards = shards.filter((s) => s.life > 0);

    if (state === 'cleared') {
      if (t - clearedAt >= CLEAR_MS) {
        level++;
        layLevel();
        state = 'playing';
        updateStats();
      }
      return;
    }
    if (state === 'lost') {
      if (t - lostAt >= LOSE_MS) {
        lives--;
        if (lives <= 0) {
          finish();
          return;
        }
        newBall();
        state = 'playing';
        updateStats();
      }
      return;
    }
    if (state !== 'playing') return;
    levelAt += ms;
    wideLeft = Math.max(0, wideLeft - ms);
    slowLeft = Math.max(0, slowLeft - ms);

    // The paddle, on the keys; the pointer moves it directly.
    const dir = held[held.length - 1];
    if (dir) paddle.x += (dir === 'right' ? 1 : -1) * PADDLE_SPEED * dt;
    paddle.x = clamp(paddle.x, 4 + paddleW() / 2, W - 4 - paddleW() / 2);

    // The balls, in steps small enough that none skips a brick.
    balls.forEach((b) => {
      if (b.stuck) {
        b.x = paddle.x;
        b.y = PADDLE_Y - R - 1;
        return;
      }
      b.trail.push([b.x, b.y]);
      if (b.trail.length > 5) b.trail.shift();
      const s = speedNow();
      const steps = Math.max(1, Math.ceil((s * dt) / 4));
      for (let i = 0; i < steps && b.y - R < H; i++) moveBall(b, dt / steps);
    });
    balls = balls.filter((b) => b.y - R < H);

    // Capsules fall; the paddle catches them.
    const left = paddleLeft();
    const w = paddleW();
    capsules.forEach((c) => { c.y += CAPSULE_FALL * dt; });
    capsules = capsules.filter((c) => {
      if (c.y + 7 >= PADDLE_Y && c.y - 7 <= PADDLE_Y + PADDLE_H && c.x + 12 > left && c.x - 12 < left + w) {
        catchCapsule(c);
        return false;
      }
      return c.y - 7 < H;
    });

    if (!balls.length) {
      state = 'lost';
      lostAt = t;
      lostHere = true;
      held.length = 0;
    } else if (!bricks.some((b) => b.alive && b.kind !== 'X')) {
      state = 'cleared';
      clearedAt = t;
      if (level === 1 || level === 4 || level === LEVELS.length) award(`breaker.${mode}.${level}`);
      if (!lostHere) award('breaker.perfect');
      score += SCORES.level;
      held.length = 0;
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
    level = 1;
    lives = LIVES;
    paddle.x = W / 2;
    paddle.w = cfg.paddle;
    layLevel();
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
    draw();
    showOverlay('Paused', 'Resume');
  };

  const resume = () => {
    state = before;
    const now = performance.now();
    if (state === 'cleared') clearedAt = now;
    if (state === 'lost') lostAt = now;
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
    level = 1;
    lives = LIVES;
    paddle.x = W / 2;
    paddle.w = cfg.paddle;
    layLevel();
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
      } else if (LAUNCH_KEYS.has(e.code)) {
        e.preventDefault();
        if (!e.repeat) launch();
      } else if (PAUSE_KEYS.has(e.code)) {
        e.preventDefault();
        if (!e.repeat) pause();
      }
      return;
    }
    if (state === 'cleared' || state === 'lost') {
      if (KEYS[e.code] || LAUNCH_KEYS.has(e.code)) e.preventDefault();
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

  // The pointer steers the paddle straight to wherever it is over the board; a press launches.
  const steer = (e) => {
    const rect = board.getBoundingClientRect();
    if (!rect.width) return;
    paddle.x = clamp(((e.clientX - rect.left) / rect.width) * W, 4 + paddleW() / 2, W - 4 - paddleW() / 2);
  };
  board.addEventListener('pointermove', (e) => {
    if (state !== 'playing') return;
    if (e.pointerType !== 'mouse' && !e.buttons) return;
    steer(e);
  });
  board.addEventListener('pointerdown', (e) => {
    if (state !== 'playing') return;
    e.preventDefault();
    stage.focus({ preventScroll: true });
    steer(e);
    launch();
  });

  // Touch pad: hold a direction to keep the paddle moving; the big button launches, the last one pauses.
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
    if (b.dataset.act === 'launch') { if (state === 'playing') launch(); } else if (state === 'paused') resume();
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
