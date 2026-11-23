# LA VEGA 3D

An open-world crime game in the sun-baked coastal city of **La Vega** —
and the wild country around it. You are **Jax Vega**, a driver fresh off
the ferry. **La Rosa**, the fixer who runs the club on Marlin Row, has ten
jobs for you across three acts — steal cars, run packages, shake the cops,
settle the score with the Vultures, and pull off the La Vega Score across
the whole city.

Everything is original: the city, the characters, the cars, the story, the
art and the music. (A real GTA 6 trailer was shown to the team only as a
mood reference — neon, beach, sunset, a living city. None of its characters,
places, scenes or names are in this game. The energy, not the content.)

## Play

Serve the folder and open it in a desktop browser, or open `game/index.html`
through any static server. The game needs no build step and makes no network
requests — it runs fully offline.

```sh
node serve.ts
# then open http://localhost:8080
```

Or play the preview at https://ilham270207.github.io/gta6-01-3d/game/

## Revision — 22 Nov evening (after ilham's Android playtest)

- **Touch camera fixed:** dragging right now turns the view right (it was
  inverted), with smooth inertia instead of a jump per event, a saner base
  sensitivity, and the Settings slider actually scales it. Dragging also
  pauses the camera auto-follow for a moment so your hand wins. The camera
  sits higher/farther now and is pulled out of any building footprint it
  would otherwise end up inside, so walls stop filling the screen.
- **Minimalist touch HUD:** the round modern minimap moved to the top-left
  (semi-transparent, thin ring, player arrow, pulsing mission marker, N
  indicator, red cop dots when wanted). The top bar is one flex row —
  minimap, act + objective, money/clock/stars — so nothing overlaps at any
  width. Toasts moved to the top, clear of the buttons. Action buttons are
  smaller (56px) and contextual: GAS/BRAKE only in a car, PUNCH/FIRE only
  on foot (FIRE only with a pistol), ENTER only near a car, the club, or the
  dealer (or to exit a car). Pause sits bottom-centre.
- **Fixed:** ENTER is now a one-shot action — it used to stay latched and
  could enter/exit a car every frame. E at a gas station still refuels
  first, at the garage repairs first, then exits.
- The in-game trailer (`game/trailer.mp4`) is being re-recorded after the
  building/GLB pass and is not in this push; the WATCH TRAILER button hides
  itself until it is back.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrow keys | Move on foot, drive in a car |
| Shift | Run |
| Space | Punch |
| F (or mouse click) | Shoot the pistol |
| E | Get in / out of a car, steal a parked car, talk to La Rosa, refuel / repair |
| 1 / 2 / 3 (at Auto Palms) | Buy sedan $800 / truck $1,000 / sport $1,500 |
| P / Esc | Pause |
| S (while paused) | Save game |
| Q (while paused) | Quit to title |
| M | Mute |

On Android: left virtual joystick to move/drive, right buttons for GAS,
BRAKE, ENTER, PUNCH and FIRE. Drag the screen to rotate the camera.

## The campaign — 10 jobs, 3 acts

**Act I — Fresh Off the Ferry:** (1) First Wheels — lift a car for Manny's
Garage ($300 + pistol). (2) Dock Run — a package at Pier 9, cops on your
tail ($500). (3) The Vultures' Warning — run two thugs off the club, fists
only ($400).

**Act II — Heat Rising:** (4) Shake the Tail — lose a two-star wanted level
($400). (5) Warehouse Payback — four Vultures at the old cannery ($700).
(6) The Getaway Driver — courier from La Vega General to the Neon Palm
Casino in two minutes ($800). (7) Grand Theft Marina — lift the red sport
car from Auto Palms in broad daylight ($600).

**Act III — The La Vega Score:** (8) Clean Wheels — buy your own car, no
heat on it. (9) The Distraction — draw three stars of police attention,
then vanish ($500). (10) The La Vega Score — five drops across the whole
city against the clock ($1,200).

Story cutscenes (dialogue panels) play between jobs. Progress auto-saves
after each job, and you can save from the pause menu. **Continue** on the
title screen picks up where you left off.

## The world

