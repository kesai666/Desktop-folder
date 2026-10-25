'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');

const fsutil = require('../src/fsutil');

async function tempDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'iosf-test-'));
}

test('listEntries 目录优先、自然排序、跳过 desktop.ini', async () => {
  const dir = await tempDir();
  await fsp.mkdir(path.join(dir, 'b-folder'));
  await fsp.mkdir(path.join(dir, 'a-folder'));
  await fsp.writeFile(path.join(dir, 'file10.txt'), 'x');
  await fsp.writeFile(path.join(dir, 'file2.txt'), 'x');
  await fsp.writeFile(path.join(dir, 'desktop.ini'), 'x');
  await fsp.writeFile(path.join(dir, '.hidden'), 'x');

  const entries = await fsutil.listEntries(dir);
  const names = entries.map((e) => e.name);
  assert.deepEqual(names, ['a-folder', 'b-folder', 'file2.txt', 'file10.txt']);
  assert.equal(entries[0].isDir, true);
  assert.equal(entries[2].isDir, false);
  assert.equal(entries[2].ext, 'txt');
});

test('uniquePath 生成不重名路径', async () => {
  const dir = await tempDir();
  await fsp.writeFile(path.join(dir, 'a.txt'), 'x');
  await fsp.writeFile(path.join(dir, 'a (2).txt'), 'x');

  const p = await fsutil.uniquePath(dir, 'a.txt');
  assert.equal(path.basename(p), 'a (3).txt');
  assert.equal(await fsutil.uniquePath(dir, 'b.txt'), path.join(dir, 'b.txt'));
});

test('moveInto 移动文件、跳过同目录、处理重名', async () => {
  const srcDir = await tempDir();
  const dstDir = await tempDir();
  const src = path.join(srcDir, 'a.txt');
  await fsp.writeFile(src, 'hello');
  await fsp.writeFile(path.join(dstDir, 'a.txt'), 'old');

  const res = await fsutil.moveInto(dstDir, [src]);
  assert.equal(res.errors.length, 0);
  assert.equal(res.moved.length, 1);
  assert.equal(path.basename(res.moved[0].dest), 'a (2).txt');
  assert.equal(await fsp.readFile(res.moved[0].dest, 'utf8'), 'hello');

  const skip = await fsutil.moveInto(dstDir, [path.join(dstDir, 'a.txt')]);
  assert.equal(skip.skipped.length, 1);
  assert.equal(skip.errors.length, 0);
});

test('moveInto 拒绝把文件夹移进自身', async () => {
  const base = await tempDir();
  const child = path.join(base, 'child');
  await fsp.mkdir(child);
  const res = await fsutil.moveInto(child, [base]);
  assert.equal(res.errors.length, 1);
  assert.match(res.errors[0].error, /文件夹移入它自己/);
});

test('validateName 拒绝非法文件名', () => {
  assert.equal(fsutil.validateName('正常名字.txt'), null);
  assert.ok(fsutil.validateName(''));
  assert.ok(fsutil.validateName('a/b.txt'));
  assert.ok(fsutil.validateName('a:b'));
  assert.ok(fsutil.validateName('结尾空格 '));
  assert.ok(fsutil.validateName('.'));
});

test('hashFile 相同内容同哈希、不同内容不同哈希', async () => {
  const dir = await tempDir();
  const a = path.join(dir, 'a.bin');
  const b = path.join(dir, 'b.bin');
  const c = path.join(dir, 'c.bin');
  await fsp.writeFile(a, Buffer.from([1, 2, 3, 4, 5]));
  await fsp.writeFile(b, Buffer.from([1, 2, 3, 4, 5]));
  await fsp.writeFile(c, Buffer.from([1, 2, 3, 4, 6]));

  const ha = await fsutil.hashFile(a);
  const hb = await fsutil.hashFile(b);
  const hc = await fsutil.hashFile(c);
  assert.equal(ha, hb);
  assert.notEqual(ha, hc);
  assert.match(ha, /^[0-9a-f]{64}$/);
});

test('copyInto 复制文件/文件夹并处理重名', async () => {
  const srcDir = await tempDir();
  const dstDir = await tempDir();
  const file = path.join(srcDir, 'a.txt');
  await fsp.writeFile(file, 'copy-me');
  await fsp.mkdir(path.join(srcDir, 'sub'));
  await fsp.writeFile(path.join(srcDir, 'sub', 'inner.txt'), 'inner');
  await fsp.writeFile(path.join(dstDir, 'a.txt'), 'old');

  const res = await fsutil.copyInto(dstDir, [file, path.join(srcDir, 'sub')]);
  assert.equal(res.errors.length, 0);
  assert.equal(res.copied.length, 2);
  const names = res.copied.map((item) => path.basename(item.dest)).sort();
  assert.deepEqual(names, ['a (2).txt', 'sub']);
  assert.equal(await fsp.readFile(path.join(dstDir, 'a (2).txt'), 'utf8'), 'copy-me');
  assert.equal(await fsp.readFile(path.join(dstDir, 'sub', 'inner.txt'), 'utf8'), 'inner');
  assert.equal(await fsp.readFile(file, 'utf8'), 'copy-me');
});
