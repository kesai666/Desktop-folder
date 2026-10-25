'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');

const SKIP_NAMES = new Set([
  'desktop.ini',
  'thumbs.db',
  'system volume information',
  '$recycle.bin',
  '.ds_store',
]);

function naturalCompare(a, b) {
  return a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' });
}

function sortEntries(a, b) {
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
  return naturalCompare(a, b);
}

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

/** 文件内容 SHA-256：拖出后用它确认目标副本和源文件完全一致，才允许删源。 */
function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function listEntries(dir) {
  const dirents = await fsp.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const d of dirents) {
    const lower = d.name.toLowerCase();
    if (SKIP_NAMES.has(lower) || d.name.startsWith('.')) continue;
    const full = path.join(dir, d.name);
    let st;
    try {
      st = await fsp.stat(full);
    } catch {
      continue;
    }
    const isDir = st.isDirectory();
    if (!isDir && !st.isFile()) continue;
    out.push({
      name: d.name,
      path: full,
      isDir,
      ext: path.extname(d.name).slice(1).toLowerCase(),
      size: st.size,
      mtime: st.mtimeMs,
    });
  }
  out.sort(sortEntries);
  return out;
}

/** 同目录下生成一个不重名的目标路径：a.txt -> a (2).txt */
async function uniquePath(dir, name) {
  let candidate = path.join(dir, name);
  if (!(await exists(candidate))) return candidate;
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length) || name;
  for (let i = 2; i < 10000; i++) {
    candidate = path.join(dir, `${base} (${i})${ext}`);
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error('无法生成不重名的文件名');
}

function isInside(child, parent) {
  const c = path.resolve(child);
  const p = path.resolve(parent);
  if (c === p) return true;
  return c.startsWith(p + path.sep);
}

/**
 * 把一组路径移动进 dir。
 * - 已在目标目录内的跳过
 * - 跨卷 / 被占用时退化为「复制 + 删除」
 * - 不允许把文件夹移进它自己
 */
async function moveInto(dir, sources) {
  const result = { moved: [], skipped: [], errors: [] };
  const targetDir = path.resolve(dir);
  for (const src of sources || []) {
    const abs = path.resolve(src);
    try {
      const st = await fsp.stat(abs);
      if (path.dirname(abs) === targetDir) {
        result.skipped.push({ src: abs, reason: 'already-inside' });
        continue;
      }
      if (st.isDirectory() && isInside(targetDir, abs)) {
        result.errors.push({ src: abs, error: '不能把文件夹移入它自己' });
        continue;
      }
      const dest = await uniquePath(targetDir, path.basename(abs));
      try {
        await fsp.rename(abs, dest);
      } catch (err) {
        if (['EXDEV', 'EPERM', 'EACCES', 'EBUSY'].includes(err.code)) {
          await fsp.cp(abs, dest, { recursive: true, force: false, errorOnExist: true });
          await fsp.rm(abs, { recursive: true, force: true });
        } else {
          throw err;
        }
      }
      result.moved.push({ src: abs, dest });
    } catch (err) {
      result.errors.push({ src: abs, error: err.message });
    }
  }
  return result;
}

/** 复制一组路径进 dir；重名自动编号，不允许把文件夹复制进它自己。 */
async function copyInto(dir, sources) {
  const result = { copied: [], errors: [] };
  const targetDir = path.resolve(dir);
  for (const src of sources || []) {
    const abs = path.resolve(src);
    try {
      const st = await fsp.stat(abs);
      if (st.isDirectory() && (abs === targetDir || isInside(targetDir, abs))) {
        result.errors.push({ src: abs, error: '不能把文件夹复制进它自己' });
        continue;
      }
      const dest = await uniquePath(targetDir, path.basename(abs));
      await fsp.cp(abs, dest, { recursive: true, force: false, errorOnExist: true });
      result.copied.push({ src: abs, dest });
    } catch (err) {
      result.errors.push({ src: abs, error: err.message });
    }
  }
  return result;
}

const INVALID_NAME = /[\\/:*?"<>|]/;

function validateName(name) {
  if (!name || !name.trim()) return '名称不能为空';
  if (INVALID_NAME.test(name)) return '名称不能包含 \\ / : * ? " < > |';
  if (name === '.' || name === '..') return '名称无效';
  if (name.length > 200) return '名称过长';
  if (/[. ]$/.test(name)) return '名称不能以空格或点结尾';
  return null;
}

module.exports = {
  SKIP_NAMES,
  listEntries,
  uniquePath,
  moveInto,
  copyInto,
  isInside,
  validateName,
  sortEntries,
  exists,
  hashFile,
};