La Vega is a 400×400 open world in four biomes, with chunk loading
(only chunks near you stay loaded, so phones hold 30 fps):

- **La Vega city** — the centre: glass towers, brick apartments, an
  art-deco hotel, the neon casino, a columned city hall, mall, hospital,
  cinema, car dealer, construction site, drive-thru, cannery warehouse,
  La Rosa's club and Manny's Garage. Every building has its own
  architecture — no two blocks look alike: real 3D structure, not just
  texture — ground-floor storefronts with glass and doors, entrance
  canopies, corner pilasters, projecting cornices, floor bands, rooftop
  AC units / water tanks / antennas, framed window grids with floor
  separators on every face (including the sides), and per-landmark
  features (neon blade signs and rooftop block at the casino, columns
  and steps at city hall, helipad on the hospital roof, tire stacks at
  the garage, scaffolding at the construction site). The follow camera
  also steers clear of tree canopies, so it never gets buried in a park
  tree on foot.
- **Sea + beach** — sand, palms, waves and Pier 9 out into the bay.
- **Forest** (north) — dense pines and dark-green trees, dirt roads.
- **Desert** (east) — sand, cacti, rocks, abandoned shacks, a long empty
  highway.
- **Rocky hills** (north-east) — boulders, cliffs and a winding dirt road.

The look is deliberate **PS2 style**: low-poly models, simple flat-shaded
textures, saturated colours, strong distance fog — like the open-world
games of that era, and it keeps the whole game under 6 MiB.

## Smart NPCs & smart police

Pedestrians have personalities — fearful (runs and calls the cops),
watcher (stares, then calls it in), brave (fights back), indifferent
(keeps walking). They hear gunshots, react to your wanted level, walk the
sidewalks and cross at intersections. They also live their own lives:
some sit on kerbs, chat in pairs, or check their phones; in the rain
they run for the nearest building edge. A witness who sees you steal a
car will call it in, and a brave one may swing at you.

The police think ahead: cruisers chase predictively (aiming where you will
be, not where you are), roadblocks go up at 3+ stars, a helicopter with a
spotlight circles you at 4–5 stars, and when they lose sight of you they
switch to search mode around your last known position. Lose them and the
heat cools off; get caught on foot and you are busted.

## District standing

La Vega has four districts — Marina, Downtown, Neon Row, South Beach.
The HUD shows where you are and your standing there; every mission you
finish raises that district's standing by 8%. Standing is saved with
your game (see it all on the pause screen).

## Living traffic & random events

Traffic stops at red lights (6-second cycle, alternating per
intersection), honks when you block the road, yields to pedestrians on
zebra crossings, and swerves around crashes. Every 60–120 seconds
something happens near you: a police pursuit, an ambulance on a call,
two pedestrians brawling, or a street robbery — announced on the police
dispatch channel, never interrupting your mission.

## Dynamic weather

Sun, clouds, rain and storms roll in on a weighted cycle. Rain makes
the roads slick (less grip), pedestrians open their umbrellas in spirit
— they run for cover — and the golden hour burns deep orange at dusk.

## Phone, radio & voices

- **Phone (T)** — call La Rosa for the next job, Manny for a free repair
  at his garage, the crew for backup, or GPS for the next objective.
- **Radio (R)** — three synthesized stations: Neon Tide FM (chill),
  Mango Radio (Latin/reggaeton), Static Dub 88.1 (night synthwave). No
  audio files, no copyrighted music. District ambience follows you —
  surf in the Marina, traffic in Downtown, crowds in Neon Row — and the
  music tempo rises during missions and at 3+ stars.
- **NPC voices** — pedestrians and La Rosa speak short dubbed lines via
  the browser's speech synthesis (different pitch per character, toggle
  in Settings); a short synth "blip" if voices are unavailable.
- **Horn (H)** — lean on it; nearby pedestrians turn to look.
- **Nitro (N)** — boost while the tank lasts; refill at Petro Vega.

## Side activities, business & skills

- **Stunt jumps** (3 ramps) — hit one at speed for +$150.
- **Collectibles** — 10 gold packages hidden around the city and biomes,
  +$50 each.
