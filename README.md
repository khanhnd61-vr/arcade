# Arcade

A pixel dungeon of sixteen small browser games, served as a static site on GitHub Pages. Plain HTML, CSS and
JavaScript, no build step: serve the folder over http and open `index.html`.

## Playing

Walk the dungeon (`dungeon.js`) with the arrows and press Z at a cabinet. Each game keeps its bests in local storage.

| Game | File | Game | File |
| --- | --- | --- | --- |
| Pong | `pong.js` | Snake | `snake.js` |
| Balatro-lite | `balatro.js` | Bomberman | `bomberman.js` |
| Tetris | `tetris.js` | Sneak | `sneak.js` |
| Hashi | `hashi.js` | Climb | `climb.js` |
| Pikachu | `pikachu.js` | Block Breaker | `breaker.js` |
| Flappy Bird | `flappy.js` | Zero | `zero.js` |
| Missiles! | `missiles.js` | Race | `race.js` |
| Minesweeper | `minesweeper.js` | Memory | `memory.js` |

The lobby has a guide book (a few words from the maker, and a link to havi.fit), a PC and a jukebox. The room next to it, where the two legendary monsters fight, is locked until all hundred monsters are owned.

Enter opens the menu: **Status** (progress in every game), **Monsterdex**, **My mons**, **Login** (Google sign-in that
merges and saves progress in the cloud), **Save** and **Reset** (wipes all progress, after a confirming second Z).

## Monsters

The hundred monsters are listed in `assets/monster.csv`, with sprites in `assets/monster-*.png`; `monsters.js` reads
them and tracks which are owned. Everyone starts with no. 49, Sparkit. The rest are rewards: `rewards.csv` maps an
achievement key to a monster, and a game calls `arcadeMons.award(key)` when it happens. The first time, the monster is
yours and a toast says so. To change a reward, edit the row; to add one, add a row and call `award` from the game.

Two legendary monsters, no. 101 Aurelyon and no. 102 Noctyrax, come after the hundred in the CSV but are not collected:
they fight each other without end in the boss room, the battlefield behind the locked door, and pressing Z at one shows
its page with its animations. Their sprites come from `assets/legendary.png` (the artwork, front views above and back
views below) by way of `tools/build-legendary.py`, which writes `assets/monster-legendary.png` (32 px cells, a row per
monster and side: the plain sprite, then the shining, beam-charge and focus-energy frames) and
`assets/legendary-avatar.png` (16 x 14 avatars, drawn by hand in the script, front then back). It needs Pillow and
numpy; run it from the repo root after changing the artwork or the pixel maps.

Six monsters travel with the player (the party). Others wait in the PC in the lobby, where they can be swapped; a reward
that arrives while the party is full goes to the PC flagged NEW. Party members can also be set to walk behind the hero.

## Accounts

`account.js` uses Firebase from Google's CDN. `firestore.rules` lets each player write only `players/{uid}` and only
with the local-storage keys listed there, so a new key goes in both files. Deploy with
`firebase deploy --only firestore:rules`. Scores come from the browser and are not used for a leaderboard.
