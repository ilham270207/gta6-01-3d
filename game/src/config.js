// LA VEGA 3D — configuration. All original: a sun-baked coastal city, La Vega.
// Three.js, vendored under game/three/. No network requests at runtime.
// World units are metres. The 2D layout (2600x2600) is scaled by 0.1 -> 260x260.
const STEP = 1 / 60;
const SAVE_KEY = 'la-vega-3d-save-v1';

// Menu character select (Android-style): the 3D model stands on a pedestal
// next to the menu buttons; the choice is saved and becomes the player model.
const CHARACTERS = [
  { id: 'jax', name: 'JAX VEGA', role: 'Wheelman — the new guy', desc: 'Fresh off the ferry, empty pockets, fast reputation. La Rosa gave him one shot.' },
  { id: 'laRosa', name: 'LA ROSA', role: 'Club owner — runs Neon Row', desc: 'She owns the best club in town — and everyone in it owes her something.' },
  { id: 'npcMale', name: 'LEO', role: 'Crew muscle', desc: 'The crew\'s heavy hands. Never misses a debt, never starts a fight he can\'t finish.' },
  { id: 'npcFemale', name: 'MAYA', role: 'Crew driver', desc: 'The fastest wheel in La Vega. If Maya can\'t outrun it, it can\'t be outrun.' },
];

const WORLD = {
  size: 400,          // metres, square — city (0..260) + biomes around it
  seaX: 15,           // x < 15 is sea
  sandX: 30,          // 15..30 is sand beach
  roadWidth: 10,
  sidewalk: 2.5,
  citySize: 260,      // La Vega city grid occupies 0..260
};

// Biomes (chunks of the 400x400 map, city at the south-west):
//  - SEA + BEACH: x < 30, all z (sand, palms, Pier 9)
//  - FOREST: x 0..260, z 260..400 (dense dark-green trees, dirt roads)
//  - DESERT: x 260..400, z 0..260 (sand, cacti, rocks, long empty highway)
//  - ROCKY HILLS: x 260..400, z 260..400 (boulders, cliffs, winding dirt road)
const BIOMES = {
  forest: { x0: 0, z0: 260, x1: 260, z1: 400 },
  desert: { x0: 260, z0: 0, x1: 400, z1: 260 },
  hills: { x0: 260, z0: 260, x1: 400, z1: 400 },
};

// Road centre lines (both axes), metres. Blocks sit between consecutive roads.
const ROADS = [39, 65, 91, 117, 143, 169, 195, 221, 247];

// Street names, one per road centre line — shown in the HUD location label
// (district + street + standing, Karimbu-style). NS = vertical roads
// (constant x), EW = horizontal roads (constant z). All La Vega originals.
const STREETS_NS = ['Shoreline Dr', 'Palm Row', 'Marina Blvd', 'Neon Ave', 'Casino Row', 'Market St', 'Harbor Blvd', 'Sunset Ave', 'Bayview Dr'];
const STREETS_EW = ['Ferry St', 'Club Row', 'Hotel Row', 'Pier Ave', 'City Hall Blvd', 'Garden St', 'Depot Rd', 'Forest Rd', 'Ridge Rd'];

const PALETTE = {
  grass: 0x8fce62,
  grassDark: 0x7cc155,
  sand: 0xf2d492,
  sea: 0x2f9fd8,
  seaDeep: 0x1e7fc0,
  road: 0x4a505c, // lightened (M3c): the old 0x3d4149 went near-black in the rain
  roadLine: 0xf5d76e,
  sidewalk: 0xc9c2b4,
  park: 0x69b455,
  pond: 0x5fb8d9,
  pier: 0xa97c50,
  sky: 0x87c5e8,
  sun: 0xfff2d0,
};

