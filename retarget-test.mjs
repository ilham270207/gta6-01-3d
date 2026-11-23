// Quick boot test for the total-rewrite push: HTTP load (so the fetch-based
// retarget of the NEW Male/Female GLBs actually runs), console errors,
// retarget probes, PLAY + gameplay screenshot, weapon-wheel toggle probe.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = '/home/hatch/workspace/makefun/retarget-test-20261123';
const POLICY = '/home/hatch/workspace/makefun/gta6-01/video/webgl-policy.txt';
const SHA = '8097045f0459c96c4cdc76e3a1af4e0f43f640b4b59c43d6db35e3641c0264c6';
const GAME = 'http://127.0.0.1:8321/index.html';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn('/opt/meta-chromium/chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio', '--hide-scrollbars', '--disable-features=LocalNetworkAccessChecks',
  `--hatch-webgl-allowed-domains-file=${POLICY}`, `--hatch-webgl-allowed-domains-sha256=${SHA}`,
  '--window-size=1280,720', '--remote-debugging-port=9232',
  '--user-data-dir=/tmp/chrome-retarget-test', GAME,
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
  const targets = JSON.parse(await waitHttp('http://127.0.0.1:9232/json/list'));
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let nextId = 1; const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); }
    else if (msg.method === 'Runtime.exceptionThrown') events.push('EXCEPTION: ' + JSON.stringify(msg.params.exceptionDetails).slice(0, 600));
    else if (msg.method === 'Runtime.consoleAPICalled') {
      const txt = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300);
      if (msg.params.type === 'error') events.push('CONSOLE.ERROR: ' + txt);
      else if (/retarget|Failed|failed/i.test(txt)) events.push(`${msg.params.type.toUpperCase()}: ${txt}`);
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
  await send('Runtime.enable'); await send('Page.enable');
  const t0 = Date.now();
  let booted = false;
  while (Date.now() - t0 < 180000) {
    if (await evalJs(`!!window.__game`)) { booted = true; break; }
    await sleep(1000);
  }
  console.log(`booted=${booted} after ${Date.now() - t0}ms`);
  console.log('newChars jax:', await evalJs(`window.__game?.newChars?.jax ? Object.keys(window.__game.newChars.jax.actions).join(',') : 'NULL (fallback)'`));
  console.log('newChars laRosa:', await evalJs(`window.__game?.newChars?.laRosa ? Object.keys(window.__game.newChars.laRosa.actions).join(',') : 'NULL (fallback)'`));
  console.log('player clips:', await evalJs(`window.__game?.player?.quat ? Object.keys(window.__game.player.quat.actions).join(',') : 'n/a'`));
  console.log('player mesh is new model:', await evalJs(`!!window.__game?.newChars?.jax`));
  console.log('missions:', await evalJs(`window.__game?.state ? 'state ok' : 'no state'`));
  console.log('clock:', await evalJs(`window.__game?.state?.clock`));
  console.log('weapon:', await evalJs(`window.__game?.state?.weapon`));
  await sleep(2000);
  const shot1 = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
  writeFileSync(join(OUT, '01-menu.jpg'), Buffer.from(shot1.data, 'base64'));
  console.log('menu shot saved');
  await evalJs(`document.getElementById('btn-play')?.click()`);
  await sleep(4000);
  console.log('mode after play:', await evalJs(`window.__game?.mode`));
  console.log('wheel toggle:', await evalJs(`window.__game?.toggleWeaponWheel(); document.getElementById('weapon-wheel')?.style.display`));
  await evalJs(`window.__game?.toggleWeaponWheel()`);
  const shot2 = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
  writeFileSync(join(OUT, '02-gameplay.jpg'), Buffer.from(shot2.data, 'base64'));
  console.log('gameplay shot saved');
  console.log('EVENTS:', JSON.stringify(events, null, 1));
  ws.close();
} catch (e) { console.error('TEST ERROR:', e.message); }
chrome.kill();
await sleep(500);
process.exit(0);
