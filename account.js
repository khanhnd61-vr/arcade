// Accounts for the dungeon menu: Google sign-in through Firebase Auth and a
// cloud copy of the player's progress in Firestore. Local storage stays the
// source of truth while playing, since every game writes its best there. Login
// pulls the cloud copy down and merges it, keeping the better best for each
// key; Save pushes the local copy up. The dungeon's menu (dungeon.js) calls
// the window.arcadeAccount API at the bottom.
//
// The config below is public by design: Firebase client keys only name the
// project, and anyone can read them from the page. What keeps the data safe
// is firestore.rules (each player may read and write only their own document,
// and only the keys listed there), the authorized-domain list in the console,
// and the referrer restriction on the key. There is no server and no secret.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyAUQk8P625_w-i5_Rycv9Rw_R_xqJLPQ3M',
  authDomain: 'arcade-3302c.firebaseapp.com',
  projectId: 'arcade-3302c',
  storageBucket: 'arcade-3302c.firebasestorage.app',
  messagingSenderId: '1057837806758',
  appId: '1:1057837806758:web:d15d4a2a89f94bb1267067',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Every local-storage key the games keep a best in, plus the owned monsters,
// the party (the ones carried), the ones that walk behind the player and the
// things found in the dungeon; the party and the walkers are choices, so this
// browser's win over the cloud's, while monsters and things found are joined.
// This list is the contract with firestore.rules: a key missing there is
// rejected on save, so add new games to both.
const KEYS = [
  'pong-best-rally-1', 'pong-best-rally-2', 'balatro-best', 'tetris-best', 'hashi-best', 'pika-best',
  'flappy-best-normal', 'flappy-best-hard', 'missiles-best-normal', 'missiles-best-fast', 'missiles-stars',
  'mines-best', 'snake-best-easy', 'snake-best-medium', 'snake-best-hard', 'sneak-best-normal',
  'sneak-best-hard', 'climb-best-normal', 'climb-best-hard', 'zero-best', 'bomber-best-easy',
  'bomber-best-medium', 'bomber-best-hard', 'breaker-best-normal', 'breaker-best-hard', 'race-best',
  'memory-best', 'arcade-mons', 'arcade-party', 'arcade-walk', 'arcade-items',
];
// Keys that hold a JSON map of mode -> milliseconds, where lower is better.
const TIMES = new Set(['hashi-best', 'mines-best', 'race-best', 'memory-best']);
const MONS = 'arcade-mons'; // a JSON list of monster numbers
const PARTY = 'arcade-party'; // a JSON list of up to six of them
const WALK = 'arcade-walk'; // a JSON list of the ones that walk behind the player
const ITEMS = 'arcade-items'; // a JSON list of the things found in the dungeon, by name

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };
const json = (s, fallback) => { try { return JSON.parse(s) ?? fallback; } catch { return fallback; } };

// The local progress as one flat map of raw strings, keyed as in local storage.
const collect = () => Object.fromEntries(KEYS.map((k) => [k, read(k)]).filter(([, v]) => typeof v === 'string'));

// Fold a cloud copy into local storage, keeping the better of the two per key.
const merge = (bests) => {
  for (const k of KEYS) {
    const theirs = bests[k];
    if (typeof theirs !== 'string') continue;
    const mine = read(k);
    if (mine === null) { write(k, theirs); continue; }
    if (k === PARTY || k === WALK) continue; // choices, not scores: this browser's stand
    if (k === MONS) {
      const all = [...json(mine, []), ...json(theirs, [])].map(Number).filter((n) => n >= 1);
      write(k, JSON.stringify([...new Set(all)]));
    } else if (k === ITEMS) {
      const all = [...json(mine, []), ...json(theirs, [])].filter((s) => typeof s === 'string');
      write(k, JSON.stringify([...new Set(all)]));
    } else if (TIMES.has(k)) {
      const a = json(mine, {});
      const b = json(theirs, {});
      const out = { ...a };
      for (const m of Object.keys(b)) out[m] = a[m] ? Math.min(a[m], b[m]) : b[m];
      write(k, JSON.stringify(out));
    } else {
      write(k, String(Math.max(Number(mine) || 0, Number(theirs) || 0)));
    }
  }
};

let user = null;
const ready = new Promise((resolve) => {
  onAuthStateChanged(auth, (u) => { user = u; resolve(); });
});

const save = async () => {
  await ready;
  if (!user) throw new Error('Log in first');
  await setDoc(doc(db, 'players', user.uid), { bests: collect(), updatedAt: serverTimestamp() });
};

// Sign in with Google, merge the cloud copy into this browser, then save the
// merged progress back so both sides agree. Resolves to the player's name.
const login = async () => {
  const { user: u } = await signInWithPopup(auth, new GoogleAuthProvider());
  user = u;
  const snap = await getDoc(doc(db, 'players', u.uid));
  if (snap.exists()) merge(snap.data().bests || {});
  await save();
  return u.displayName || u.email || 'player';
};

const logout = () => signOut(auth);

window.arcadeAccount = {
  login,
  save,
  logout,
  ready,
  who: () => (user ? user.displayName || user.email || 'player' : null),
};
