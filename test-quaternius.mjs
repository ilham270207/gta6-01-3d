// Test La Vega 3D after Quaternius integration: console errors + screenshots.
// Same pattern as claude-playtest-v98.mjs (URL as Chrome argv, one Chrome per shot).
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = '/home/hatch/workspace/makefun/gta6-01-3d/quaternius-test';
const POLICY = '/home/hatch/workspace/makefun/gta6-01/video/webgl-policy.txt';
const SHA = '8097045f0459c96c4cdc76e3a1af4e0f43f640b4b59c43d6db35e3641c0264c6';
const GAME = 'file:///home/hatch/workspace/makefun/gta6-01-3d/game/index.html';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runOne({ label, url, port, profile, waitMs, file, probes }) {
  const chrome = spawn('/opt/meta-chromium/chrome', [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio', '--hide-scrollbars', '--allow-file-access-from-files',
    `--hatch-webgl-allowed-domains-file=${POLICY}`, `--hatch-webgl-allowed-domains-sha256=${SHA}`,
    '--window-size=1280,720', `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, url,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const events = [];
  try {
    const waitHttp = async (u, tries = 60) => {
      for (let i = 0; i < tries; i++) {
        try { const r = await fetch(u); if (r.ok) return await r.text(); } catch {}
        await sleep(250);
      }
      throw new Error('cdp never came up');
    };
    const targets = JSON.parse(await waitHttp(`http://127.0.0.1:${port}/json/list`));
    const page = targets.find((t) => t.type === 'page');
    if (!page) throw new Error('no page target');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let nextId = 1; const pending = new Map();
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); }
      else if (msg.method === 'Runtime.exceptionThrown') events.push('EXCEPTION: ' + JSON.stringify(msg.params.exceptionDetails).slice(0, 800));
      else if (msg.method === 'Runtime.consoleAPICalled') {
        const txt = msg.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 400);
        if (msg.params.type === 'error') events.push('CONSOLE.ERROR: ' + txt);
        else if (/quaternius|Failed/i.test(txt)) events.push(`${msg.params.type.toUpperCase()}: ${txt}`);
      }
    };
    const send = (method, params = {}) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
    const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
    await send('Runtime.enable'); await send('Page.enable');
    // Poll for boot (up to 40s).
    const t0 = Date.now();
    let booted = false;
    while (Date.now() - t0 < 40000) {
      if (await evalJs(`!!window.__game`)) { booted = true; break; }
      await sleep(500);
    }
    console.log(`${label}: booted=${booted} after ${Date.now() - t0}ms`);
    if (!booted) console.log(`${label}: loading text:`, await evalJs(`document.getElementById('loading')?.textContent`));
    await sleep(waitMs);
    const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
    writeFileSync(join(OUT, file), Buffer.from(shot.data, 'base64'));
    console.log(`${label}: ${file} saved`);
    for (const [name, expr] of probes) console.log(`${label}: ${name} =`, await evalJs(expr));
    console.log(`${label} EVENTS:`, JSON.stringify(events, null, 1));
    ws.close();
  } catch (e) { console.error(`${label} TEST ERROR:`, e.message); }
  chrome.kill();
  await sleep(1000);
}

await runOne({
  label: 'menu', url: GAME, port: 9231, profile: '/tmp/chrome-quat-menu',
  waitMs: 2000, file: '01-menu.jpg',
  probes: [
    ['player quat', `!!window.__game?.player?.quat`],
    ['laRosa present', `!!window.__game?.laRosa`],
    ['GLB cars', `window.__game?.cars.filter(c=>c.glb).length + '/' + window.__game?.cars.length`],
    ['quat peds', `window.__game?.peds.filter(p=>p.h.quat).length + '/' + window.__game?.peds.length`],
    ['player clips', `window.__game?.player?.quat ? Object.keys(window.__game.player.quat.actions).join(',') : 'n/a'`],
  ],
});
await runOne({
  label: 'city', url: GAME + '?shot=city&seed=1', port: 9232, profile: '/tmp/chrome-quat-city',
  waitMs: 2500, file: '02-city.jpg',
  probes: [
    ['shotReady', `window.__shotReady`],
    ['player quat', `!!window.__game?.player?.quat`],
    ['player pos', `JSON.stringify(window.__game?.state.player)`],
  ],
});
await runOne({
  label: 'cover', url: GAME + '?shot=cover&seed=1', port: 9233, profile: '/tmp/chrome-quat-cover',
  waitMs: 2500, file: '03-cover.jpg',
  probes: [
    ['shotReady', `window.__shotReady`],
    ['player car glb', `window.__game?.cars.find(c=>c.isPlayer)?.glb`],
    ['player car model', `window.__game?.cars.find(c=>c.isPlayer)?.model`],
    ['player car wheels', `window.__game?.cars.find(c=>c.isPlayer)?.wheels?.length`],
  ],
});
await runOne({
  label: 'mission', url: GAME + '?shot=mission&seed=1', port: 9234, profile: '/tmp/chrome-quat-mission',
  waitMs: 2500, file: '04-mission.jpg',
  probes: [
    ['shotReady', `window.__shotReady`],
    ['hasPistol', `window.__game?.state.hasPistol`],
    ['playerWeapon attached', `!!window.__game?.playerWeapon`],
    ['playerWeapon visible', `window.__game?.playerWeapon?.visible`],
  ],
});
console.log('done');
process.exit(0);
