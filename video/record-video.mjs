// Record the La Vega 3D trailer: drives game/index.html?video=1 in
// headless Chrome, captures 8 fps via canvas.toDataURL (frame-stepped, so
// slow software WebGL does not drift the 30 s timeline), stitches with ffmpeg.
//   node video/record-video.mjs
// Output: game/trailer.mp4 (embedded in the entry, played from the menu)
//         + video/solmar-heat-3d-trailer.mp4 (copy for ilham).
// The game is loaded via file:// (this Chromium blocks http://127.0.0.1
// navigations). A fresh profile dir is used each run.
import { spawn, execFile } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, copyFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const framesDir = join(here, 'frames');
const profileDir = join(here, 'chrome-profile-video');
const outMp4 = join(here, '..', 'game', 'trailer.mp4');
const outCopy = join(here, 'solmar-heat-3d-trailer.mp4');
const CDP_PORT = 9226;
const FPS = 8;
const FRAMES = 240; // 30 s at 8 fps
const POLICY_FILE = join(here, 'webgl-policy.txt');
const POLICY_SHA256 = '8097045f0459c96c4cdc76e3a1af4e0f43f640b4b59c43d6db35e3641c0264c6';
const VIDEO_URL = `${pathToFileURL(join(here, '..', 'game', 'index.html')).href}?video=1&seed=1`;

mkdirSync(framesDir, { recursive: true });
rmSync(profileDir, { recursive: true, force: true });
// Clear stale frames from any earlier (failed) run.
for (const f of (await import('node:fs')).readdirSync(framesDir)) {
  if (f.startsWith('frame-')) rmSync(join(framesDir, f));
}

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
  '--window-size=640,360', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${profileDir}`, VIDEO_URL,
], { stdio: ['ignore', 'pipe', 'pipe'] });
chrome.stderr.on('data', (d) => {
  const s = String(d);
  if (!/dbus|D-Bus|SODA|component_updater|GPU stall|swiftshader/i.test(s)) process.stdout.write(`[chrome:err] ${s}`);
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
  await send('Emulation.setDeviceMetricsOverride', { width: 640, height: 360, deviceScaleFactor: 1, mobile: false });
  let ready = false;
  for (let i = 0; i < 150; i += 1) {
    if (await evalJs('window.__videoReady === true').catch(() => false)) { ready = true; break; }
    await sleep(200);
  }
  if (!ready) throw new Error('video driver never ready');
  console.log('driver ready — capturing 30s, frame-stepped, canvas toDataURL');

  // Frame-stepped capture: advance one video frame and grab the WebGL canvas
  // in the SAME evaluate (the drawing buffer must be read before it is cleared).
  // Page.captureScreenshot is ~5s/frame in SwiftShader; toDataURL is ~2x faster
  // and skips the DOM compositor (no HUD in the trailer — cinematic, by design).
  let n = 0;
  for (; n < FRAMES; n += 1) {
    let dataUrl = null;
    try {
      const r = await send('Runtime.evaluate', {
        expression: `(() => { try { window.__advanceVideo(); return document.querySelector('canvas.webgl').toDataURL('image/jpeg', 0.78); } catch (e) { return 'ERR:' + String(e && e.message || e); } })()`,
        returnByValue: true,
      });
      dataUrl = r.result?.value;
    } catch (e) { console.log(`frame ${n}: evaluate failed (${e.message}), reusing previous frame`); }
    if (!dataUrl || !dataUrl.startsWith('data:image/jpeg;base64,')) {
      // A bad frame must not kill the whole run: reuse the previous frame
      // (invisible at 8 fps) and keep going; the page state already advanced.
      console.log(`frame ${n}: bad frame (${String(dataUrl).slice(0, 80)}), reusing previous`);
      if (n === 0) throw new Error('first frame bad, cannot continue');
      copyFileSync(join(framesDir, `frame-${String(n - 1).padStart(4, '0')}.jpg`), join(framesDir, `frame-${String(n).padStart(4, '0')}.jpg`));
    } else {
      writeFileSync(join(framesDir, `frame-${String(n).padStart(4, '0')}.jpg`), Buffer.from(dataUrl.slice(23), 'base64'));
    }
    if (n % 60 === 0) console.log(`captured ${n} frames`);
    const done = await evalJs('window.__videoDone === true').catch(() => false);
    if (done) { n += 1; break; }
  }
  console.log(`captured ${n} frames`);
  console.log(`console errors: ${errors.length}`);
  errors.slice(0, 5).forEach((e) => console.log('ERR:', e.slice(0, 300)));
  ws.close();
} finally {
  stop();
}

// Stitch: 640x360 frames upscaled to 720p; title card drawn on the last 2 s
// (the DOM title overlay is not in the canvas frames). Fall back to a plain
// encode if drawtext fails.
const runFfmpeg = (args) => new Promise((res, rej) => {
  execFile('ffmpeg', args, (err, stdout, stderr) => {
    if (err) { process.stdout.write(stderr); rej(err); }
    else res();
  });
});
const vfTitle = "scale=1280:720:flags=lanczos,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='LA VEGA 3D':fontcolor=white:fontsize=64:borderw=3:bordercolor=black:x=(w-text_w)/2:y=(h-text_h)/2-30:enable='between(t,28,30)',drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='Open-world crime in La Vega':fontcolor=0xffd24a:fontsize=28:borderw=2:bordercolor=black:x=(w-text_w)/2:y=(h-text_h)/2+50:enable='between(t,28,30)'";
try {
  await runFfmpeg(['-y', '-framerate', String(FPS), '-i', join(framesDir, 'frame-%04d.jpg'),
    '-vf', vfTitle, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '26', '-preset', 'medium',
    '-movflags', '+faststart', outMp4]);
} catch {
  console.log('drawtext encode failed, retrying plain');
  await runFfmpeg(['-y', '-framerate', String(FPS), '-i', join(framesDir, 'frame-%04d.jpg'),
    '-vf', 'scale=1280:720:flags=lanczos', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '26', '-preset', 'medium',
    '-movflags', '+faststart', outMp4]);
}
copyFileSync(outMp4, outCopy);
const size = statSync(outMp4).size;
console.log(`wrote ${outMp4} (${(size / 1048576).toFixed(2)} MiB) + copy ${outCopy}`);
