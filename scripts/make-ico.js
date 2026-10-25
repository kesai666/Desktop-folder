'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'assets', 'tray');
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];

const images = sizes.map((size) => {
  const file = path.join(dir, `tray-${size}.png`);
  return { size, data: fs.readFileSync(file) };
});

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);

const entries = [];
let offset = 6 + images.length * 16;
for (const image of images) {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(image.size >= 256 ? 0 : image.size, 0);
  entry.writeUInt8(image.size >= 256 ? 0 : image.size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(image.data.length, 8);
  entry.writeUInt32LE(offset, 12);
  entries.push(entry);
  offset += image.data.length;
}

const out = Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
fs.writeFileSync(path.join(root, 'assets', 'tray.ico'), out);
fs.copyFileSync(path.join(dir, 'tray-64.png'), path.join(root, 'assets', 'tray.png'));
console.log(`wrote assets/tray.ico (${out.length} bytes, ${images.length} sizes)`);
