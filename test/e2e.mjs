import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const exe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const port = Number(process.env.E2E_PORT || 9444);
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'iosf-e2e-'));

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(exe, ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`], {
  cwd: root,
  env,
  windowsHide: true,
  stdio: 'ignore',
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pageTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json`);
      const list = await res.json();
      const page = list.find((item) => item.type === 'page' && item.url.includes('index.html'));
      if (page) return page;
    } catch { /* 启动中 */ }
    await sleep(250);
  }
  throw new Error('Electron 页面没有在 10 秒内启动');
}

async function connect(page) {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  return { ws, evaluate };
}

function killTree() {
  try {
    execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    try { child.kill(); } catch { /* ignore */ }
  }
}

let ws;
try {
  const page = await pageTarget();
  const client = await connect(page);
  ws = client.ws;

  let title = '';
  for (let i = 0; i < 40; i++) {
    title = await client.evaluate('document.title');
    if (title) break;
    await sleep(250);
  }
  if (title !== 'iOS Folder') throw new Error(`页面标题不对: ${title}`);

  const hasRoot = await client.evaluate("!!document.querySelector('#root')");
  if (!hasRoot) throw new Error('缺少 #root');

  await client.evaluate("document.getElementById('miniLabel').click()");
  await sleep(600);
  const opened = await client.evaluate("JSON.stringify({ open: document.getElementById('root').classList.contains('open'), width: innerWidth })");
  const state = JSON.parse(opened);
  if (!state.open || state.width < 500) throw new Error(`面板没有展开: ${opened}`);

  console.log('e2e ok: page loaded, panel opened');
} catch (err) {
  console.error('e2e failed:', err.message);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  killTree();
  await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
}