- **Taxi jobs** — hop in a cab and a fare may appear; deliver fast for
  $80–$150.
- **Businesses (B)** — buy the Neon Bar ($2,000, at the casino) or a
  share of Manny's Garage ($1,500) for passive income every game hour;
  buy the Beach House safehouse ($1,200) to respawn there.
- **Respray (4, at the garage)** — recolour your car for $50.
- **Skills** — driving, shooting and stamina level up as you use them
  (top speed, damage and run speed); shown on the pause screen.

## Simulator touches

- **Fuel** — every car has a tank. Fill up at Petro Vega ($20).
- **Damage & repair** — crashes wreck cars; Manny's Garage fixes them
  (price scales with damage). A wrecked car will not drive.
- **Economy & garage** — mission money buys cars at Auto Palms; your cars
  wait for you at Manny's Garage (3 slots).
- **Day-night cycle** — the sun moves, golden hour at dusk, lamps and
  headlights at night; clouds, rain and storms roll in and out.
- **Rush hour** — traffic gets dense at 08:00 and 17:00.
- **Radio** — three procedural stations (Neon Tide FM, Mango Radio,
  Static Dub 88.1) plus district ambience; music volume in Settings.

## Menu, settings & trailer

The title screen is a live cinematic: a slow golden-hour orbit over the
living city. **Settings** (persisted) covers graphics quality
(Low/Medium/High), shadows on/off, music and SFX volume, mute, NPC
voices (dubbing) on/off and camera sensitivity — all of them really
change the game, and the game also drops
a quality level automatically if the frame rate sags. **Watch Trailer**
plays a 30-second cinematic recorded from the game itself
(`game/trailer.mp4`, also in `video/`).

## Screenshots

The four screenshots in `screenshots/` are deterministic scenes from the
game itself — run it with `?shot=cover|chase|mission|city&seed=1`:

- `1-cover.jpg` — cruising the central boulevard in the sport car, one star.
- `2-chase.jpg` — three stars, two cruisers on your tail at the beach.
- `3-mission.jpg` — the Dock Run pickup on Pier 9, beacon lit.
- `4-city.jpg` — on foot in Palm Court Park, pedestrians and a boosted sedan.

## Files

- `game/index.html` — the game page (HUD, menus, touch controls).
- `game/src/main.js` — boot, input, screens, video autopilot.
- `game/src/game.js` — player, cars, traffic, pedestrians, police, wanted,
  combat, missions, camera, HUD, minimap, save/load.
- `game/src/city.js` — city generation, landmarks, biomes, chunk loading,
  structured-building kit (ground floor, canopy, pilasters, crown,
  rooftop props, side windows) and tree spots for the camera.
- `game/src/vehicles.js` — the five car models + traffic AI.
- `game/src/humanoid.js` — CesiumMan GLB rig, cloned per humanoid
  (player, pedestrians, police, rivals) via SkeletonUtils, each with its
  own skeleton and shirt tint.
- `game/src/config.js` — tuning, places, the 10-mission campaign.
- `game/src/audio.js` — procedural WebAudio: engine, sirens, gunshots,
  pickups and a bassline loop.
- `game/src/settings.js` — persisted settings + quality application.
- `game/three/` — vendored Three.js (no CDN, no network).
- `game/trailer.mp4` — the 30-second trailer, recorded from the game.
- `main.ts` — make.fun entry plumbing (copies `game/` + `screenshots/`
  and writes `dossier.json`).
- `serve.ts` — static dev server.
- `shots.json` — the four screenshot scenes.
- `video/` — screenshot + video capture scripts (not part of the entry).

## Credits & license

MIT — see `LICENSE`. All code, story, art and audio are original or
procedural. Characters, cars and the pistol use **Quaternius** models
(CC0, via Poly Pizza), embedded as base64 — Jax, La Rosa, pedestrians,
police, rivals, the sports car, sedans, SUV, taxi, police cruiser and the
pistol. The fallback humanoid is **CesiumMan**, donated by Cesium and
licensed under **CC-BY 4.0** (embedded, with attribution). No copyrighted
music, models or textures are used.
