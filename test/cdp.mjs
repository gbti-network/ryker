// A minimal Chrome DevTools Protocol client, with no dependencies.
//
// Node 22 carries a global WebSocket, so driving real Chrome needs nothing
// installed. That matters here: the bundler is concatenation on purpose and the
// project vendors nothing, so a test harness that dragged in node_modules would
// be the first dependency in the tree and would owe the specification's section
// 26 audit for the privilege of running the tests.
//
// Real Chrome rather than a DOM shim, because the code under test reads layout,
// tracks a live selection and mounts a shadow root. sow-004 records a module
// whose own test passed while the feature was broken in every browser, because
// the test built its selection in script. Synthetic environments are not
// evidence.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function chromePath() {
  if (process.env.RYKER_CHROME) return process.env.RYKER_CHROME;
  const candidates = process.platform === 'win32' ? [
    join(process.env.ProgramFiles || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
  ] : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'];
  return candidates.find((candidate) => candidate && existsSync(candidate)) || candidates[0];
}

const CHROME = chromePath();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function poll(fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await sleep(100);
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}` +
    (last ? ` (last error: ${last.message})` : ''));
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let nextId = 1;
    const pending = new Map();
    const waiters = [];

    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }

      if (msg.id && pending.has(msg.id)) {
        const { res, rej, method } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(`${method} failed: ${JSON.stringify(msg.error)}`));
        else res(msg.result);
        return;
      }
      // Events. Walked backwards so a waiter can be spliced out as it fires.
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].method === msg.method) {
          waiters[i].res(msg.params);
          waiters.splice(i, 1);
        }
      }
    });

    ws.addEventListener('error', () => reject(new Error('CDP websocket error on ' + url)));

    ws.addEventListener('open', () => {
      const send = (method, params = {}) => new Promise((res, rej) => {
        const id = nextId++;
        pending.set(id, { res, rej, method });
        ws.send(JSON.stringify({ id, method, params }));
      });

      const once = (method, timeoutMs = 15000) => new Promise((res, rej) => {
        const w = { method, res };
        waiters.push(w);
        setTimeout(() => {
          const i = waiters.indexOf(w);
          if (i >= 0) { waiters.splice(i, 1); rej(new Error('timed out waiting for ' + method)); }
        }, timeoutMs);
      });

      resolve({ ws, send, once });
    });
  });
}

export async function launch() {
  const profile = mkdtempSync(join(tmpdir(), 'ryker-cdp-'));

  // Port 0 lets Chrome choose, and it writes the one it took to
  // DevToolsActivePort in the profile directory. A fixed port was fine until
  // two suites ran at once, at which point the second silently attached to the
  // first one's browser and drove the wrong tab.
  const proc = spawn(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--user-data-dir=' + profile,
    '--remote-debugging-port=0',
    'about:blank'
  ], { stdio: 'ignore' });

  const port = await poll(() => {
    const line = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim();
    return line ? Number(line) : null;
  }, 20000, 'Chrome to report the port it chose');

  const base = `http://127.0.0.1:${port}`;

  await poll(() => fetch(`${base}/json/version`).then((r) => r.json()), 20000, 'the CDP endpoint');
  const target = await poll(async () => {
    const list = await fetch(`${base}/json/list`).then((r) => r.json());
    return list.find((t) => t.type === 'page');
  }, 10000, 'a page target');

  const sess = await connect(target.webSocketDebuggerUrl);
  await sess.send('Page.enable');
  await sess.send('Runtime.enable');

  return {
    ...sess,
    async close() {
      try { sess.ws.close(); } catch { /* already gone */ }
      proc.kill();
      await sleep(200);
      try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  };
}

export async function navigate(sess, url) {
  const loaded = sess.once('Page.loadEventFired');
  await sess.send('Page.navigate', { url });
  await loaded;
}

// returnByValue so results arrive as plain JSON rather than remote handles, and
// awaitPromise so an expression may be async without the caller caring.
export async function evaluate(sess, expression) {
  const r = await sess.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true
  });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error('page threw: ' + (d.exception?.description || d.text || JSON.stringify(d)));
  }
  return r.result.value;
}

export async function waitInPage(sess, expression, timeoutMs = 10000, label = expression) {
  return poll(() => evaluate(sess, expression), timeoutMs, label);
}
