/**
 * 极简 CDP 客户端：连到 Electron 的 remote-debugging 端口，
 * 在渲染进程里求值 / 截图。零依赖（Node 22+ 自带 WebSocket）。
 *
 * 用法：
 *   node scripts/cdp.mjs eval "document.title"
 *   node scripts/cdp.mjs eval-file path/to/expr.js
 *   node scripts/cdp.mjs shot out.png
 */

import fs from 'node:fs/promises';

const [, , action, arg] = process.argv;
const port = process.env.CDP_PORT || '9333';

async function connect() {
  const res = await fetch(`http://127.0.0.1:${port}/json`);
  const targets = await res.json();
  const pageIndex = Number(process.env.CDP_PAGE || 0);
  const pages = process.env.CDP_ANY === '1'
    ? targets.filter((t) => t.type === 'page')
    : targets.filter((t) => t.type === 'page' && t.url.includes('index.html'));
  const page = pages[pageIndex] || pages[0] || targets.find((t) => t.type === 'page');
  if (!page) throw new Error('没有找到 page target');
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
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  return { ws, send };
}

const { ws, send } = await connect();
try {
  if (action === 'eval') {
    const out = await send('Runtime.evaluate', {
      expression: arg,
      awaitPromise: true,
      returnByValue: true,
    });
    console.log(JSON.stringify(out.result?.value ?? out, null, 2));
  } else if (action === 'eval-file') {
    const expression = await fs.readFile(arg, 'utf8');
    const out = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    console.log(JSON.stringify(out.result?.value ?? out, null, 2));
  } else if (action === 'shot') {
    const out = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    await fs.writeFile(arg, Buffer.from(out.data, 'base64'));
    console.log(`saved ${arg}`);
  } else {
    console.error('用法: node scripts/cdp.mjs eval <expr> | shot <out.png>');
    process.exitCode = 2;
  }
} finally {
  ws.close();
}
