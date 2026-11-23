// LA VEGA 3D — settings, persisted in localStorage.
// Quality actually changes the renderer (pixel ratio, shadows, fog distance).
export const SETTINGS_KEY = 'la-vega-3d-settings-v1';

export const DEFAULT_SETTINGS = {
  quality: 'high',    // low | medium | high
  shadows: true,
  musicVol: 0.6,      // 0..1
  sfxVol: 0.8,        // 0..1
  muted: false,
  sensitivity: 1.0,   // camera / touch sensitivity 0.5..2
  hudDensity: 'full', // full | compact
  controlMode: 'auto', // auto | touch | keyboard (ilham 19:27 WIB)
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
}

// Applies quality to the renderer. Returns the effective pixel ratio.
export function applyQuality(renderer, scene, settings) {
  const dpr = window.devicePixelRatio || 1;
  let pr = 1;
  let shadowSize = 1024;
  if (settings.quality === 'high') { pr = Math.min(dpr, 2); shadowSize = 2048; }
  else if (settings.quality === 'medium') { pr = Math.min(dpr, 1.5); shadowSize = 1024; }
  else { pr = 1; shadowSize = 512; }
  renderer.setPixelRatio(pr);
  renderer.shadowMap.enabled = settings.shadows && settings.quality !== 'low';
  if (renderer.shadowMap.enabled) {
    scene.traverse((o) => {
      if (o.isDirectionalLight && o.shadow) {
        o.shadow.mapSize.set(shadowSize, shadowSize);
        if (o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; }
      }
    });
  }
  return pr;
}
