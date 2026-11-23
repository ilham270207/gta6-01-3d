// Capture one deterministic screenshot (?shot=...) or the title screen.
//   node video/shot-test.mjs [shot-name] [out-path]
// Loads the game via file:// (http://127.0.0.1 is blocked in this Chromium),
// collects console errors, waits for __shotReady, saves a JPEG.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const shot = process.argv[2] ?? 'cover';
const outPath = process.argv[3] ?? join(here, `test-${shot}.jpg`);
const profileDir = join(here, 'chrome-profile-test');
const CDP_PORT = 9224;
const POLICY_FILE = join(here, 'webgl-policy.txt');
const POLICY_SHA256 = '8097045f0459c96c4cdc76e3a1af4e0f43f640b4b59c43d6db35e3641c0264c6';
const GAME_URL = `${pathToFileURL(join(here, '..', 'game', 'index.html')).href}?shot=${shot}&seed=1`;

mkdirSync(dirname(outPath), { recursive: true });
rmSync(profileDir, { recursive: true, force: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitHttp(url, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    try { const res = await fetch(url); if (res.ok) return await res.text(); } catch {}
    await sleep(200);
  }
  throw new Error(`never came up: ${url}`);
}

const chrome = spawn('/opt/meta-chromium/chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio', '--hide-scrollbars',
  '--allow-file-access-from-files',
  `--hatch-webgl-allowed-domains-file=${POLICY_FILE}`,
  `--hatch-webgl-allowed-domains-sha256=${POLICY_SHA256}`,
  '--window-size=1280,720', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${profileDir}`, GAME_URL,
], { stdio: ['ignore', 'pipe', 'pipe'] });
chrome.stderr.on('data', (d) => {
  const s = String(d);
  if (!/dbus|D-Bus|SODA|component_updater/.test(s)) process.stdout.write(`[chrome:err] ${s}`);
});

const errors = [];
const stop = () => { try { chrome.kill('SIGKILL'); } catch {} };
process.on('SIGINT', () => { stop(); process.exit(130); });

try {
  const targets = JSON.parse(await waitHttp(`http://127.0.0.1:${CDP_PORT}/json/list`));
  const page = targets.find((t) => t.type === 'page' && t.url.includes('/game/index.html'));
  if (!page) throw new Error(`no game page target (got: ${targets.map((t) => t.url).join(' | ')})`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let nextId = 1;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(JSON.stringify(msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(msg.error.message));
      else res(msg.result);
    }
  };
  const send = (method, params = {}) => {
    const id = nextId++;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => pending.set(id, { res, rej }));
  };
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`page exception: ${JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)}`);
    return r.result?.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  let ready = false;
  for (let i = 0; i < 150; i += 1) {
    if (await evalJs('window.__shotReady === true').catch(() => false)) { ready = true; break; }
    await sleep(200);
  }
  if (!ready) {
    const state = await evalJs('JSON.stringify({mode: window.__game?.mode, err: document.getElementById("loading")?.textContent})').catch(() => '?');
    throw new Error(`shot never ready — ${state}`);
  }
  await sleep(600);
  const img = await send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
  writeFileSync(outPath, Buffer.from(img.data, 'base64'));
  console.log(`wrote ${outPath}`);
  console.log(`console errors: ${errors.length}`);
  errors.slice(0, 10).forEach((e) => console.log('ERR:', e.slice(0, 500)));
  ws.close();
} finally {
  stop();
}