// Key places in La Vega (all original names), metres.
const PLACES = {
  club: { x: 156, y: 104, name: "La Rosa's Club" },
  garage: { x: 78, y: 156, name: "Manny's Garage" },
  warehouse: { x: 52, y: 208, name: 'Old Cannery Warehouse' },
  hospital: { x: 208, y: 52, name: 'La Vega General' },
  pierPickup: { x: 8.2, y: 130, name: 'Pier 9 Drop' },
  dock: { x: 23.5, y: 130, name: 'The Docks' },
  park: { x: 104, y: 78, name: 'Palm Court Park' },
  beach: { x: 23, y: 78, name: 'La Vega Beach' },
  cityHall: { x: 182, y: 182, name: 'La Vega City Hall' },
  casino: { x: 117, y: 65, name: 'Neon Palm Casino' },
  dealer: { x: 65, y: 91, name: 'Auto Palms' },
  gunShop: { x: 143, y: 117, name: 'Vega Arms Gun Shop' },
  villa: { x: 52, y: 52, name: 'Villa La Vega' },
  gas: { x: 30, y: 200, name: 'Petro Vega' },
  harbor: { x: 20, y: 130, name: 'La Vega Harbor' },
  station: { x: 130, y: 156, name: 'LVPD Station' },
  petshop: { x: 78, y: 130, name: 'Paws & Claws Pet Shop' },
  restaurant: { x: 195, y: 130, name: 'Warung La Vega' },
  villa2: { x: 221, y: 221, name: 'Villa del Mar' },
  mall: { x: 104, y: 156, name: 'La Vega Mall' },
};

// Car models: length, width, accel, top speed, turn rate, base colours, shop price.
const CAR_MODELS = {
  sedan: { name: 'Vega Sedan', len: 4.6, wid: 1.9, accel: 14, top: 32, turn: 2.4, colors: [0xd94f3d, 0x3d7dd9, 0xe8e8e8, 0x5a5a66, 0xe0a13c], price: 800 },
  suv: { name: 'Vega SUV', len: 4.7, wid: 2.0, accel: 15, top: 35, turn: 2.5, colors: [0x2a9d8f, 0x3d7dd9, 0xe8e8e8, 0x20242c], price: 1200 },
  taxi: { name: 'Taxi', len: 4.6, wid: 1.9, accel: 13, top: 31, turn: 2.4, colors: [0xf7c948], price: 0 },
  truck: { name: 'Vega Hauler', len: 6.4, wid: 2.4, accel: 9, top: 24, turn: 1.7, colors: [0x7a8a99, 0xb0653a, 0x4e7a51], price: 1000 },
  sport: { name: 'Vega Comet', len: 4.4, wid: 1.9, accel: 20, top: 44, turn: 2.9, colors: [0xe01e37, 0xff8c1a, 0x22c3aa], price: 1500 },
  police: { name: 'Cruiser', len: 4.8, wid: 2.0, accel: 17, top: 40, turn: 2.7, colors: [0x20242c], price: 0 },
  pickup: { name: 'Vega Pickup', len: 4.6, wid: 2.0, accel: 13, top: 33, turn: 2.4, colors: [0x7a8a99, 0xb0653a, 0x4e7a51, 0xe8e8e8], price: 1100 }, // Quaternius pickup GLB (CC0) — M3c
  bus: { name: 'City Bus', len: 10, wid: 2.6, accel: 8, top: 22, turn: 1.4, colors: [0x2a5a9a], price: 0 }, // AI-only route bus (M3c) — not stealable, not for sale
  // Buy-car GLBs (Poly Pizza, fetched from game/models/cars/). Wedge is the
  // Lamborghini-style flagship — the most expensive car in the dealer.
  wedge: { name: 'Countach Wedge', len: 4.4, wid: 1.9, accel: 24, top: 52, turn: 3.1, colors: [0x7a1fa2], price: 8000, buycar: true },
  dominus: { name: 'Dominus GT', len: 4.4, wid: 2.0, accel: 23, top: 50, turn: 3.0, colors: [0x1e5fd6], price: 6000, buycar: true },
  f1: { name: 'Vega Formula', len: 5.6, wid: 2.2, accel: 26, top: 55, turn: 3.4, colors: [0xd92038], price: 5000, buycar: true },
  convblue: { name: 'Marina Convertible', len: 4.6, wid: 2.0, accel: 19, top: 42, turn: 2.8, colors: [0x2a6fd6], price: 3500, buycar: true },
  roadster: { name: 'Sunset Roadster', len: 4.4, wid: 1.9, accel: 20, top: 44, turn: 2.9, colors: [0xf28c1e], price: 3200, buycar: true },
  sportster: { name: 'Retro Sportster', len: 4.4, wid: 1.9, accel: 19, top: 43, turn: 2.8, colors: [0xe8e8e8], price: 3000, buycar: true },
  convpink: { name: 'Pink Wedge Cabrio', len: 4.6, wid: 1.9, accel: 19, top: 42, turn: 2.8, colors: [0xe86aa8], price: 2800, buycar: true },
  muscle: { name: 'Mustang Muscle', len: 4.4, wid: 2.0, accel: 18, top: 41, turn: 2.6, colors: [0xf7c948], price: 2500, buycar: true },
  hatch: { name: 'City Hatch', len: 4.2, wid: 1.9, accel: 17, top: 38, turn: 2.8, colors: [0x8a8a92], price: 2200, buycar: true },
  sedansport: { name: 'Orange Sport Sedan', len: 4.4, wid: 1.9, accel: 18, top: 40, turn: 2.7, colors: [0xf26a1b], price: 1800, buycar: true },
  vip: { name: 'VIP Classic', len: 4.4, wid: 1.9, accel: 13, top: 33, turn: 2.3, colors: [0x9e2b25], price: 1500, buycar: true },
};
// Buyable at Auto Palms (dealer): order shown in the car shop.
const CAR_CATALOG = ['wedge', 'dominus', 'f1', 'convblue', 'roadster', 'sportster', 'convpink', 'muscle', 'hatch', 'sedansport', 'vip', 'sedan', 'suv', 'truck', 'sport'];

