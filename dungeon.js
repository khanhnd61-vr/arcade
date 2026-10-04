// Dungeon hub for the Play section: a top-down, Zelda-style map of eighteen
// rooms, drawn on one small canvas and scaled up with crisp pixels; the view
// is a window onto the map that follows the hero. The room
// beside it is the boss room, a battlefield where the two legendary monsters
// fight each other without end: its one door, in the lobby's east wall,
// stays locked until every monster is the player's. The lobby has a book that
// explains the place, a PC that keeps the monsters the player is not carrying
// (six at most come along) and a jukebox. Enter opens the player's menu
// (Status, Monsterdex, My mons, Login, Save, Reset) down the right side. The four long rooms
// above and below them, the two narrow rooms either side of them, the north-west, north,
// north-east and south-west rooms of the outer ring and its two west, two east, south and
// south-east rooms each hold an arcade cabinet. Press Z at one to
// swap this card for that game's window; the red button in the game window's
// title bar brings the player back here.
(() => {
  const root = document.querySelector('[data-dungeon]');
  if (!root) return;

  // The map, one character per tile: # is rock or wall, + a door, x the locked
  // door (the only way into the boss room, from the lobby; it opens once all the
  // monsters are owned), and each letter or digit is a room's floor. The middle is split into
  // the lobby (l) and the boss room (k); the long rooms above them are Pong (p)
  // and Balatro (b), the long rooms below them Tetris (t) and Hashi (h), and the two
  // narrow rooms beside them are the Race room (c) on the left and the Memory room (e)
  // on the right. The two middle rooms open onto the rooms above and below them, and
  // the six rooms around them join up in a ring. Around all of that runs a thin outer ring of ten rooms
  // (1-8, clockwise from the top left, then m and r): the first is the Flappy Bird room, the
  // second the Missiles room, the third the Pikachu room, the fourth (the upper west
  // room) the Snake room, the fifth (the upper east room) the Climb room, the sixth the Minesweeper
  // room, the seventh (the south room) the Sneak room, and the eighth the Zero room. The west
  // and east sides are split in two: below Snake is the Bomberman room (m), below Climb the
  // Block Breaker room (r). Doors are a single tile wide and not every pair of neighbours
  // shares one, but every room can be reached. Under the Sneak room, behind one tile of its
  // south wall that a punch can break (%), is a small secret room (s) with a ball in it; it
  // is drawn as rock until the wall is broken.
  const LAYOUT = [
    '#################################',
    '#111111111#22222222222#333333333#',
    '#111111111+22222222222+333333333#',
    '#111111111#22222222222#333333333#',
    '###+##########+#########+####+###',
    '#444#ppppppppppp#bbbbbbbbbbb#555#',
    '#444#ppppppppppp+bbbbbbbbbbb#555#',
    '#444#ppppppppppp#bbbbbbbbbbb#555#',
    '#444##+#####+#############+##555#',
    '#444#ccc#lllllll#kkkkkkk#eee#555#',
    '#444#ccc#lllllll#kkkkkkk#eee#555#',
    '#444#ccc#lllllll#kkkkkkk#eee#555#',
    '#444#ccc#lllllllxkkkkkkk#eee#555#',
    '###+#ccc#lllllll#kkkkkkk#eee#+###',
    '#mmm#ccc#lllllll#kkkkkkk#eee#rrr#',
    '#mmm#ccc#lllllll#kkkkkkk#eee#rrr#',
    '#mmm#ccc#lllllll#kkkkkkk#eee#rrr#',
    '#mmm+ccc#lllllll#kkkkkkk#eee+rrr#',
    '#mmm##+#####+#############+##rrr#',
    '#mmm#ttttttttttt#hhhhhhhhhhh#rrr#',
    '#mmm#ttttttttttt#hhhhhhhhhhh+rrr#',
    '#mmm#ttttttttttt#hhhhhhhhhhh#rrr#',
    '##+####+#############+########+##',
    '#666666666+77777777777+888888888#',
    '#666666666#77777777777#888888888#',
    '#666666666#77777777777#888888888#',
    '#################%###############',
    '##############sssss##############',
    '##############sssss##############',
    '#################################',
  ];

  const TILE = 16;
  const COLS = LAYOUT[0].length;
  const ROWS = LAYOUT.length;
  const W = COLS * TILE;
  const H = ROWS * TILE;
  const VIEW_W = 25 * TILE; // the part of the map on screen
  const VIEW_H = 19 * TILE;
  const CAM_EASE = 110; // ms for the view to catch up with the hero
  const SPEED = 72; // px per second, in canvas pixels
  const FADE = 320; // ms for the scene fade
  const STEP = 150; // ms per walk frame

  // Tile types. The pond tiles and the furniture are solid.
  const FLOOR = 0;
  const WALL = 1;
  const POT = 2;
  const RUG = 3;
  const STAIRS = 4;
  const WATER = 5;
  const ISLAND = 6;
  const BRIDGE_H = 7;
  const BRIDGE_V = 8;
  const BLOCK = 9;
  const CRACK = 10;
  const CARD = 11;
  const ARCADE = 12;
  const COMPUTER = 13;
  const DESK = 14;
  const BOOK = 15;
  const CHAIR = 16;
  const SHELF = 17;
  const PLANT = 18;
  const COURT = 19;
  const SKY = 20;
  const JUKEBOX = 21;
  const LOCKED = 22;
  const FIELD = 23;
  const ARENA = 24; // the boss room's flagstones
  const LEGEND = 25; // a flagstone with a legendary monster on it
  const BREAKABLE = 26; // the wall tile a punch can break
  const SECRET = 27; // the secret room's floor, rock until the wall is broken
  const BALL = 28; // the secret room's floor with the ball on it
  const SOLID = new Set([WALL, POT, WATER, ISLAND, BRIDGE_H, BRIDGE_V, ARCADE, COMPUTER, DESK, BOOK, CHAIR, SHELF, PLANT, JUKEBOX, LOCKED, LEGEND, BREAKABLE, BALL]);

  // Room floors by letter; each game room's name is painted on its floor at `at` (tiles).
  const ROOMS = {
    l: { name: 'Lobby', label: 'LOBBY', at: [12.5, 16.5] },
    k: { name: 'Boss room' }, // sealed; the legendaries' battlefield
    s: { name: 'Secret room' }, // under the Sneak room, behind the breakable wall
    p: { name: 'Pong room', label: 'PONG', at: [7, 6.5] },
    b: { name: 'Balatro room', label: 'BALATRO', at: [22, 6.5] },
    t: { name: 'Tetris room', label: 'TETRIS', at: [8, 20.5] },
    h: { name: 'Hashi room', label: 'HASHI', at: [23, 20.5] },
    // The narrow rooms either side of the lobby: Race on the left, Memory on the right.
    c: { name: 'Race room', label: 'RACE', at: [6.5, 10.5] },
    e: { name: 'Memory room', label: 'MEMORY', at: [26.5, 10.5] },
    // The outer ring: Flappy Bird in the top-left corner, Missiles along the top, Pikachu in the top-right,
    // Snake over Bomberman on the west side, Climb over Block Breaker on the east side, Minesweeper in the
    // bottom-left, Sneak along the bottom, and Zero in the bottom-right.
    1: { name: 'Flappy room', label: 'FLAPPY', at: [7.5, 2.5] },
    2: { name: 'Missiles room', label: 'MISSILES', at: [16.5, 2.5] },
    3: { name: 'Pikachu room', label: 'PIKACHU', at: [24.5, 2.5] },
    4: { name: 'Snake room', label: 'SNAKE', at: [2, 8.5] },
    5: { name: 'Climb room', label: 'CLIMB', at: [30, 8.5] },
    6: { name: 'Minesweeper room', label: 'MINES', at: [7, 24.5] },
    7: { name: 'Sneak room', label: 'SNEAK', at: [16.5, 24.5] },
    8: { name: 'Zero room', label: 'ZERO', at: [25.5, 24.5] },
    m: { name: 'Bomberman room', label: 'BOMBER', at: [2, 18.5] },
    r: { name: 'Block Breaker room', label: 'BREAKER', at: [30.5, 18.5] },
  };
  const DOORS = [];
  LAYOUT.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === '+') DOORS.push([x, y]); }));
  const TORCHES = [[10, 4], [22, 4], [4, 10], [28, 10], [4, 16], [28, 16], [10, 22], [22, 22], [16, 8], [16, 10], [16, 16], [16, 18],
    [5, 0], [16, 0], [27, 0], [5, 26], [16, 26], [27, 26], [0, 2], [0, 13], [0, 25], [32, 2], [32, 13], [32, 25], [10, 1], [22, 1], [10, 26], [22, 26], [2, 13], [30, 13]];
  const POTS = [[15, 5], [17, 5], [15, 21], [27, 21], [7, 17], [25, 17]];
  // A small Hashi pond at the far end of the Hashi room: four islands joined in a ring.
  const ISLANDS = { '17,19': 2, '19,19': 2, '17,21': 2, '19,21': 2 };
  const BLOCK_COLORS = {
    I: '#8FB8C4', O: '#F4C15D', T: '#B48CB0', S: '#8DB07E', Z: '#D9745A', J: '#6F8FC0', L: '#E2A963',
  };
  // Fallen tetrominoes on the Tetris room floor.
  const BLOCKS = {
    T: [[6, 20], [5, 21], [6, 21], [7, 21]],
    S: [[9, 20], [10, 20], [8, 21], [9, 21]],
    I: [[11, 21], [12, 21], [13, 21], [14, 21]],
    O: [[13, 19], [14, 19], [13, 20], [14, 20]],
  };
  const CRACKS = [[8, 6], [11, 20], [10, 16], [18, 11], [25, 7], [22, 21]];
  const CARDS = [[19, 6], [21, 5], [23, 7], [20, 7], [24, 5], [27, 7]]; // playing cards strewn on the floor
  const COURT_AT = [9, 5, 6, 3]; // Pong court painted on the Pong room floor: x, y, w, h in tiles
  const SKY_AT = [2, 2, 4, 2]; // strip of sky painted on the Flappy room floor: x, y, w, h in tiles
  // A corner of a minefield painted on the Minesweeper room floor: x, y, w, h in tiles, then
  // which of its cells are dug up (with the number shown in each) and which is flagged.
  const FIELD_AT = [1, 24, 3, 2];
  const FIELD_OPEN = { '1,24': 1, '1,25': 0, '2,25': 1 };
  const FIELD_FLAG = [3, 24];
  // A snake painted on the Snake room floor, head first, and the apple it is after.
  const SNAKE_PATH = [[1, 11], [1, 10], [2, 10], [3, 10], [3, 9]];
  const SNAKE_APPLE = [1, 12];
  // The Missiles room's floor painting: the plane, in tiles, and the missile on its tail.
  const PLANE_AT = [20, 1.5];
  const MISSILE_AT = [18.6, 2.4];
  // A few Pikachu tiles painted on the Pikachu room floor, one pair of them joined: x, y, then a colour per tile.
  const BOARD_AT = [27, 2];
  const BOARD = [
    ['#8db07e', '#f4c15d', '#8fb8c4', '#f4c15d'],
    ['#d9745a', '#6f8fc0', '#b48cb0', '#8db07e'],
  ];
  // The Sneak room's floor painting: a guard's lantern throwing its light across the floor, in
  // tiles, with the thief's gem just beyond its reach.
  const LANTERN_AT = [19, 24];
  const GEM_AT = [12.5, 24.5];
  // The Climb room's floor painting: a few ledges stacked up the floor, in tiles, with the
  // climber on the middle one, a flag on the top one and lava lapping at the bottom.
  const TOWER_AT = [29, 10];
  // The Bomberman room's floor painting: the cross of a blast that has just gone off, with the
  // crumbs of the brick it took with it, a couple of bricks still standing and a bomb with its
  // fuse lit. All in tiles.
  const BLAST_AT = [2, 16];
  const CRUMBS_AT = [2, 17];
  const BRICKS = [[3, 15], [3, 20]];
  const BOMB_AT = [1, 20];
  // The Block Breaker room's floor painting: rows of coloured bricks with one knocked out, the
  // ball on its way back down and the paddle waiting for it. All in tiles.
  const WALL_AT = [29, 15];
  const BALL_AT = [30.5, 17.2];
  const PADDLE_AT = [30.5, 19.6];
  // The Zero room's floor painting: the Z-Saber lying on the floor, in tiles, and the arc of its last swing.
  const SABER_AT = [29, 23];
  // The Race room's floor painting: a stretch of road running down the room, in tiles (x, y,
  // then its height), with the finish line across the top, a rival ahead and the player's red car.
  const ROAD_AT = [5, 11, 6];
  const RIVAL_AT = [6, 12.6];
  const RACER_AT = [6.5, 15];
  // The Memory room's floor painting: six cards laid out in two columns, in tiles, with the
  // middle pair turned up and matching.
  const DECK_AT = [25.5, 11.25];
  // The top of the Snake room: a second snake coiled up asleep, another apple and some grass; the
  // top of the Climb room: a coil of rope, a pickaxe and a couple of boulders. All in tiles.
  const COIL_AT = [1, 6];
  const APPLES = [[3, 7]];
  const GRASS = [[3, 6], [3, 11]];
  const ROPE_AT = [29, 6];
  const PICK_AT = [31, 8];
  const BOULDERS = [[29.5, 9.5], [31, 9.5]];
  // The boss room is a battlefield: its floor (x, y, w, h in tiles) is flagstone
  // with a ring worn into it, and the two legendary monsters from monster.csv
  // stand at either end of it, each on its own tile, facing each other down the
  // middle column: Noctyrax to the north, seen from the front, and Aurelyon to
  // the south, seen from behind. They fight without end (see fightAt), and
  // pressing Z at one shows its page with its animations playing.
  const ARENA_AT = [17, 9, 7, 9];
  const LEGENDS = [
    { x: 20, y: 10, id: 102, name: 'Noctyrax', side: 'front', glow: '#d6289a', core: '#ffd6f0' },
    { x: 20, y: 15, id: 101, name: 'Aurelyon', side: 'back', glow: '#f4c15d', core: '#fff6d6' },
  ];

  // What the book on the table and the computer on the desk say, a page at a time.
  // The book on the lobby table: what this place is, how it works, and who made it.
  const GUIDE = [
    'Play games to earn monsters. Monsters are your companions.',
    'Collect all monsters to unlock the final room.',
    'Hope you enjoy my childhood video games. More about me at havi.fit.',
  ];

  // A poem on the bookshelf beside the stairs, the one hint to the boss room: it
  // is read like the book, but no marker gives it away (see `hidden` on THINGS).
  const POEM = [
    'Two titans burn where none may tread, / the golden and the dark; / no hero\u2019s hand, no hundred friends / can leave on them a mark.',
    'But sing the one to slumber deep / and claim it while it dreams: / the other falls to its own kind, / and only to its beams.',
  ];

  // The locked door's page counts the monsters still to find; the unlocked one is read once, as it opens.
  const lockedPages = () => {
    const api = mons();
    const have = api ? api.owned().length : 1;
    const total = api ? api.TOTAL : 100;
    return [`Locked tight. On the other side two legendary monsters are fighting, and the door shakes with every blow. It opens only to whoever owns every monster: ${have} of ${total} are yours so far.`];
  };
  const OPENED_PAGES = ['The lock falls open. Every monster in the Monsterdex is yours, and the two legendary monsters fight on just inside.'];

  // Things the player can face and press Z at. Each gets a marker on the map, except
  // one marked `hidden`, which is found only by trying it.
  const THINGS = [
    { x: 13, y: 9, tile: COMPUTER, name: 'PC', pc: true }, // the monsters not with the player
    { x: 12, y: 13, tile: BOOK, name: 'Guide', pages: GUIDE },
    { x: 10, y: 9, tile: SHELF, name: 'Bookshelf', pages: POEM, hidden: true },
    // The Sneak room's south wall has one tile a punch can break, and the secret room behind
    // it holds a ball. Neither is marked: the wall is found by trying it, the ball once the
    // wall is down (see `revealSecret`).
    { x: 17, y: 26, tile: BREAKABLE, name: 'Wall', wall: true, hidden: true },
    { x: 17, y: 28, tile: BALL, name: 'Ball', ball: true, hidden: true },
    { x: 14, y: 17, tile: JUKEBOX, name: 'Jukebox', juke: true },
    { x: 6, y: 5, tile: ARCADE, name: 'Pong', game: '[data-pong]' },
    { x: 4, y: 1, tile: ARCADE, name: 'Flappy', game: '[data-flappy]' },
    { x: 12, y: 1, tile: ARCADE, name: 'Missiles', game: '[data-missiles]' },
    { x: 5, y: 23, tile: ARCADE, name: 'Minesweeper', game: '[data-mines]' },
    { x: 1, y: 5, tile: ARCADE, name: 'Snake', game: '[data-snake]' },
    { x: 1, y: 14, tile: ARCADE, name: 'Bomberman', game: '[data-bomber]' },
    { x: 16, y: 23, tile: ARCADE, name: 'Sneak', game: '[data-sneak]' },
    { x: 31, y: 5, tile: ARCADE, name: 'Climb', game: '[data-climb]' },
    { x: 31, y: 14, tile: ARCADE, name: 'Block Breaker', game: '[data-breaker]' },
    { x: 27, y: 23, tile: ARCADE, name: 'Zero', game: '[data-zero]' },
    { x: 26, y: 5, tile: ARCADE, name: 'Balatro', game: '[data-balatro]' },
    { x: 28, y: 1, tile: ARCADE, name: 'Pikachu', game: '[data-pika]' },
    { x: 8, y: 19, tile: ARCADE, name: 'Tetris', game: '[data-tetris]' },
    { x: 23, y: 19, tile: ARCADE, name: 'Hashi', game: '[data-hashi]' },
    { x: 5, y: 9, tile: ARCADE, name: 'Race', game: '[data-race]' },
    { x: 27, y: 9, tile: ARCADE, name: 'Memory', game: '[data-memory]' },
    ...LEGENDS.map((l) => ({ x: l.x, y: l.y, tile: LEGEND, name: l.name, legend: l })),
  ];

  const grid = LAYOUT.map((row) => [...row].map((ch) => (ch === '#' ? WALL : ch === 'x' ? LOCKED : ch === '%' ? BREAKABLE : ch === 's' ? SECRET : FLOOR)));
  let revealed = false; // whether the secret room is open: until then it is drawn as rock
  const put = (type, cells) => cells.forEach(([x, y]) => { grid[y][x] = type; });
  const rect = (x0, y0, w, h) => {
    const cells = [];
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) cells.push([x, y]);
    return cells;
  };
  put(CRACK, CRACKS);
  put(CARD, CARDS);
  put(POT, POTS);
  put(COURT, rect(...COURT_AT));
  put(SKY, rect(...SKY_AT));
  put(FIELD, rect(...FIELD_AT));
  put(ARENA, rect(...ARENA_AT));
  put(STAIRS, [[9, 9]]);
  put(RUG, rect(10, 12, 5, 3));
  put(SHELF, [[10, 9], [15, 9]]);
  put(DESK, [[14, 9]]);
  put(CHAIR, [[11, 13], [13, 13]]);
  put(PLANT, [[9, 17], [15, 17], [23, 17]]);
  put(WATER, rect(17, 19, 3, 3));
  put(BRIDGE_H, [[18, 19], [18, 21]]);
  put(BRIDGE_V, [[17, 20], [19, 20]]);
  put(ISLAND, Object.keys(ISLANDS).map((k) => k.split(',').map(Number)));
  const blockColor = new Map();
  Object.entries(BLOCKS).forEach(([id, cells]) => {
    put(BLOCK, cells);
    cells.forEach(([x, y]) => blockColor.set(`${x},${y}`, BLOCK_COLORS[id]));
  });
  THINGS.forEach((t) => { grid[t.y][t.x] = t.tile; });
  const thingAt = (x, y) => THINGS.find((t) => t.x === x && t.y === y);

  /* ---------- Tile art ---------- */

  const floor = (c, px, py, x, y) => {
    c.fillStyle = (x + y) % 2 ? '#7d5c3a' : '#775736';
    c.fillRect(px, py, TILE, TILE);
    c.fillStyle = 'rgba(0, 0, 0, .12)';
    c.fillRect(px, py + TILE - 1, TILE, 1);
    c.fillRect(px + TILE - 1, py, 1, TILE);
  };

  // Walls show their bricks where they face a room; rock further in stays dark,
  // so the shapes of the rooms stand out.
  const secretTile = (t) => t === SECRET || t === BALL;
  const facesRoom = (x, y) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const t = grid[y + dy]?.[x + dx];
        if (t !== undefined && t !== WALL && t !== BREAKABLE && !(secretTile(t) && !revealed)) return true;
      }
    }
    return false;
  };

  const rock = (c, px, py, x, y) => {
    c.fillStyle = '#1c1006';
    c.fillRect(px, py, TILE, TILE);
    c.fillStyle = '#2b1a08';
    if ((x * 7 + y * 3) % 4 === 0) c.fillRect(px + 4, py + 5, 2, 1);
    if ((x * 5 + y * 11) % 5 === 0) c.fillRect(px + 10, py + 11, 3, 1);
  };

  const wall = (c, px, py, x, y) => {
    if (!facesRoom(x, y)) {
      rock(c, px, py, x, y);
      return;
    }
    c.fillStyle = '#2b1a08';
    c.fillRect(px, py, TILE, TILE);
    const brick = (bx, by, bw) => {
      c.fillStyle = '#4b2e0f';
      c.fillRect(bx, by, bw, 6);
      c.fillStyle = '#5e3d1a';
      c.fillRect(bx, by, bw, 1);
    };
    brick(px + 1, py + 1, 6);
    brick(px + 9, py + 1, 6);
    brick(px, py + 9, 3);
    brick(px + 5, py + 9, 6);
    brick(px + 13, py + 9, 3);
  };

  // The boss room's floor: dark flagstones, each edged with light on two sides.
  const arena = (c, px, py, x, y) => {
    c.fillStyle = (x + y) % 2 ? '#3b3546' : '#353040';
    c.fillRect(px, py, TILE, TILE);
    c.fillStyle = 'rgba(255, 242, 225, .05)';
    c.fillRect(px, py, TILE, 1);
    c.fillRect(px, py, 1, TILE);
    c.fillStyle = 'rgba(0, 0, 0, .22)';
    c.fillRect(px, py + TILE - 1, TILE, 1);
    c.fillRect(px + TILE - 1, py, 1, TILE);
    if ((x * 3 + y * 5) % 7 === 0) { // a chipped stone here and there
      c.fillStyle = '#2b2634';
      c.fillRect(px + 4 + (x % 3) * 3, py + 5 + (y % 2) * 4, 2, 1);
    }
  };

  // The ball, 8 x 8: red above, cream below, a dark band between with its button.
  const ball = (c, px, py) => {
    c.fillStyle = 'rgba(0, 0, 0, .22)';
    c.fillRect(px, py + 7, 8, 2);
    c.fillStyle = '#2b1a08';
    c.fillRect(px + 2, py, 4, 1);
    c.fillRect(px + 1, py + 1, 1, 1);
    c.fillRect(px + 6, py + 1, 1, 1);
    c.fillRect(px, py + 2, 1, 4);
    c.fillRect(px + 7, py + 2, 1, 4);
    c.fillRect(px + 1, py + 6, 1, 1);
    c.fillRect(px + 6, py + 6, 1, 1);
    c.fillRect(px + 2, py + 7, 4, 1);
    c.fillStyle = '#d9745a';
    c.fillRect(px + 2, py + 1, 4, 1);
    c.fillRect(px + 1, py + 2, 6, 1);
    c.fillStyle = '#fff2e1';
    c.fillRect(px + 1, py + 4, 6, 2);
    c.fillRect(px + 2, py + 6, 4, 1);
    c.fillRect(px + 2, py + 1, 1, 1); // a glint
    c.fillStyle = '#2b1a08';
    c.fillRect(px + 1, py + 3, 6, 1);
    c.fillStyle = '#fffaf2';
    c.fillRect(px + 3, py + 3, 2, 1);
  };

  const water = (c, px, py, x, y) => {
    c.fillStyle = '#4f6f8a';
    c.fillRect(px, py, TILE, TILE);
    c.fillStyle = '#6a8fae';
    if ((x + y) % 2) {
      c.fillRect(px + 2, py + 4, 4, 1);
      c.fillRect(px + 9, py + 11, 4, 1);
    } else {
      c.fillRect(px + 8, py + 3, 4, 1);
      c.fillRect(px + 3, py + 10, 4, 1);
    }
  };

  const pot = (c, px, py) => {
    c.fillStyle = 'rgba(0, 0, 0, .22)';
    c.fillRect(px + 3, py + 14, 10, 2);
    c.fillStyle = '#b48c6a';
    c.fillRect(px + 3, py + 6, 10, 8);
    c.fillRect(px + 4, py + 5, 8, 1);
    c.fillRect(px + 4, py + 14, 8, 1);
    c.fillStyle = '#4b2e0f';
    c.fillRect(px + 5, py + 3, 6, 2);
    c.fillRect(px + 4, py + 5, 8, 1);
    c.fillStyle = '#d2ad8a';
    c.fillRect(px + 5, py + 7, 2, 4);
  };

  // A wooden desk top with its front edge; the computer and papers sit on it.
  const desk = (c, px, py) => {
    c.fillStyle = 'rgba(0, 0, 0, .2)';
    c.fillRect(px + 1, py + 14, 14, 2);
    c.fillStyle = '#8b5a2b';
    c.fillRect(px, py + 5, TILE, 8);
    c.fillStyle = '#6b4420';
    c.fillRect(px, py + 13, TILE, 2);
    c.fillStyle = '#a06a35';
    c.fillRect(px, py + 5, TILE, 1);
  };

  // Each arcade cabinet shows a different screen.
  const SCREENS = {
    Tetris: (c, px, py) => {
      c.fillStyle = '#1a1030';
      c.fillRect(px + 4, py + 3, 8, 6);
      [['#D9745A', 4, 7], ['#D9745A', 5, 7], ['#F4C15D', 7, 7], ['#F4C15D', 8, 7], ['#8FB8C4', 10, 4], ['#8FB8C4', 10, 5], ['#8FB8C4', 10, 6], ['#8FB8C4', 10, 7], ['#B48CB0', 6, 5], ['#B48CB0', 5, 6], ['#B48CB0', 6, 6], ['#B48CB0', 7, 6]]
        .forEach(([col, x, y]) => { c.fillStyle = col; c.fillRect(px + x, py + y, 1, 1); });
    },
    Balatro: (c, px, py) => {
      c.fillStyle = '#2f6b45';
      c.fillRect(px + 4, py + 3, 8, 6);
      c.fillStyle = '#fffaf2';
      c.fillRect(px + 5, py + 4, 3, 4);
      c.fillRect(px + 9, py + 4, 3, 4);
      c.fillStyle = '#c0392b';
      c.fillRect(px + 6, py + 5, 1, 2);
      c.fillStyle = '#2b1a08';
      c.fillRect(px + 10, py + 5, 1, 2);
    },
    Hashi: (c, px, py) => {
      c.fillStyle = '#4f6f8a';
      c.fillRect(px + 4, py + 3, 8, 6);
      c.fillStyle = '#e2a963';
      c.fillRect(px + 6, py + 5, 5, 1);
      c.fillStyle = '#a8b89c';
      c.fillRect(px + 5, py + 4, 2, 3);
      c.fillRect(px + 10, py + 4, 2, 3);
    },
    Pong: (c, px, py) => {
      c.fillStyle = '#1a1030';
      c.fillRect(px + 4, py + 3, 8, 6);
      c.fillStyle = '#fffaf2';
      c.fillRect(px + 4, py + 4, 1, 3); // paddles
      c.fillRect(px + 11, py + 5, 1, 3);
      c.fillStyle = '#f4c15d';
      c.fillRect(px + 8, py + 5, 1, 1); // ball
    },
    Flappy: (c, px, py) => {
      c.fillStyle = '#8fb8c4';
      c.fillRect(px + 4, py + 3, 8, 6);
      c.fillStyle = '#5c7a5e';
      c.fillRect(px + 10, py + 3, 2, 2); // pipes
      c.fillRect(px + 10, py + 7, 2, 2);
      c.fillStyle = '#f4c15d';
      c.fillRect(px + 6, py + 5, 2, 1); // bird
      c.fillStyle = '#d9745a';
      c.fillRect(px + 8, py + 5, 1, 1);
    },
    Missiles: (c, px, py) => {
      c.fillStyle = '#8db07e';
      c.fillRect(px + 4, py + 3, 8, 6);
      c.fillStyle = '#d9745a';
      c.fillRect(px + 8, py + 4, 1, 3); // the plane
      c.fillRect(px + 7, py + 5, 3, 1);
      c.fillStyle = '#c9b899';
      c.fillRect(px + 5, py + 7, 2, 1); // a missile on its tail
      c.fillStyle = '#f4c15d';
      c.fillRect(px + 11, py + 4, 1, 1); // a star
    },
    Snake: (c, px, py) => {
      c.fillStyle = '#34503c';
      c.fillRect(px + 4, py + 3, 8, 6);
      c.fillStyle = '#8db07e';
      c.fillRect(px + 5, py + 7, 4, 1); // the snake
      c.fillRect(px + 8, py + 5, 1, 3);
      c.fillStyle = '#b8d2a8';
      c.fillRect(px + 8, py + 4, 1, 1); // its head
      c.fillStyle = '#d9745a';
      c.fillRect(px + 10, py + 4, 1, 1); // the apple
    },
    Minesweeper: (c, px, py) => {
      c.fillStyle = '#e8d6bd';
      c.fillRect(px + 4, py + 3, 8, 6); // closed cells
      c.fillStyle = '#c9b899';
      c.fillRect(px + 8, py + 3, 1, 6); // the lines between them
      c.fillRect(px + 4, py + 6, 8, 1);
      c.fillStyle = '#fff2e1';
      c.fillRect(px + 4, py + 3, 4, 3); // one dug up
      c.fillStyle = '#6f8fc0';
      c.fillRect(px + 5, py + 4, 2, 1); // its number
      c.fillStyle = '#d9745a';
      c.fillRect(px + 9, py + 3, 2, 2); // a flag
      c.fillStyle = '#2b1a08';
      c.fillRect(px + 11, py + 3, 1, 3);
      c.fillRect(px + 5, py + 7, 2, 2); // a mine
    },
    Sneak: (c, px, py) => {
      c.fillStyle = '#2a2e3d';
      c.fillRect(px + 4, py + 3, 8, 6); // a dark room
      c.fillStyle = 'rgba(244, 193, 93, .45)';
      c.fillRect(px + 8, py + 5, 1, 2); // the lantern's cone
      c.fillRect(px + 9, py + 4, 3, 4);
      c.fillStyle = '#9aa5b5';
      c.fillRect(px + 7, py + 5, 1, 2); // the guard
      c.fillStyle = '#3b2f5e';
      c.fillRect(px + 5, py + 6, 1, 2); // the thief, in the dark
      c.fillStyle = '#8fb8c4';
      c.fillRect(px + 5, py + 4, 1, 1); // the gem
    },
    Climb: (c, px, py) => {
      c.fillStyle = '#1e2130';
      c.fillRect(px + 4, py + 3, 8, 6); // the tower shaft
      c.fillStyle = '#d9745a';
      c.fillRect(px + 4, py + 8, 8, 1); // the lava
      c.fillStyle = '#9aa5b5';
      c.fillRect(px + 4, py + 7, 3, 1); // the ledges
      c.fillRect(px + 9, py + 6, 3, 1);
      c.fillRect(px + 5, py + 4, 3, 1);
      c.fillStyle = '#d9745a';
      c.fillRect(px + 10, py + 4, 1, 1); // the climber's hat
      c.fillStyle = '#6f8fc0';
      c.fillRect(px + 10, py + 5, 1, 1); // and jacket
    },
    Bomberman: (c, px, py) => {
      c.fillStyle = '#5c7a5e';
      c.fillRect(px + 4, py + 3, 8, 6); // the arena
      c.fillStyle = '#9aa5b5';
      c.fillRect(px + 5, py + 4, 1, 1); // the pillars
      c.fillRect(px + 7, py + 4, 1, 1);
      c.fillRect(px + 5, py + 6, 1, 1);
      c.fillRect(px + 7, py + 6, 1, 1);
      c.fillStyle = '#b48c6a';
      c.fillRect(px + 10, py + 3, 2, 2); // bricks
      c.fillRect(px + 4, py + 7, 2, 2);
      c.fillStyle = '#f4c15d';
      c.fillRect(px + 9, py + 5, 3, 1); // the blast
      c.fillRect(px + 10, py + 4, 1, 3);
      c.fillStyle = '#2b1a08';
      c.fillRect(px + 6, py + 7, 2, 2); // the bomb
    },
    'Block Breaker': (c, px, py) => {
      c.fillStyle = '#1e2130';
      c.fillRect(px + 4, py + 3, 8, 6);
      [['#d9745a', 4, 3], ['#f4c15d', 6, 3], ['#8db07e', 8, 3], ['#6f8fc0', 10, 3], ['#f4c15d', 4, 4], ['#8db07e', 6, 4], ['#6f8fc0', 10, 4]]
        .forEach(([col, x, y]) => { c.fillStyle = col; c.fillRect(px + x, py + y, 2, 1); }); // the bricks, one gone
      c.fillStyle = '#fffaf2';
      c.fillRect(px + 8, py + 6, 1, 1); // the ball
      c.fillStyle = '#8fb8c4';
      c.fillRect(px + 6, py + 8, 4, 1); // the paddle
    },
    Zero: (c, px, py) => {
      c.fillStyle = '#0f1020';
      c.fillRect(px + 4, py + 3, 8, 6); // the night highway
      c.fillStyle = '#3b3f52';
      c.fillRect(px + 4, py + 8, 8, 1); // the road
      c.fillStyle = '#d8343f';
      c.fillRect(px + 6, py + 4, 2, 4); // Zero, in red
      c.fillStyle = '#f7dd7f';
      c.fillRect(px + 5, py + 5, 1, 3); // his hair
      c.fillStyle = '#78f08a';
      c.fillRect(px + 9, py + 4, 1, 1); // the saber's arc
      c.fillRect(px + 10, py + 5, 1, 2);
      c.fillRect(px + 9, py + 7, 1, 1);
    },
    Pikachu: (c, px, py) => {
      c.fillStyle = '#1a1030';
      c.fillRect(px + 4, py + 3, 8, 6);
      [['#8db07e', 5, 4], ['#f4c15d', 8, 4], ['#d9745a', 5, 7], ['#8db07e', 8, 7]]
        .forEach(([col, x, y]) => { c.fillStyle = col; c.fillRect(px + x, py + y, 2, 1); });
      c.fillStyle = '#fffaf2';
      c.fillRect(px + 10, py + 4, 1, 4); // the line joining the two green tiles
      c.fillRect(px + 7, py + 4, 3, 1);
      c.fillRect(px + 10, py + 7, 1, 1);
    },
    Race: (c, px, py) => {
      c.fillStyle = '#8fb8c4';
      c.fillRect(px + 4, py + 3, 8, 2); // the sky
      c.fillStyle = '#5c7a5e';
      c.fillRect(px + 4, py + 5, 8, 4); // the grass
      c.fillStyle = '#6b7585';
      c.fillRect(px + 7, py + 5, 2, 1); // the road, widening towards us
      c.fillRect(px + 6, py + 6, 4, 1);
      c.fillRect(px + 5, py + 7, 6, 2);
      c.fillStyle = '#fffaf2';
      c.fillRect(px + 8, py + 7, 1, 1); // the centre line
      c.fillStyle = '#d9745a';
      c.fillRect(px + 7, py + 8, 3, 1); // the car
      c.fillRect(px + 8, py + 7, 1, 1);
    },
    Memory: (c, px, py) => {
      c.fillStyle = '#1a1030';
      c.fillRect(px + 4, py + 3, 8, 6);
      [[5, 4], [8, 4], [5, 7]].forEach(([x, y]) => { // cards face down
        c.fillStyle = '#5e4a86';
        c.fillRect(px + x, py + y, 2, 2);
      });
      c.fillStyle = '#fffaf2';
      c.fillRect(px + 8, py + 7, 2, 2); // one turned up
      c.fillStyle = '#f4c15d';
      c.fillRect(px + 8, py + 7, 1, 1);
      c.fillRect(px + 9, py + 8, 1, 1);
    },
  };

  const TILES = {
    [FLOOR]: floor,
    [WALL]: wall,
    [WATER]: water,
    [POT]: (c, px, py, x, y) => floor(c, px, py, x, y), // the pot is drawn later, sorted with the hero
    [CRACK]: (c, px, py, x, y) => {
      floor(c, px, py, x, y);
      c.fillStyle = '#4b2e0f';
      const pts = [[3, 4], [4, 5], [5, 5], [6, 6], [7, 8], [8, 9], [9, 9], [10, 11]];
      pts.forEach(([dx, dy]) => c.fillRect(px + ((x + y) % 2 ? TILE - 1 - dx : dx), py + dy, 1, 1));
    },
    [RUG]: (c, px, py, x, y) => {
      c.fillStyle = '#a44a3a';
      c.fillRect(px, py, TILE, TILE);
      c.fillStyle = '#c96a52';
      c.fillRect(px + 6, py + 6, 4, 4);
      c.fillStyle = '#f4c15d';
      const rugLike = (t) => t === RUG || t === BOOK || t === CHAIR;
      if (!rugLike(grid[y - 1][x])) c.fillRect(px, py, TILE, 1);
      if (!rugLike(grid[y + 1][x])) c.fillRect(px, py + TILE - 1, TILE, 1);
      if (!rugLike(grid[y][x - 1])) c.fillRect(px, py, 1, TILE);
      if (!rugLike(grid[y][x + 1])) c.fillRect(px + TILE - 1, py, 1, TILE);
    },
    [COURT]: (c, px, py) => {
      c.fillStyle = '#34503c';
      c.fillRect(px, py, TILE, TILE);
    },
    [SKY]: (c, px, py) => {
      c.fillStyle = '#8fb8c4';
      c.fillRect(px, py, TILE, TILE);
    },
    [FIELD]: (c, px, py) => {
      c.fillStyle = '#c9b899';
      c.fillRect(px, py, TILE, TILE);
      c.fillStyle = '#e8d6bd';
      c.fillRect(px + 1, py + 1, 14, 14); // a closed cell, raised
      c.fillStyle = '#fffaf2';
      c.fillRect(px + 1, py + 1, 14, 2);
      c.fillRect(px + 1, py + 1, 2, 14);
      c.fillStyle = '#b8a78c';
      c.fillRect(px + 1, py + 13, 14, 2);
      c.fillRect(px + 13, py + 1, 2, 14);
    },
    [ARENA]: arena,
    [LEGEND]: arena,
    [BREAKABLE]: (c, px, py, x, y) => { // a wall like any other, but split by a jagged crack
      wall(c, px, py, x, y);
      const dark = (dx, dy, w, h) => { c.fillStyle = '#1c1006'; c.fillRect(px + dx, py + dy, w, h); };
      const chip = (dx, dy, w, h) => { c.fillStyle = '#8b5a2b'; c.fillRect(px + dx, py + dy, w, h); };
      // the fissure, top to bottom, with light chipped edges beside it
      dark(6, 0, 2, 3); chip(8, 1, 1, 2);
      dark(7, 3, 2, 2); chip(6, 3, 1, 1);
      dark(8, 5, 3, 2); chip(7, 6, 1, 1); chip(11, 5, 1, 1);
      dark(9, 7, 2, 2); dark(5, 8, 4, 1); chip(4, 8, 1, 1);
      dark(8, 9, 2, 2); chip(10, 10, 1, 1);
      dark(7, 11, 2, 3); chip(9, 12, 1, 1);
      dark(6, 14, 3, 2); dark(10, 13, 2, 1);
      // a branch off to the right, and bricks missing their corners
      dark(10, 6, 3, 1); dark(13, 5, 1, 2);
      dark(1, 1, 1, 1); dark(14, 10, 1, 1); dark(2, 14, 2, 1);
    },
    [SECRET]: (c, px, py, x, y) => (revealed ? floor(c, px, py, x, y) : rock(c, px, py, x, y)),
    [BALL]: (c, px, py, x, y) => {
      if (!revealed) {
        rock(c, px, py, x, y);
        return;
      }
      floor(c, px, py, x, y);
      ball(c, px + 4, py + 4);
    },
    [STAIRS]: (c, px, py) => {
      c.fillStyle = '#1c1006';
      c.fillRect(px, py, TILE, TILE);
      ['#5a3a1a', '#47300f', '#33210a'].forEach((col, i) => {
        c.fillStyle = col;
        c.fillRect(px + 2, py + 2 + i * 3, 12, 3);
      });
    },
    [ISLAND]: (c, px, py, x, y) => {
      water(c, px, py, x, y);
      c.fillStyle = '#3d250c';
      c.beginPath();
      c.arc(px + 8, py + 8, 6.5, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#a8b89c';
      c.beginPath();
      c.arc(px + 8, py + 8, 5.5, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#3d250c';
      c.font = 'bold 8px "JetBrains Mono", monospace';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(String(ISLANDS[`${x},${y}`]), px + 8, py + 8.5);
    },
    [BRIDGE_H]: (c, px, py, x, y) => {
      water(c, px, py, x, y);
      c.fillStyle = '#e2a963';
      c.fillRect(px, py + 6, TILE, 4);
      c.fillStyle = '#b8823e';
      c.fillRect(px, py + 6, TILE, 1);
      c.fillRect(px, py + 9, TILE, 1);
    },
    [BRIDGE_V]: (c, px, py, x, y) => {
      water(c, px, py, x, y);
      c.fillStyle = '#e2a963';
      c.fillRect(px + 6, py, 4, TILE);
      c.fillStyle = '#b8823e';
      c.fillRect(px + 6, py, 1, TILE);
      c.fillRect(px + 9, py, 1, TILE);
    },
    [CARD]: (c, px, py, x, y) => {
      floor(c, px, py, x, y);
      const red = (x + y) % 2;
      c.fillStyle = '#3d250c';
      c.fillRect(px + 3, py + 2, 10, 13);
      c.fillStyle = '#fffaf2';
      c.fillRect(px + 4, py + 3, 8, 11);
      c.fillStyle = red ? '#c0392b' : '#2b1a08';
      c.fillRect(px + 7, py + 7, 2, 2);
      c.fillRect(px + 6, py + 8, 4, 1);
      if (!red) c.fillRect(px + 7, py + 10, 2, 1);
      else c.fillRect(px + 7, py + 6, 2, 1);
      c.fillRect(px + 5, py + 4, 1, 2);
      c.fillRect(px + 10, py + 11, 1, 2);
    },
    [BLOCK]: (c, px, py, x, y) => {
      floor(c, px, py, x, y);
      c.fillStyle = blockColor.get(`${x},${y}`);
      c.fillRect(px + 1, py + 1, 14, 14);
      c.fillStyle = 'rgba(255, 255, 255, .25)';
      c.fillRect(px + 3, py + 2, 10, 2);
      c.fillStyle = 'rgba(0, 0, 0, .18)';
      c.fillRect(px + 1, py + 13, 14, 2);
    },
    [ARCADE]: (c, px, py, x, y) => {
      floor(c, px, py, x, y);
      c.fillStyle = 'rgba(0, 0, 0, .22)';
      c.fillRect(px + 2, py + 14, 12, 2);
      c.fillStyle = '#2b1a08';
      c.fillRect(px + 2, py, 12, 15);
      c.fillStyle = '#3b2f5e';
      c.fillRect(px + 3, py + 1, 10, 13);
      c.fillStyle = '#e2a963';
      c.fillRect(px + 3, py + 1, 10, 1); // marquee
      SCREENS[thingAt(x, y).name](c, px, py);
      c.fillStyle = '#5e4a86';
      c.fillRect(px + 3, py + 10, 10, 3); // control panel
      c.fillStyle = '#2b1a08';
      c.fillRect(px + 5, py + 10, 1, 2); // joystick
      c.fillStyle = '#d9745a';
      c.fillRect(px + 8, py + 11, 2, 1);
      c.fillStyle = '#f4c15d';
      c.fillRect(px + 11, py + 11, 2, 1);
    },
    [COMPUTER]: (c, px, py, x, y) => {
      floor(c, px, py, x, y);
      desk(c, px, py);
      c.fillStyle = '#3d3d3d';
      c.fillRect(px + 3, py, 10, 8); // monitor
      c.fillStyle = '#5b8ac7';
      c.fillRect(px + 4, py + 1, 8, 6);
      c.fillStyle = '#cfe3ff';
      c.fillRect(px + 5, py + 2, 5, 1);
      c.fillRect(px + 5, py + 4, 3, 1);
      c.fillStyle = '#3d3d3d';
      c.fillRect(px + 7, py + 8, 2, 1); // stand
      c.fillStyle = '#d8d0c0';
      c.fillRect(px + 4, py + 10, 8, 2); // keyboard
    },
    [DESK]: (c, px, py, x, y) => {
      floor(c, px, py, x, y);
      desk(c, px, py);
      c.fillStyle = '#fffaf2';
      c.fillRect(px + 2, py + 6, 6, 6); // papers
      c.fillStyle = '#9a8a78';
      c.fillRect(px + 3, py + 7, 4, 1);
      c.fillRect(px + 3, py + 9, 3, 1);
      c.fillStyle = '#c0392b';
      c.fillRect(px + 10, py + 7, 4, 4); // mug
      c.fillStyle = '#e06a5a';
      c.fillRect(px + 14, py + 8, 1, 2);
    },
    [BOOK]: (c, px, py, x, y) => {
      TILES[RUG](c, px, py, x, y);
      c.fillStyle = 'rgba(0, 0, 0, .2)';
      c.fillRect(px + 2, py + 13, 12, 2);
      c.fillStyle = '#a8743f';
      c.fillRect(px + 1, py + 3, 14, 10); // table top
      c.fillStyle = '#7c5228';
      c.fillRect(px + 1, py + 12, 14, 1);
      c.fillStyle = '#c0392b';
      c.fillRect(px + 3, py + 4, 10, 7); // book cover
      c.fillStyle = '#fffaf2';
      c.fillRect(px + 4, py + 5, 4, 5); // open pages
      c.fillRect(px + 9, py + 5, 3, 5);
      c.fillStyle = '#9a8a78';
      c.fillRect(px + 5, py + 6, 2, 1);
      c.fillRect(px + 5, py + 8, 2, 1);
      c.fillRect(px + 10, py + 6, 1, 1);
      c.fillRect(px + 10, py + 8, 1, 1);
    },
    [CHAIR]: (c, px, py, x, y) => {
      TILES[RUG](c, px, py, x, y);
      c.fillStyle = '#6b4420';
      c.fillRect(px + 4, py + 2, 8, 4); // back
      c.fillStyle = '#8b5a2b';
      c.fillRect(px + 4, py + 6, 8, 6); // seat
      c.fillStyle = '#4b2e0f';
      c.fillRect(px + 4, py + 12, 2, 2); // legs
      c.fillRect(px + 10, py + 12, 2, 2);
    },
    [SHELF]: (c, px, py) => {
      c.fillStyle = '#4b2e0f';
      c.fillRect(px, py, TILE, TILE);
      c.fillStyle = '#3a230b';
      c.fillRect(px + 1, py + 1, 14, 6);
      c.fillRect(px + 1, py + 9, 14, 6);
      const spines = ['#c0392b', '#5c7a5e', '#e2a963', '#6f8fc0', '#b48cb0', '#f4c15d', '#8db07e'];
      for (let i = 0; i < 6; i++) {
        c.fillStyle = spines[i % spines.length];
        c.fillRect(px + 2 + i * 2, py + 2 + (i % 2), 2, 5 - (i % 2));
        c.fillStyle = spines[(i + 3) % spines.length];
        c.fillRect(px + 2 + i * 2, py + 10 + ((i + 1) % 2), 2, 5 - ((i + 1) % 2));
      }
    },
    [JUKEBOX]: (c, px, py, x, y) => {
      floor(c, px, py, x, y);
      c.fillStyle = 'rgba(0, 0, 0, .22)';
      c.fillRect(px + 2, py + 14, 12, 2);
      c.fillStyle = '#2b1a08';
      c.fillRect(px + 3, py + 1, 10, 14); // outline, rounded at the top
      c.fillRect(px + 4, py, 8, 1);
      c.fillStyle = '#a44a3a';
      c.fillRect(px + 4, py + 1, 8, 13); // body
      c.fillStyle = '#e2a963';
      c.fillRect(px + 5, py + 1, 6, 1); // the arch of lights
      c.fillRect(px + 4, py + 2, 1, 4);
      c.fillRect(px + 11, py + 2, 1, 4);
      c.fillStyle = '#8fb8c4';
      c.fillRect(px + 6, py + 2, 4, 3); // window
      c.fillStyle = '#fffaf2';
      c.fillRect(px + 7, py + 3, 1, 1);
      c.fillStyle = '#2b1a08';
      c.fillRect(px + 5, py + 9, 6, 4); // speaker grille
      c.fillStyle = '#5e4a86';
      c.fillRect(px + 5, py + 10, 6, 1);
      c.fillRect(px + 5, py + 12, 6, 1);
      c.fillStyle = '#4b2e0f';
      c.fillRect(px + 4, py + 13, 8, 1); // base
    },
    [LOCKED]: (c, px, py, x, y) => {
      c.fillStyle = '#2b1a08';
      c.fillRect(px, py, TILE, TILE);
      c.fillStyle = '#6b4420';
      c.fillRect(px + 2, py + 1, 12, 14); // planks
      c.fillStyle = '#8b5a2b';
      c.fillRect(px + 5, py + 1, 1, 14);
      c.fillRect(px + 10, py + 1, 1, 14);
      c.fillStyle = '#9a8a78';
      c.fillRect(px + 2, py + 4, 12, 1); // iron bands
      c.fillRect(px + 2, py + 11, 12, 1);
      c.fillStyle = '#2b1a08';
      c.fillRect(px + 6, py + 6, 4, 4); // the lock
      c.fillStyle = '#f4c15d';
      c.fillRect(px + 7, py + 7, 2, 1);
      c.fillRect(px + 7, py + 8, 1, 1);
    },
    [PLANT]: (c, px, py, x, y) => {
      floor(c, px, py, x, y);
      c.fillStyle = 'rgba(0, 0, 0, .2)';
      c.fillRect(px + 4, py + 14, 8, 2);
      c.fillStyle = '#b48c6a';
      c.fillRect(px + 5, py + 10, 6, 5); // pot
      c.fillStyle = '#4b2e0f';
      c.fillRect(px + 4, py + 9, 8, 1);
      c.fillStyle = '#5c7a5e';
      c.fillRect(px + 6, py + 3, 4, 7);
      c.fillRect(px + 3, py + 5, 4, 3);
      c.fillRect(px + 9, py + 4, 4, 3);
      c.fillStyle = '#8db07e';
      c.fillRect(px + 7, py + 2, 2, 3);
      c.fillRect(px + 4, py + 5, 2, 1);
      c.fillRect(px + 10, py + 4, 2, 1);
    },
  };

  // Everything that never changes is drawn once, then copied each frame.
  const map = document.createElement('canvas');
  map.width = W;
  map.height = H;
  const mctx = map.getContext('2d');
  grid.forEach((row, y) => row.forEach((t, x) => TILES[t](mctx, x * TILE, y * TILE, x, y)));
  DOORS.forEach(([x, y]) => {
    mctx.fillStyle = 'rgba(0, 0, 0, .14)';
    mctx.fillRect(x * TILE, y * TILE, TILE, TILE);
  });
  TORCHES.forEach(([x, y]) => {
    mctx.fillStyle = '#8b5a2b';
    mctx.fillRect(x * TILE + 7, y * TILE + 8, 2, 6);
  });
  // The court's lines, net, paddles and ball, painted over its floor.
  {
    const [x0, y0, w, h] = COURT_AT.map((n) => n * TILE);
    mctx.fillStyle = 'rgba(255, 242, 225, .5)';
    mctx.fillRect(x0 + 2, y0 + 2, w - 4, 1);
    mctx.fillRect(x0 + 2, y0 + h - 3, w - 4, 1);
    mctx.fillRect(x0 + 2, y0 + 2, 1, h - 4);
    mctx.fillRect(x0 + w - 3, y0 + 2, 1, h - 4);
    for (let y = y0 + 5; y < y0 + h - 4; y += 5) mctx.fillRect(x0 + w / 2, y, 1, 3);
    mctx.fillStyle = '#fff2e1';
    mctx.fillRect(x0 + 6, y0 + 12, 2, 12);
    mctx.fillRect(x0 + w - 8, y0 + 22, 2, 12);
    mctx.fillStyle = '#f4c15d';
    mctx.fillRect(x0 + 34, y0 + 18, 3, 3);
  }
  // The Pikachu tiles, and the path over the top of the board joining the two yellow ones.
  {
    const [x0, y0] = BOARD_AT.map((n) => n * TILE);
    BOARD.forEach((row, j) => row.forEach((col, i) => {
      const tx = x0 + i * TILE;
      const ty = y0 + j * TILE;
      mctx.fillStyle = 'rgba(0, 0, 0, .2)';
      mctx.fillRect(tx + 3, ty + 3, 12, 12);
      mctx.fillStyle = '#fffaf2';
      mctx.fillRect(tx + 2, ty + 2, 12, 12);
      mctx.fillStyle = col;
      mctx.fillRect(tx + 4, ty + 4, 8, 8);
      mctx.fillStyle = '#2b1a08';
      mctx.fillRect(tx + 6, ty + 7, 1, 1); // eyes
      mctx.fillRect(tx + 9, ty + 7, 1, 1);
    }));
    mctx.fillStyle = '#f4c15d';
    mctx.fillRect(x0 + TILE + 7, y0 - 4, 2, 6);
    mctx.fillRect(x0 + TILE + 7, y0 - 4, 2 * TILE + 2, 2);
    mctx.fillRect(x0 + 3 * TILE + 7, y0 - 4, 2, 6);
  }
  // The Flappy room's floor painting: a strip of sky with two pipes and the bird between them.
  {
    const [x0, y0, w, h] = SKY_AT.map((n) => n * TILE);
    mctx.fillStyle = '#8db07e';
    mctx.fillRect(x0, y0 + h - 4, w, 2); // grass
    mctx.fillStyle = '#7d5c3a';
    mctx.fillRect(x0, y0 + h - 2, w, 2);
    mctx.fillStyle = 'rgba(255, 250, 242, .8)'; // a cloud
    mctx.fillRect(x0 + 3, y0 + 4, 9, 2);
    mctx.fillRect(x0 + 5, y0 + 2, 5, 2);
    [[x0 + 14, 10], [x0 + 46, 5]].forEach(([x, gapTop]) => {
      const gapBot = gapTop + 11;
      mctx.fillStyle = '#5c7a5e';
      mctx.fillRect(x, y0, 7, gapTop);
      mctx.fillRect(x, y0 + gapBot, 7, h - 4 - gapBot);
      mctx.fillRect(x - 1, y0 + gapTop - 2, 9, 2); // the lips
      mctx.fillRect(x - 1, y0 + gapBot, 9, 2);
      mctx.fillStyle = '#8db07e';
      mctx.fillRect(x + 1, y0, 2, gapTop - 2);
      mctx.fillRect(x + 1, y0 + gapBot + 2, 2, h - 6 - gapBot);
    });
    mctx.fillStyle = '#f4c15d'; // the bird
    mctx.fillRect(x0 + 30, y0 + 11, 5, 4);
    mctx.fillStyle = '#e2a963';
    mctx.fillRect(x0 + 29, y0 + 13, 3, 1);
    mctx.fillStyle = '#d9745a';
    mctx.fillRect(x0 + 35, y0 + 13, 2, 1);
    mctx.fillStyle = '#2b1a08';
    mctx.fillRect(x0 + 33, y0 + 11, 1, 1);
  }
  // The Minesweeper room's floor painting: a few cells dug up, with their numbers, and one flagged.
  {
    mctx.font = 'bold 9px "JetBrains Mono", monospace';
    mctx.textAlign = 'center';
    mctx.textBaseline = 'middle';
    Object.entries(FIELD_OPEN).forEach(([key, n]) => {
      const [x, y] = key.split(',').map((v) => v * TILE);
      mctx.fillStyle = '#fff2e1';
      mctx.fillRect(x + 1, y + 1, 14, 14);
      if (!n) return;
      mctx.fillStyle = '#6f8fc0';
      mctx.fillText(String(n), x + 8, y + 9);
    });
    const [fx, fy] = FIELD_FLAG.map((v) => v * TILE);
    mctx.fillStyle = '#2b1a08';
    mctx.fillRect(fx + 8, fy + 4, 1, 8); // pole
    mctx.fillRect(fx + 5, fy + 11, 6, 1); // base
    mctx.fillStyle = '#d9745a';
    mctx.fillRect(fx + 4, fy + 4, 4, 3); // the flag
    mctx.fillRect(fx + 5, fy + 7, 3, 1);
  }
  // The Snake room's floor painting: the snake's body joined up segment by segment, then its head and the apple.
  {
    const box = ([x, y]) => [x * TILE + 3, y * TILE + 3];
    mctx.fillStyle = '#5c7a5e';
    SNAKE_PATH.forEach((cell, i) => {
      const [bx, by] = box(cell);
      mctx.fillRect(bx, by, 10, 10);
      const next = SNAKE_PATH[i + 1];
      if (!next) return;
      const [nx, ny] = box(next);
      mctx.fillRect(Math.min(bx, nx), Math.min(by, ny), Math.abs(nx - bx) + 10, Math.abs(ny - by) + 10);
    });
    mctx.fillStyle = '#8db07e';
    SNAKE_PATH.forEach((cell, i) => {
      const [bx, by] = box(cell);
      mctx.fillRect(bx + 1, by + 1, 8, 8);
      const next = SNAKE_PATH[i + 1];
      if (!next) return;
      const [nx, ny] = box(next);
      mctx.fillRect(Math.min(bx, nx) + 1, Math.min(by, ny) + 1, Math.abs(nx - bx) + 8, Math.abs(ny - by) + 8);
    });
    const [hx, hy] = box(SNAKE_PATH[0]);
    mctx.fillStyle = '#b8d2a8';
    mctx.fillRect(hx + 1, hy + 1, 8, 8); // the head, looking down at the apple
    mctx.fillStyle = '#2b1a08';
    mctx.fillRect(hx + 2, hy + 6, 2, 2);
    mctx.fillRect(hx + 6, hy + 6, 2, 2);
    const [ax, ay] = SNAKE_APPLE.map((n) => n * TILE);
    mctx.fillStyle = '#d9745a';
    mctx.fillRect(ax + 5, ay + 5, 6, 6);
    mctx.fillRect(ax + 4, ay + 6, 8, 4);
    mctx.fillStyle = '#8db07e';
    mctx.fillRect(ax + 8, ay + 3, 3, 2); // the leaf
    mctx.fillStyle = '#fff2e1';
    mctx.fillRect(ax + 6, ay + 6, 1, 1);
  }
  // The Missiles room's floor painting: a little red plane with a missile and its smoke trail behind it.
  {
    const [px, py] = PLANE_AT.map((n) => Math.round(n * TILE));
    mctx.fillStyle = '#2b1a08';
    mctx.fillRect(px - 2, py - 1, 11, 5); // outline of the fuselage
    mctx.fillRect(px + 1, py - 6, 5, 15); // and of the wings
    mctx.fillRect(px - 3, py - 3, 4, 9); // and of the tail
    mctx.fillStyle = '#d9745a';
    mctx.fillRect(px - 1, py, 9, 3);
    mctx.fillRect(px + 2, py - 5, 3, 13);
    mctx.fillRect(px - 2, py - 2, 2, 7);
    mctx.fillStyle = '#fff2e1';
    mctx.fillRect(px + 4, py + 1, 1, 1); // the cockpit
    mctx.fillStyle = '#2b1a08';
    mctx.fillRect(px + 9, py - 1, 1, 5); // the propeller
    const [mx, my] = MISSILE_AT.map((n) => Math.round(n * TILE));
    mctx.fillStyle = 'rgba(255, 250, 242, .6)'; // smoke
    [[-6, 1], [-10, 2], [-14, 1]].forEach(([dx, dy], i) => mctx.fillRect(mx + dx - i, my + dy, 2 + i, 2 + i));
    mctx.fillStyle = '#2b1a08';
    mctx.fillRect(mx - 2, my - 1, 9, 4);
    mctx.fillStyle = '#c9b899';
    mctx.fillRect(mx - 1, my, 6, 2);
    mctx.fillStyle = '#d9745a';
    mctx.fillRect(mx + 5, my, 1, 2); // the tip
    mctx.fillStyle = '#f4c15d';
    mctx.fillRect(mx - 4, my, 2, 2); // the flame
  }
  // The Sneak room's floor painting: a lantern on the floor, the fan of light it throws to the
  // left, and a gem sitting just outside it.
  {
    const [lx, ly] = LANTERN_AT.map((n) => n * TILE);
    const cx = lx + 4;
    const cy = ly + 8;
    mctx.fillStyle = 'rgba(244, 193, 93, .28)';
    mctx.beginPath();
    mctx.moveTo(cx, cy);
    mctx.lineTo(cx - 40, cy - 14);
    mctx.lineTo(cx - 40, cy + 14);
    mctx.closePath();
    mctx.fill();
    mctx.fillStyle = 'rgba(244, 193, 93, .22)';
    mctx.beginPath();
    mctx.moveTo(cx, cy);
    mctx.lineTo(cx - 22, cy - 8);
    mctx.lineTo(cx - 22, cy + 8);
    mctx.closePath();
    mctx.fill();
    mctx.fillStyle = '#2b1a08';
    mctx.fillRect(lx + 3, ly + 3, 7, 10); // the lantern
    mctx.fillRect(lx + 5, ly + 1, 3, 2); // its handle
    mctx.fillStyle = '#f4c15d';
    mctx.fillRect(lx + 4, ly + 4, 5, 8);
    mctx.fillStyle = '#fff2e1';
    mctx.fillRect(lx + 5, ly + 6, 2, 3);
    const [gx, gy] = GEM_AT.map((n) => Math.round(n * TILE));
    mctx.fillStyle = 'rgba(0, 0, 0, .2)';
    mctx.fillRect(gx - 4, gy + 5, 9, 2);
    mctx.fillStyle = '#6f8fc0'; // the gem
    mctx.fillRect(gx - 4, gy - 2, 9, 3);
    mctx.fillRect(gx - 3, gy + 1, 7, 1);
    mctx.fillRect(gx - 2, gy + 2, 5, 1);
    mctx.fillRect(gx - 1, gy + 3, 3, 1);
    mctx.fillRect(gx, gy + 4, 1, 1);
    mctx.fillStyle = '#8fb8c4';
    mctx.fillRect(gx - 3, gy - 2, 7, 2);
    mctx.fillStyle = '#fffaf2';
    mctx.fillRect(gx - 3, gy - 2, 2, 1);
  }
  // The Climb room's floor painting: three stone ledges climbing the floor, the climber on
  // the middle one, a flag planted on the top one and lava along the bottom.
  {
    const [x0, y0] = TOWER_AT.map((n) => n * TILE);
    [[4, 40], [26, 28], [8, 16]].forEach(([dx, dy]) => {
      mctx.fillStyle = 'rgba(0, 0, 0, .2)';
      mctx.fillRect(x0 + dx + 1, y0 + dy + 3, 14, 1);
      mctx.fillStyle = '#6b7585';
      mctx.fillRect(x0 + dx, y0 + dy, 14, 3);
      mctx.fillStyle = '#9aa5b5';
      mctx.fillRect(x0 + dx + 1, y0 + dy, 12, 2);
      mctx.fillStyle = '#c3ccd8';
      mctx.fillRect(x0 + dx + 1, y0 + dy, 12, 1);
    });
    mctx.fillStyle = '#2b1a08';
    mctx.fillRect(x0 + 12, y0 + 7, 1, 9); // the flag's pole
    mctx.fillStyle = '#d9745a';
    mctx.fillRect(x0 + 13, y0 + 7, 4, 3); // and its cloth
    mctx.fillStyle = '#d9745a';
    mctx.fillRect(x0 + 30, y0 + 19, 4, 2); // the climber: hat
    mctx.fillStyle = '#fff2e1';
    mctx.fillRect(x0 + 30, y0 + 21, 4, 2); // face
    mctx.fillStyle = '#2b1a08';
    mctx.fillRect(x0 + 31, y0 + 21, 1, 1); // eyes
    mctx.fillRect(x0 + 33, y0 + 21, 1, 1);
    mctx.fillStyle = '#6f8fc0';
    mctx.fillRect(x0 + 30, y0 + 23, 4, 3); // jacket
    mctx.fillStyle = '#8b5a2b';
    mctx.fillRect(x0 + 29, y0 + 23, 1, 3); // the pack
    mctx.fillStyle = '#2b1a08';
    mctx.fillRect(x0 + 30, y0 + 26, 1, 2); // legs
    mctx.fillRect(x0 + 33, y0 + 26, 1, 2);
    mctx.fillStyle = '#d9745a';
    mctx.fillRect(x0 + 1, y0 + 44, 46, 3); // the lava
    mctx.fillStyle = '#f4c15d';
    [[3, 44], [12, 45], [22, 44], [31, 45], [41, 44]].forEach(([dx, dy]) => mctx.fillRect(x0 + dx, y0 + dy, 3, 1));
  }
  // The Snake room's upper half: a snake coiled into a square spiral, asleep, with apples and grass about.
  {
    const [x0, y0] = COIL_AT.map((n) => n * TILE);
    const spiral = [[0, 0, 28, 6], [22, 0, 6, 28], [0, 22, 28, 6], [0, 6, 6, 22], [6, 6, 16, 6], [16, 6, 6, 12], [6, 12, 10, 6]];
    mctx.fillStyle = 'rgba(0, 0, 0, .18)';
    mctx.fillRect(x0 + 3, y0 + 4, 28, 28);
    mctx.fillStyle = '#5c7a5e';
    spiral.forEach(([dx, dy, w, h]) => mctx.fillRect(x0 + 2 + dx, y0 + 2 + dy, w, h));
    mctx.fillStyle = '#8db07e';
    spiral.forEach(([dx, dy, w, h]) => mctx.fillRect(x0 + 3 + dx, y0 + 3 + dy, w - 2, h - 2));
    mctx.fillStyle = '#b8d2a8';
    mctx.fillRect(x0 + 9, y0 + 15, 8, 4); // the head, at the centre of the coil, eyes shut
    mctx.fillStyle = '#2b1a08';
    mctx.fillRect(x0 + 10, y0 + 17, 2, 1);
    mctx.fillRect(x0 + 14, y0 + 17, 2, 1);
    mctx.fillStyle = '#5c7a5e';
    mctx.fillRect(x0 + 2, y0 + 2, 3, 3); // the tail's tip pokes out of the outer ring
    APPLES.forEach(([ax, ay]) => {
      const px = Math.round(ax * TILE);
      const py = Math.round(ay * TILE);
      mctx.fillStyle = 'rgba(0, 0, 0, .18)';
      mctx.fillRect(px + 4, py + 11, 8, 2);
      mctx.fillStyle = '#d9745a';
      mctx.fillRect(px + 5, py + 5, 6, 6);
      mctx.fillRect(px + 4, py + 6, 8, 4);
      mctx.fillStyle = '#8db07e';
      mctx.fillRect(px + 8, py + 3, 3, 2);
      mctx.fillStyle = '#fff2e1';
      mctx.fillRect(px + 6, py + 6, 1, 1);
    });
    GRASS.forEach(([gx, gy]) => {
      const px = gx * TILE;
      const py = gy * TILE;
      mctx.fillStyle = '#8db07e';
      [[4, 9, 1, 4], [6, 7, 1, 6], [8, 8, 1, 5], [10, 10, 1, 3], [5, 12, 5, 1]].forEach(([dx, dy, w, h]) => mctx.fillRect(px + dx, py + dy, w, h));
      mctx.fillStyle = '#5c7a5e';
      mctx.fillRect(px + 6, py + 11, 1, 2);
      mctx.fillRect(px + 8, py + 11, 1, 2);
    });
  }
  // The Climb room's upper half: a coiled rope with a knot, a pickaxe leaning on the wall and boulders.
  {
    const [x0, y0] = ROPE_AT.map((n) => n * TILE);
    const cx = x0 + 14;
    const cy = y0 + 13;
    mctx.fillStyle = 'rgba(0, 0, 0, .18)';
    mctx.beginPath();
    mctx.ellipse(cx + 1, cy + 3, 14, 11, 0, 0, Math.PI * 2);
    mctx.fill();
    [[13, '#8b5a2b'], [11, '#b48c6a'], [9, '#8b5a2b'], [7, '#b48c6a'], [5, '#8b5a2b']].forEach(([r, col]) => {
      mctx.fillStyle = col;
      mctx.beginPath();
      mctx.ellipse(cx, cy, r, r * 0.75, 0, 0, Math.PI * 2);
      mctx.fill();
    });
    mctx.fillStyle = '#a07a4f';
    mctx.beginPath();
    mctx.ellipse(cx, cy, 3, 2, 0, 0, Math.PI * 2);
    mctx.fill();
    mctx.fillStyle = '#b48c6a';
    mctx.fillRect(cx + 9, cy - 2, 12, 3); // the rope's end trailing off the coil
    mctx.fillRect(cx + 19, cy - 2, 3, 6);
    mctx.fillStyle = '#4b2e0f';
    mctx.fillRect(cx + 18, cy + 3, 5, 2); // the knot
    const [px, py] = PICK_AT.map((n) => n * TILE);
    mctx.fillStyle = 'rgba(0, 0, 0, .18)';
    mctx.fillRect(px + 3, py + 14, 10, 2);
    mctx.fillStyle = '#8b5a2b';
    for (let i = 0; i < 10; i++) mctx.fillRect(px + 4 + i, py + 13 - i, 2, 2); // the handle, leaning
    mctx.fillStyle = '#6b7585';
    mctx.fillRect(px + 10, py + 1, 6, 3); // the head
    mctx.fillRect(px + 14, py + 3, 2, 4);
    mctx.fillRect(px + 9, py + 3, 2, 3);
    mctx.fillStyle = '#9aa5b5';
    mctx.fillRect(px + 11, py + 1, 4, 1);
    BOULDERS.forEach(([bx, by], i) => {
      const qx = Math.round(bx * TILE);
      const qy = Math.round(by * TILE);
      const w = i === 1 ? 14 : 10;
      const h = i === 1 ? 10 : 8;
      mctx.fillStyle = 'rgba(0, 0, 0, .2)';
      mctx.fillRect(qx + 2, qy + h + 2, w, 2);
      mctx.fillStyle = '#6b7585';
      mctx.fillRect(qx + 1, qy + 2, w, h);
      mctx.fillRect(qx + 2, qy + 1, w - 2, h + 2);
      mctx.fillStyle = '#9aa5b5';
      mctx.fillRect(qx + 2, qy + 2, w - 2, h - 2);
      mctx.fillStyle = '#c3ccd8';
      mctx.fillRect(qx + 3, qy + 2, w - 5, 2);
      mctx.fillStyle = '#4b5066';
      mctx.fillRect(qx + 4, qy + h - 1, w - 5, 1);
    });
  }
  // The Zero room's floor painting: the Z-Saber on the floor, its green blade lit, and the arc of a swing.
  {
    const [x0, y0] = SABER_AT.map((n) => n * TILE);
    mctx.strokeStyle = 'rgba(120, 240, 138, .45)';
    mctx.lineWidth = 4;
    mctx.beginPath();
    mctx.arc(x0 + 22, y0 + 20, 16, -Math.PI * 0.85, Math.PI * 0.15);
    mctx.stroke();
    mctx.strokeStyle = 'rgba(230, 255, 230, .6)';
    mctx.lineWidth = 1;
    mctx.beginPath();
    mctx.arc(x0 + 22, y0 + 20, 16, -Math.PI * 0.85, Math.PI * 0.15);
    mctx.stroke();
    mctx.fillStyle = 'rgba(0, 0, 0, .2)';
    mctx.fillRect(x0 + 5, y0 + 36, 30, 2);
    mctx.fillStyle = '#9aa5b5';
    mctx.fillRect(x0 + 4, y0 + 32, 9, 4); // the hilt
    mctx.fillStyle = '#d8343f';
    mctx.fillRect(x0 + 6, y0 + 31, 5, 6);
    mctx.fillStyle = '#78f08a';
    mctx.fillRect(x0 + 13, y0 + 33, 22, 2); // the blade
    mctx.fillStyle = '#e6ffe6';
    mctx.fillRect(x0 + 13, y0 + 33, 22, 1);
  }
  // The Bomberman room's floor painting: a plus-shaped blast, orange with a yellow core, the
  // crumbs of the brick it blew up scattered over its lower arm, two bricks it did not reach
  // and a bomb whose fuse is still burning.
  {
    const brick = ([x, y]) => {
      const px = x * TILE;
      const py = y * TILE;
      mctx.fillStyle = 'rgba(0, 0, 0, .2)';
      mctx.fillRect(px + 2, py + 14, 13, 2);
      mctx.fillStyle = '#8b5a2b';
      mctx.fillRect(px + 1, py + 1, 14, 14); // the mortar
      [[2, 2, 6], [9, 2, 5], [2, 6, 3], [6, 6, 8], [2, 10, 6], [9, 10, 5]].forEach(([dx, dy, w]) => {
        mctx.fillStyle = '#b48c6a';
        mctx.fillRect(px + dx, py + dy, w, 3);
        mctx.fillStyle = '#d2ad8a';
        mctx.fillRect(px + dx, py + dy, w, 1);
      });
    };
    BRICKS.forEach(brick);
    const [cx, cy] = BLAST_AT.map((n) => n * TILE + TILE / 2);
    mctx.fillStyle = 'rgba(217, 116, 90, .3)'; // the scorch around the blast
    mctx.fillRect(cx - 23, cy - 6, 46, 12);
    mctx.fillRect(cx - 6, cy - 23, 12, 46);
    mctx.fillStyle = '#d9745a';
    mctx.fillRect(cx - 21, cy - 4, 42, 8);
    mctx.fillRect(cx - 4, cy - 21, 8, 42);
    mctx.fillRect(cx - 23, cy - 2, 2, 4); // the tips taper
    mctx.fillRect(cx + 21, cy - 2, 2, 4);
    mctx.fillRect(cx - 2, cy - 23, 4, 2);
    mctx.fillRect(cx - 2, cy + 21, 4, 2);
    mctx.fillStyle = '#f4c15d';
    mctx.fillRect(cx - 20, cy - 2, 40, 4);
    mctx.fillRect(cx - 2, cy - 20, 4, 40);
    mctx.fillStyle = '#fff2e1';
    mctx.fillRect(cx - 3, cy - 3, 6, 6);
    mctx.fillRect(cx - 12, cy - 1, 4, 2);
    mctx.fillRect(cx + 8, cy - 1, 4, 2);
    mctx.fillRect(cx - 1, cy - 12, 2, 4);
    mctx.fillRect(cx - 1, cy + 8, 2, 4);
    const [kx, ky] = CRUMBS_AT.map((n) => n * TILE);
    [[2, 3, 3, '#8b5a2b'], [11, 2, 2, '#b48c6a'], [12, 9, 3, '#8b5a2b'], [3, 11, 2, '#b48c6a'], [8, 13, 2, '#8b5a2b'], [1, 7, 2, '#d2ad8a']]
      .forEach(([dx, dy, n, col]) => { mctx.fillStyle = col; mctx.fillRect(kx + dx, ky + dy, n, n); });
    const [bx, by] = BOMB_AT.map((n) => n * TILE);
    mctx.fillStyle = 'rgba(0, 0, 0, .22)';
    mctx.fillRect(bx + 3, by + 13, 10, 2);
    mctx.fillStyle = '#2b1a08';
    mctx.beginPath();
    mctx.arc(bx + 8, by + 9, 5.5, 0, Math.PI * 2);
    mctx.fill();
    mctx.fillStyle = '#3b3f52';
    mctx.beginPath();
    mctx.arc(bx + 8, by + 9, 4.5, 0, Math.PI * 2);
    mctx.fill();
    mctx.fillStyle = '#6b7585';
    mctx.fillRect(bx + 6, by + 6, 2, 2); // the shine
    mctx.fillStyle = '#2b1a08';
    mctx.fillRect(bx + 7, by + 2, 3, 3); // the cap
    mctx.fillStyle = '#b48c6a';
    mctx.fillRect(bx + 9, by + 1, 2, 1); // the fuse
    mctx.fillRect(bx + 10, by, 2, 1);
    mctx.fillStyle = '#f4c15d';
    mctx.fillRect(bx + 11, by - 2, 3, 3); // the spark
    mctx.fillStyle = '#fff2e1';
    mctx.fillRect(bx + 12, by - 1, 1, 1);
  }
  // The Block Breaker room's floor painting: three rows of bricks with the one the ball has just
  // knocked out missing, the ball dropping back down its trail, and the paddle under it.
  {
    const [x0, y0] = WALL_AT.map((n) => n * TILE);
    const rows = ['#d9745a', '#f4c15d', '#8db07e'];
    rows.forEach((col, r) => {
      for (let c = 0; c < 3; c++) {
        if (r === 2 && c === 1) continue; // the one the ball took
        const bx = x0 + c * TILE + 1;
        const by = y0 + 1 + r * 7;
        mctx.fillStyle = 'rgba(0, 0, 0, .2)';
        mctx.fillRect(bx + 1, by + 5, 14, 1);
        mctx.fillStyle = col;
        mctx.fillRect(bx, by, 14, 5);
        mctx.fillStyle = 'rgba(255, 255, 255, .35)';
        mctx.fillRect(bx + 1, by, 12, 1);
        mctx.fillStyle = 'rgba(0, 0, 0, .15)';
        mctx.fillRect(bx, by + 4, 14, 1);
      }
    });
    const [ballX, ballY] = BALL_AT.map((n) => Math.round(n * TILE));
    mctx.fillStyle = 'rgba(255, 250, 242, .35)'; // the trail back up to the gap
    mctx.fillRect(ballX - 1, ballY - 11, 2, 2);
    mctx.fillRect(ballX - 1, ballY - 6, 2, 2);
    mctx.fillStyle = 'rgba(0, 0, 0, .2)';
    mctx.fillRect(ballX - 2, ballY + 3, 5, 1);
    mctx.fillStyle = '#fffaf2';
    mctx.beginPath();
    mctx.arc(ballX, ballY, 2.5, 0, Math.PI * 2);
    mctx.fill();
    const [padX, padY] = PADDLE_AT.map((n) => Math.round(n * TILE));
    mctx.fillStyle = 'rgba(0, 0, 0, .22)';
    mctx.fillRect(padX - 10, padY + 3, 22, 2);
    mctx.fillStyle = '#5c7a8a';
    mctx.fillRect(padX - 11, padY - 2, 22, 5);
    mctx.fillStyle = '#8fb8c4';
    mctx.fillRect(padX - 10, padY - 2, 20, 4);
    mctx.fillStyle = '#b8d2dc';
    mctx.fillRect(padX - 9, padY - 2, 18, 1);
    mctx.fillStyle = '#d9745a';
    mctx.fillRect(padX - 11, padY - 2, 3, 4); // the red caps at either end
    mctx.fillRect(padX + 8, padY - 2, 3, 4);
  }
  // The Race room's floor painting: a straight of grey road with red and white kerbs and a
  // dashed centre line, a chequered finish line across its far end, a blue rival ahead and
  // the player's red car behind it, both seen from above.
  {
    const [tx, ty, th] = ROAD_AT;
    const x0 = tx * TILE + 4;
    const y0 = ty * TILE;
    const w = 3 * TILE - 8;
    const h = th * TILE;
    mctx.fillStyle = '#4b5066';
    mctx.fillRect(x0, y0, w, h); // the asphalt
    mctx.fillStyle = '#6b7585';
    for (let y = y0 + 2; y < y0 + h; y += 7) mctx.fillRect(x0 + 6 + (y % 3), y, 1, 1); // its grain
    for (let y = y0; y < y0 + h; y += 6) { // the kerbs
      mctx.fillStyle = Math.floor(y / 6) % 2 ? '#d9745a' : '#fffaf2';
      mctx.fillRect(x0, y, 2, 6);
      mctx.fillRect(x0 + w - 2, y, 2, 6);
    }
    mctx.fillStyle = '#fffaf2';
    for (let y = y0 + 10; y < y0 + h - 2; y += 8) mctx.fillRect(x0 + w / 2 - 1, y, 2, 4); // the centre line
    for (let i = 0; i < (w - 4) / 3; i++) { // the finish line, chequered
      for (let j = 0; j < 2; j++) {
        mctx.fillStyle = (i + j) % 2 ? '#2b1a08' : '#fffaf2';
        mctx.fillRect(x0 + 2 + i * 3, y0 + 2 + j * 3, 3, 3);
      }
    }
    const car = ([cx, cy], col) => {
      const px = Math.round(cx * TILE);
      const py = Math.round(cy * TILE);
      mctx.fillStyle = 'rgba(0, 0, 0, .25)';
      mctx.fillRect(px + 2, py + 2, 10, 16);
      mctx.fillStyle = '#2b1a08';
      mctx.fillRect(px, py + 2, 3, 4); // the wheels
      mctx.fillRect(px + 9, py + 2, 3, 4);
      mctx.fillRect(px, py + 11, 3, 4);
      mctx.fillRect(px + 9, py + 11, 3, 4);
      mctx.fillStyle = col;
      mctx.fillRect(px + 2, py, 8, 17); // the body
      mctx.fillStyle = 'rgba(255, 255, 255, .3)';
      mctx.fillRect(px + 3, py, 6, 1);
      mctx.fillStyle = '#1e2130';
      mctx.fillRect(px + 3, py + 5, 6, 3); // the windscreen
      mctx.fillRect(px + 3, py + 12, 6, 2); // and the rear window
      mctx.fillStyle = '#f4c15d';
      mctx.fillRect(px + 2, py, 2, 1); // headlights
      mctx.fillRect(px + 8, py, 2, 1);
    };
    car(RIVAL_AT, '#6f8fc0');
    car(RACER_AT, '#d9745a');
  }
  // The Memory room's floor painting: six cards in two columns, face down in dark blue with a
  // cream question mark, but for the middle pair, turned up to show the same yellow monster.
  {
    const [tx, ty] = DECK_AT;
    const cw = 14;
    const ch = 18;
    for (let col = 0; col < 2; col++) {
      for (let row = 0; row < 3; row++) {
        const px = Math.round(tx * TILE) + col * (cw + 6);
        const py = Math.round(ty * TILE) + row * (ch + 4);
        mctx.fillStyle = 'rgba(0, 0, 0, .25)';
        mctx.fillRect(px + 1, py + 1, cw, ch);
        mctx.fillStyle = '#fffaf2';
        mctx.fillRect(px, py, cw, ch);
        if (row !== 1) {
          mctx.fillStyle = '#3b2f5e';
          mctx.fillRect(px + 1, py + 1, cw - 2, ch - 2);
          mctx.fillStyle = '#5e4a86';
          mctx.fillRect(px + 2, py + 2, cw - 4, ch - 4);
          mctx.fillStyle = '#fffaf2'; // the question mark
          mctx.fillRect(px + 5, py + 5, 4, 1);
          mctx.fillRect(px + 8, py + 6, 1, 2);
          mctx.fillRect(px + 6, py + 8, 2, 1);
          mctx.fillRect(px + 6, py + 9, 1, 2);
          mctx.fillRect(px + 6, py + 12, 1, 1);
        } else {
          mctx.fillStyle = '#f4c15d'; // the monster: a round yellow body with two ears
          mctx.fillRect(px + 4, py + 6, 6, 7);
          mctx.fillRect(px + 3, py + 8, 8, 4);
          mctx.fillRect(px + 3, py + 3, 2, 3);
          mctx.fillRect(px + 9, py + 3, 2, 3);
          mctx.fillStyle = '#2b1a08';
          mctx.fillRect(px + 5, py + 8, 1, 1); // its eyes
          mctx.fillRect(px + 8, py + 8, 1, 1);
          mctx.fillStyle = '#d9745a';
          mctx.fillRect(px + 6, py + 10, 2, 1); // its mouth
        }
      }
    }
  }
  Object.values(ROOMS).forEach((r) => {
    if (!r.label) return;
    const [cx, cy] = r.at.map((n) => n * TILE);
    mctx.font = 'bold 8px "JetBrains Mono", monospace';
    mctx.textAlign = 'center';
    mctx.textBaseline = 'middle';
    mctx.fillStyle = '#a07a4f';
    mctx.fillText(r.label, cx, cy + 1);
    mctx.fillStyle = '#2b1a08';
    mctx.fillText(r.label, cx, cy);
  });

  // The tag that hangs beside the PC while a new monster waits in it.
  // The battlefield painted over the boss room's flagstones: a ring worn into the
  // floor, the beams' scorch marks down the line between the two legendaries, and a
  // glowing pad under each in its own colour.
  {
    const [ax, ay, aw, ah] = ARENA_AT;
    const cx = (ax + aw / 2) * TILE;
    const cy = (ay + ah / 2) * TILE;
    mctx.save();
    mctx.beginPath();
    mctx.rect(ax * TILE, ay * TILE, aw * TILE, ah * TILE);
    mctx.clip();
    mctx.strokeStyle = 'rgba(255, 242, 225, .16)';
    mctx.lineWidth = 2;
    mctx.beginPath();
    mctx.ellipse(cx, cy, (aw * TILE) / 2 - 8, (ah * TILE) / 2 - 12, 0, 0, Math.PI * 2);
    mctx.stroke();
    mctx.fillStyle = '#2b2634'; // cracks running out from the middle
    [[-6, -3, 1, 4], [-5, 1, 1, 3], [6, 2, 1, 5], [7, 7, 1, 2], [-14, 10, 3, 1], [12, -8, 3, 1], [-9, -14, 1, 3], [10, 12, 1, 3]]
      .forEach(([dx, dy, w, h]) => mctx.fillRect(cx + dx, cy + dy, w, h));
    mctx.fillStyle = 'rgba(0, 0, 0, .3)'; // scorch marks
    for (let i = 0; i < 7; i++) {
      mctx.beginPath();
      mctx.ellipse(cx + ((i * 5) % 7) - 3, (ay + 2) * TILE + i * 11, 5 + (i % 3), 2.5, 0, 0, Math.PI * 2);
      mctx.fill();
    }
    LEGENDS.forEach((l) => {
      const px = l.x * TILE + 8;
      const py = l.y * TILE + 12;
      mctx.fillStyle = l.glow;
      mctx.globalAlpha = .2;
      mctx.beginPath();
      mctx.ellipse(px, py, 11, 5, 0, 0, Math.PI * 2);
      mctx.fill();
      mctx.globalAlpha = .55;
      mctx.strokeStyle = l.glow;
      mctx.lineWidth = 1;
      mctx.beginPath();
      mctx.ellipse(px, py, 11, 5, 0, 0, Math.PI * 2);
      mctx.stroke();
      mctx.globalAlpha = 1;
    });
    mctx.restore();
  }

  // The secret room under the Sneak room. `revealSecret` opens it: the broken
  // wall becomes floor strewn with rubble, the room's tiles are painted as they
  // are, the walls round it show their bricks, and the ball gets its marker.
  // `takeBall` lifts the ball off its tile. Both are remembered among the
  // things found (monsters.js `items`), so they hold from one visit to the next.
  const SECRET_AT = [13, 25, 9, 5]; // the part of the map to repaint: x, y, w, h in tiles
  const removeThing = (thing) => {
    const i = THINGS.indexOf(thing);
    if (i >= 0) THINGS.splice(i, 1);
  };
  const repaintSecret = () => {
    const [sx, sy, sw, sh] = SECRET_AT;
    for (let y = sy; y < sy + sh; y++) for (let x = sx; x < sx + sw; x++) TILES[grid[y][x]](mctx, x * TILE, y * TILE, x, y);
  };
  const revealSecret = () => {
    if (revealed) return;
    revealed = true;
    const wallThing = THINGS.find((th) => th.wall);
    if (wallThing) {
      grid[wallThing.y][wallThing.x] = FLOOR;
      removeThing(wallThing);
    }
    repaintSecret();
    if (wallThing) { // rubble where the wall stood
      const px = wallThing.x * TILE;
      const py = wallThing.y * TILE;
      mctx.fillStyle = '#4b2e0f';
      [[2, 3, 3, 2], [9, 2, 2, 2], [5, 8, 2, 2], [11, 10, 3, 2], [1, 12, 2, 1]].forEach(([dx, dy, w, h]) => mctx.fillRect(px + dx, py + dy, w, h));
      mctx.fillStyle = '#2b1a08';
      [[3, 5], [10, 4], [6, 10], [12, 12]].forEach(([dx, dy]) => mctx.fillRect(px + dx, py + dy, 1, 1));
    }
    const ballThing = THINGS.find((th) => th.ball);
    if (ballThing) ballThing.hidden = false;
  };
  const takeBall = () => {
    const ballThing = THINGS.find((th) => th.ball);
    if (!ballThing) return;
    grid[ballThing.y][ballThing.x] = SECRET;
    removeThing(ballThing);
    repaintSecret();
  };
  let bagBall = false; // whether the ball is in the bag: it then shows in the top right corner of the view

  const PC_AT = [13, 9];
  const newTag = (c, px, py, t) => {
    const x = px + 11;
    const y = py - 7 - (Math.floor(t / 500) % 2);
    c.fillStyle = '#2b1a08';
    c.fillRect(x - 1, y - 1, 22, 10);
    c.fillStyle = '#d9745a';
    c.fillRect(x, y, 20, 8);
    c.font = 'bold 7px "JetBrains Mono", monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#fffaf2';
    c.fillText('NEW', x + 10, y + 4.5);
  };

  const flame = (c, px, py, alt) => {
    c.fillStyle = '#e2a963';
    if (alt) c.fillRect(px + 5, py + 4, 5, 4);
    else c.fillRect(px + 6, py + 3, 5, 5);
    c.fillStyle = '#f4c15d';
    c.fillRect(px + 7, py + (alt ? 3 : 2), 2, 5);
    c.fillStyle = '#fff2e1';
    c.fillRect(px + 7 + (alt ? 1 : 0), py + (alt ? 5 : 4), 1, 2);
  };

  // "Z" bubble over everything the player can use; the one in reach lights up.
  const prompt = (c, px, py, bob, active) => {
    const bx = px + 4;
    const by = py - 10 - bob;
    c.fillStyle = '#2b1a08';
    c.fillRect(bx, by, 9, 9);
    c.fillRect(bx + 3, by + 9, 3, 1);
    c.fillStyle = active ? '#f4c15d' : '#fffaf2';
    c.fillRect(bx + 1, by + 1, 7, 7);
    c.fillStyle = '#2b1a08';
    c.fillRect(bx + 3, by + 2, 4, 1);
    c.fillRect(bx + 5, by + 3, 1, 1);
    c.fillRect(bx + 4, by + 4, 1, 1);
    c.fillRect(bx + 3, by + 5, 1, 1);
    c.fillRect(bx + 3, by + 6, 4, 1);
  };

  /* ---------- Hero sprite ---------- */

  // A shiba inu, 16 x 14 pixels: o coat, d ear tips, c cream muzzle, belly
  // and paws, k eyes and nose. The side view shows the curled tail.
  const PAL = { o: '#e2a963', d: '#b8743a', c: '#fff2e1', k: '#2b1a08' };
  const BODY = {
    down: [
      '....d......d....', '...dod....dod...', '...oooooooooo...', '..oooooooooooo..',
      '..oookooookooo..', '..ooccccccccoo..', '..occccckkcccco.', '...occcccccco...',
      '...oooccccooo...', '...oooccccooo...', '...oooooooooo...',
    ],
    up: [
      '....d......d....', '...dod....dod...', '...oooooooooo...', '..oooooooooooo..',
      '..oooooooooooo..', '..oooooooooooo..', '...oooooooooo...', '...oooooooooo...',
      '...oooooooooo...', '...ooooccoooo...', '...oooccccooo...',
    ],
    right: [
      '..........d..d..', '..........dood..', '...oo.....oooooo', '..o..o...ooookoo',
      '..o..o..oooooooo', '...ooooooooccckk', '..oooooooooocccc', '..ooooooooooocc.',
      '..ooooooooooooo.', '..oocccccccccoo.', '..ooo.....ooo...',
    ],
  };
  const LEGS = {
    front: [['...ooo....ooo...', '...ccc....ccc...'], ['..ooo......ooo..', '..ccc......ccc..']],
    side: [['..ooo.....ooo...', '..ccc.....ccc...'], ['.oo..o...oo..o..', '.cc..c...cc..c..']],
  };
  const render = (rows, flip) => {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 14;
    const g = c.getContext('2d');
    if (flip) {
      g.translate(16, 0);
      g.scale(-1, 1);
    }
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (!PAL[ch]) return;
      g.fillStyle = PAL[ch];
      g.fillRect(x, y, 1, 1);
    }));
    return c;
  };
  const SPRITES = {
    down: LEGS.front.map((legs) => render([...BODY.down, ...legs])),
    up: LEGS.front.map((legs) => render([...BODY.up, ...legs])),
    right: LEGS.side.map((legs) => render([...BODY.right, ...legs])),
    left: LEGS.side.map((legs) => render([...BODY.right, ...legs], true)),
  };

  /* ---------- Pets ---------- */

  // The party members set to walk (under My mons; see monsters.js) follow the
  // hero in a line, each PET_GAP px behind the one before along the hero's own
  // path, so they pass through the same doors and round the same pots. `trail`
  // samples the hero's position at every step with the distance walked so far,
  // newest last; a pet sits at its distance back along it, facing the way the
  // hero went there, and steps in time with the hero. Their frames, 16 x 14
  // like the hero's, are on assets/monster-walk.png.
  const PET_GAP = 14;
  const WALK_IMG = new Image();
  WALK_IMG.src = 'assets/monster-walk.png';
  let pets = []; // monster ids, in party order
  let trail = []; // { x, y, dir, d }

  // Lay the line out behind the hero, as far as the floor allows, so the pets
  // do not start piled under the hero. Called when the hero or the pets change.
  const seedTrail = () => {
    const [dx, dy] = DIRS[hero.dir];
    const want = pets.length * PET_GAP;
    let len = 0;
    while (len < want && !blocked(hero.x - dx * (len + 1), hero.y - dy * (len + 1))) len++;
    trail = [{ x: hero.x - dx * len, y: hero.y - dy * len, dir: hero.dir, d: 0 }];
    if (len) trail.push({ x: hero.x, y: hero.y, dir: hero.dir, d: len });
  };
  const refreshPets = () => {
    const next = mons()?.walking() || [];
    if (next.join() === pets.join() && trail.length) return;
    pets = next;
    seedTrail();
  };
  // After the hero has moved: remember where, and forget what no pet needs any more.
  const trailStep = () => {
    const last = trail[trail.length - 1];
    const dist = Math.hypot(hero.x - last.x, hero.y - last.y);
    if (!dist) return;
    trail.push({ x: hero.x, y: hero.y, dir: hero.dir, d: last.d + dist });
    const keep = last.d + dist - pets.length * PET_GAP - TILE;
    let drop = 0;
    while (drop + 1 < trail.length && trail[drop + 1].d <= keep) drop++;
    if (drop) trail.splice(0, drop);
  };
  // Where pet `i` stands: between the two samples its distance back falls
  // among, or at the trail's start, still, when the trail is not that long yet.
  const petAt = (i) => {
    const back = trail[trail.length - 1].d - (i + 1) * PET_GAP;
    let k = trail.length - 1;
    while (k > 0 && trail[k - 1].d >= back) k--;
    if (!k) return { x: trail[0].x, y: trail[0].y, dir: trail[0].dir, still: true };
    const a = trail[k - 1];
    const b = trail[k];
    const t = (back - a.d) / (b.d - a.d);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dir: b.dir, still: false };
  };

  /* ---------- The legendaries' fight ---------- */

  // Their avatars, 16 x 14 like the pets', from assets/legendary-avatar.png, each
  // copied once onto a small canvas, with a second copy all white for the frames
  // in which it is hit.
  const AVATAR_IMG = new Image();
  AVATAR_IMG.src = 'assets/legendary-avatar.png';
  const legendPics = new Map();
  const legendPic = (l) => {
    const key = `${l.id}:${l.side}`;
    if (legendPics.has(key)) return legendPics.get(key);
    if (!AVATAR_IMG.complete || !AVATAR_IMG.naturalWidth || !mons()) return null;
    const f = mons().legendAvatar(l.id, l.side);
    const make = (flash) => {
      const c = document.createElement('canvas');
      c.width = f.w;
      c.height = f.h;
      const g = c.getContext('2d');
      g.drawImage(AVATAR_IMG, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
      if (flash) {
        g.globalCompositeOperation = 'source-atop';
        g.fillStyle = '#fffaf2';
        g.fillRect(0, 0, f.w, f.h);
      }
      return c;
    };
    const pics = { plain: make(false), flash: make(true) };
    legendPics.set(key, pics);
    return pics;
  };

  // One round of the fight, FIGHT ms long, over and over: Noctyrax gathers a beam
  // and fires it down the room at Aurelyon, Aurelyon shines and answers with its
  // own, then both fire at once and the beams lock in the middle. `fightAt` reads
  // the round at time t into what each is doing, every value 0 to 1: `aura` the
  // energy gathered round it, `charge` the orb growing at its mouth, `beam` the
  // beam it is firing, `hit` how hard it is being struck, and `hp` its health
  // bar; `clash` is the two beams meeting, with `lock` where along the line.
  const FIGHT = 7600;
  const ramp = (u, a, b) => Math.max(0, Math.min(1, (u - a) / (b - a)));
  const pulse = (u, a, b, c, d) => ramp(u, a, b) * (1 - ramp(u, c, d)); // up from a to b, down from c to d
  const fightAt = (t) => {
    const u = t % FIGHT;
    const N = { aura: pulse(u, 0, 400, 900, 1300), charge: pulse(u, 900, 2200, 2200, 2250), beam: pulse(u, 2200, 2300, 2900, 3050), hit: 0 };
    const A = { aura: pulse(u, 3000, 3300, 4300, 4500), charge: pulse(u, 3300, 4500, 4500, 4550), beam: pulse(u, 4500, 4600, 5200, 5350), hit: 0 };
    A.hit = pulse(u, 2250, 2350, 2900, 3200);
    N.hit = pulse(u, 4550, 4650, 5200, 5500);
    const both = pulse(u, 5500, 6000, 6000, 6050);
    N.charge = Math.max(N.charge, both);
    A.charge = Math.max(A.charge, both);
    const clash = pulse(u, 6000, 6150, 7100, 7450);
    N.beam = Math.max(N.beam, clash);
    A.beam = Math.max(A.beam, clash);
    N.aura = Math.max(N.aura, pulse(u, 5400, 5700, 7000, 7400));
    A.aura = Math.max(A.aura, pulse(u, 5400, 5700, 7000, 7400));
    A.hp = 1 - 0.35 * ramp(u, 2300, 2900) - 0.2 * ramp(u, 6500, 7100);
    N.hp = 1 - 0.3 * ramp(u, 4600, 5200) - 0.2 * ramp(u, 6500, 7100);
    const lock = 0.5 + 0.12 * Math.sin(u / 170) + 0.1 * Math.sin(u / 530); // the beams' meeting point shoves back and forth
    return { N, A, clash, lock, u };
  };
  const fighter = (l, f) => (l.side === 'front' ? f.N : f.A);
  // Where a legendary's beam starts: just past its mouth, towards its foe.
  const muzzle = (l) => [l.x * TILE + 8, l.y * TILE + (l.side === 'front' ? 15 : 1)];

  // A legendary on the field, drawn in its turn among the walkers: it hovers,
  // and when hit it flashes white, shakes and is shoved back a little.
  const drawLegend = (l, t, f) => {
    const pics = legendPic(l);
    if (!pics) return;
    const s = fighter(l, f);
    const bob = Math.round(Math.sin(t / 400 + l.id));
    const shake = s.hit ? (Math.floor(t / 45) % 2) * 2 - 1 : 0;
    const push = Math.round(s.hit * 2) * (l.side === 'front' ? -1 : 1);
    ctx.drawImage(s.hit && Math.floor(t / 90) % 2 ? pics.flash : pics.plain, l.x * TILE + shake, l.y * TILE + 1 + bob + push);
  };

  // A beam down the middle column from y0 to y1, `w` px wide, its edges rippling.
  const beam = (x, y0, y1, l, w, t) => {
    const top = Math.min(y0, y1);
    const len = Math.abs(y1 - y0);
    ctx.globalAlpha = .35;
    ctx.fillStyle = l.glow;
    ctx.fillRect(x - w - 2, top, 2 * w + 4, len);
    ctx.globalAlpha = 1;
    ctx.fillRect(x - w, top, 2 * w, len);
    ctx.fillStyle = l.core;
    ctx.fillRect(x - Math.max(1, w - 1), top, 2 * Math.max(1, w - 1), len);
    ctx.fillStyle = '#fffaf2';
    for (let y = top + ((Math.floor(t / 40) * 3) % 8); y < top + len; y += 8) ctx.fillRect(x - w - 1 + (y % 16 ? 0 : 2 * w + 1), y, 1, 2);
  };
  const sparks = (x, y, r, l, n, seed) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + seed;
      ctx.fillStyle = i % 2 ? l.core : l.glow;
      ctx.fillRect(Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r * 0.6), 1, 1);
    }
  };
  // Everything the fight throws about, drawn over the room after the sprites.
  const drawFight = (t, f) => {
    const [N, A] = LEGENDS;
    const [nx, ny] = muzzle(N);
    const [, ay] = muzzle(A);
    const x = nx;
    LEGENDS.forEach((l) => {
      const s = fighter(l, f);
      const [mx, my] = muzzle(l);
      if (s.aura > 0) { // energy gathers round it: a pulsing ring and motes rising past it
        ctx.globalAlpha = s.aura * (0.35 + 0.25 * Math.sin(t / 90));
        ctx.strokeStyle = l.glow;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(l.x * TILE + 8, l.y * TILE + 11, 11 + 2 * Math.sin(t / 150), 6, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = s.aura;
        for (let i = 0; i < 5; i++) {
          const k = ((t / 14) + i * 29) % 36;
          ctx.fillStyle = i % 2 ? l.core : l.glow;
          ctx.fillRect(l.x * TILE - 2 + ((i * 7) % 20), l.y * TILE + 16 - k, 1, 1);
        }
        ctx.globalAlpha = 1;
      }
      if (s.charge > 0 && !s.beam) { // the orb swells at its mouth as motes fall in
        const r = 1 + s.charge * 3.5;
        sparks(mx, my, 10 - s.charge * 8, l, 6, t / 300);
        ctx.globalAlpha = .5;
        ctx.fillStyle = l.glow;
        ctx.beginPath();
        ctx.arc(mx, my, r + 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(mx, my, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = l.core;
        ctx.beginPath();
        ctx.arc(mx, my, r * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    const n = f.N;
    const a = f.A;
    if (f.clash > 0) { // both beams, locked where they meet, throwing sparks sideways
      const my = ny + (ay - ny) * f.lock;
      beam(x, ny, my, N, 2, t);
      beam(x, ay, my, A, 2, t + 20);
      const r = 3 + 2 * f.clash + Math.sin(t / 60);
      ctx.fillStyle = '#fffaf2';
      ctx.beginPath();
      ctx.arc(x, my, r, 0, Math.PI * 2);
      ctx.fill();
      sparks(x, my, 7 + (t / 30) % 6, N, 4, t / 120);
      sparks(x, my, 9 + (t / 25) % 6, A, 4, t / 95 + 1);
      if (f.clash > 0.9 && Math.floor(t / 60) % 3 === 0) { // the room lights up at the peak
        ctx.globalAlpha = .12;
        ctx.fillStyle = '#fffaf2';
        ctx.fillRect(ARENA_AT[0] * TILE, ARENA_AT[1] * TILE, ARENA_AT[2] * TILE, ARENA_AT[3] * TILE);
        ctx.globalAlpha = 1;
      }
    } else {
      if (n.beam > 0) {
        beam(x, ny, ay, N, Math.round(1 + 2 * n.beam), t);
        sparks(x, ay, 3 + 6 * (1 - a.hit) + ((t / 40) % 4), N, 6, t / 110);
      }
      if (a.beam > 0) {
        beam(x, ay, ny, A, Math.round(1 + 2 * a.beam), t);
        sparks(x, ny, 3 + 6 * (1 - n.hit) + ((t / 40) % 4), A, 6, t / 110);
      }
    }
    LEGENDS.forEach((l) => { // a health bar beside each
      const s = fighter(l, f);
      const bx = l.x * TILE + 19;
      const by = l.y * TILE + 3;
      ctx.fillStyle = '#2b1a08';
      ctx.fillRect(bx - 1, by - 1, 12, 4);
      ctx.fillStyle = s.hp > 0.5 ? '#8db07e' : s.hp > 0.25 ? '#f4c15d' : '#d9745a';
      ctx.fillRect(bx, by, Math.round(10 * s.hp), 2);
    });
  };

  /* ---------- State ---------- */

  const stage = root.querySelector('[data-stage]');
  const view = root.querySelector('[data-view]');
  const overlay = root.querySelector('[data-overlay]');
  const msg = root.querySelector('[data-msg]');
  const startBtn = root.querySelector('[data-start]');
  const roomOut = root.querySelector('[data-room]');
  const talkEl = root.querySelector('[data-talk]');
  const talkTitle = root.querySelector('[data-talk-title]');
  const talkText = root.querySelector('[data-talk-text]');
  const talkMore = root.querySelector('[data-talk-more]');
  const talkPic = root.querySelector('[data-talk-pic]');
  const ctx = view.getContext('2d');
  view.width = VIEW_W;
  view.height = VIEW_H;
  ctx.imageSmoothingEnabled = false;

  // The hero's feet box is rows 8-13 and columns 2-13 of the 16 x 14 sprite.
  const hero = { x: 9 * TILE, y: 10 * TILE - 8, dir: 'down', frame: 0, walked: 0 }; // at the foot of the stairs
  let room = ROOMS.l;
  const cam = { x: 0, y: 0 }; // top-left corner of the view, in map pixels
  let state = 'idle'; // idle | playing | reading | juke | menu | status | mons | paused | leaving | away | returning
  let raf = 0;
  let lastTime = 0;
  let fade = 0;
  let fadeFrom = 0;
  let fadeAt = 0;
  let target = null; // arcade whose game is being entered
  let talk = null; // { thing, page } while reading
  const held = []; // directions currently held, most recent last
  const PAUSABLE = new Set(['playing', 'reading', 'juke', 'menu', 'status', 'mons']); // states the map runs in
  // Hiding a focused button or box blurs it with nowhere to go, which looks like
  // leaving the window and pauses, so the stage takes the focus back first.
  const refocus = () => stage.focus({ preventScroll: true });

  const roomAt = (tx, ty) => ROOMS[LAYOUT[ty]?.[tx]] || null;
  const feetTile = () => [Math.floor((hero.x + 8) / TILE), Math.floor((hero.y + 11) / TILE)];

  // Where the view wants to be: centred on the hero, but never past the map's edge.
  const camTarget = () => [
    Math.max(0, Math.min(W - VIEW_W, hero.x + 8 - VIEW_W / 2)),
    Math.max(0, Math.min(H - VIEW_H, hero.y + 7 - VIEW_H / 2)),
  ];
  const moveCam = (dt) => {
    const [tx, ty] = camTarget();
    const k = Math.min(1, dt / CAM_EASE);
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;
  };

  // Only the hero's feet collide, so the head may overlap the wall above (Zelda-style).
  const blocked = (x, y) => {
    const corners = [[x + 2, y + 8], [x + 13, y + 8], [x + 2, y + 13], [x + 13, y + 13]];
    return corners.some(([cx, cy]) => {
      const t = grid[Math.floor(cy / TILE)]?.[Math.floor(cx / TILE)];
      return t === undefined || SOLID.has(t);
    });
  };

  // When a step is blocked but a gap (a door, the end of a wall) is only a few pixels off to the
  // side, which way to nudge the hero so they slip into it instead of stopping dead.
  const NUDGE = 6;
  const nudge = (axis, nx, ny) => {
    for (let off = 1; off <= NUDGE; off++) {
      for (const dir of [-1, 1]) {
        const ox = axis === 'y' ? dir * off : 0;
        const oy = axis === 'x' ? dir * off : 0;
        if (!blocked(nx + ox, ny + oy) && !blocked(hero.x + Math.sign(ox), hero.y + Math.sign(oy))) return dir;
      }
    }
    return 0;
  };
  // Slide up to `amount` px along one axis, one pixel at a time, stopping at walls.
  const slide = (axis, amount) => {
    const sign = Math.sign(amount);
    let left = Math.abs(amount);
    while (left > 0) {
      const s = Math.min(1, left);
      const nx = hero.x + (axis === 'x' ? s * sign : 0);
      const ny = hero.y + (axis === 'y' ? s * sign : 0);
      if (blocked(nx, ny)) {
        const dir = nudge(axis, nx, ny);
        if (!dir) return;
        if (axis === 'x') hero.y += dir;
        else hero.x += dir;
      } else {
        hero.x = nx;
        hero.y = ny;
      }
      left -= s;
    }
  };

  // The thing in front of the hero, or else any one beside it.
  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const nearThing = () => {
    const [tx, ty] = feetTile();
    const [fx, fy] = DIRS[hero.dir];
    return thingAt(tx + fx, ty + fy)
      || Object.values(DIRS).map(([dx, dy]) => thingAt(tx + dx, ty + dy)).find(Boolean)
      || null;
  };
  // The locked door the hero faces, if any.
  const nearLocked = () => {
    const [tx, ty] = feetTile();
    const [fx, fy] = DIRS[hero.dir];
    return grid[ty + fy]?.[tx + fx] === LOCKED ? [tx + fx, ty + fy] : null;
  };

  /* ---------- Drawing ---------- */

  const draw = (t) => {
    ctx.setTransform(1, 0, 0, 1, -Math.round(cam.x), -Math.round(cam.y));
    ctx.drawImage(map, 0, 0);
    TORCHES.forEach(([x, y]) => flame(ctx, x * TILE, y * TILE, Math.floor(t / 220 + x) % 2));

    // The pots, the pets and the hero, drawn from the back of the room forwards
    // by the foot of each; the hero stands in front of a pet on the same line.
    const walkers = [
      ...pets.map((id, i) => ({ ...petAt(i), id })),
      { x: hero.x, y: hero.y, dir: hero.dir, hero: true },
    ].map((w) => ({ ...w, x: Math.round(w.x), y: Math.round(w.y), frame: w.still ? 0 : hero.frame }));
    walkers.forEach((w) => {
      ctx.fillStyle = 'rgba(0, 0, 0, .25)';
      ctx.beginPath();
      ctx.ellipse(w.x + 8, w.y + 13.5, 6, 2, 0, 0, Math.PI * 2);
      ctx.fill();
    });
    const sheet = WALK_IMG.complete && WALK_IMG.naturalWidth ? WALK_IMG : null;
    const fight = fightAt(t);
    [...POTS.map(([x, y]) => ({ foot: y * TILE + TILE, pot: [x * TILE, y * TILE] })), ...LEGENDS.map((l) => ({ foot: l.y * TILE + TILE, legend: l })), ...walkers.map((w) => ({ foot: w.y + 14 + (w.hero ? 0.5 : 0), w }))]
      .sort((a, b) => a.foot - b.foot)
      .forEach(({ pot: p, legend, w }) => {
        if (p) pot(ctx, p[0], p[1]);
        else if (legend) drawLegend(legend, t, fight);
        else if (w.hero) ctx.drawImage(SPRITES[w.dir][w.frame], w.x, w.y - (w.frame ? 1 : 0));
        else if (sheet) {
          const f = mons().walkFrame(w.id, w.dir, w.frame);
          ctx.drawImage(sheet, f.x, f.y, f.w, f.h, w.x, w.y - (w.frame ? 1 : 0), f.w, f.h);
        }
      });

    drawFight(t, fight);
    if (state === 'reading' && talk?.thing.legend) drawLegendPic(talk.thing.legend, t);

    // The jukebox's lights run while music plays, with a note floating up from it.
    if (music()?.playing) {
      const j = THINGS.find((th) => th.juke);
      const jx = j.x * TILE;
      const jy = j.y * TILE;
      const phase = Math.floor(t / 180);
      ['#f4c15d', '#8fb8c4', '#d9745a', '#8db07e'].forEach((col, i) => {
        ctx.fillStyle = (phase + i) % 4 ? col : '#fffaf2';
        ctx.fillRect(jx + 5 + (i % 2) * 5, jy + 6 + Math.floor(i / 2) * 2, 1, 1);
      });
      const bob = (t / 60) % 14;
      ctx.fillStyle = `rgba(255, 242, 225, ${1 - bob / 14})`;
      ctx.fillRect(jx + 8, jy - 6 - bob, 1, 4);
      ctx.fillRect(jx + 6, jy - 3 - bob, 2, 2);
      ctx.fillRect(jx + 9, jy - 6 - bob, 2, 1);
    }

    const near = state === 'playing' ? nearThing() : null;
    THINGS.forEach((thing) => {
      if (thing.hidden) return;
      const active = thing === near;
      prompt(ctx, thing.x * TILE, thing.y * TILE, active ? Math.floor(t / 400) % 2 : 0, active);
    });
    const door = state === 'playing' && !near ? nearLocked() : null;
    if (door) prompt(ctx, door[0] * TILE, door[1] * TILE, Math.floor(t / 400) % 2, true);
    if (mons()?.fresh().length) newTag(ctx, PC_AT[0] * TILE, PC_AT[1] * TILE, t);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (bagBall) {
      ctx.fillStyle = 'rgba(20, 12, 4, .55)';
      ctx.fillRect(VIEW_W - 16, 2, 14, 14);
      ball(ctx, VIEW_W - 13, 5);
    }
    if (fade > 0) {
      ctx.fillStyle = `rgba(20, 12, 4, ${fade})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
  };

  /* ---------- Scene flow ---------- */

  const showOverlay = (text, label) => {
    msg.textContent = text;
    startBtn.textContent = label;
    overlay.hidden = false;
  };

  const run = () => {
    lastTime = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  };

  const switchTo = (thing) => {
    cancelAnimationFrame(raf);
    state = 'away';
    const game = document.querySelector(thing.game);
    root.hidden = true;
    game.hidden = false;
    game.dispatchEvent(new CustomEvent('scene-enter'));
    game.scrollIntoView({ block: 'nearest' });
  };

  const enterGame = (thing) => {
    state = 'leaving';
    target = thing;
    held.length = 0;
    hero.frame = 0;
    fadeFrom = fade;
    fadeAt = performance.now();
    roomOut.textContent = `Starting ${thing.name}…`;
  };

  const leaveGame = (game) => {
    if (state !== 'away') return;
    game.dispatchEvent(new CustomEvent('scene-exit'));
    game.hidden = true;
    root.hidden = false;
    overlay.hidden = true;
    roomOut.textContent = room.name;
    state = 'returning';
    fadeFrom = fade;
    fadeAt = performance.now();
    stage.focus({ preventScroll: true });
    root.scrollIntoView({ block: 'nearest' });
    run();
  };

  /* ---------- Reading ---------- */

  const showPage = () => {
    const { thing, page } = talk;
    talkTitle.textContent = `${thing.name} · ${page + 1} / ${thing.pages.length}`;
    talkText.textContent = thing.pages[page];
    talkMore.textContent = page + 1 < thing.pages.length ? 'next' : 'done';
    talkPic.hidden = !thing.legend;
    talkEl.hidden = false;
  };

  // Z at a legendary: its number, name, types and fact from monster.csv, and
  // the fight it is in, with its animations playing beside the text: on its
  // sheet (see monsters.js), front then back, shining, gathering energy, then
  // firing its beam, a frame every FRAME_MS.
  let legendRows = null; // [{ id, name, types, fact }] once fetched
  window.arcadeMons?.legendary().then((rows) => { legendRows = rows; }).catch(() => { /* the pages manage without */ }); // before mons() below exists
  const readLegend = (thing) => {
    const l = thing.legend;
    const foe = LEGENDS.find((o) => o !== l).name;
    const row = legendRows?.find((r) => r.id === l.id);
    const name = row ? `No. ${mons().no(row.id)} ${row.name} · ${row.types.join(', ')}` : l.name;
    const pages = row
      ? [row.fact, `${row.name} has fought ${foe} here since before the dungeon was dug, and neither has yet given ground.`]
      : [`${l.name} is too busy fighting ${foe} to notice you.`];
    startReading({ name, pages, legend: l });
  };
  const LEGEND_IMG = new Image();
  LEGEND_IMG.src = 'assets/monster-legendary.png';
  const SHOW = [['front', 'shine', 2], ['front', 'focus', 2], ['front', 'attack', 1], ['back', 'shine', 2], ['back', 'focus', 2], ['back', 'attack', 1]]; // side, animation, times through
  const FRAME_MS = 140;
  const drawLegendPic = (l, t) => {
    if (!LEGEND_IMG.complete || !LEGEND_IMG.naturalWidth) return;
    const api = mons();
    const steps = SHOW.map(([side, anim, times]) => [side, anim, api.legendFrame(l.id, side, anim).frames * times]);
    let k = Math.floor(t / FRAME_MS) % steps.reduce((sum, [, , n]) => sum + n, 0);
    const [side, anim] = steps.find(([, , n]) => (k < n ? true : (k -= n, false)));
    const f = api.legendFrame(l.id, side, anim, k);
    const g = talkPic.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, talkPic.width, talkPic.height);
    g.drawImage(LEGEND_IMG, f.x, f.y, f.w, f.h, 0, 0, talkPic.width, talkPic.height);
  };

  const startReading = (thing) => {
    state = 'reading';
    held.length = 0;
    hero.frame = 0;
    talk = { thing, page: 0 };
    showPage();
  };

  const stopReading = () => {
    talk = null;
    talkEl.hidden = true;
    if (state === 'reading') state = 'playing';
  };

  const nextPage = () => {
    if (talk.page + 1 < talk.thing.pages.length) {
      talk.page++;
      showPage();
    } else stopReading();
  };


  /* ---------- Jukebox ---------- */

  // The jukebox panel lists the tracks that music.js plays; ↑/↓ choose a row,
  // Z plays or stops it (or switches the mode on the last row), X closes.
  const jukeEl = root.querySelector('[data-juke]');
  const jukeList = root.querySelector('[data-juke-list]');
  const jukeHintEl = root.querySelector('[data-juke-hint]');
  const music = () => window.arcadeMusic || null;
  let jukeSel = 0; // the chosen row: a track, or one of the control rows after them
  let jukeHooked = false;

  // Rows: one per track, then pause, volume and mode.
  const JUKE_ROWS = ['pause', 'volume', 'mode'];
  const jukeRow = (sel) => {
    const n = music().tracks.length;
    return sel < n ? 'track' : JUKE_ROWS[sel - n];
  };
  const rowButton = (li, selected, icon, text, data) => {
    const b = document.createElement('button');
    b.type = 'button';
    Object.assign(b.dataset, data);
    b.classList.toggle('is-sel', selected);
    b.innerHTML = `<i>${icon}</i>`;
    b.append(text);
    li.append(b);
    return b;
  };
  const jukeHint = (keys, act) => `<kbd>&uarr;</kbd><kbd>&darr;</kbd> choose · ${keys} ${act} · <kbd>X</kbd> close`;

  const renderJuke = () => {
    const m = music();
    const n = m.tracks.length;
    const items = m.tracks.map((track, i) => {
      const playing = m.playing && m.index === i;
      const li = document.createElement('li');
      rowButton(li, i === jukeSel, playing ? '&#9654;' : '&#9834;', track.title, { row: i }).classList.toggle('is-playing', playing);
      return li;
    });
    const pauseLi = document.createElement('li');
    pauseLi.className = 'dungeon__juke-sep';
    rowButton(pauseLi, n === jukeSel, m.playing ? '&#10074;&#10074;' : '&#9654;', m.playing ? 'Pause' : `Resume ${m.tracks[m.index].title}`, { row: n });
    const volLi = document.createElement('li');
    const pct = Math.round(m.volume * 100);
    const vol = rowButton(volLi, n + 1 === jukeSel, '&#128266;', `Volume ${pct}%`, { row: n + 1 });
    const meter = document.createElement('span');
    meter.className = 'dungeon__juke-meter';
    meter.innerHTML = `<i style="width:${pct}%"></i>`;
    vol.append(meter);
    ['-', '+'].forEach((sign) => {
      const s = document.createElement('button');
      s.type = 'button';
      s.className = 'dungeon__juke-step';
      s.dataset.step = sign === '+' ? 1 : -1;
      s.setAttribute('aria-label', sign === '+' ? 'Louder' : 'Quieter');
      s.textContent = sign;
      volLi.append(s);
    });
    const modeLi = document.createElement('li');
    rowButton(modeLi, n + 2 === jukeSel, m.mode === 'one' ? '&#8635;' : '&#8694;', m.mode === 'one' ? 'Loop this song' : 'Play all songs in turn', { row: n + 2 });
    jukeList.replaceChildren(...items, pauseLi, volLi, modeLi);

    const row = jukeRow(jukeSel);
    if (row === 'track') jukeHintEl.innerHTML = jukeHint('<kbd>Z</kbd>', m.playing && m.index === jukeSel ? 'stop' : 'play');
    else if (row === 'pause') jukeHintEl.innerHTML = jukeHint('<kbd>Z</kbd>', m.playing ? 'pause' : 'resume');
    else if (row === 'volume') jukeHintEl.innerHTML = jukeHint('<kbd>&larr;</kbd><kbd>&rarr;</kbd>', 'volume');
    else jukeHintEl.innerHTML = jukeHint('<kbd>Z</kbd>', 'switch');
  };

  const closeJuke = () => {
    if (state === 'juke') refocus();
    jukeEl.hidden = true;
    if (state === 'juke') state = 'playing';
  };

  const openJuke = () => {
    const m = music();
    if (!m) {
      startReading({ name: 'Jukebox', pages: ['The jukebox is unplugged.'] });
      return;
    }
    if (!jukeHooked) {
      jukeHooked = true;
      m.onChange(() => { if (state === 'juke') renderJuke(); });
    }
    state = 'juke';
    held.length = 0;
    hero.frame = 0;
    jukeSel = m.index;
    renderJuke();
    jukeEl.hidden = false;
  };

  const jukeMove = (d) => {
    const rows = music().tracks.length + JUKE_ROWS.length;
    jukeSel = (jukeSel + d + rows) % rows;
    renderJuke();
  };

  // Z on the chosen row: play or stop a track, pause or resume, nudge the volume, or switch the mode.
  const jukeActivate = () => {
    const m = music();
    const row = jukeRow(jukeSel);
    if (row === 'track') {
      if (m.playing && m.index === jukeSel) m.stop();
      else m.play(jukeSel);
    } else if (row === 'pause') m.toggle();
    else if (row === 'volume') m.setVolume(m.volume >= 1 ? 0 : m.volume + 0.1);
    else m.setMode(m.mode === 'one' ? 'all' : 'one');
    renderJuke();
  };

  // ←/→: volume on its row, the mode on its row.
  const jukeSide = (d) => {
    const m = music();
    const row = jukeRow(jukeSel);
    if (row === 'volume') m.setVolume(m.volume + d * 0.1);
    else if (row === 'mode') m.setMode(m.mode === 'one' ? 'all' : 'one');
    else return;
    renderJuke();
  };

  jukeList.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || state !== 'juke') return;
    if (b.dataset.step) {
      jukeSel = music().tracks.length + JUKE_ROWS.indexOf('volume');
      jukeSide(Number(b.dataset.step));
      return;
    }
    jukeSel = Number(b.dataset.row);
    jukeActivate();
  });

  /* ---------- Menu and status ---------- */

  // Enter opens a short menu down the right side of the map: Status swaps the
  // map for the player's progress in every game, Monsterdex and My mons list the
  // monsters (see monsters.js), Login signs in with Google and pulls the cloud
  // copy of the progress down, and Save pushes it up (see account.js). While
  // signed in the Login row reads Logout. ↑/↓ choose a row, Z picks it, X closes.
  const menuEl = root.querySelector('[data-menu]');
  const menuList = root.querySelector('[data-menu-list]');
  const menuNote = root.querySelector('[data-menu-note]');
  const statusEl = root.querySelector('[data-status]');
  const statusList = root.querySelector('[data-status-list]');
  const statusSum = root.querySelector('[data-status-sum]');
  const MENU = [
    { id: 'status', icon: '&#9776;', label: 'Status' },
    { id: 'dex', icon: '&#128214;', label: 'Monsterdex' },
    { id: 'mine', icon: '&#9829;', label: 'My mons' },
    { id: 'login', icon: '&#9786;', label: 'Login' },
    { id: 'save', icon: '&#128190;', label: 'Save' },
    { id: 'reset', icon: '&#8635;', label: 'Reset' },
  ];
  let menuSel = 0;
  let resetArmed = false; // Reset asks once; the next Z on it, with nothing in between, goes ahead

  // What each game keeps in local storage, read back for the status screen. Each
  // game's `lines` gives the lines to show, or none when it has not been played.
  const stored = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  const num = (key) => Number(stored(key)) || 0;
  const obj = (key) => { try { return JSON.parse(stored(key)) || {}; } catch { return {}; } };
  const clock = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
  const points = (key) => { const b = num(key); return b ? [`${b.toLocaleString()} points`] : []; };
  // One line per mode that has a best: `read` fetches it, `show` words it.
  const byMode = (modes, read, show = (v) => v) => Object.entries(modes)
    .map(([m, label]) => { const v = read(m); return v ? `${label} ${show(v)}` : null; })
    .filter(Boolean);
  const EASY3 = { easy: 'easy', medium: 'medium', hard: 'hard' };
  const NORMAL2 = { normal: 'normal', hard: 'hard' };
  const PROGRESS = [
    { name: 'Pong', lines: () => byMode({ 1: 'solo', 2: 'duo' }, (m) => num(`pong-best-rally-${m}`), (v) => `rally of ${v}`) },
    { name: 'Balatro', lines: () => { const b = num('balatro-best'); return b ? [`reached ante ${Math.ceil(b / 3)}`] : []; } },
    { name: 'Tetris', lines: () => points('tetris-best') },
    { name: 'Hashi', lines: () => byMode(EASY3, (m) => obj('hashi-best')[m], clock) },
    { name: 'Pikachu', lines: () => points('pika-best') },
    { name: 'Flappy Bird', lines: () => byMode(NORMAL2, (m) => num(`flappy-best-${m}`), (v) => `${v} pipes`) },
    {
      name: 'Missiles!',
      lines: () => [
        ...byMode({ normal: 'normal', fast: 'fast' }, (m) => num(`missiles-best-${m}`), (v) => `${v.toLocaleString()} points`),
        ...(num('missiles-stars') ? [`${num('missiles-stars')} stars gathered`] : []),
      ],
    },
    { name: 'Minesweeper', lines: () => byMode(EASY3, (m) => obj('mines-best')[m], clock) },
    { name: 'Snake', lines: () => byMode(EASY3, (m) => num(`snake-best-${m}`), (v) => `${v} apples`) },
    { name: 'Sneak', lines: () => byMode(NORMAL2, (m) => num(`sneak-best-${m}`), clock) },
    { name: 'Climb', lines: () => byMode(NORMAL2, (m) => num(`climb-best-${m}`), (v) => `${v} m`) },
    { name: 'Zero', lines: () => points('zero-best') },
    { name: 'Bomberman', lines: () => byMode(EASY3, (m) => num(`bomber-best-${m}`), (v) => `${v.toLocaleString()} points`) },
    { name: 'Block Breaker', lines: () => byMode(NORMAL2, (m) => num(`breaker-best-${m}`), (v) => `${v.toLocaleString()} points`) },
    { name: 'Race', lines: () => byMode(NORMAL2, (m) => obj('race-best')[m], (v) => `${clock(v)} for three laps`) },
    { name: 'Memory', lines: () => byMode(EASY3, (m) => obj('memory-best')[m], clock) },
  ];

  // The account module (account.js) loads after this script, so look it up each time.
  const account = () => window.arcadeAccount;
  const menuLabel = (item) => (item.id === 'login' && account()?.who() ? 'Logout' : item.label);

  const renderMenu = () => {
    menuList.replaceChildren(...MENU.map((item, i) => {
      const li = document.createElement('li');
      rowButton(li, i === menuSel, item.icon, menuLabel(item), { menu: i });
      return li;
    }));
  };

  const note = (text) => {
    menuNote.textContent = text;
    menuNote.hidden = false;
  };

  const closeMenu = () => {
    if (state === 'menu') refocus();
    menuEl.hidden = true;
    menuNote.hidden = true;
    resetArmed = false;
    if (state === 'menu') state = 'playing';
  };

  const openMenu = () => {
    state = 'menu';
    held.length = 0;
    hero.frame = 0;
    menuNote.hidden = true;
    renderMenu();
    menuEl.hidden = false;
  };

  const menuMove = (d) => {
    menuSel = (menuSel + d + MENU.length) % MENU.length;
    menuNote.hidden = true;
    resetArmed = false;
    renderMenu();
  };

  const renderStatus = () => {
    let played = 0;
    statusList.replaceChildren(...PROGRESS.map((g) => {
      const lines = g.lines();
      if (lines.length) played++;
      const li = document.createElement('li');
      li.classList.toggle('is-blank', !lines.length);
      const name = document.createElement('b');
      name.textContent = g.name;
      const text = document.createElement('span');
      text.textContent = lines.length ? lines.join(' · ') : 'not played yet';
      li.append(name, text);
      return li;
    }));
    if (mons()) {
      const li = document.createElement('li');
      const name = document.createElement('b');
      name.textContent = 'Monsters';
      const text = document.createElement('span');
      text.textContent = `${mons().owned().length} of ${mons().TOTAL} owned`;
      li.append(name, text);
      statusList.append(li);
    }
    statusSum.textContent = `${played} of ${PROGRESS.length} games played`;
  };

  const openStatus = () => {
    state = 'status';
    refocus();
    renderStatus();
    menuEl.hidden = true;
    statusEl.hidden = false;
  };

  // Back from the status screen to the menu.
  const closeStatus = () => {
    statusEl.hidden = true;
    if (state === 'status') {
      state = 'menu';
      menuEl.hidden = false;
    }
  };

  /* ---------- Monsterdex and My mons ---------- */

  // Both share one panel: a list of monsters (all hundred slots in the
  // Monsterdex, with a search box; the player's own under My mons) and a page
  // for the chosen one with its sprites, types, fact and moves. A monster the player
  // does not own yet is hidden in the Monsterdex: its slot shows only its number
  // and a dark silhouette, its name reads ???, and only its number finds it.
  // ↑/↓ choose, Enter or Z opens the page, Escape or X goes back to the list
  // and then to the menu. While the search box has focus the letter keys type
  // into it, so only Enter, Escape and the arrows are taken.
  const mons = () => window.arcadeMons || null;

  // The boss room's door, the one locked tile on the map. It becomes an ordinary
  // door, walkable and drawn like the others, as soon as every monster is owned;
  // that is checked when the dungeon starts, on the way back from a game, after a
  // login merges a cloud copy in, and when the hero tries the door.
  const BOSS_DOOR = (() => { for (let y = 0; y < ROWS; y++) { const x = LAYOUT[y].indexOf('x'); if (x >= 0) return [x, y]; } return null; })();
  let bossOpen = false;
  const unlockBoss = () => {
    if (bossOpen) return true;
    const api = mons();
    if (!BOSS_DOOR || !api || api.owned().length < api.TOTAL) return false;
    bossOpen = true;
    const [x, y] = BOSS_DOOR;
    grid[y][x] = FLOOR;
    TILES[FLOOR](mctx, x * TILE, y * TILE, x, y);
    mctx.fillStyle = 'rgba(0, 0, 0, .14)'; // the shade every door has
    mctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    return true;
  };
  const monsEl = root.querySelector('[data-mons]');
  const monsTitle = root.querySelector('[data-mons-title]');
  const monsSearch = root.querySelector('[data-mons-search]');
  const monsList = root.querySelector('[data-mons-list]');
  const monsPage = root.querySelector('[data-mons-page]');
  const monsHint = root.querySelector('[data-mons-hint]');
  let monsMode = 'dex'; // dex | mine | pc
  let monsFrom = 'menu'; // menu | pc: where closing the panel goes back to
  let monsAll = null; // every monster, once the list has loaded (fetched straight away: the wall below needs it)
  window.arcadeMons?.load().then((list) => { monsAll = list; }).catch(() => { /* the Monsterdex tries again */ });
  let monsNote = ''; // what the list says while it has no rows: loading, or why not
  let monsShown = []; // the rows on screen, after the search
  let monsSel = 0;
  let monsOpen = null; // the monster whose page is up

  const el = (tag, className, text) => {
    const e = document.createElement(tag);
    e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const typeChips = (m, holder) => m.types.forEach((t) => holder.append(el('i', `dungeon__mons-type is-${t}`, t)));

  // The rows to list: the player's own, or everyone who matches the search by
  // name, number or type.
  const monsRows = () => {
    if (!monsAll) return [];
    const api = mons();
    const have = new Set(api.owned());
    if (monsMode === 'pc') { // the party first, then the PC, each in the order gained
      const byId = new Map(monsAll.map((m) => [m.id, m]));
      return [...api.party(), ...api.boxed()].map((id) => byId.get(id)).filter(Boolean);
    }
    const list = monsMode === 'mine' ? monsAll.filter((m) => have.has(m.id)) : monsAll;
    const q = monsMode === 'dex' ? monsSearch.value.trim().toLowerCase() : '';
    if (!q) return list;
    if (/^\d+$/.test(q)) return list.filter((m) => m.id === Number(q));
    return list.filter((m) => have.has(m.id) && (m.name.toLowerCase().includes(q) || m.types.some((t) => t.startsWith(q))));
  };
  const hidden = (m) => monsMode === 'dex' && !mons().owned().includes(m.id);

  const renderMonsList = () => {
    const api = mons();
    const have = new Set(api.owned());
    const party = api.party();
    const walks = new Set(api.walking());
    monsTitle.textContent = monsMode === 'dex' ? `Monsterdex · ${have.size} of ${api.TOTAL} owned`
      : monsMode === 'pc' ? `PC · ${party.length} of ${api.PARTY_MAX} with you · ${have.size - party.length} stored`
        : `My mons · ${have.size} · ${party.length} with you · ${walks.size} walking`;
    monsShown = monsRows();
    monsSel = Math.min(monsSel, Math.max(0, monsShown.length - 1));
    if (!monsShown.length) {
      const why = !monsAll ? monsNote : monsMode === 'dex' ? 'No monster goes by that.' : 'No monsters yet.';
      monsList.replaceChildren(el('li', 'dungeon__mons-empty', why));
      return;
    }
    const inParty = new Set(party);
    const fresh = new Set(api.fresh());
    const rows = [];
    monsShown.forEach((m, i) => {
      // In the PC, a heading opens each group: the party, then the stored ones.
      if (monsMode === 'pc' && (i === 0 || inParty.has(monsShown[i - 1].id) !== inParty.has(m.id))) {
        rows.push(el('li', 'dungeon__mons-group', inParty.has(m.id) ? `With you (${party.length} of ${api.PARTY_MAX})` : `In the PC (${monsShown.length - party.length})`));
      }
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.row = i;
      b.classList.toggle('is-sel', i === monsSel);
      const hide = hidden(m);
      const pic = el('span', hide ? 'dungeon__mons-pic is-hidden' : 'dungeon__mons-pic');
      api.paint(pic, m.id, 'front', 28);
      const types = el('span', 'dungeon__mons-types');
      if (!hide) typeChips(m, types);
      b.append(pic, el('span', 'dungeon__mons-no', api.no(m.id)), el('span', hide ? 'dungeon__mons-name is-hidden' : 'dungeon__mons-name', hide ? '???' : m.name));
      if (monsMode !== 'dex' && fresh.has(m.id)) b.append(el('span', 'dungeon__mons-new', 'NEW'));
      if (monsMode === 'mine' && !inParty.has(m.id)) b.append(el('span', 'dungeon__mons-where', 'PC'));
      if (monsMode !== 'dex' && walks.has(m.id)) b.append(el('span', 'dungeon__mons-walk', 'WALKS'));
      b.append(types);
      li.append(b);
      rows.push(li);
    });
    monsList.replaceChildren(...rows);
    monsList.querySelector('.is-sel')?.scrollIntoView({ block: 'nearest' });
  };

  // What Z does on a monster's page: swap it over in the PC, or under My mons
  // have a party member walk behind the hero, or stay.
  const pageAct = (m) => {
    if (monsMode === 'pc') return 'swap';
    if (monsMode !== 'mine' || !mons().party().includes(m.id)) return '';
    return mons().walking().includes(m.id) ? 'stay' : 'walk';
  };
  const monsHintFor = (page) => {
    if (page) monsHint.innerHTML = pageAct(page) ? `<kbd>Z</kbd> ${pageAct(page)} · <kbd>X</kbd> back` : '<kbd>X</kbd> back';
    else if (monsMode === 'dex') monsHint.innerHTML = '<kbd>&uarr;</kbd><kbd>&darr;</kbd> choose · <kbd>Enter</kbd> open · <kbd>Esc</kbd> back';
    else monsHint.innerHTML = '<kbd>&uarr;</kbd><kbd>&darr;</kbd> choose · <kbd>Z</kbd> open · <kbd>X</kbd> back';
  };

  // How a monster not yet owned is won, from rewards.csv via monsters.js.
  const GAME_NAMES = {
    pong: 'Pong', balatro: 'Balatro', tetris: 'Tetris', hashi: 'Hashi', race: 'Race', memory: 'Memory',
    flappy: 'Flappy Bird', missiles: 'Missiles!', pikachu: 'Pikachu', snake: 'Snake', climb: 'Climb',
    minesweeper: 'Minesweeper', sneak: 'Sneak', zero: 'Zero', bomberman: 'Bomberman', breaker: 'Block Breaker',
  };
  const MODE_WORDS = new Set(['easy', 'medium', 'hard', 'normal', 'fast', 'single', 'duo']);
  const earnHint = (r) => {
    const game = GAME_NAMES[r.game] || r.game;
    const mode = MODE_WORDS.has(r.mode) ? ` on ${r.mode}` : '';
    return `Win it in ${game}${mode}: ${r.achievement[0].toLowerCase()}${r.achievement.slice(1)}.`;
  };

  // A monster's four moves, one card each: name, type, kind, then power,
  // accuracy and PP (a dash where there is none, or for a move that never
  // misses), and what the move does.
  const movesList = (m) => {
    const list = el('ul', 'dungeon__mons-moves');
    list.setAttribute('aria-label', 'Moves');
    m.moves.forEach((mv) => {
      const top = el('div', 'dungeon__mons-move-top');
      top.append(el('strong', 'dungeon__mons-move-name', mv.name), el('i', `dungeon__mons-type is-${mv.type}`, mv.type));
      const stats = `${mv.kind} · Pow ${mv.power ?? '—'} · Acc ${mv.accuracy === null ? '—' : `${mv.accuracy}%`} · PP ${mv.pp ?? '—'}`;
      const li = el('li', 'dungeon__mons-move');
      li.append(top, el('span', 'dungeon__mons-move-stats', stats), el('span', 'dungeon__mons-move-effect', mv.effect));
      list.append(li);
    });
    return list;
  };

  // The page for one monster: both sprites beside its number and name, types
  // and fact, then its moves, laid out to fit without scrolling. A hidden one shows only its number and the silhouette of
  // its front, and says which achievement wins it.
  const showMonsPage = (m) => {
    const api = mons();
    monsOpen = m;
    const hide = hidden(m);
    const pics = el('div', 'dungeon__mons-pics');
    (hide ? ['front'] : ['front', 'back']).forEach((side) => {
      const pic = el('span', hide ? 'dungeon__mons-pic dungeon__mons-pic--big is-hidden' : 'dungeon__mons-pic dungeon__mons-pic--big');
      pic.title = side;
      api.paint(pic, m.id, side, 64);
      pics.append(pic);
    });
    const head = el('div', 'dungeon__mons-head');
    head.append(el('span', 'dungeon__mons-no', `No. ${api.no(m.id)}`), el('strong', hide ? 'dungeon__mons-bigname is-hidden' : 'dungeon__mons-bigname', hide ? '???' : m.name));
    const types = el('p', 'dungeon__mons-types');
    if (!hide) typeChips(m, types);
    const fact = hide ? 'Nothing is known about this monster yet. Make it yours to read its page.' : m.fact;
    const how = hide ? api.earnedBy?.(m.id) : null;
    const yours = hide ? `Not one of yours yet.${how ? ` ${earnHint(how)}` : ''}` : whereIs(m);
    if (!hide) api.seen(m.id); // looked at: no longer new
    const info = el('div', 'dungeon__mons-info');
    info.append(head, types, el('p', 'dungeon__mons-fact', fact), el('p', 'dungeon__mons-own', yours));
    const top = el('div', 'dungeon__mons-top');
    top.append(pics, info);
    monsPage.replaceChildren(top);
    if (!hide && m.moves?.length) monsPage.append(movesList(m));
    refocus();
    monsSearch.hidden = true;
    monsList.hidden = true;
    monsPage.hidden = false;
    monsHintFor(m);
  };

  // Where an owned monster is, and what Z does with it: in the PC it changes
  // places; under My mons a party member starts or stops walking behind the hero.
  const whereIs = (m) => {
    const api = mons();
    const party = api.party();
    const starter = m.id === api.STARTER ? ' Your starter, with you since your first step into the dungeon.' : '';
    if (party.includes(m.id)) {
      if (monsMode === 'mine') {
        return api.walking().includes(m.id)
          ? `With you, walking behind you through the dungeon.${starter} Press Z to have it ride along quietly instead.`
          : `With you.${starter} Press Z to have it walk behind you through the dungeon.`;
      }
      if (monsMode !== 'pc') return `With you.${starter}`;
      return party.length > 1 ? `With you.${starter} Press Z to leave it in the PC.` : `With you, and someone has to be.${starter} Bring another along first.`;
    }
    if (monsMode !== 'pc') return `In the PC.${starter}`;
    return party.length < api.PARTY_MAX ? 'In the PC. Press Z to bring it along.' : `In the PC. Your party is full: leave one of the ${api.PARTY_MAX} behind to bring this one along.`;
  };
  // Z on a page in the PC: the monster changes places, if it can.
  const pcSwap = (m) => {
    const api = mons();
    const moved = api.party().includes(m.id) ? api.deposit(m.id) : api.withdraw(m.id);
    if (moved) { refreshPets(); closeMonsPage(); }
  };
  // Z on a page under My mons: a party member starts or stops walking behind the hero.
  const walkToggle = (m) => {
    if (!pageAct(m)) return;
    mons().toggleWalk(m.id);
    refreshPets();
    showMonsPage(m);
  };

  const closeMonsPage = () => {
    monsOpen = null;
    monsPage.hidden = true;
    monsList.hidden = false;
    monsSearch.hidden = monsMode !== 'dex';
    monsHintFor(false);
    renderMonsList();
    if (monsMode === 'dex') monsSearch.focus({ preventScroll: true });
  };

  const openMons = (mode, from = 'menu') => {
    const api = mons();
    if (!api) {
      menuNote.textContent = 'The monsters are missing: monsters.js did not load.';
      menuNote.hidden = false;
      return;
    }
    state = 'mons';
    refocus();
    monsMode = mode;
    monsFrom = from;
    monsOpen = null;
    monsSel = 0;
    menuEl.hidden = true;
    monsSearch.value = '';
    monsSearch.hidden = mode !== 'dex';
    monsPage.hidden = true;
    monsList.hidden = false;
    monsHintFor(false);
    monsEl.hidden = false;
    if (!monsAll) {
      monsNote = 'Fetching the monsters…';
      api.load()
        .then((list) => { monsAll = list; })
        .catch(() => { monsNote = 'Could not load assets/monster.csv. Serve the folder over http to meet the monsters.'; })
        .finally(() => { if (state === 'mons') renderMonsList(); });
    }
    renderMonsList();
    if (mode === 'dex') monsSearch.focus({ preventScroll: true });
  };

  // Z at the PC in the lobby: the same panel, listing the party and the stored monsters.
  const openPC = () => openMons('pc', 'pc');

  // Back from the monsters to the menu, or to the map from the PC.
  const closeMons = () => {
    if (state === 'mons') refocus();
    monsEl.hidden = true;
    if (state === 'mons') {
      if (monsFrom === 'pc') state = 'playing';
      else {
        state = 'menu';
        menuEl.hidden = false;
      }
    }
  };
  const monsBack = () => { if (monsOpen) closeMonsPage(); else closeMons(); };
  const monsMove = (d) => {
    if (monsOpen || !monsShown.length) return;
    monsSel = (monsSel + d + monsShown.length) % monsShown.length;
    renderMonsList();
  };
  const monsActivate = () => {
    if (monsOpen) { if (monsMode === 'pc') pcSwap(monsOpen); else walkToggle(monsOpen); return; }
    if (monsShown[monsSel]) showMonsPage(monsShown[monsSel]);
  };

  monsSearch.addEventListener('input', () => {
    monsSel = 0;
    renderMonsList();
  });
  monsList.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || state !== 'mons') return;
    monsSel = Number(b.dataset.row);
    renderMonsList();
    monsActivate();
  });
  monsPage.addEventListener('click', () => { if (state === 'mons' && monsOpen) closeMonsPage(); });

  // Z on the chosen row: open the status screen or the monsters, or log in, log
  // out or save through the account module. Its promises settle after the
  // Google popup or the write, so the note reports as it goes.
  // Reset: every best, star, plane, monster, party and pet kept in this browser
  // goes, and the cloud copy with it when the player is logged in; the jukebox's
  // settings stay. The page then reloads so every game starts from nothing.
  const PROGRESS_PREFIXES = [
    'pong-best', 'balatro-best', 'tetris-best', 'hashi-best', 'pika-best', 'flappy-best', 'missiles-', 'mines-best',
    'snake-best', 'sneak-best', 'climb-best', 'zero-best', 'bomber-best', 'breaker-best', 'race-best', 'memory-best', 'arcade-',
  ];
  const resetProgress = () => {
    note('Starting over…');
    try {
      Object.keys(localStorage).filter((k) => PROGRESS_PREFIXES.some((p) => k.startsWith(p))).forEach((k) => localStorage.removeItem(k));
    } catch { /* storage unavailable: nothing was kept anyway */ }
    const acct = account();
    const cloud = acct?.who() ? acct.save().catch(() => { /* the next Save will push the empty state */ }) : Promise.resolve();
    cloud.then(() => location.reload());
  };

  const menuActivate = () => {
    const item = MENU[menuSel];
    if (item.id === 'status') { openStatus(); return; }
    if (item.id === 'dex' || item.id === 'mine') { openMons(item.id); return; }
    if (item.id === 'reset') {
      if (resetArmed) { resetArmed = false; resetProgress(); return; }
      resetArmed = true;
      note(`This wipes every best, star, monster and party from this browser${account()?.who() ? ' and from your cloud save' : ''}, back to Sparkit alone. Press Z again to start over, or move away to keep playing.`);
      return;
    }
    resetArmed = false;
    const acct = account();
    if (!acct) { note('Accounts are not available right now. Your progress stays in this browser.'); return; }
    const fail = (err) => {
      if (err?.code === 'auth/popup-closed-by-user' || err?.code === 'auth/cancelled-popup-request') note('Sign-in cancelled.');
      else if (err?.code === 'auth/popup-blocked') note('The browser blocked the sign-in window. Allow pop-ups for this site and try again.');
      else if (err?.message === 'Log in first') note('Log in first, then save.');
      else note('Something went wrong. Check your connection and try again.');
    };
    if (item.id === 'login' && acct.who()) {
      acct.logout().then(() => { note('Logged out. Your progress stays in this browser.'); renderMenu(); }, fail);
    } else if (item.id === 'login') {
      note('Opening Google sign-in…');
      acct.login().then((name) => { note(`Logged in as ${name}. Your progress is merged and saved.`); renderMenu(); unlockBoss(); refreshPets(); }, fail);
    } else {
      note('Saving…');
      acct.save().then(() => note(`Saved for ${acct.who()}.`), fail);
    }
  };

  menuList.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || state !== 'menu') return;
    menuSel = Number(b.dataset.menu);
    renderMenu();
    menuActivate();
  });
  statusEl.addEventListener('click', () => { if (state === 'status') closeStatus(); });

  // Z: use the thing in front of the hero, turn the page while reading, or act on the jukebox row.
  const interact = () => {
    if (state === 'reading') {
      nextPage();
      return;
    }
    if (state === 'juke') {
      jukeActivate();
      return;
    }
    if (state !== 'playing') return;
    const thing = nearThing();
    if (!thing) {
      if (nearLocked()) startReading(unlockBoss() ? { name: 'Boss room door', pages: OPENED_PAGES } : { name: 'Locked door', pages: lockedPages() });
      return;
    }
    if (thing.game) enterGame(thing);
    else if (thing.juke) openJuke();
    else if (thing.pc) openPC();
    else if (thing.legend) readLegend(thing);
    else if (thing.wall) punchWall(thing);
    else if (thing.ball) pickBall(thing);
    else startReading(thing);
  };

  // Z at the breakable wall: a monster with the hero that knows a punching move
  // breaks it, and the secret room opens. Without one the wall only sounds hollow,
  // and if the puncher is in the PC, the page says so.
  const punchers = () => {
    const api = mons();
    const have = new Set(api.owned());
    return (monsAll || []).filter((m) => have.has(m.id)).map((m) => ({ m, move: m.moves.find((mv) => /punch/i.test(mv.name)) })).filter((p) => p.move);
  };
  const punchWall = (thing) => {
    const api = mons();
    const party = new Set(api.party());
    const found = punchers();
    const here = found.find((p) => party.has(p.m.id));
    if (here) {
      api.keep('sneak-wall');
      revealSecret();
      startReading({ name: thing.name, pages: [`${here.m.name} used ${here.move.name}! The wall crumbles, and a way opens behind it.`] });
    } else if (found.length) {
      startReading({ name: thing.name, pages: [`The wall sounds hollow here. ${found[0].m.name} knows ${found[0].move.name}, but it is waiting in the PC.`] });
    } else {
      startReading({ name: thing.name, pages: ['The wall sounds hollow here. Something with a hard punch might break through.'] });
    }
  };
  const pickBall = (thing) => {
    mons().keep('ball');
    bagBall = true;
    takeBall();
    startReading({ name: thing.name, pages: ['You found the Ball! It goes into your bag, and shows in the corner of the map.'] });
  };

  const pause = () => {
    if (!PAUSABLE.has(state)) return;
    stopReading();
    closeJuke();
    closeStatus();
    closeMons();
    closeMenu();
    state = 'paused';
    cancelAnimationFrame(raf);
    held.length = 0;
    hero.frame = 0;
    draw(performance.now());
    showOverlay('Paused', 'Continue');
  };

  const resume = () => {
    state = 'playing';
    overlay.hidden = true;
    stage.focus({ preventScroll: true });
    run();
  };

  const tick = (t) => {
    const dt = Math.max(0, Math.min(50, t - lastTime)); // the first frame stamp can predate run()
    lastTime = t;

    if (state === 'leaving' || state === 'returning') {
      const k = Math.min(1, (t - fadeAt) / FADE);
      fade = state === 'leaving' ? fadeFrom + (1 - fadeFrom) * k : fadeFrom * (1 - k);
      draw(t);
      if (k < 1) raf = requestAnimationFrame(tick);
      else if (state === 'leaving') switchTo(target);
      else {
        state = 'playing';
        unlockBoss(); // a monster may have been won in the game
        raf = requestAnimationFrame(tick);
      }
      return;
    }
    if (!PAUSABLE.has(state)) return;

    const dir = state === 'playing' && held[held.length - 1];
    if (dir) {
      hero.dir = dir;
      const step = (SPEED * dt) / 1000;
      const dx = (held.includes('right') ? 1 : 0) - (held.includes('left') ? 1 : 0);
      const dy = (held.includes('down') ? 1 : 0) - (held.includes('up') ? 1 : 0);
      const norm = dx && dy ? Math.SQRT1_2 : 1;
      if (dx) slide('x', dx * step * norm);
      if (dy) slide('y', dy * step * norm);
      trailStep();
      hero.walked += dt;
      hero.frame = Math.floor(hero.walked / STEP) % 2;
    } else {
      hero.walked = 0;
      hero.frame = 0;
    }

    const r = roomAt(...feetTile());
    if (r && r !== room) {
      room = r;
      roomOut.textContent = r.name;
    }

    moveCam(dt);
    draw(t);
    raf = requestAnimationFrame(tick);
  };

  /* ---------- Input ---------- */

  const KEYS = {
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  };
  const unhold = (dir) => {
    const i = held.indexOf(dir);
    if (i >= 0) held.splice(i, 1);
  };
  const hold = (dir) => {
    unhold(dir);
    held.push(dir);
  };

  root.addEventListener('keydown', (e) => {
    if (e.target.closest('button') && (e.code === 'Enter' || e.code === 'Space')) return;
    if (state === 'idle' || state === 'paused') {
      if ((e.code === 'Enter' || e.code === 'KeyZ') && !e.repeat) {
        e.preventDefault();
        resume();
      }
      return;
    }
    if (state === 'juke') {
      if (e.code === 'ArrowUp' || e.code === 'KeyW') jukeMove(-1);
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') jukeMove(1);
      else if (e.code === 'ArrowLeft' || e.code === 'KeyA') jukeSide(-1);
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') jukeSide(1);
      else if (e.code === 'KeyZ' || e.code === 'Enter') { if (!e.repeat) jukeActivate(); }
      else if (e.code === 'KeyX' || e.code === 'Escape') closeJuke();
      else return;
      e.preventDefault();
      return;
    }
    if (state === 'menu') {
      if (e.code === 'ArrowUp' || e.code === 'KeyW') menuMove(-1);
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') menuMove(1);
      else if (e.code === 'KeyZ' || e.code === 'Enter') { if (!e.repeat) menuActivate(); }
      else if (e.code === 'KeyX' || e.code === 'Escape') closeMenu();
      else return;
      e.preventDefault();
      return;
    }
    if (state === 'status') {
      if (['KeyX', 'Escape', 'KeyZ', 'Enter'].includes(e.code)) { if (!e.repeat) closeStatus(); } else return;
      e.preventDefault();
      return;
    }
    if (state === 'mons') {
      const typing = e.target === monsSearch;
      if (e.code === 'ArrowUp' || (!typing && e.code === 'KeyW')) monsMove(-1);
      else if (e.code === 'ArrowDown' || (!typing && e.code === 'KeyS')) monsMove(1);
      else if (e.code === 'Enter' || (!typing && e.code === 'KeyZ')) { if (!e.repeat) monsActivate(); }
      else if (e.code === 'Escape' || (!typing && e.code === 'KeyX')) { if (!e.repeat) monsBack(); }
      else return;
      e.preventDefault();
      return;
    }
    if (state !== 'playing' && state !== 'reading') return;
    if (e.code === 'Enter') {
      if (state !== 'playing') return;
      e.preventDefault();
      if (!e.repeat) openMenu();
    } else if (e.code === 'KeyZ') {
      e.preventDefault();
      if (!e.repeat) interact();
    } else if (e.code === 'KeyX' || e.code === 'Escape') {
      if (state !== 'reading') return;
      e.preventDefault();
      stopReading();
    } else if (KEYS[e.code]) {
      e.preventDefault();
      if (!e.repeat && state === 'playing') hold(KEYS[e.code]);
    }
  });
  root.addEventListener('keyup', (e) => {
    const dir = KEYS[e.code];
    if (dir) unhold(dir);
  });

  // Touch pad: hold a direction to keep walking; Z and X act like the keys.
  root.querySelectorAll('[data-dir]').forEach((b) => {
    const dir = b.dataset.dir;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (state === 'juke') {
        if (dir === 'up') jukeMove(-1);
        else if (dir === 'down') jukeMove(1);
        else jukeSide(dir === 'right' ? 1 : -1);
        return;
      }
      if (state === 'menu' || state === 'mons') {
        const move = state === 'menu' ? menuMove : monsMove;
        if (dir === 'up') move(-1);
        else if (dir === 'down') move(1);
        return;
      }
      if (state !== 'playing') return;
      hold(dir);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((type) => b.addEventListener(type, () => unhold(dir)));
  });
  root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const act = b.dataset.act;
    if (act === 'menu') {
      if (state === 'playing') openMenu();
      else if (state === 'menu') closeMenu();
      else if (state === 'status') closeStatus();
      else if (state === 'mons') closeMons();
    } else if (act === 'z') {
      if (state === 'menu') menuActivate();
      else if (state === 'status') closeStatus();
      else if (state === 'mons') monsActivate();
      else interact();
    } else if (state === 'reading') stopReading();
    else if (state === 'juke') closeJuke();
    else if (state === 'status') closeStatus();
    else if (state === 'mons') monsBack();
    else if (state === 'menu') closeMenu();
  }));
  talkEl.addEventListener('click', () => { if (state === 'reading') nextPage(); });
  startBtn.addEventListener('click', resume);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) resume();
  });

  // The red window button of each game window leads back to the dungeon.
  THINGS.filter((t) => t.game).forEach((t) => {
    const game = document.querySelector(t.game);
    game?.querySelectorAll('[data-exit]').forEach((b) => b.addEventListener('click', () => leaveGame(game)));
  });

  // Stop whenever attention goes elsewhere.
  root.addEventListener('focusout', (e) => {
    if (!e.relatedTarget || !root.contains(e.relatedTarget)) pause();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!root.contains(e.target)) pause();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
  });
  window.addEventListener('blur', pause);

  unlockBoss(); // a collection completed before this visit
  { // the secret room, if it was opened before, and the ball, if it was taken
    const found = mons()?.items() || [];
    if (found.includes('sneak-wall')) revealSecret();
    if (found.includes('ball')) {
      bagBall = true;
      takeBall();
    }
  }
  refreshPets(); // the ones set to walk fall in behind the hero
  roomOut.textContent = room.name;
  [cam.x, cam.y] = camTarget();
  draw(0);
  showOverlay('Explore the lobby, then find the sixteen game rooms. One door stays locked.', 'Enter the dungeon');
})();
