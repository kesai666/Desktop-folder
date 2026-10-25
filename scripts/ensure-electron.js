'use strict';

/**
 * pnpm 的顶层 electron 偶尔只有包文件、没有 dist（二进制在 .pnpm 里），
 * 直接用 node_modules/electron/dist 打包会失败。缺了就补跑一次官方 install.js。
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const electronDir = path.dirname(require.resolve('electron/package.json'));
const exe = path.join(electronDir, 'dist', 'electron.exe');
if (fs.existsSync(exe)) process.exit(0);

const installer = path.join(electronDir, 'install.js');
if (!fs.existsSync(installer)) process.exit(0);

console.log('[postinstall] electron binary missing, running install.js ...');
execFileSync(process.execPath, [installer], { stdio: 'inherit' });
