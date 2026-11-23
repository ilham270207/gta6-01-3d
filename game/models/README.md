# game/models/ — Quaternius GLB models (embedded, not loaded from here)

The Quaternius GLB models are **base64-embedded** in `game/src/quaternius-data.js`
and parsed with `GLTFLoader.parse` (see `game/src/quaternius.js`).

Why embedded instead of files in this folder: `fetch()` from `file://` is
blocked by Chrome's CORS policy, and the game must load via `file://` with
0 console errors (the dossier screenshots are taken from `file://`).
Embedding is the same pattern already used for CesiumMan
(`game/src/cesium-man-data.js`).

Source GLBs live in `models-quaternius/` (staging folder, not part of the
game). Regenerate the embedded file with the embed script (see the commit
that introduced `quaternius-data.js`).

Models used (all CC0, Quaternius via Poly Pizza — no attribution required):
- Characters: jax-male, la-rosa-female, npc-male-business, npc-female-2
- Cars: sports-car, sedan, suv, taxi, police-car
- Weapons: pistol, smg, shotgun, rifle (only the pistol is shown in-game;
  the game has a single pistol tier)

NOT used (still only in `models-quaternius/`): the 7 GLB buildings and the
2 GLB trees (palm, pine) — the procedural city already covers those, and
the 2 CC-BY buildings (hospital by Poly by Google, house by burunduk)
were deliberately left out so no CC-BY attribution is needed in the game.

## Ilham's NEW character models (fetched, NOT embedded)

- `male.glb` (Jax) + `female.glb` (La Rosa) — sent by ilham 23 Nov 2026,
  UE5-style rigs, 0 animations. Loaded at boot via `fetch('./models/male.glb')`
  (see `game/src/retarget.js`) — only on http(s) (GitHub Pages preview); on
  `file://` the fetch is skipped silently and the game falls back to the
  embedded Quaternius heroes.
- Animations (walk/idle/run/punch) are retargeted at load from the Quaternius
  clips (world-space, rest-pose-corrected) — no animation data is copied from
  any other file; the retarget code was written in a recorded session.
- NOT embedded because the two files are ~31 MB together and would push the
  game past its 20 MB budget.
- Weapons: the game now has 4 tiers (pistol, SMG, shotgun, rifle) + fists,
  bought at the Vega Arms gun shop — see `WEAPONS` in `game/src/config.js`.