// Districts of La Vega (4 quadrants of the 260x260 city grid).
// Standing 0-100% per district; +8% per mission completed there.
const DISTRICTS = [
  { key: 'marina', name: 'MARINA', x0: 0, z0: 0, x1: 130, z1: 130 },
  { key: 'downtown', name: 'DOWNTOWN', x0: 130, z0: 0, x1: 260, z1: 130 },
  { key: 'neon', name: 'NEON ROW', x0: 0, z0: 130, x1: 130, z1: 260 },
  { key: 'south', name: 'SOUTH BEACH', x0: 130, z0: 130, x1: 260, z1: 260 },
];


// Weapons (Claude parity): 5 tiers — fists, pistol, SMG, shotgun, rifle.
// damage = HP per hit, interval = seconds between shots, range = metres,
// price = gun-shop price, pack = ammo per purchase, len = GLB target length (m).
// mag = magazine size, reload = reload time (s) — Point Blank style ADS kit.
const WEAPONS = {
  fists: { name: 'FISTS', damage: 34, interval: 0.45, range: 2.2, price: 0, pack: 0, len: 0, mag: 0, reload: 0 },
  pistol: { name: 'PISTOL', damage: 50, interval: 0.32, range: 45, price: 600, pack: 24, len: 0.18, mag: 12, reload: 1.1 },
  smg: { name: 'SMG', damage: 22, interval: 0.09, range: 38, price: 1500, pack: 60, len: 0.55, mag: 30, reload: 1.5 },
  shotgun: { name: 'SHOTGUN', damage: 110, interval: 0.85, range: 20, price: 2500, pack: 12, len: 0.95, mag: 6, reload: 2.0 },
  rifle: { name: 'RIFLE', damage: 80, interval: 0.22, range: 70, price: 4000, pack: 30, len: 0.95, mag: 30, reload: 1.7 },
};

// Respect ranks (Claude parity): title grows with jobs done.
const RANKS = ['Newcomer', 'Street Hustler', 'Wheelman', 'Crew Runner', 'Made Driver', 'La Vega Legend'];

const PLAYER = {
  radius: 0.45,
  walk: 4.2,
  run: 7.0,
  punchRange: 2.2,
  punchDamage: 34,
  health: 100,
};

