// Monsters for the Play section: the hundred creatures listed in
// assets/monster.csv (number, name, types and a fact), the four moves each
// knows from assets/moves.csv (described in assets/all-moves.csv), their front and back
// sprites on the two sheets in assets/, and the ones the player owns, kept in
// this browser. The two legendary monsters after them in the CSV are not
// collected: they fight each other in the boss room, from their own sheets. Everyone starts with no. 49, Sparkit. The dungeon's menu shows
// them all in the Monsterdex and the player's own under My mons. The other
// ninety-nine are won in the games: rewards.csv says which achievement earns
// which monster, and a game calls award(key) at the moment it is done. The
// first time a key is earned its monster joins the player's and a toast says so.
// The player carries up to six of them, the party; the rest wait in the PC in
// the lobby, and one that goes straight there, because the party was full, is
// marked new until it is looked at. Some of the party may walk behind the
// player through the dungeon, chosen under My mons; `walking` lists them.
window.arcadeMons = (() => {
  const CSV = 'assets/monster.csv';
  const MOVES = 'assets/moves.csv'; // each monster's four moves, by name
  const MOVE_LIST = 'assets/all-moves.csv'; // every move: type, kind, power, accuracy, PP and effect
  const REWARDS = 'rewards.csv';
  const TOAST_MS = 4200;
  const STARTER = 49;
  const TOTAL = 100;
  const OWNED_KEY = 'arcade-mons';
  const PARTY_KEY = 'arcade-party'; // the ids with the player, up to PARTY_MAX, in order
  const NEW_KEY = 'arcade-pc-new'; // ids sent to the PC that the player has not looked at yet
  const WALK_KEY = 'arcade-walk'; // the ids that walk behind the player in the dungeon
  const ITEMS_KEY = 'arcade-items'; // the things found in the dungeon, by name
  const PARTY_MAX = 6;

  // The sheets hold the sprites ten to a row in number order, on an even grid
  // of 32 px cells: `x` and `y` are the eleven cell boundaries of each sheet,
  // in pixels. The front sheet has a transparent background, the back sheet a
  // black one. `inset` trims the edge of each cell, none on these sheets.
  const GRID = Array.from({ length: 11 }, (_, i) => i * 32);
  const SHEETS = {
    front: { src: 'assets/monster-front.png', w: 320, h: 320, inset: 0, x: GRID, y: GRID },
    back: { src: 'assets/monster-back.png', w: 320, h: 320, inset: 0, x: GRID, y: GRID },
  };
  // The walking sprites, the size of the dungeon's hero: one row per monster,
  // eight 16 x 14 frames across it, two (standing, stepping) per direction.
  const WALK = { src: 'assets/monster-walk.png', w: 16, h: 14, cols: { down: 0, up: 2, left: 4, right: 6 } };
  // The two legendary monsters, numbered past TOTAL in the same CSV, are not
  // among the hundred to collect: they hold the boss room, locked in battle
  // (see dungeon.js). Their sprites are on their own sheet in 32 px cells, a
  // row per monster and side (front, then back, in number order), and across
  // each row the animation frames: column 0 the plain sprite, then `anims`
  // says where each animation starts and how many frames it has. Their
  // avatars, 16 x 14 like the walking sprites, are on a second sheet, front
  // then back across and a row per monster. Both sheets are built from
  // assets/legendary.png by tools/build-legendary.py.
  const LEGEND = {
    src: 'assets/monster-legendary.png', w: 480, h: 128, cell: 32,
    anims: { idle: [0, 1], shine: [1, 4], attack: [5, 6], focus: [11, 4] },
  };
  const LEGEND_AVATAR = { src: 'assets/legendary-avatar.png', w: 16, h: 14 };
  const legendRow = (id, side) => (id - TOTAL - 1) * 2 + (side === 'back' ? 1 : 0);
  // One frame of a legendary monster's animation on its sheet, in pixels, with
  // how many frames the animation has; `frame` counts round and round.
  const legendFrame = (id, side, anim, frame = 0) => {
    const [from, n] = LEGEND.anims[anim] || LEGEND.anims.idle;
    const c = LEGEND.cell;
    return { src: LEGEND.src, sheetW: LEGEND.w, sheetH: LEGEND.h, x: (from + (((frame % n) + n) % n)) * c, y: legendRow(id, side) * c, w: c, h: c, frames: n };
  };
  // A legendary monster's avatar on the avatar sheet, in pixels.
  const legendAvatar = (id, side) => ({ src: LEGEND_AVATAR.src, x: side === 'back' ? LEGEND_AVATAR.w : 0, y: (id - TOTAL - 1) * LEGEND_AVATAR.h, w: LEGEND_AVATAR.w, h: LEGEND_AVATAR.h });

  // The cell of a monster's sprite on a sheet, in pixels; a legendary's is its plain frame.
  const sprite = (id, side) => {
    if (id > TOTAL) return legendFrame(id, side, 'idle');
    const s = SHEETS[side];
    const c = (id - 1) % 10;
    const r = Math.floor((id - 1) / 10);
    const w = s.x[c + 1] - s.x[c];
    const h = s.y[r + 1] - s.y[r];
    return { src: s.src, sheetW: s.w, sheetH: s.h, x: s.x[c] + w * s.inset, y: s.y[r] + h * s.inset, w: w * (1 - 2 * s.inset), h: h * (1 - 2 * s.inset) };
  };

  // The frame of a monster walking `dir` on the walking sheet, in pixels.
  const walkFrame = (id, dir, frame) => ({ src: WALK.src, x: (WALK.cols[dir] + (frame ? 1 : 0)) * WALK.w, y: (id - 1) * WALK.h, w: WALK.w, h: WALK.h });

  // Paint a monster's sprite into a tile `size` px square: the tile holds one
  // inner element the exact shape of the cell, scaled to fit and centred, with
  // the sheet as its background, so nothing of the neighbouring cells shows.
  const paint = (tile, id, side, size) => {
    const r = sprite(id, side);
    const k = size / Math.max(r.w, r.h);
    tile.style.width = `${size}px`;
    tile.style.height = `${size}px`;
    const inner = tile.firstElementChild || tile.appendChild(document.createElement('i'));
    inner.style.width = `${r.w * k}px`;
    inner.style.height = `${r.h * k}px`;
    inner.style.backgroundImage = `url(${r.src})`;
    inner.style.backgroundSize = `${r.sheetW * k}px ${r.sheetH * k}px`;
    inner.style.backgroundPosition = `${-r.x * k}px ${-r.y * k}px`;
    inner.style.backgroundRepeat = 'no-repeat';
  };

  // A small CSV reader: commas, quoted cells with doubled quotes, CRLF or LF lines.
  const parseCsv = (text) => {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch !== '"') cell += ch;
        else if (text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    const [head, ...body] = rows;
    return body.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i]])));
  };

  const fetchText = (url) => fetch(url).then((res) => { if (!res.ok) throw new Error(`${url}: ${res.status}`); return res.text(); });

  // Each monster's four moves, by number: [{ name, type, kind, power, accuracy,
  // pp, effect }]. The move list names types as the games do (Flying for fly);
  // `type` is turned into the monsters' own words. Kind is Physical, Special or
  // Status (the list marks some status moves by the stat they change). Power,
  // accuracy and PP are null where the move has none; accuracy is null too
  // for a move that never misses. Without the files the monsters simply know no moves.
  const loadMoves = () => Promise.all([fetchText(MOVES), fetchText(MOVE_LIST)])
    .then(([sets, list]) => {
      const num = (v) => (/^\d+$/.test(v) ? Number(v) : null);
      const byName = new Map(parseCsv(list).filter((r) => r['#']?.trim()).map((r) => {
        const kind = r.Kind.trim();
        const acc = num(r.Accuracy.trim().replace('%', ''));
        const power = num(r.Power.trim());
        return [r.Name.trim(), {
          name: r.Name.trim(),
          type: r.Type.trim().toLowerCase().replace('flying', 'fly'),
          kind: kind === 'Physical' || kind === 'Special' ? kind : 'Status',
          power: power || null,
          accuracy: acc && acc <= 100 ? acc : null,
          pp: num(r.PP.trim()),
          effect: r.Effect.trim(),
        }];
      }));
      return new Map(parseCsv(sets).map((r) => [Number(r.id),
        [r.move1, r.move2, r.move3, r.move4].map((n) => byName.get(n?.trim())).filter(Boolean)]));
    })
    .catch((err) => { console.warn(err); return new Map(); });

  // The CSV, fetched once: [{ id, name, types, fact, moves }] in number order.
  // `load` gives the hundred to collect, `legendary` the legendary ones after them.
  let loading = null;
  const loadAll = () => {
    loading ??= Promise.all([fetchText(CSV), loadMoves()])
      .then(([text, moves]) => parseCsv(text)
        .map((m) => ({ id: Number(m.id), name: m.name, types: m.type.split(',').map((t) => t.trim()).filter(Boolean), fact: m.fact }))
        .filter((m) => m.id >= 1)
        .map((m) => ({ ...m, moves: moves.get(m.id) || [] }))
        .sort((a, b) => a.id - b.id))
      .catch((err) => { loading = null; throw err; }); // so a later try can fetch again
    return loading;
  };
  const load = () => loadAll().then((all) => all.filter((m) => m.id <= TOTAL));
  const legendary = () => loadAll().then((all) => all.filter((m) => m.id > TOTAL));

  // The player's monsters, by number, in the order they were gained.
  const owned = () => {
    try {
      const got = JSON.parse(localStorage.getItem(OWNED_KEY));
      if (Array.isArray(got)) return [...new Set(got.map(Number).filter((n) => n >= 1 && n <= TOTAL))];
    } catch { /* storage unavailable or junk */ }
    return [STARTER];
  };
  const own = (id) => {
    const list = owned();
    if (!list.includes(id)) {
      list.push(id);
      try { localStorage.setItem(OWNED_KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
    }
    return list;
  };
  const no = (id) => String(id).padStart(3, '0'); // "049"

  /* ---------- The party and the PC ---------- */

  const readList = (key) => {
    try {
      const got = JSON.parse(localStorage.getItem(key));
      if (Array.isArray(got)) return [...new Set(got.map(Number).filter((n) => n >= 1 && n <= TOTAL))];
    } catch { /* storage unavailable or junk */ }
    return null;
  };
  const writeList = (key, list) => { try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* storage unavailable */ } };

  // The monsters with the player, owned ones only and at most PARTY_MAX. Without
  // a saved party (a player from before there was one) it is the first six owned.
  const party = () => {
    const have = owned();
    return (readList(PARTY_KEY) || have).filter((id) => have.includes(id)).slice(0, PARTY_MAX);
  };
  // The rest, kept in the PC.
  const boxed = () => {
    const p = new Set(party());
    return owned().filter((id) => !p.has(id));
  };
  // The ones in the PC not yet looked at. Kept in memory as well, since the map
  // asks every frame whether to show the PC's tag.
  let newCache = null;
  const fresh = () => (newCache ??= readList(NEW_KEY) || []);
  const seen = (id) => {
    if (!fresh().includes(id)) return;
    newCache = fresh().filter((x) => x !== id);
    writeList(NEW_KEY, newCache);
  };
  // Bring a monster from the PC along, if there is room; leave one in the PC,
  // as long as it is not the last with the player. Each says whether it happened.
  const withdraw = (id) => {
    const p = party();
    if (p.includes(id) || !owned().includes(id) || p.length >= PARTY_MAX) return false;
    writeList(PARTY_KEY, [...p, id]);
    seen(id);
    return true;
  };
  const deposit = (id) => {
    const p = party();
    if (!p.includes(id) || p.length <= 1) return false;
    writeList(PARTY_KEY, p.filter((x) => x !== id));
    return true;
  };

  // The party members that walk behind the player, in party order. Saying one
  // should walk or stay is remembered even while it sits in the PC, so it falls
  // back into line when it is brought along again. `toggleWalk` says what it is now.
  const walking = () => {
    const w = new Set(readList(WALK_KEY) || []);
    return party().filter((id) => w.has(id));
  };
  const toggleWalk = (id) => {
    const w = readList(WALK_KEY) || [];
    const on = !w.includes(id);
    writeList(WALK_KEY, on ? [...w, id] : w.filter((x) => x !== id));
    return on;
  };

  /* ---------- Things found in the dungeon ---------- */

  // The names of the things the player has found or done in the dungeon, in
  // order (a secret opened, an item picked up). `keep` adds one, saving to
  // the cloud as a reward does, and says whether it was new.
  const items = () => {
    try {
      const got = JSON.parse(localStorage.getItem(ITEMS_KEY));
      if (Array.isArray(got)) return [...new Set(got.filter((s) => typeof s === 'string'))];
    } catch { /* storage unavailable or junk */ }
    return [];
  };
  const keep = (name) => {
    const list = items();
    if (list.includes(name)) return false;
    list.push(name);
    try { localStorage.setItem(ITEMS_KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
    const acct = window.arcadeAccount;
    if (acct?.who()) acct.save().catch(() => { /* the Save menu item can retry */ });
    return true;
  };

  /* ---------- Rewards ---------- */

  // The table from rewards.csv, by key: { key, game, mode, achievement, id, name }.
  // It is fetched as soon as this file runs, so by the time a game ends it is
  // long since here; a key earned before then is kept and settled on arrival.
  let rewards = null;
  const early = [];
  const loadRewards = fetch(REWARDS)
    .then((res) => { if (!res.ok) throw new Error(`${REWARDS}: ${res.status}`); return res.text(); })
    .then((text) => {
      rewards = new Map(parseCsv(text)
        .map((r) => ({ key: r.key, game: r.game, mode: r.mode, achievement: r.achievement, id: Number(r.monster_id), name: r.monster_name }))
        .filter((r) => r.key && r.id >= 1 && r.id <= TOTAL)
        .map((r) => [r.key, r]));
      early.splice(0).forEach(award);
      return rewards;
    })
    .catch((err) => { console.warn(err); return null; });

  // The reward a monster is won for, for the Monsterdex: { game, mode, achievement } or null.
  const earnedBy = (id) => (rewards ? [...rewards.values()].find((r) => r.id === id) || null : null);

  // A small banner at the top of the page, one at a time; the next waits its turn.
  let toastEl = null;
  let toastTimer = 0;
  const queue = [];
  const showToast = () => {
    if (toastTimer || !queue.length) return;
    const r = queue.shift();
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'mon-toast';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.body.append(toastEl);
    }
    const pic = document.createElement('span');
    pic.className = 'mon-toast__pic';
    paint(pic, r.id, 'front', 44);
    const text = document.createElement('span');
    text.className = 'mon-toast__text';
    const name = document.createElement('strong');
    name.textContent = r.carried ? `No. ${no(r.id)} ${r.name} joins your party!` : `No. ${no(r.id)} ${r.name} is yours, and waits in the PC.`;
    const how = document.createElement('small');
    how.textContent = r.achievement;
    text.append(name, how);
    toastEl.replaceChildren(pic, text);
    toastEl.classList.add('is-on');
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('is-on');
      toastTimer = 0;
      setTimeout(showToast, 350); // after it has slid away
    }, TOAST_MS);
  };

  // A game reports an achievement by its key in rewards.csv. The first time,
  // the monster becomes the player's and the toast announces it; the row is
  // returned, with `carried` saying whether it joined the party or, the party
  // being full, went to the PC as new. Later times, and unknown keys, return null.
  const award = (key) => {
    if (!rewards) {
      if (loadRewards && !early.includes(key)) early.push(key);
      return null;
    }
    const r = rewards.get(key);
    if (!r || owned().includes(r.id)) return null;
    own(r.id);
    const p = party();
    const carried = p.length < PARTY_MAX;
    if (carried) writeList(PARTY_KEY, [...p, r.id]);
    else {
      newCache = [...fresh(), r.id];
      writeList(NEW_KEY, newCache);
    }
    const got = { ...r, carried };
    queue.push(got);
    showToast();
    const acct = window.arcadeAccount; // a player who is logged in keeps it in the cloud too
    if (acct?.who()) acct.save().catch(() => { /* the Save menu item can retry */ });
    return got;
  };

  return { STARTER, TOTAL, PARTY_MAX, load, legendary, sprite, walkFrame, legendFrame, legendAvatar, paint, owned, own, no, party, boxed, fresh, seen, withdraw, deposit, walking, toggleWalk, items, keep, award, earnedBy, rewards: () => loadRewards };
})();