const WANTED_MAX = 5;
const FUEL_PRICE = 20;
const REPAIR_BASE = 50;

// ---------------------------------------------------------------------------
// THE CAMPAIGN — "LA VEGA": three acts, twelve linked jobs. Original story.
// Act I  Fresh Off the Ferry (1-3): Jax arrives, earns La Rosa's trust.
// Act II Heat Rising (4-7): the Vultures push back, the cops close in.
// Act III The La Vega Score (8-12): the big job — clean wheels, a distraction,
//         five drops across the whole city, and the Harbor Heist finale.
// Dialogue lines are shown between missions. Step types: steal, reach,
// deliver, evade, killAll, defeat, checkpoint, reachWanted, buy.
const MISSIONS = [
  {
    id: 1, act: 'ACT I — FRESH OFF THE FERRY', name: 'First Wheels', giver: 'La Rosa',
    dialogueBefore: [
      { who: 'La Rosa', text: "Jax Vega. Fresh off the ferry, broke as a joke, and already my favourite problem." },
      { who: 'Jax', text: "I drive. That's what I do. Point me at a job, Rosa." },
      { who: 'La Rosa', text: "Then drive, baby. Lift a parked car, bring it to Manny's Garage. Don't scratch it... much." },
    ],
    intro: "La Rosa: 'Lift a parked car and bring it to Manny's Garage.'",
    reward: 300,
    steps: [
      { type: 'steal', text: 'Steal a parked car (press E near one)', marker: null },
      { type: 'deliver', text: "Drive it to Manny's Garage", marker: PLACES.garage, needCar: true },
    ],
    dialogueAfter: [
      { who: 'La Rosa', text: "Clean lift. Manny says the engine's sweet. Here's $300 — and a pistol. In this town, you carry one." },
      { who: 'Jax', text: "What's next?" },
      { who: 'La Rosa', text: "A package. Pier 9. The bay cops are jumpy today — expect company." },
    ],
    onComplete: 'Nice wheels. La Rosa slips you a pistol and $300. Welcome to La Vega.',
  },
  {
    id: 2, act: 'ACT I — FRESH OFF THE FERRY', name: 'Dock Run', giver: 'La Rosa',
    intro: "La Rosa: 'A package is waiting at Pier 9. Fetch it, bring it to the club.'",
    reward: 500,
    steps: [
      { type: 'reach', text: 'Pick up the package at Pier 9', marker: PLACES.pierPickup },
      { type: 'deliver', text: "Deliver the package to La Rosa's Club", marker: PLACES.club },
    ],
    dialogueAfter: [
      { who: 'La Rosa', text: "Package safe. $500. You're building a name, Jax — and names attract attention." },
      { who: 'Jax', text: "Whose attention?" },
      { who: 'La Rosa', text: "The Vultures. They torched one of my warehouses last month. They don't like new drivers." },
    ],
    onComplete: 'Package delivered. $500, and La Rosa owes you one.',
  },
  {
    id: 3, act: 'ACT I — FRESH OFF THE FERRY', name: "The Vultures' Warning", giver: 'La Rosa',
    dialogueBefore: [
      { who: 'La Rosa', text: "Two Vultures are leaning on my door staff outside the club. Go remind them whose street this is." },
      { who: 'Jax', text: "Fists or pistol?" },
      { who: 'La Rosa', text: "Fists. Loud guns bring cops, and tonight I need quiet." },
    ],
    intro: "La Rosa: 'Two Vultures outside the club. Run them off — fists only.'",
    reward: 400,
    steps: [
      { type: 'reach', text: 'Get to La Rosa\'s Club', marker: PLACES.club },
      { type: 'defeat', text: 'Run off the Vultures (2 thugs)', marker: PLACES.club, count: 2 },
    ],
    dialogueAfter: [
      { who: 'Vulture thug', text: "This ain't over, Vega. The boss wants this whole bay." },
      { who: 'Jax', text: "Then the boss can come and take it himself." },
      { who: 'La Rosa', text: "Good. But word travels fast — the cops will be watching you now." },
    ],
    onComplete: 'Vultures sent packing. $400. The street knows your name now.',
  },
  {
    id: 4, act: 'ACT I — FRESH OFF THE FERRY', name: 'Neon Street Race', giver: 'La Rosa',
    dialogueBefore: [
      { who: 'La Rosa', text: "Neon Row runs a street race tonight, baby. Win it and the whole crowd will know your name." },
      { who: 'Jax', text: "I just need a car." },
      { who: 'La Rosa', text: "Take the coupe by the club. Hit every checkpoint — and don't let the Vultures cut you off." },
    ],
    intro: "La Rosa: 'Street race on Neon Row tonight. Grab the coupe, hit every checkpoint.'",
    reward: 900,
    steps: [
      { type: 'steal', text: 'Grab the race coupe near the club (press E near it)', marker: null },
      { type: 'checkpoint', text: 'Checkpoint 1/4 — Neon Row north', marker: { x: 130, y: 52 }, time: 150 },
      { type: 'checkpoint', text: 'Checkpoint 2/4 — Neon Row east', marker: { x: 208, y: 130 }, time: 150 },
      { type: 'checkpoint', text: 'Checkpoint 3/4 — South Beach', marker: { x: 130, y: 208 }, time: 150 },
      { type: 'checkpoint', text: 'Finish line — La Rosa\'s Club', marker: PLACES.club, time: 150 },
    ],
    dialogueAfter: [
      { who: 'La Rosa', text: "You smoked them, Jax! The crowd is chanting your name. $900 — and the Vultures just lost a lot of money." },
      { who: 'Jax', text: "Tell the crowd I'll be back tomorrow." },
    ],
    onComplete: 'Race won! $900. Neon Row knows the name Jax Vega now.',
  },
  {
    id: 5, act: 'ACT II — HEAT RISING', name: 'Shake the Tail', giver: 'La Rosa',
    dialogueBefore: [
      { who: 'La Rosa', text: "You are HOT, Jax. Two stars and climbing. Lose the cops — hide, lay low, make them give up." },
      { who: 'Jax', text: "I know how to disappear." },
      { who: 'La Rosa', text: "Then disappear. When you're clean, come see me." },
    ],
    intro: "La Rosa: 'Lose a two-star wanted level. Stay out of sight.'",
    reward: 400,
    steps: [
      { type: 'evade', text: 'Lose your wanted level — stay out of sight', marker: null },
    ],
    dialogueAfter: [
      { who: 'La Rosa', text: "Clean. The heat is off. $400 for keeping your cool." },
      { who: 'Jax', text: "The Vultures won't stop, will they?" },
      { who: 'La Rosa', text: "No. So we stop them. The old cannery — four of them. End it." },
    ],
    onComplete: 'Clean. The heat is off. $400 for keeping your cool.',
  },
  {
    id: 6, act: 'ACT II — HEAT RISING', name: 'Warehouse Payback', giver: 'La Rosa',
    intro: "La Rosa: 'The Vultures torched my warehouse. Go to the old cannery and settle it.'",
    reward: 700,
    steps: [
      { type: 'reach', text: 'Get to the Old Cannery Warehouse', marker: PLACES.warehouse },
      { type: 'killAll', text: 'Deal with the Vultures (4 rivals)', marker: PLACES.warehouse },
    ],
    dialogueAfter: [
      { who: 'La Rosa', text: "Four down. The Vultures will think twice now." },
      { who: 'Jax', text: "What's the big job you keep hinting at?" },
      { who: 'La Rosa', text: "Patience. First, a courier run — my girl at La Vega General needs a fast driver. And the cops are still jumpy." },
    ],
    onComplete: 'Warehouse payback, done. $700 and the Vultures are yesterday\'s news.',
  },
  {
    id: 7, act: 'ACT II — HEAT RISING', name: 'The Getaway Driver', giver: 'La Rosa',
    dialogueBefore: [
      { who: 'La Rosa', text: "My courier is waiting at La Vega General. Take her to the Neon Palm Casino — fast, before the cops connect the dots." },
      { who: 'Jax', text: "How fast?" },
      { who: 'La Rosa', text: "Two minutes. And Jax — they'll be watching the roads." },
    ],
    intro: "La Rosa: 'Pick up the courier at La Vega General, drop her at the casino. Two minutes.'",
    reward: 800,
    steps: [
      { type: 'reach', text: 'Pick up the courier at La Vega General', marker: PLACES.hospital },
      { type: 'deliver', text: 'Drop the courier at the Neon Palm Casino (2:00)', marker: PLACES.casino, time: 120 },
    ],
    dialogueAfter: [
      { who: 'Courier', text: "You drive like the devil himself, Vega. Rosa chose well." },
      { who: 'La Rosa', text: "$800. And now the real question: what are you driving for the Score? That rust bucket won't cut it." },
    ],
    onComplete: 'Courier delivered with time to spare. $800.',
  },
  {
    id: 8, act: 'ACT II — HEAT RISING', name: 'Grand Theft Marina', giver: 'La Rosa',
    dialogueBefore: [
      { who: 'La Rosa', text: "Auto Palms has a red sport car on the lot — the one with the spoiler. I want it. Manny's waiting at the garage." },
      { who: 'Jax', text: "Stealing from a dealer in broad daylight?" },
      { who: 'La Rosa', text: "Broad daylight, baby. That's what makes it a story." },
    ],
    intro: "La Rosa: 'Lift the red sport car from Auto Palms. Bring it to Manny's.'",
    reward: 600,
    steps: [
      { type: 'steal', text: 'Steal the red sport car at Auto Palms (press E near it)', marker: PLACES.dealer },
      { type: 'deliver', text: "Drive it to Manny's Garage", marker: PLACES.garage, needCar: true },
    ],
    dialogueAfter: [
      { who: 'Manny', text: "Sweet ride, Jax. I'll tune her up — on the house, for Rosa." },
      { who: 'La Rosa', text: "One more thing before the Score. You need CLEAN wheels — yours, bought and paid for. No heat on them." },
    ],
    onComplete: 'Sport car delivered. $600. Manny gives it a free tune-up.',
  },
  {
    id: 9, act: 'ACT III — THE LA VEGA SCORE', name: 'Clean Wheels', giver: 'La Rosa',
    dialogueBefore: [
      { who: 'La Rosa', text: "The Score needs a car nobody can trace. Go to Auto Palms and BUY one — sedan, truck or sport. Your money, your wheels, your garage." },
      { who: 'Jax', text: "Buying a car with stolen money. The irony is delicious." },
      { who: 'La Rosa', text: "At the dealer, press 1 for sedan ($800), 2 for truck ($1,000), 3 for sport ($1,500). It goes straight to your garage." },
    ],
    intro: "La Rosa: 'Buy a car at Auto Palms — press 1/2/3 at the dealer. It goes to your garage.'",
    reward: 0,
    steps: [
      { type: 'buy', text: 'Buy a car at Auto Palms (1 sedan $800 · 2 truck $1,000 · 3 sport $1,500)', marker: PLACES.dealer },
    ],
    dialogueAfter: [
      { who: 'La Rosa', text: "Clean wheels. She's yours — parked at Manny's, ready whenever you are." },
      { who: 'Jax', text: "So. The Score. When?" },
      { who: 'La Rosa', text: "Tonight. But first, the cops need looking the other way..." },
    ],
    onComplete: 'Clean wheels bought. Your car waits at Manny\'s Garage.',
  },
  {
    id: 10, act: 'ACT III — THE LA VEGA SCORE', name: 'The Distraction', giver: 'La Rosa',
    dialogueBefore: [
      { who: 'La Rosa', text: "Tonight we hit the Score. But the whole city's police will be watching the club — so give them something else to watch." },
      { who: 'Jax', text: "You want me to make noise." },
      { who: 'La Rosa', text: "Three stars of noise, baby. Then vanish. When you're clean, the Score is on." },
    ],
    intro: "La Rosa: 'Cause a scene — get to 3 stars — then lose the heat.'",
    reward: 500,
    steps: [
      { type: 'reachWanted', text: 'Make noise — reach 3 stars', marker: null, wanted: 3 },
      { type: 'evade', text: 'Now vanish — lose the wanted level', marker: null },
    ],
    dialogueAfter: [
      { who: 'La Rosa', text: "Beautiful chaos. Every cop in La Vega is chasing a ghost. The Score is on — five drops, one clock. Go." },
    ],
    onComplete: 'Distraction complete. The cops are chasing ghosts. $500.',
  },
  {
    id: 11, act: 'ACT III — THE LA VEGA SCORE', name: 'The La Vega Score', giver: 'La Rosa',
    dialogueBefore: [
      { who: 'La Rosa', text: "Five drops. Marina Gate, the park, La Vega General, the South Docks — and back to my club. Two and a half minutes. Drive like the sun is chasing you." },
      { who: 'Jax', text: "For the bay, Rosa." },
      { who: 'La Rosa', text: "For the bay." },
    ],
    intro: "La Rosa: 'Five drops across the whole city before the clock runs out.'",
    reward: 1200,
    steps: [
      { type: 'checkpoint', text: 'Checkpoint 1/5 — Marina Gate', marker: { x: 52, y: 52 }, time: 150 },
      { type: 'checkpoint', text: 'Checkpoint 2/5 — Palm Court Park', marker: { x: 104, y: 78 }, time: 150 },
      { type: 'checkpoint', text: 'Checkpoint 3/5 — La Vega General', marker: { x: 208, y: 52 }, time: 150 },
      { type: 'checkpoint', text: 'Checkpoint 4/5 — South Docks', marker: { x: 52, y: 234 }, time: 150 },
      { type: 'checkpoint', text: 'Final drop — La Rosa\'s Club', marker: PLACES.club, time: 150 },
    ],
    dialogueAfter: [
      { who: 'La Rosa', text: "THE LA VEGA SCORE! $1,200. You own this city, Jax Vega." },
      { who: 'Jax', text: "We own it, Rosa. All of it." },
      { who: 'La Rosa', text: "Then let's enjoy it. La Vega is yours." },
    ],
    onComplete: 'THE LA VEGA SCORE! $1,200. You own this city, Jax Vega.',
  },
  {
    id: 12, act: 'ACT III — THE LA VEGA SCORE', name: 'Harbor Heist', giver: 'La Rosa',
    dialogueBefore: [
      { who: 'La Rosa', text: "One last piece of the Score is sitting in the harbor, baby. Armored cargo, five stars of heat, and every cop in the bay." },
      { who: 'Jax', text: "Everyone in the bay will be chasing me." },
      { who: 'La Rosa', text: "Then drive like they're not. Bring it home, Jax." },
    ],
    intro: "La Rosa: 'The last piece of the Score is at the harbor. Take it and do not stop.'",
    reward: 8000,
    steps: [
      { type: 'reach', text: 'Reach the harbor', marker: PLACES.harbor },
      { type: 'heat', text: 'Grab the cargo — the harbor patrol is on you', marker: null, wanted: 5 },
      { type: 'evade', text: 'Disappear from the harbor patrol', marker: null },
      { type: 'deliver', text: 'Bring the cargo to the club', marker: PLACES.club },
    ],
    dialogueAfter: [
      { who: 'La Rosa', text: "THE HARBOR HEIST! $8,000. You are a legend now, Jax Vega — the whole bay will sing about tonight." },
      { who: 'Jax', text: "We did it, Rosa. All of it." },
      { who: 'La Rosa', text: "La Vega is ours. Every street, every star, every dollar." },
    ],
    onComplete: 'THE HARBOR HEIST! $8,000. Jax Vega owns this city.',
  },
];

export { STEP, SAVE_KEY, CHARACTERS, WORLD, BIOMES, ROADS, STREETS_NS, STREETS_EW, PALETTE, PLACES, DISTRICTS, CAR_MODELS, CAR_CATALOG, PLAYER, WANTED_MAX, MISSIONS, FUEL_PRICE, REPAIR_BASE, WEAPONS, RANKS };
