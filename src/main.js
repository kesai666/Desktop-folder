'use strict';

/**
 * iOS Folder Widget（多实例版）
 * 外观：iPhone 主屏文件夹（磨砂玻璃 + 3×3 预览）
 * 内里：一个真实的 Windows 目录
 *
 * 关键点：
 * - 一个进程里可以同时存在多个小组件，每个绑定一个目录、各自记住位置；
 * - 窗口透明，玻璃感由「自绘壁纸层 + CSS 模糊 + 圆角裁切」实现；
 * - 收起时窗口就是小图标大小，展开时放大到面板大小；
 * - 位置钳制在当前显示器工作区内，拖不出桌面。
 */

const {
  app, BrowserWindow, ipcMain, Menu, shell, nativeImage, screen, dialog, nativeTheme, Tray,
} = require('electron');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync, execFile, spawn } = require('node:child_process');
const electronLog = require('electron-log');

const fsutil = require('./fsutil');

electronLog.transports.file.level = 'info';
electronLog.transports.file.maxSize = 5 * 1024 * 1024;

const PANEL_WIN = { width: 600, height: 640 };
const COMPACT_WIN = { width: 160, height: 184 };
const MINI_PAD = 30;
const PANEL = { width: 580, height: 620, left: 10, top: 10 };
const COMPACT = { width: 100, height: 100 };

const THUMB_EXT = /^(png|jpe?g|gif|webp|bmp|ico|avif|heic|heif|svg|mp4|m4v|mov|mkv|avi|webm|pdf|docx|pptx|xlsx)$/i;

const widgets = new Map();
let tray = null;
let settingsWin = null;
let settingsWidgetId = null;
let config = { widgets: [], autoStart: true, onboarded: false };
let dirOrders = {};
let trashRecords = [];
let lastTrashBatch = null;
let nextWidgetId = 1;
let iconCache = new Map();
let suppressBlurUntil = 0;
let quitting = false;
const ALIGN_TOL = 8;

const log = (...args) => {
  console.log('[ios-folder]', ...args);
  try { electronLog.info(...args); } catch { /* 日志不可用不影响主流程 */ }
};

process.on('uncaughtException', (err) => log('uncaughtException', err && err.stack ? err.stack : err));
process.on('unhandledRejection', (err) => log('unhandledRejection', err && err.stack ? err.stack : err));

/** 打包后脚本在 asar.unpacked 里，PowerShell 读不了 asar 内部路径。 */
function scriptFile(name) {
  if (!app.isPackaged) return path.join(__dirname, '..', 'scripts', name);
  const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', 'scripts', name);
  if (fs.existsSync(unpacked)) return unpacked;
  // 手动 portable 目录（resources/app 而不是 app.asar）的情况
  return path.join(app.getAppPath(), 'scripts', name);
}

/** 托盘图标等需要交给 Windows 原生加载的资源，同样优先用 unpacked 路径。 */
function assetFile(name) {
  if (!app.isPackaged) return path.join(__dirname, '..', 'assets', name);
  const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', name);
  if (fs.existsSync(unpacked)) return unpacked;
  return path.join(app.getAppPath(), 'assets', name);
}

function execFileAsync(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

// ---------------------------------------------------------------- 配置

function configFile() {
  return path.join(app.getPath('userData'), 'config.json');
}

/** 同目录临时文件 + rename；避免直接写被中断后留下半截 JSON。 */
function writeFileAtomic(file, text) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text);
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.rmSync(file, { force: true });
      fs.renameSync(tmp, file);
    } catch (err2) {
      throw err2;
    }
  }
}

function loadConfig() {
  // 开发态默认开机启动；分发给别人时默认不偷偷写启动项，由用户在托盘里自己开
  config.autoStart = !app.isPackaged;
  config.onboarded = false;
  const file = configFile();
  const fileExisted = fs.existsSync(file);
  let raw = null;
  for (const candidate of [file, `${file}.bak`]) {
    try {
      raw = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      break;
    } catch {
      raw = null;
    }
  }
  if (raw) {
    config.autoStart = raw.autoStart !== false && (!app.isPackaged || raw.autoStart === true);
    // 老配置没有 onboarded 字段：视为已经用过，不再弹首次引导
    config.onboarded = raw.onboarded !== undefined ? raw.onboarded !== false : fileExisted;
    if (Array.isArray(raw.widgets)) {
      config.widgets = raw.widgets.filter((item) => item && item.folder);
    } else if (raw && (raw.folder || Number.isFinite(raw.x))) {
      // 旧版单窗口配置迁移
      config.widgets = [{ id: 1, folder: raw.folder, x: raw.x, y: raw.y }];
    } else {
      config.widgets = [];
    }
  } else {
    config.widgets = [];
  }
  config.widgets = config.widgets.filter((item) => item && typeof item.folder === 'string' && item.folder);
  for (const item of config.widgets) {
    if (!Number.isFinite(item.id)) item.id = nextWidgetId++;
    if (!Number.isFinite(item.x)) item.x = 140;
    if (!Number.isFinite(item.y)) item.y = 140;
    if (item.id >= nextWidgetId) nextWidgetId = item.id + 1;
  }
}

function saveConfig() {
  const file = configFile();
  const json = JSON.stringify({
    autoStart: config.autoStart !== false,
    onboarded: config.onboarded !== false,
    widgets: config.widgets,
  }, null, 2);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) {
      try { fs.copyFileSync(file, `${file}.bak`); } catch { /* 备份失败不影响主写入 */ }
    }
    writeFileAtomic(file, json);
  } catch (err) {
    log('保存配置失败', err.message);
    try { fs.writeFileSync(file, json); } catch { /* ignore */ }
  }
}

function saveWidgetConfig(w) {
  const item = config.widgets.find((entry) => entry.id === w.id);
  if (item) {
    item.folder = w.rootDir;
    item.x = w.anchor.x;
    item.y = w.anchor.y;
    item.wallpaper = w.wallpaper || null;
    item.autoCreated = w.autoFolder === true;
    item.blur = w.blur;
    item.frost = w.frost;
    item.customBlur = w.customBlur;
    item.iconSize = w.iconSize;
    item.wallpaperFit = w.wallpaperFit;
    item.wallpaperPosition = w.wallpaperPosition;
    item.wallpaperScale = w.wallpaperScale;
    item.wallpaperBlur = w.wallpaperBlur;
    item.sortMode = w.sortMode;
  } else {
    config.widgets.push({
      id: w.id,
      folder: w.rootDir,
      x: w.anchor.x,
      y: w.anchor.y,
      wallpaper: w.wallpaper || null,
      autoCreated: w.autoFolder === true,
      blur: w.blur,
      frost: w.frost,
      customBlur: w.customBlur,
      iconSize: w.iconSize,
      wallpaperFit: w.wallpaperFit,
      wallpaperPosition: w.wallpaperPosition,
      wallpaperScale: w.wallpaperScale,
      wallpaperBlur: w.wallpaperBlur,
      sortMode: w.sortMode,
    });
  }
  saveConfig();
}

// ---------------------------------------------------------------- 应用回收站

const trashRoot = () => path.join(app.getPath('userData'), 'trash');
const trashIndexFile = () => path.join(app.getPath('userData'), 'trash.json');

function saveTrash() {
  try {
    writeFileAtomic(trashIndexFile(), JSON.stringify({ records: trashRecords }, null, 2));
  } catch (err) {
    log('保存回收站索引失败', err.message);
  }
}

function loadTrash() {
  try {
    const raw = JSON.parse(fs.readFileSync(trashIndexFile(), 'utf8'));
    trashRecords = Array.isArray(raw.records) ? raw.records.filter((item) => item && item.trashPath) : [];
  } catch {
    trashRecords = [];
  }
}

async function cleanupTrash() {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const keep = [];
  for (const record of trashRecords) {
    if (record.deletedAt && record.deletedAt < cutoff) {
      await fsp.rm(record.trashPath, { recursive: true, force: true }).catch(() => {});
    } else {
      keep.push(record);
    }
  }
  if (keep.length !== trashRecords.length) {
    trashRecords = keep;
    saveTrash();
  }
  await fsp.mkdir(trashRoot(), { recursive: true }).catch(() => {});
}

async function moveToTrash(file, batchId, index) {
  const dir = path.join(trashRoot(), batchId, String(index));
  await fsp.mkdir(dir, { recursive: true });
  const dest = path.join(dir, path.basename(file));
  try {
    await fsp.rename(file, dest);
  } catch (err) {
    if (['EXDEV', 'EPERM', 'EACCES', 'EBUSY'].includes(err.code)) {
      await fsp.cp(file, dest, { recursive: true, force: false, errorOnExist: true });
      await fsp.rm(file, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
  return {
    batchId,
    originalPath: path.resolve(file),
    trashPath: dest,
    name: path.basename(file),
    deletedAt: Date.now(),
  };
}

function trashBatches() {
  const groups = new Map();
  for (const record of trashRecords) {
    const key = record.batchId || 'unknown';
    if (!groups.has(key)) {
      groups.set(key, { batchId: key, deletedAt: record.deletedAt || 0, count: 0, names: [] });
    }
    const group = groups.get(key);
    group.count += 1;
    group.deletedAt = Math.max(group.deletedAt, record.deletedAt || 0);
    if (group.names.length < 4) group.names.push(record.name || path.basename(record.originalPath || ''));
  }
  return [...groups.values()].sort((a, b) => b.deletedAt - a.deletedAt);
}

async function restoreTrashBatch(batch) {
  const records = trashRecords.filter((item) => item.batchId === batch);
  if (!records.length) return { ok: false, error: '没有可恢复的删除' };
  let restored = 0;
  const errors = [];
  for (const record of records) {
    try {
      if (!fs.existsSync(record.trashPath)) continue;
      const parent = path.dirname(record.originalPath);
      await fsp.mkdir(parent, { recursive: true });
      let target = record.originalPath;
      if (fs.existsSync(target)) {
        target = await fsutil.uniquePath(parent, path.basename(target));
      }
      await fsp.rename(record.trashPath, target);
      restored += 1;
    } catch (err) {
      errors.push({ path: record.originalPath, error: err.message });
    }
  }
  const done = new Set(
    records.filter((record) => !fs.existsSync(record.trashPath)).map((record) => record.trashPath),
  );
  trashRecords = trashRecords.filter((record) => !done.has(record.trashPath));
  if (lastTrashBatch === batch) lastTrashBatch = null;
  saveTrash();
  return { ok: restored > 0, restored, errors };
}

async function createShortcutLink(link, target) {
  await execFileAsync('powershell', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', scriptFile('create-shortcut.ps1'), link, target,
  ], { windowsHide: true, timeout: 8000 });
}

async function createShortcutsInto(dir, sources) {
  const result = { created: [], errors: [] };
  for (const src of sources || []) {
    try {
      const base = path.basename(src) || '快捷方式';
      const name = base.toLowerCase().endsWith('.lnk') ? base : `${base}.lnk`;
      const link = await fsutil.uniquePath(dir, name);
      await createShortcutLink(link, src);
      result.created.push({ src, dest: link });
    } catch (err) {
      result.errors.push({ src, error: err.message });
    }
  }
  return result;
}

// ---------------------------------------------------------------- 开机自启动

/**
 * 开发态下 electron.exe 和项目目录都可能被移动，直接把 Run 项指向它们很脆。
 * 所以在 LocalAppData 放一个稳定的 launch.ps1：它先读 install.json 的当前路径，
 * 找不到就扫描 Documents/Desktop/Downloads 里名为 ios-folder-widget 的目录。
 * 这样项目搬家后，开机仍然能找到它，不用再去托盘里重新勾一次。
 */
function ensureLauncher() {
  const localBase = process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local');
  const dir = path.join(localBase, 'ios-folder-widget');
  fs.mkdirSync(dir, { recursive: true });

  const installJson = path.join(app.getPath('userData'), 'install.json');
  fs.writeFileSync(
    installJson,
    JSON.stringify({
      appDir: path.resolve(app.getAppPath()),
      electron: process.execPath,
      updatedAt: new Date().toISOString(),
    }, null, 2),
    'utf8',
  );

  const launcher = path.join(dir, 'launch.ps1');
  const installLiteral = installJson.replace(/'/g, "''");
  const script = `$ErrorActionPreference = 'SilentlyContinue'
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$install = '${installLiteral}'

function Start-WidgetApp([string]$dir) {
  if ([string]::IsNullOrWhiteSpace($dir)) { return $false }
  $exe = Join-Path $dir 'node_modules\\electron\\dist\\electron.exe'
  if (-not (Test-Path -LiteralPath $exe)) { return $false }
  if (-not (Test-Path -LiteralPath (Join-Path $dir 'package.json'))) { return $false }
  Start-Process -FilePath $exe -ArgumentList ('"' + $dir + '"') -WorkingDirectory $dir
  return $true
}

$candidates = @()
if (Test-Path -LiteralPath $install) {
  try {
    $data = Get-Content -LiteralPath $install -Raw | ConvertFrom-Json
    $candidates += $data.appDir
  } catch {}
}
$candidates += (Join-Path $env:USERPROFILE 'Documents\\deepseek-harness\\default-workspace\\ios-folder-widget')

foreach ($dir in $candidates) {
  if (Start-WidgetApp $dir) { exit }
}

$roots = @(
  (Join-Path $env:USERPROFILE 'Documents'),
  (Join-Path $env:USERPROFILE 'Desktop'),
  (Join-Path $env:USERPROFILE 'Downloads')
)
foreach ($root in $roots) {
  if (-not (Test-Path -LiteralPath $root)) { continue }
  $found = Get-ChildItem -LiteralPath $root -Directory -Filter 'ios-folder-widget' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found -and (Start-WidgetApp $found.FullName)) { exit }
}
`;
  fs.writeFileSync(launcher, script, 'utf8');
  return launcher;
}

function applyAutoStart() {
  if (process.platform !== 'win32') return;
  const enabled = config.autoStart !== false;
  // 便携版 exe 每次会解压到临时目录，process.execPath 指不到用户手里那个文件；
  // electron-builder 会给出 PORTABLE_EXECUTABLE_FILE。
  let commandPath = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  let args = [];
  if (!app.isPackaged) {
    const launcher = ensureLauncher();
    commandPath = path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    args = ['-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', launcher];
  }
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, path: commandPath, args });
    const actual = app.getLoginItemSettings({ path: commandPath, args }).openAtLogin;
    log('autostart', enabled ? 'on' : 'off', 'actual:', actual, commandPath, args.join(' '));
  } catch (err) {
    log('autostart 设置失败:', err.message);
  }
}

const ordersFile = () => path.join(app.getPath('userData'), 'orders.json');
function loadOrders() {
  try {
    dirOrders = JSON.parse(fs.readFileSync(ordersFile(), 'utf8')) || {};
  } catch {
    dirOrders = {};
  }
}
function saveOrders() {
  try {
    fs.mkdirSync(path.dirname(ordersFile()), { recursive: true });
    fs.writeFileSync(ordersFile(), JSON.stringify(dirOrders));
  } catch (err) {
    log('保存排列失败', err.message);
  }
}
function orderKey(dir) {
  return path.resolve(dir).toLowerCase();
}
function applyOrder(dir, entries) {
  const names = dirOrders[orderKey(dir)];
  if (!Array.isArray(names) || !names.length) return entries;
  const map = new Map(entries.map((entry) => [entry.name, entry]));
  const out = [];
  for (const name of names) {
    const entry = map.get(name);
    if (entry) {
      out.push(entry);
      map.delete(name);
    }
  }
  const rest = [...map.values()].sort(fsutil.sortEntries);
  return out.concat(rest);
}

// ---------------------------------------------------------------- 显示器 / 位置

function displayInfo(winRef) {
  const d = screen.getDisplayMatching(winRef.getBounds());
  return {
    x: d.bounds.x,
    y: d.bounds.y,
    width: d.bounds.width,
    height: d.bounds.height,
    scaleFactor: d.scaleFactor,
  };
}

function clampToWorkArea(x, y, width, height, disp) {
  const d = disp || screen.getDisplayNearestPoint({ x: x + width / 2, y: y + height / 2 });
  const wa = d.workArea;
  const maxX = wa.x + wa.width - width;
  const maxY = wa.y + wa.height - height;
  return {
    x: Math.round(Math.min(Math.max(x, wa.x), Math.max(wa.x, maxX))),
    y: Math.round(Math.min(Math.max(y, wa.y), Math.max(wa.y, maxY))),
  };
}

// 可见内容（小图标 + 名字）在窗口里的位置：图标 30..130，名字到约 150
const CONTENT = { left: MINI_PAD, top: MINI_PAD, width: COMPACT.width, height: 120 };
const SNAP_DISTANCE = 12;
const SNAP_GAP = 10;

function contentOfAnchor(anchor) {
  return { x: anchor.x + CONTENT.left, y: anchor.y + CONTENT.top, w: CONTENT.width, h: CONTENT.height };
}

function anchorOfContent(x, y) {
  return { x: Math.round(x - CONTENT.left), y: Math.round(y - CONTENT.top) };
}

function clampContent(x, y, disp) {
  const d = disp || screen.getDisplayNearestPoint({ x: x + CONTENT.width / 2, y: y + CONTENT.height / 2 });
  const wa = d.workArea;
  const maxX = Math.max(wa.x, wa.x + wa.width - CONTENT.width);
  const maxY = Math.max(wa.y, wa.y + wa.height - CONTENT.height);
  return {
    x: Math.round(Math.min(Math.max(x, wa.x), maxX)),
    y: Math.round(Math.min(Math.max(y, wa.y), maxY)),
  };
}

/**
 * 按「可见内容」而不是整个窗口来钳制位置：
 * 允许 30px 的透明留白伸出屏幕，图标本身可以贴到桌面边缘。
 */
function clampWidgetWindow(x, y, disp) {
  const c = clampContent(x + CONTENT.left, y + CONTENT.top, disp);
  return anchorOfContent(c.x, c.y);
}

function clampWidgetPos(x, y) {
  const disp = screen.getDisplayNearestPoint({ x: x + 80, y: y + 92 });
  return clampWidgetWindow(x, y, disp);
}

function contentRects(excludeId) {
  const rects = [];
  for (const w of widgets.values()) {
    if (w.id === excludeId) continue;
    if (!w.win || w.win.isDestroyed() || w.expanded) continue;
    rects.push(contentOfAnchor(w.anchor));
  }
  return rects;
}

/** 靠近另一个组件边缘时吸附贴边（留 10px 空隙），返回吸附到的组件 id。 */
function snapWidgetContent(selfId, x, y) {
  let cx = x;
  let cy = y;
  let partnerId = null;
  const W = CONTENT.width;
  const H = CONTENT.height;
  const G = SNAP_GAP;
  for (const w of widgets.values()) {
    if (w.id === selfId) continue;
    if (!w.win || w.win.isDestroyed() || w.expanded) continue;
    const o = contentOfAnchor(w.anchor);
    if (cy < o.y + o.h && cy + H > o.y) {
      const options = [
        { d: (o.x + o.w + G) - cx, nx: o.x + o.w + G },
        { d: (o.x - G) - (cx + W), nx: o.x - G - W },
      ];
      let best = null;
      for (const opt of options) {
        if (Math.abs(opt.d) <= SNAP_DISTANCE && (!best || Math.abs(opt.d) < Math.abs(best.d))) best = opt;
      }
      if (best) {
        cx = best.nx;
        partnerId = w.id;
      }
    }
    if (cx < o.x + o.w && cx + W > o.x) {
      const options = [
        { d: (o.y + o.h + G) - cy, ny: o.y + o.h + G },
        { d: (o.y - G) - (cy + H), ny: o.y - G - H },
      ];
      let best = null;
      for (const opt of options) {
        if (Math.abs(opt.d) <= SNAP_DISTANCE && (!best || Math.abs(opt.d) < Math.abs(best.d))) best = opt;
      }
      if (best) {
        cy = best.ny;
        partnerId = w.id;
      }
    }
  }
  return { x: cx, y: cy, partnerId };
}

/** 通知两个窗口进入/退出「磁吸高亮」状态。 */
function setMagnet(w, partnerId) {
  if (!w || !w.win || w.win.isDestroyed()) return;
  if (w.magnetPartner === partnerId) return;
  const prev = w.magnetPartner;
  w.magnetPartner = partnerId;
  w.win.webContents.send('win:magnet', { active: partnerId !== null });
  if (prev) {
    const pw = widgets.get(prev);
    if (pw && pw.win && !pw.win.isDestroyed()) pw.win.webContents.send('win:magnet', { active: false });
  }
  if (partnerId) {
    const pw = widgets.get(partnerId);
    if (pw && pw.win && !pw.win.isDestroyed()) pw.win.webContents.send('win:magnet', { active: true });
  }
}

/** 拖放结束后如果还和别的组件重叠，按最小位移推到旁边。 */
function resolveWidgetOverlap(w) {
  if (!w.win || w.win.isDestroyed() || w.expanded) return;
  let content = contentOfAnchor(w.anchor);
  for (let iter = 0; iter < 6; iter++) {
    let moved = false;
    for (const o of contentRects(w.id)) {
      const ix = Math.min(content.x + CONTENT.width, o.x + o.w) - Math.max(content.x, o.x);
      const iy = Math.min(content.y + CONTENT.height, o.y + o.h) - Math.max(content.y, o.y);
      const overlapArea = Math.max(0, ix) * Math.max(0, iy);
      const threshold = CONTENT.width * CONTENT.height * 0.25;
      if (overlapArea < threshold) continue;
      const moves = [
        { d: (o.x + o.w + SNAP_GAP) - content.x, x: o.x + o.w + SNAP_GAP, y: content.y },
        { d: (o.x - SNAP_GAP - CONTENT.width) - content.x, x: o.x - SNAP_GAP - CONTENT.width, y: content.y },
        { d: (o.y + o.h + SNAP_GAP) - content.y, x: content.x, y: o.y + o.h + SNAP_GAP },
        { d: (o.y - SNAP_GAP - CONTENT.height) - content.y, x: content.x, y: o.y - SNAP_GAP - CONTENT.height },
      ];
      moves.sort((a, b) => Math.abs(a.d) - Math.abs(b.d));
      const pick = moves[0];
      content = clampContent(pick.x, pick.y, screen.getDisplayNearestPoint({ x: pick.x, y: pick.y }));
      moved = true;
    }
    if (!moved) break;
  }
  w.anchor = anchorOfContent(content.x, content.y);
  w.win.setBounds({ x: w.anchor.x, y: w.anchor.y, width: COMPACT_WIN.width, height: COMPACT_WIN.height });
  saveWidgetConfig(w);
}

/** 给新组件找一块不重叠的位置：优先贴着上一个组件的右边/下边。 */
function findSpotForNewWidget() {
  const list = [...widgets.values()];
  const disp = list.length
    ? screen.getDisplayNearestPoint({
      x: list[list.length - 1].anchor.x + 50,
      y: list[list.length - 1].anchor.y + 60,
    })
    : screen.getPrimaryDisplay();
  const wa = disp.workArea;
  const rects = contentRects(null);
  const collides = (x, y) => rects.some(
    (o) => x < o.x + o.w && x + CONTENT.width > o.x && y < o.y + o.h && y + CONTENT.height > o.y,
  );

  const candidates = [];
  const last = rects[rects.length - 1];
  if (last) {
    candidates.push({ x: last.x + last.w + SNAP_GAP, y: last.y });
    candidates.push({ x: last.x - CONTENT.width - SNAP_GAP, y: last.y });
    candidates.push({ x: last.x, y: last.y + last.h + SNAP_GAP });
    candidates.push({ x: last.x, y: last.y - CONTENT.height - SNAP_GAP });
  }
  for (let gy = wa.y + 20; gy + CONTENT.height <= wa.y + wa.height; gy += CONTENT.height + 12) {
    for (let gx = wa.x + 20; gx + CONTENT.width <= wa.x + wa.width; gx += CONTENT.width + 12) {
      candidates.push({ x: gx, y: gy });
    }
  }

  for (const c of candidates) {
    const cl = clampContent(c.x, c.y, disp);
    if (!collides(cl.x, cl.y)) return anchorOfContent(cl.x, cl.y);
  }
  const fallback = last
    ? { x: last.x + 30, y: last.y + 30 }
    : { x: wa.x + 40, y: wa.y + 40 };
  const cl = clampContent(fallback.x, fallback.y, disp);
  return anchorOfContent(cl.x, cl.y);
}

function ensureWindowsOnScreen() {
  for (const w of widgets.values()) {
    if (!w.win || w.win.isDestroyed()) continue;
    const [x, y] = w.win.getPosition();
    const [width, height] = w.win.getSize();
    const disp = screen.getDisplayNearestPoint({ x: x + width / 2, y: y + height / 2 });
    const pos = w.expanded
      ? clampToWorkArea(x, y, width, height, disp)
      : clampWidgetWindow(x, y, disp);
    if (pos.x !== x || pos.y !== y) {
      w.win.setBounds({ x: pos.x, y: pos.y, width, height });
    }
    if (!w.expanded) {
      w.anchor = { x: pos.x, y: pos.y };
      saveWidgetConfig(w);
    }
  }
}

// ---------------------------------------------------------------- 对齐检测

/** 是否与其它组件处于同一行/列（上中下或左中右对齐）。 */
function isContentAligned(selfId, content) {
  const W = CONTENT.width;
  const H = CONTENT.height;
  for (const other of widgets.values()) {
    if (other.id === selfId) continue;
    if (!other.win || other.win.isDestroyed() || other.expanded) continue;
    const o = contentOfAnchor(other.anchor);
    const pairs = [
      [content.y, o.y],
      [content.y + H, o.y + H],
      [content.y + H / 2, o.y + H / 2],
      [content.x, o.x],
      [content.x + W, o.x + W],
      [content.x + W / 2, o.x + W / 2],
    ];
    for (const [a, b] of pairs) {
      if (Math.abs(a - b) <= ALIGN_TOL) return true;
    }
  }
  return false;
}

/** 把目标位置吸到同一行/列（顶边或左边对齐），返回是否发生对齐。 */
function alignTarget(selfId, x, y, tolerance = ALIGN_TOL) {
  let ax = x;
  let ay = y;
  let aligned = false;
  for (const other of widgets.values()) {
    if (other.id === selfId) continue;
    if (!other.win || other.win.isDestroyed() || other.expanded) continue;
    const o = contentOfAnchor(other.anchor);
    if (Math.abs(y - o.y) <= tolerance) {
      ay = o.y;
      aligned = true;
    }
    if (Math.abs(x - o.x) <= tolerance) {
      ax = o.x;
      aligned = true;
    }
  }
  return { x: ax, y: ay, aligned };
}

// ---------------------------------------------------------------- 壁纸

function wallpaperInfo() {
  let file = null;
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Control Panel\\Desktop', '/v', 'WallPaper'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    const line = out.split(/\r?\n/).find((l) => /WallPaper\s+REG_(SZ|EXPAND_SZ)/i.test(l));
    if (line) {
      const m = line.match(/REG_(?:SZ|EXPAND_SZ)\s+(.*)\s*$/);
      if (m && m[1].trim()) file = m[1].trim();
    }
  } catch { /* 读不到就用渐变兜底 */ }
  if (file && !fs.existsSync(file)) file = null;
  let fileUrl = null;
  if (file) {
    try { fileUrl = pathToFileURL(file).href; } catch { fileUrl = null; }
  }
  return { file, fileUrl };
}

/** 某个小组件自己的壁纸（不存在就返回 null，渲染端会退回桌面壁纸）。 */
function customWallpaperInfo(w) {
  if (!w || !w.wallpaper) return null;
  try {
    if (!fs.existsSync(w.wallpaper)) return null;
    return { file: w.wallpaper, fileUrl: pathToFileURL(w.wallpaper).href };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- 目录 / 图标

async function iconFor(entry) {
  const key = `${entry.path}|${entry.mtime}|${entry.size}`;
  if (iconCache.has(key)) return iconCache.get(key);

  let icon = null;
  try {
    if (entry.ext && THUMB_EXT.test(entry.ext)) {
      const img = await nativeImage.createThumbnailFromPath(entry.path, { width: 128, height: 128 });
      if (img && !img.isEmpty()) icon = { url: img.toDataURL(), kind: 'thumb' };
    }
  } catch { /* 没有缩略图就走图标 */ }

  // 快捷方式：让 Windows 解析目标图标（否则是「白纸 + 箭头」）
  if (!icon && (entry.ext === 'lnk' || entry.ext === 'url')) {
    const script = scriptFile('extract-icon.ps1');
    const tmp = path.join(
      app.getPath('temp'),
      `iosf-icon-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.png`,
    );
    try {
      await execFileAsync('powershell', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
        entry.path, tmp,
      ], { windowsHide: true, timeout: 8000 });
      if (fs.existsSync(tmp)) {
        const img = nativeImage.createFromPath(tmp);
        if (!img.isEmpty()) {
          const sz = img.getSize();
          const out = sz.width < 64 ? img.resize({ width: 96, height: 96, quality: 'best' }) : img;
          icon = { url: out.toDataURL(), kind: 'glyph' };
        }
      }
    } catch { /* 退回通用图标 */ }
    try { await fsp.rm(tmp, { force: true }); } catch { /* ignore */ }
  }

  if (!icon) {
    try {
      const img = await app.getFileIcon(entry.path, { size: 'large' });
      if (img && !img.isEmpty()) {
        const size = img.getSize();
        const out = size.width < 64 ? img.resize({ width: 96, height: 96, quality: 'best' }) : img;
        icon = { url: out.toDataURL(), kind: 'glyph' };
      }
    } catch { /* 拿不到图标就显示占位 */ }
  }

  iconCache.set(key, icon);
  if (iconCache.size > 1200) {
    const oldest = iconCache.keys().next().value;
    if (oldest !== key) iconCache.delete(oldest);
  }
  return icon;
}

async function listing(w, dir) {
  const entries = applyOrder(dir, await fsutil.listEntries(dir));
  return {
    dir,
    rootDir: w.rootDir,
    canUp: path.resolve(dir) !== path.resolve(w.rootDir),
    folderName: path.basename(dir),
    entries,
  };
}

function startWatch(w) {
  if (w.watcher) {
    try { w.watcher.close(); } catch { /* ignore */ }
    w.watcher = null;
  }
  clearTimeout(w.watchTimer);
  try {
    w.watcher = fs.watch(w.currentDir, { persistent: false }, () => {
      clearTimeout(w.watchTimer);
      w.watchTimer = setTimeout(() => {
        if (w.win && !w.win.isDestroyed()) w.win.webContents.send('dir:changed');
      }, 250);
    });
  } catch (err) {
    log('目录监视不可用:', err.message);
  }
}

function stopWatch(w) {
  clearTimeout(w.watchTimer);
  if (w.watcher) {
    try { w.watcher.close(); } catch { /* ignore */ }
    w.watcher = null;
  }
}

// ---------------------------------------------------------------- 小组件

function widgetFrom(event) {
  const sender = event && event.sender;
  if (!sender) return null;
  for (const w of widgets.values()) {
    if (w.win && !w.win.isDestroyed() && w.win.webContents === sender) return w;
  }
  return null;
}

function createWidget({
  folder, x, y, id, autoOpen = false, wallpaper = null, autoFolder = false,
  blur = 26, frost = 100, customBlur = 10, iconSize = 64, wallpaperFit = 'cover',
  wallpaperPosition = 'center', wallpaperScale = 100, wallpaperBlur = true, sortMode = 'name',
}) {
  const wid = Number.isFinite(id) ? id : nextWidgetId++;
  if (wid >= nextWidgetId) nextWidgetId = wid + 1;

  const root = path.resolve(folder);
  let customWallpaper = null;
  if (wallpaper && typeof wallpaper === 'string' && fs.existsSync(wallpaper)) {
    customWallpaper = wallpaper;
  }
  const anchor = clampWidgetPos(
    Number.isFinite(x) ? x : 140,
    Number.isFinite(y) ? y : 140,
  );

  const winRef = new BrowserWindow({
    x: anchor.x,
    y: anchor.y,
    width: COMPACT_WIN.width,
    height: COMPACT_WIN.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    title: 'iOS Folder',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: false,
      additionalArguments: [`--widget-id=${wid}`],
    },
  });

  const w = {
    id: wid,
    rootDir: root,
    currentDir: root,
    win: winRef,
    anchor,
    expanded: false,
    watcher: null,
    watchTimer: null,
    dragTimer: null,
    dragInfo: null,
    magnetPartner: null,
    alignActive: false,
    snapActive: false,
    lastClickAt: 0,
    wallpaper: customWallpaper,
    autoFolder: autoFolder === true,
    blur: Number.isFinite(blur) ? Math.min(40, Math.max(0, Math.round(blur))) : 26,
    frost: Number.isFinite(frost) ? Math.min(100, Math.max(0, Math.round(frost))) : 100,
    customBlur: Number.isFinite(customBlur) ? Math.min(30, Math.max(0, Math.round(customBlur))) : 10,
    iconSize: Number.isFinite(iconSize) ? Math.min(76, Math.max(52, Math.round(iconSize))) : 64,
    wallpaperFit: wallpaperFit === 'contain' ? 'contain' : 'cover',
    wallpaperPosition: ['center', 'top', 'bottom', 'left', 'right'].includes(wallpaperPosition) ? wallpaperPosition : 'center',
    wallpaperScale: Number.isFinite(wallpaperScale) ? Math.min(200, Math.max(100, Math.round(wallpaperScale))) : 100,
    wallpaperBlur: wallpaperBlur !== false,
    sortMode: ['name', 'time', 'size', 'type', 'custom'].includes(sortMode) ? sortMode : 'name',
  };
  widgets.set(wid, w);

  winRef.setMenuBarVisibility(false);
  winRef.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  const reveal = () => {
    if (!winRef.isDestroyed()) winRef.show();
  };
  winRef.once('ready-to-show', () => {
    reveal();
    log('widget ready', wid, JSON.stringify(winRef.getBounds()));
    if (autoOpen) {
      setTimeout(() => {
        if (winRef && !winRef.isDestroyed()) winRef.webContents.send('ui:auto-open');
      }, 700);
    }
  });
  setTimeout(() => {
    if (!winRef.isDestroyed() && !winRef.isVisible()) reveal();
  }, 1500);

  winRef.on('blur', () => {
    if (winRef.isDestroyed()) return;
    if (Date.now() < suppressBlurUntil) return;
    if (w.expanded) winRef.webContents.send('ui:blur-close');
  });

  winRef.on('closed', () => {
    stopWatch(w);
    clearInterval(w.dragTimer);
    if (w.magnetPartner) {
      const pw = widgets.get(w.magnetPartner);
      if (pw && pw.win && !pw.win.isDestroyed()) pw.win.webContents.send('win:magnet', { active: false });
      w.magnetPartner = null;
    }
    for (const other of widgets.values()) {
      if (other.magnetPartner === wid) {
        other.magnetPartner = null;
        if (other.win && !other.win.isDestroyed()) other.win.webContents.send('win:magnet', { active: false });
      }
    }
    widgets.delete(wid);
    config.widgets = config.widgets.filter((item) => item.id !== wid);
    saveConfig();
    rebuildTray();
    if (!quitting && widgets.size === 0) app.quit();
  });

  startWatch(w);
  saveWidgetConfig(w);
  rebuildTray();
  return w;
}

function focusedWidget() {
  const bw = BrowserWindow.getFocusedWindow();
  if (!bw) return null;
  for (const w of widgets.values()) {
    if (w.win === bw) return w;
  }
  return null;
}

/**
 * 新建一个小组件：不弹目录选择框，直接在桌面建一个新文件夹，
 * 并把小组件绑到它上面（和「新建文件夹」一样是真目录）。
 */
async function addWidgetAuto() {
  try {
    const desktop = app.getPath('desktop');
    const target = await fsutil.uniquePath(desktop, '新建文件夹');
    await fsp.mkdir(target);
    // 只保留 iPhone 风格图标：把真实文件夹设为隐藏，资源管理器默认不显示。
    try {
      execFileSync('attrib', ['+h', target], { windowsHide: true });
    } catch (err) {
      log('设置隐藏属性失败', err.message);
    }

    const base = findSpotForNewWidget();
    const created = createWidget({ folder: target, x: base.x, y: base.y, autoFolder: true });
    return created
      ? { ok: true, folder: target, name: path.basename(target) }
      : { ok: false, error: '创建小组件失败' };
  } catch (err) {
    log('新建小组件失败', err.message);
    return { ok: false, error: err.message };
  }
}

async function cleanupAutoFolder(w) {
  if (!w || !w.autoFolder) return;
  const root = path.resolve(w.rootDir);
  const desktop = path.resolve(app.getPath('desktop'));
  if (path.dirname(root) !== desktop) return;
  if (!path.basename(root).startsWith('新建文件夹')) return;
  try {
    const entries = await fsp.readdir(root);
    if (entries.length) return;
    stopWatch(w);
    try { execFileSync('attrib', ['-h', root], { windowsHide: true }); } catch { /* ignore */ }
    await fsp.rmdir(root);
    log('已清理空的自定义文件夹', root);
  } catch (err) {
    log('清理空文件夹失败', err.message);
  }
}

async function removeWidget(w) {
  if (!w || !w.win || w.win.isDestroyed()) return { ok: false };
  suppressBlurUntil = Date.now() + 15000;
  const res = await dialog.showMessageBox(w.win, {
    type: 'question',
    buttons: ['移除小组件', '取消'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: '移除小组件',
    message: `移除「${path.basename(w.rootDir)}」这个小组件？`,
    detail: w.autoFolder
      ? '只移除桌面上的小组件；如果它是工具创建的空文件夹，会一并清理。'
      : '只移除桌面上的小组件，不会删除文件夹。',
  });
  suppressBlurUntil = Date.now() + 500;
  if (res.response !== 0) return { ok: false, canceled: true };

  config.widgets = config.widgets.filter((item) => item.id !== w.id);
  saveConfig();
  await cleanupAutoFolder(w);
  w.win.close();
  return { ok: true };
}

// ---------------------------------------------------------------- 托盘

function settingsWidgetFrom(event) {
  if (!settingsWin || settingsWin.isDestroyed()) return null;
  if (event.sender !== settingsWin.webContents) return null;
  return widgets.get(settingsWidgetId) || null;
}

function openSettings(w) {
  if (!w) return;
  settingsWidgetId = w.id;
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.setTitle(`设置 — ${path.basename(w.rootDir)}`);
    settingsWin.show();
    settingsWin.focus();
    settingsWin.webContents.reload();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 480,
    height: 700,
    minWidth: 440,
    minHeight: 520,
    title: `设置 — ${path.basename(w.rootDir)}`,
    resizable: true,
    minimizable: true,
    maximizable: false,
    autoHideMenuBar: true,
    backgroundColor: '#f6f7f9',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => {
    settingsWin = null;
    settingsWidgetId = null;
  });
}

function setAutoStart(enabled) {
  config.autoStart = !!enabled;
  saveConfig();
  applyAutoStart();
  rebuildTray();
}

// ---------------------------------------------------------------- 更新检查

function updateRepo() {
  let raw = process.env.IOS_UPDATE_REPO || '';
  if (!raw) {
    try {
      const pkg = require('../package.json');
      raw = (pkg.repository && (pkg.repository.url || pkg.repository)) || '';
    } catch { raw = ''; }
  }
  const match = String(raw).match(/github\.com[\/:]([^\/]+)\/([^\/.#?]+)/i);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/i, '') };
}

function versionParts(value) {
  return String(value || '').replace(/^v/i, '').split(/[.-]/).slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersions(a, b) {
  const pa = versionParts(a);
  const pb = versionParts(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

async function checkForUpdates(parent) {
  const show = (options) => (
    parent && !parent.isDestroyed()
      ? dialog.showMessageBox(parent, options)
      : dialog.showMessageBox(options)
  );
  const repo = updateRepo();
  if (!repo) {
    await show({
      type: 'info',
      title: '检查更新',
      message: '当前版本还没有配置更新源',
      detail: '成品发布后会指向公开的 GitHub Release；开发版看到这个提示可以忽略。',
      buttons: ['知道了'],
      noLink: true,
    });
    return { ok: false, error: 'no-repo' };
  }
  const releasesUrl = `https://github.com/${repo.owner}/${repo.repo}/releases`;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/latest`,
      {
        headers: { 'User-Agent': 'ios-folder-widget', Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(12000),
      },
    );
    if (res.status === 404) {
      const choice = await show({
        type: 'info',
        title: '检查更新',
        message: '更新源暂时读不到',
        detail: '仓库可能是私有的，或者还没有发布 Release。可以打开 Releases 页面手动查看。',
        buttons: ['打开 Releases', '知道了'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (choice.response === 0) await shell.openExternal(releasesUrl);
      return { ok: false, error: 'not-found', url: releasesUrl };
    }
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const data = await res.json();
    const current = app.getVersion();
    const latest = String(data.tag_name || '').replace(/^v/i, '');
    if (compareVersions(latest, current) <= 0) {
      await show({
        type: 'info',
        title: '检查更新',
        message: `已是最新版本（${current}）`,
        buttons: ['知道了'],
        noLink: true,
      });
      return { ok: true, current, latest, upToDate: true };
    }
    const result = await show({
      type: 'info',
      title: '发现新版本',
      message: `发现新版本 ${latest}（当前 ${current}）`,
      detail: String(data.body || '').slice(0, 600) || '打开下载页查看更新内容。',
      buttons: ['打开下载页', '稍后'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (result.response === 0 && data.html_url) {
      await shell.openExternal(data.html_url);
    }
    return { ok: true, current, latest, url: data.html_url || null };
  } catch (err) {
    await show({
      type: 'warning',
      title: '检查更新失败',
      message: '连不上更新源',
      detail: err.message,
      buttons: ['知道了'],
      noLink: true,
    });
    return { ok: false, error: err.message };
  }
}

function rebuildTray() {
  if (!tray) return;
  const items = [];
  for (const w of widgets.values()) {
    items.push({
      label: path.basename(w.rootDir) || w.rootDir,
      click: () => {
        if (!w.win || w.win.isDestroyed()) return;
        w.win.show();
        w.win.focus();
        w.win.webContents.send('ui:open');
      },
    });
  }
  if (items.length) items.push({ type: 'separator' });
  items.push({ label: '新建文件夹小组件…', click: () => addWidgetAuto() });
  items.push({
    label: '开机自启动',
    type: 'checkbox',
    checked: config.autoStart !== false,
    click: (item) => setAutoStart(!!item.checked),
  });
  items.push({ type: 'separator' });
  items.push({ label: '退出', click: () => app.quit() });
  tray.setContextMenu(Menu.buildFromTemplate(items));
  try {
    tray.setToolTip(`iOS 文件夹 · ${widgets.size} 个小组件`);
  } catch { /* ignore */ }
}

function createTray() {
  try {
    const icoPath = assetFile('tray.ico');
    let icon = nativeImage.createFromPath(icoPath);
    if (icon.isEmpty()) {
      icon = nativeImage.createFromPath(assetFile('tray.png'));
    }
    // 不要强制缩到 16px：ICO 里带了 16/20/24/32/48/64/256，让 Windows 按 DPI 自己挑
    tray = new Tray(icon);
    rebuildTray();
    tray.on('double-click', () => {
      const first = [...widgets.values()][0];
      if (first && first.win && !first.win.isDestroyed()) {
        first.win.show();
        first.win.focus();
      }
    });
    log('tray ready');
  } catch (err) {
    log('托盘创建失败', err.message);
  }
}

// ---------------------------------------------------------------- 菜单

function popupMenu(w, template) {
  suppressBlurUntil = Date.now() + 1500;
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    const wrap = (list) => list.map((item) => {
      if (Array.isArray(item.submenu)) {
        return { ...item, submenu: wrap(item.submenu) };
      }
      if (typeof item.click === 'function') {
        return {
          ...item,
          click: (...args) => {
            const value = item.click(...args);
            finish(value);
          },
        };
      }
      return item;
    });
    const items = wrap(template);
    const menu = Menu.buildFromTemplate(items);
    menu.popup({
      window: w.win,
      callback: () => setTimeout(() => finish(null), 0),
    });
  });
}

// ---------------------------------------------------------------- 拖出移动

function startDropWatcher() {
  return new Promise((resolve) => {
    const script = scriptFile('resolve-drop.ps1');
    if (!fs.existsSync(script)) return resolve('');
    try {
      const child = spawn('powershell', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
      ], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      child.stdout.on('data', (chunk) => { out += chunk.toString(); });
      child.on('error', () => resolve(''));
      child.on('exit', () => resolve(out.trim()));
    } catch {
      resolve('');
    }
  });
}

async function handleDragOutResult(w, files, raw) {
  suppressBlurUntil = Date.now() + 500;
  let info = null;
  try {
    const line = String(raw || '').split(/\r?\n/).filter(Boolean).pop();
    info = line ? JSON.parse(line) : null;
  } catch {
    info = null;
  }
  if (!info) return;

  let targetDir = null;
  if (info.kind === 'desktop') targetDir = app.getPath('desktop');
  else if (info.kind === 'folder' && info.path) targetDir = info.path;
  if (!targetDir) return;

  let moved = 0;
  for (const src of files) {
    if (!src) continue;
    if (path.resolve(targetDir) === path.resolve(path.dirname(src))) continue;

    const st = await fsp.stat(src).catch(() => null);
    if (!st || st.isDirectory()) continue;

    // 只有目标目录里存在内容完全一致（SHA-256）的副本，才把源文件移进回收站。
    const srcHash = await fsutil.hashFile(src).catch(() => null);
    if (!srcHash) continue;

    let matched = false;
    for (let attempt = 0; attempt < 12 && !matched; attempt++) {
      const names = await fsp.readdir(targetDir).catch(() => []);
      let checked = 0;
      for (const name of names) {
        if (checked >= 30) break;
        const full = path.join(targetDir, name);
        if (path.resolve(full) === path.resolve(src)) continue;
        const t = await fsp.stat(full).catch(() => null);
        if (!t || !t.isFile() || t.size !== st.size) continue;
        checked += 1;
        const hash = await fsutil.hashFile(full).catch(() => null);
        if (hash && hash === srcHash) {
          matched = true;
          break;
        }
      }
      if (!matched) await new Promise((r) => setTimeout(r, 400));
    }
    if (!matched) continue;

    try {
      await shell.trashItem(src);
      moved += 1;
      log('拖出按移动处理（哈希校验通过）:', src);
    } catch (err) {
      log('移入回收站失败，保留源文件:', err.message);
    }
  }
  if (moved && w.win && !w.win.isDestroyed()) w.win.webContents.send('drag:out-done');
}

// ---------------------------------------------------------------- IPC

function registerIpc() {
  ipcMain.handle('app:init', async (event) => {
    const w = widgetFrom(event);
    if (!w) return null;
    w.currentDir = w.rootDir;
    startWatch(w);
    const [x, y] = w.win.getPosition();
    return {
      rootDir: w.rootDir,
      currentDir: w.currentDir,
      ...(await listing(w, w.currentDir)),
      windowPos: { x, y },
      display: displayInfo(w.win),
      wallpaper: wallpaperInfo(),
      customWallpaper: customWallpaperInfo(w),
      appearance: {
        blur: w.blur,
        frost: w.frost,
        customBlur: w.customBlur,
        iconSize: w.iconSize,
        wallpaperFit: w.wallpaperFit,
        wallpaperPosition: w.wallpaperPosition,
        wallpaperScale: w.wallpaperScale,
        wallpaperBlur: w.wallpaperBlur,
      },
      sortMode: w.sortMode,
      dark: nativeTheme.shouldUseDarkColors,
      sizes: {
        panel: PANEL_WIN,
        compact: COMPACT_WIN,
        miniPad: MINI_PAD,
        mini: COMPACT,
        panelBox: PANEL,
      },
    };
  });

  ipcMain.handle('dir:list', async (event, dir) => {
    const w = widgetFrom(event);
    if (!w) return null;
    return listing(w, dir);
  });

  ipcMain.handle('dir:enter', async (event, dir) => {
    const w = widgetFrom(event);
    if (!w) return null;
    const st = await fsp.stat(dir).catch(() => null);
    if (!st || !st.isDirectory()) return null;
    if (!fsutil.isInside(dir, w.rootDir)) return null;
    w.currentDir = dir;
    startWatch(w);
    return listing(w, dir);
  });

  ipcMain.handle('dir:up', async (event) => {
    const w = widgetFrom(event);
    if (!w) return null;
    if (!w.currentDir || path.resolve(w.currentDir) === path.resolve(w.rootDir)) return null;
    const parent = path.dirname(w.currentDir);
    if (!fsutil.isInside(parent, w.rootDir)) return null;
    w.currentDir = parent;
    startWatch(w);
    return listing(w, parent);
  });

  ipcMain.handle('icon:get', async (e, entry) => iconFor(entry));

  ipcMain.handle('item:open', async (e, target) => {
    const error = await shell.openPath(target);
    return { ok: !error, error: error || null };
  });

  ipcMain.handle('item:reveal', (e, target) => {
    shell.showItemInFolder(target);
    return { ok: true };
  });

  ipcMain.handle('item:trash', async (event, target) => {
    const w = widgetFrom(event);
    const targets = (Array.isArray(target) ? target : [target]).filter(Boolean);
    if (!targets.length) return { ok: false, error: '没有要删除的条目' };
    suppressBlurUntil = Date.now() + 15000;
    const label = targets.length === 1
      ? `「${path.basename(targets[0])}」`
      : `这 ${targets.length} 项`;
    const res = w && w.win
      ? await dialog.showMessageBox(w.win, {
        type: 'warning',
        buttons: ['移到应用回收站', '取消'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        title: '删除',
        message: `确定把${label}移到应用回收站？`,
        detail: '7 天内可以在应用内撤销（Ctrl+Z）。',
      })
      : { response: 1 };
    suppressBlurUntil = Date.now() + 600;
    if (res.response !== 0) return { ok: false, canceled: true };

    const batchId = `b${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const errors = [];
    let trashed = 0;
    for (const [index, file] of targets.entries()) {
      try {
        const record = await moveToTrash(file, batchId, index);
        trashRecords.push(record);
        trashed += 1;
        const key = orderKey(path.dirname(file));
        const order = dirOrders[key];
        if (Array.isArray(order)) {
          const name = path.basename(file);
          const next = order.filter((item) => item !== name);
          if (next.length) dirOrders[key] = next;
          else delete dirOrders[key];
          saveOrders();
        }
      } catch (err) {
        errors.push({ path: file, error: err.message });
      }
    }
    if (trashed) {
      lastTrashBatch = batchId;
      saveTrash();
    }
    return { ok: trashed > 0, trashed, batchId: trashed ? batchId : null, errors };
  });

  ipcMain.handle('trash:undo', async () => {
    const batch = lastTrashBatch
      || (trashRecords.length
        ? trashRecords.reduce((a, b) => (a.deletedAt > b.deletedAt ? a : b)).batchId
        : null);
    if (!batch) return { ok: false, error: '没有可撤销的删除' };
    return restoreTrashBatch(batch);
  });

  ipcMain.handle('trash:list', async () => trashBatches());

  ipcMain.handle('trash:restore', async (event, batchId) => {
    if (!batchId) return { ok: false, error: '没有指定要恢复的删除' };
    return restoreTrashBatch(batchId);
  });

  ipcMain.handle('trash:empty', async (event) => {
    const w = widgetFrom(event);
    if (w && w.win) {
      suppressBlurUntil = Date.now() + 15000;
      const res = await dialog.showMessageBox(w.win, {
        type: 'warning',
        buttons: ['清空应用回收站', '取消'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        title: '清空应用回收站',
        message: '确定永久删除应用回收站里的全部内容？',
        detail: '这一步不可恢复。',
      });
      suppressBlurUntil = Date.now() + 600;
      if (res.response !== 0) return { ok: false, canceled: true };
    }
    await fsp.rm(trashRoot(), { recursive: true, force: true }).catch(() => {});
    trashRecords = [];
    lastTrashBatch = null;
    saveTrash();
    return { ok: true };
  });

  ipcMain.handle('trash:open', async () => {
    await fsp.mkdir(trashRoot(), { recursive: true }).catch(() => {});
    await shell.openPath(trashRoot());
    return { ok: true };
  });

  ipcMain.handle('item:paste', async (event, dir, sources, mode) => {
    const list = (Array.isArray(sources) ? sources : []).filter(Boolean);
    if (!list.length) return { ok: false, error: '剪贴板为空' };
    const st = await fsp.stat(dir).catch(() => null);
    if (!st || !st.isDirectory()) return { ok: false, error: '目标不是文件夹' };
    const result = mode === 'cut'
      ? await fsutil.moveInto(dir, list)
      : await fsutil.copyInto(dir, list);
    return {
      ok: result.errors.length === 0,
      mode: mode === 'cut' ? 'cut' : 'copy',
      ...result,
    };
  });

  ipcMain.handle('item:rename', async (e, target, newName) => {
    const name = String(newName || '').trim();
    const problem = fsutil.validateName(name);
    if (problem) return { ok: false, error: problem };
    const dest = path.join(path.dirname(target), name);
    if (path.resolve(dest) === path.resolve(target)) return { ok: true, name };
    if (await fsutil.exists(dest)) return { ok: false, error: '同名文件已存在' };
    try {
      await fsp.rename(target, dest);
      const key = orderKey(path.dirname(target));
      const order = dirOrders[key];
      if (Array.isArray(order)) {
        const oldName = path.basename(target);
        const pos = order.indexOf(oldName);
        if (pos >= 0) {
          order[pos] = name;
          saveOrders();
        }
      }
      return { ok: true, name };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('item:drop', async (e, dir, sources) => fsutil.moveInto(dir, sources));

  ipcMain.handle('item:drop-choice', async (event, count) => {
    const w = widgetFrom(event);
    if (!w || !w.win) return 'move';
    suppressBlurUntil = Date.now() + 15000;
    const res = await dialog.showMessageBox(w.win, {
      type: 'question',
      title: '放入文件',
      message: `要如何处理这 ${count} 项？`,
      detail: '移动会改变文件位置；创建快捷方式只在当前文件夹生成 .lnk，原文件留在原处。',
      buttons: ['移动到这里', '创建快捷方式', '取消'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    suppressBlurUntil = Date.now() + 600;
    return ['move', 'shortcut', 'cancel'][res.response] || 'cancel';
  });

  ipcMain.handle('item:drop-shortcuts', async (e, dir, sources) => createShortcutsInto(dir, sources));

  ipcMain.handle('item:new-folder', async (e, dir) => {
    try {
      const st = await fsp.stat(dir);
      if (!st.isDirectory()) return { ok: false, error: '目标不是文件夹' };
      const target = await fsutil.uniquePath(dir, '新建文件夹');
      await fsp.mkdir(target);
      return { ok: true, name: path.basename(target), path: target };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('item:new-shortcut', async (event, dir) => {
    const w = widgetFrom(event);
    if (!w || !w.win) return { ok: false };
    const st = await fsp.stat(dir).catch(() => null);
    if (!st || !st.isDirectory()) return { ok: false, error: '目标不是文件夹' };
    suppressBlurUntil = Date.now() + 15000;
    const picked = await dialog.showOpenDialog(w.win, {
      title: '选择快捷方式目标',
      buttonLabel: '创建快捷方式',
      properties: ['openFile', 'openDirectory'],
    });
    suppressBlurUntil = Date.now() + 600;
    if (picked.canceled || !picked.filePaths.length) return { ok: false, canceled: true };
    const target = picked.filePaths[0];
    try {
      const base = path.basename(target) || '快捷方式';
      const link = await fsutil.uniquePath(dir, `${base}.lnk`);
      await createShortcutLink(link, target);
      return { ok: true, path: link, name: path.basename(link), target };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('dir:order:set', async (e, dir, names) => {
    const list = (Array.isArray(names) ? names : []).filter((name) => typeof name === 'string' && name);
    if (!dir || !list.length) return { ok: false };
    dirOrders[orderKey(dir)] = list;
    saveOrders();
    return { ok: true };
  });

  ipcMain.handle('dir:order:clear', async (e, dir) => {
    if (!dir) return { ok: false };
    delete dirOrders[orderKey(dir)];
    saveOrders();
    return { ok: true };
  });

  ipcMain.handle('view:sort', async (event, mode) => {
    const w = widgetFrom(event);
    if (!w) return { ok: false };
    const allowed = ['name', 'time', 'size', 'type', 'custom'];
    if (!allowed.includes(mode)) return { ok: false };
    w.sortMode = mode;
    saveWidgetConfig(w);
    return { ok: true, sortMode: w.sortMode };
  });

  ipcMain.on('drag:out', (event, paths, iconData) => {
    const w = widgetFrom(event);
    if (!w) return;
    const files = (Array.isArray(paths) ? paths : [paths]).filter(Boolean);
    if (!files.length) return;
    suppressBlurUntil = Date.now() + 120000;

    let icon = null;
    if (iconData) {
      try { icon = nativeImage.createFromDataURL(iconData); } catch { icon = null; }
    }
    if (!icon || icon.isEmpty()) {
      try {
        icon = nativeImage.createFromPath(assetFile('tray.png'));
      } catch { icon = null; }
    }

    const watcher = startDropWatcher();
    try {
      event.sender.startDrag({ files, icon });
    } catch (err) {
      log('startDrag 失败', err.message);
    }
    watcher.then((raw) => handleDragOutResult(w, files, raw));
  });

  ipcMain.on('win:drag-start', (event, startX, startY) => {
    const w = widgetFrom(event);
    if (!w || !w.win || w.win.isDestroyed()) return;
    const [x, y] = w.win.getPosition();
    const [width, height] = w.win.getSize();
    const cursor = screen.getCursorScreenPoint();
    w.dragInfo = {
      winX: x,
      winY: y,
      width,
      height,
      cursorX: Number.isFinite(startX) ? startX : cursor.x,
      cursorY: Number.isFinite(startY) ? startY : cursor.y,
    };
    w.dragVisual = contentOfAnchor({ x, y });
    const startSnap = snapWidgetContent(w.id, w.dragVisual.x, w.dragVisual.y);
    w.alignActive = isContentAligned(w.id, w.dragVisual);
    w.snapActive = startSnap.partnerId !== null;
    w.lastClickAt = 0;
    clearInterval(w.dragTimer);
    w.dragTimer = setInterval(() => {
      if (!w.win || w.win.isDestroyed() || !w.dragInfo) return;
      const c = screen.getCursorScreenPoint();
      const nx = w.dragInfo.winX + (c.x - w.dragInfo.cursorX);
      const ny = w.dragInfo.winY + (c.y - w.dragInfo.cursorY);
      const disp = screen.getDisplayNearestPoint(c);
      const raw = clampContent(nx + CONTENT.left, ny + CONTENT.top, disp);
      const snapped = snapWidgetContent(w.id, raw.x, raw.y);
      let target = clampContent(snapped.x, snapped.y, disp);

      // 进入同一行/列时把位置吸正，作为"卡一下"的停靠点
      const align = alignTarget(w.id, target.x, target.y);
      if (align.aligned) target = clampContent(align.x, align.y, disp);

      // 缓动跟随：避免窗口逐像素硬跳，同时让磁吸是"滑过去"而不是瞬移
      if (!w.dragVisual) w.dragVisual = { x: raw.x, y: raw.y };

      const now = Date.now();
      const alignNow = align.aligned;
      const snapNow = snapped.partnerId !== null;
      let triggered = false;
      if (alignNow && !w.alignActive) triggered = true;
      else if (snapNow && !w.snapActive && !alignNow) triggered = true;
      w.alignActive = alignNow;
      w.snapActive = snapNow;

      if (triggered && now - w.lastClickAt > 350) {
        w.lastClickAt = now;
        // 咔哒：直接落位到对齐/吸附点，并让两个窗口弹一下
        w.dragVisual = { x: target.x, y: target.y };
        const clickPos = anchorOfContent(target.x, target.y);
        w.win.setBounds({
          x: clickPos.x,
          y: clickPos.y,
          width: w.dragInfo.width,
          height: w.dragInfo.height,
        });
        w.win.webContents.send('win:moved', clickPos);
        w.win.webContents.send('win:click');
        if (snapped.partnerId) {
          const partner = widgets.get(snapped.partnerId);
          if (partner && partner.win && !partner.win.isDestroyed()) {
            partner.win.webContents.send('win:click');
          }
        }
        setMagnet(w, snapped.partnerId);
        return;
      }

      const ease = 0.55;
      let vx = w.dragVisual.x + (target.x - w.dragVisual.x) * ease;
      let vy = w.dragVisual.y + (target.y - w.dragVisual.y) * ease;
      if (Math.abs(target.x - vx) < 0.4) vx = target.x;
      if (Math.abs(target.y - vy) < 0.4) vy = target.y;
      const content = { x: Math.round(vx), y: Math.round(vy) };
      w.dragVisual = content;
      setMagnet(w, snapped.partnerId);
      const pos = anchorOfContent(content.x, content.y);
      w.win.setBounds({
        x: pos.x,
        y: pos.y,
        width: w.dragInfo.width,
        height: w.dragInfo.height,
      });
      w.win.webContents.send('win:moved', pos);
    }, 8);
  });

  ipcMain.on('win:drag-end', (event) => {
    const w = widgetFrom(event);
    if (!w || !w.win || w.win.isDestroyed()) return;

    // 松手时落到吸附/边界后的最终位置，避免停在缓动过程中的中间态
    if (w.dragInfo) {
      const c = screen.getCursorScreenPoint();
      const nx = w.dragInfo.winX + (c.x - w.dragInfo.cursorX);
      const ny = w.dragInfo.winY + (c.y - w.dragInfo.cursorY);
      const disp = screen.getDisplayNearestPoint(c);
      const raw = clampContent(nx + CONTENT.left, ny + CONTENT.top, disp);
      const snapped = snapWidgetContent(w.id, raw.x, raw.y);
      let target = clampContent(snapped.x, snapped.y, disp);
      // 松手时也要对齐（范围略放宽），否则拖动中咔哒对齐、一放手又差几像素
      const align = alignTarget(w.id, target.x, target.y, ALIGN_TOL + 6);
      if (align.aligned) target = clampContent(align.x, align.y, disp);
      const pos = anchorOfContent(target.x, target.y);
      w.win.setBounds({
        x: pos.x,
        y: pos.y,
        width: w.dragInfo.width,
        height: w.dragInfo.height,
      });
    }

    clearInterval(w.dragTimer);
    w.dragTimer = null;
    w.dragInfo = null;
    w.dragVisual = null;
    w.alignActive = false;
    w.snapActive = false;
    w.lastClickAt = 0;
    setMagnet(w, null);
    const [x, y] = w.win.getPosition();
    w.anchor = { x, y };
    resolveWidgetOverlap(w);
    const [finalX, finalY] = w.win.getPosition();
    w.anchor = { x: finalX, y: finalY };
    saveWidgetConfig(w);
    w.win.webContents.send('win:drag-ended', {
      windowPos: { x: finalX, y: finalY },
      display: displayInfo(w.win),
      wallpaper: wallpaperInfo(),
      customWallpaper: customWallpaperInfo(w),
    });
  });

  ipcMain.handle('win:expand', (event) => {
    const w = widgetFrom(event);
    if (!w || !w.win || w.win.isDestroyed()) return null;
    const disp = screen.getDisplayMatching(w.win.getBounds());
    const wa = disp.workArea;
    const [ax, ay] = w.win.getPosition();
    w.anchor = { x: ax, y: ay };
    let nx = ax;
    let ny = ay;
    if (wa.width >= PANEL_WIN.width) nx = Math.min(Math.max(ax, wa.x), wa.x + wa.width - PANEL_WIN.width);
    else nx = wa.x;
    if (wa.height >= PANEL_WIN.height) ny = Math.min(Math.max(ay, wa.y), wa.y + wa.height - PANEL_WIN.height);
    else ny = wa.y;
    w.win.setBounds({ x: nx, y: ny, width: PANEL_WIN.width, height: PANEL_WIN.height });
    w.win.focus();
    w.expanded = true;
    return {
      windowPos: { x: nx, y: ny },
      offset: { x: ax - nx, y: ay - ny },
      display: displayInfo(w.win),
    };
  });

  ipcMain.handle('win:collapse', (event) => {
    const w = widgetFrom(event);
    if (!w || !w.win || w.win.isDestroyed()) return null;
    w.expanded = false;
    w.win.setBounds({
      x: w.anchor.x,
      y: w.anchor.y,
      width: COMPACT_WIN.width,
      height: COMPACT_WIN.height,
    });
    return {
      windowPos: { x: w.anchor.x, y: w.anchor.y },
      display: displayInfo(w.win),
    };
  });

  ipcMain.handle('display:info', (event) => {
    const w = widgetFrom(event);
    if (!w || !w.win) return null;
    return {
      display: displayInfo(w.win),
      wallpaper: wallpaperInfo(),
      customWallpaper: customWallpaperInfo(w),
    };
  });

  ipcMain.handle('wallpaper:get', () => wallpaperInfo());

  ipcMain.handle('wallpaper:choose', async (event) => {
    const w = widgetFrom(event);
    if (!w || !w.win) return null;
    suppressBlurUntil = Date.now() + 60000;
    const res = await dialog.showOpenDialog(w.win, {
      title: '选择这个文件夹的壁纸',
      properties: ['openFile'],
      filters: [{
        name: '图片',
        extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'avif'],
      }],
    });
    suppressBlurUntil = Date.now() + 600;
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
    w.wallpaper = res.filePaths[0];
    saveWidgetConfig(w);
    const info = customWallpaperInfo(w);
    w.win.webContents.send('ui:wallpaper', { customWallpaper: info });
    return { ok: true, customWallpaper: info };
  });

  ipcMain.handle('wallpaper:clear', async (event) => {
    const w = widgetFrom(event);
    if (!w) return null;
    w.wallpaper = null;
    saveWidgetConfig(w);
    if (w.win && !w.win.isDestroyed()) {
      w.win.webContents.send('ui:wallpaper', { customWallpaper: null });
    }
    return { ok: true, customWallpaper: null };
  });

  ipcMain.handle('folder:choose', async (event) => {
    const w = widgetFrom(event);
    if (!w || !w.win) return null;
    suppressBlurUntil = Date.now() + 60000;
    const res = await dialog.showOpenDialog(w.win, {
      properties: ['openDirectory'],
      defaultPath: w.currentDir || w.rootDir,
      title: '选择要用 iPhone 文件夹外观展示的目录',
    });
    suppressBlurUntil = Date.now() + 600;
    if (res.canceled || !res.filePaths.length) return null;
    w.rootDir = res.filePaths[0];
    w.currentDir = w.rootDir;
    w.autoFolder = false;
    saveWidgetConfig(w);
    startWatch(w);
    rebuildTray();
    return {
      rootDir: w.rootDir,
      ...(await listing(w, w.currentDir)),
      wallpaper: wallpaperInfo(),
      customWallpaper: customWallpaperInfo(w),
      dark: nativeTheme.shouldUseDarkColors,
    };
  });

  ipcMain.handle('widget:add', async () => addWidgetAuto());

  ipcMain.handle('widget:remove', async (event) => {
    const w = widgetFrom(event);
    return removeWidget(w);
  });

  ipcMain.handle('menu:root', (event) => {
    const w = widgetFrom(event);
    if (!w) return null;
    return popupMenu(w, [
      { label: '打开', click: () => 'open' },
      { label: '在资源管理器中打开', click: () => 'open-root' },
      { label: '新建文件夹', click: () => 'new-folder' },
      { label: '新建快捷方式…', click: () => 'new-shortcut' },
      { label: '粘贴', click: () => 'paste' },
      {
        label: '设置',
        submenu: [
          { label: '打开设置窗口…', click: () => 'open-settings' },
          { type: 'separator' },
          { label: '换个文件夹…', click: () => 'choose' },
          {
            label: '排序',
            submenu: [
              { label: '名称（文件夹优先）', click: () => 'sort-name' },
              { label: '修改时间（新→旧）', click: () => 'sort-time' },
              { label: '大小（大→小）', click: () => 'sort-size' },
              { label: '类型', click: () => 'sort-type' },
            ],
          },
          { label: '设置文件夹壁纸…', click: () => 'choose-wallpaper' },
          { label: '清除文件夹壁纸', click: () => 'clear-wallpaper' },
          { type: 'separator' },
          { label: '撤销上一次删除', click: () => 'undo-delete' },
          { label: '打开应用回收站', click: () => 'trash-open' },
          { label: '清空应用回收站', click: () => 'trash-empty' },
          { type: 'separator' },
          {
            label: '开机自启动',
            type: 'checkbox',
            checked: config.autoStart !== false,
            click: (item) => {
              setAutoStart(!!item.checked);
              return null;
            },
          },
          {
            label: '打开日志文件夹',
            click: () => {
              try {
                shell.openPath(path.dirname(electronLog.transports.file.getFile().path));
              } catch { /* ignore */ }
              return null;
            },
          },
          {
            label: '检查更新…',
            click: () => {
              checkForUpdates(w.win);
              return null;
            },
          },
        ],
      },
      { label: '新建文件夹小组件…', click: () => 'add-widget' },
      { label: '移除这个小组件', click: () => 'remove-widget' },
      { label: '刷新', click: () => 'refresh' },
      { label: '按名称重新排序', click: () => 'sort' },
      { type: 'separator' },
      { label: '退出', click: () => 'quit' },
    ]);
  });

  ipcMain.handle('menu:item', (event) => {
    const w = widgetFrom(event);
    if (!w) return null;
    return popupMenu(w, [
      { label: '打开', click: () => 'open' },
      { label: '在资源管理器中显示', click: () => 'reveal' },
      { type: 'separator' },
      { label: '复制', click: () => 'copy' },
      { label: '剪切', click: () => 'cut' },
      { label: '粘贴', click: () => 'paste' },
      { type: 'separator' },
      { label: '新建文件夹', click: () => 'new-folder' },
      { label: '重命名', click: () => 'rename' },
      { label: '删除（移入应用回收站）', click: () => 'trash' },
    ]);
  });

  ipcMain.handle('settings:open', async (event) => {
    const w = widgetFrom(event);
    if (!w) return { ok: false };
    openSettings(w);
    return { ok: true };
  });

  ipcMain.handle('settings:get', async (event) => {
    const w = settingsWidgetFrom(event);
    if (!w) return null;
    return {
      folder: w.rootDir,
      autoStart: config.autoStart !== false,
      currentId: w.id,
      widgets: [...widgets.values()].map((item) => ({
        id: item.id,
        name: path.basename(item.rootDir) || item.rootDir,
        folder: item.rootDir,
      })),
      appearance: {
        blur: w.blur,
        frost: w.frost,
        customBlur: w.customBlur,
        iconSize: w.iconSize,
        wallpaperFit: w.wallpaperFit,
        wallpaperPosition: w.wallpaperPosition,
        wallpaperScale: w.wallpaperScale,
        wallpaperBlur: w.wallpaperBlur,
      },
      customWallpaper: customWallpaperInfo(w),
    };
  });

  ipcMain.handle('settings:appearance', async (event, appearance) => {
    const w = settingsWidgetFrom(event);
    if (!w) return { ok: false };
    const blur = Math.min(40, Math.max(0, Math.round(Number(appearance && appearance.blur))));
    const frost = Math.min(100, Math.max(0, Math.round(Number(appearance && appearance.frost))));
    const customBlur = Math.min(30, Math.max(0, Math.round(Number(appearance && appearance.customBlur))));
    const iconSize = Math.min(76, Math.max(52, Math.round(Number(appearance && appearance.iconSize))));
    const wallpaperFit = appearance && appearance.wallpaperFit === 'contain' ? 'contain' : 'cover';
    const wallpaperPosition = appearance && ['center', 'top', 'bottom', 'left', 'right'].includes(appearance.wallpaperPosition)
      ? appearance.wallpaperPosition
      : 'center';
    const wallpaperScale = Math.min(200, Math.max(100, Math.round(Number(appearance && appearance.wallpaperScale))));
    const wallpaperBlur = !appearance || appearance.wallpaperBlur !== false;
    w.blur = Number.isFinite(blur) ? blur : w.blur;
    w.frost = Number.isFinite(frost) ? frost : w.frost;
    w.customBlur = Number.isFinite(customBlur) ? customBlur : w.customBlur;
    w.iconSize = Number.isFinite(iconSize) ? iconSize : w.iconSize;
    w.wallpaperFit = wallpaperFit;
    w.wallpaperPosition = wallpaperPosition;
    w.wallpaperScale = Number.isFinite(wallpaperScale) ? wallpaperScale : w.wallpaperScale;
    w.wallpaperBlur = wallpaperBlur;
    saveWidgetConfig(w);
    if (w.win && !w.win.isDestroyed()) {
      w.win.webContents.send('ui:appearance', {
        blur: w.blur,
        frost: w.frost,
        customBlur: w.customBlur,
        iconSize: w.iconSize,
        wallpaperFit: w.wallpaperFit,
        wallpaperPosition: w.wallpaperPosition,
        wallpaperScale: w.wallpaperScale,
        wallpaperBlur: w.wallpaperBlur,
      });
    }
    return {
      ok: true,
      appearance: {
        blur: w.blur,
        frost: w.frost,
        customBlur: w.customBlur,
        iconSize: w.iconSize,
        wallpaperFit: w.wallpaperFit,
        wallpaperPosition: w.wallpaperPosition,
        wallpaperScale: w.wallpaperScale,
        wallpaperBlur: w.wallpaperBlur,
      },
    };
  });

  ipcMain.handle('settings:choose-wallpaper', async (event) => {
    const w = settingsWidgetFrom(event);
    if (!w) return { ok: false };
    const res = await dialog.showOpenDialog(settingsWin, {
      title: '选择这个文件夹的壁纸',
      properties: ['openFile'],
      filters: [{
        name: '图片',
        extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'avif'],
      }],
    });
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
    w.wallpaper = res.filePaths[0];
    saveWidgetConfig(w);
    const info = customWallpaperInfo(w);
    if (w.win && !w.win.isDestroyed()) w.win.webContents.send('ui:wallpaper', { customWallpaper: info });
    return { ok: true, customWallpaper: info };
  });

  ipcMain.handle('settings:clear-wallpaper', async (event) => {
    const w = settingsWidgetFrom(event);
    if (!w) return { ok: false };
    w.wallpaper = null;
    saveWidgetConfig(w);
    if (w.win && !w.win.isDestroyed()) w.win.webContents.send('ui:wallpaper', { customWallpaper: null });
    return { ok: true, customWallpaper: null };
  });

  ipcMain.handle('settings:auto-start', async (event, enabled) => {
    setAutoStart(!!enabled);
    return { ok: true };
  });

  ipcMain.handle('settings:add-widget', async () => addWidgetAuto());

  ipcMain.handle('settings:open-logs', async () => {
    try {
      shell.openPath(path.dirname(electronLog.transports.file.getFile().path));
    } catch { /* ignore */ }
    return { ok: true };
  });

  ipcMain.handle('settings:open-trash', async () => {
    await fsp.mkdir(trashRoot(), { recursive: true }).catch(() => {});
    await shell.openPath(trashRoot());
    return { ok: true };
  });

  ipcMain.handle('settings:empty-trash', async () => {
    const res = settingsWin && !settingsWin.isDestroyed()
      ? await dialog.showMessageBox(settingsWin, {
        type: 'warning',
        buttons: ['清空应用回收站', '取消'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        title: '清空应用回收站',
        message: '确定永久删除应用回收站里的全部内容？',
        detail: '这一步不可恢复。',
      })
      : { response: 1 };
    if (res.response !== 0) return { ok: false, canceled: true };
    await fsp.rm(trashRoot(), { recursive: true, force: true }).catch(() => {});
    trashRecords = [];
    lastTrashBatch = null;
    saveTrash();
    return { ok: true };
  });

  ipcMain.handle('settings:remove', async (event) => {
    const w = settingsWidgetFrom(event);
    if (!w) return { ok: false };
    return removeWidget(w);
  });

  ipcMain.handle('settings:remove-widget', async (event, id) => {
    if (!settingsWidgetFrom(event)) return { ok: false };
    const target = widgets.get(id);
    if (!target) return { ok: false, error: '小组件不存在' };
    return removeWidget(target);
  });

  ipcMain.handle('settings:check-update', async () => {
    const res = await checkForUpdates(settingsWin && !settingsWin.isDestroyed() ? settingsWin : null);
    return res;
  });

  ipcMain.handle('settings:close', async () => {
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
    return { ok: true };
  });

  ipcMain.on('app:quit', () => app.quit());
}

// ---------------------------------------------------------------- 生命周期

function folderFromArgv(argv) {
  const list = Array.isArray(argv) ? argv : [];
  const isDir = (cand) => {
    if (!cand || cand === '.' || cand.startsWith('--')) return false;
    try { return fs.statSync(cand).isDirectory(); } catch { return false; }
  };
  for (let i = 0; i < list.length; i++) {
    if (list[i] === '--folder' || list[i] === '-f') {
      for (let j = i + 1; j < list.length; j++) {
        if (isDir(list[j])) return list[j];
      }
    }
    if (list[i].startsWith('--folder=')) {
      const value = list[i].slice('--folder='.length);
      if (isDir(value)) return value;
    }
  }
  if (process.env.IOS_FOLDER) return process.env.IOS_FOLDER;
  return null;
}

function pickPosition() {
  const argv = process.argv;
  let raw = process.env.IOS_POS || null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--pos') raw = argv[i + 1];
    else if (argv[i].startsWith('--pos=')) raw = argv[i].slice('--pos='.length);
  }
  if (!raw) return null;
  const [x, y] = String(raw).split(',').map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.setAppUserModelId('com.local.iosfolderwidget');

  app.on('second-instance', (e, argv) => {
    const folder = folderFromArgv(argv);
    if (folder && fs.existsSync(folder)) {
      const base = findSpotForNewWidget();
      createWidget({ folder, x: base.x, y: base.y });
      return;
    }
    const first = [...widgets.values()][0];
    if (first && first.win && !first.win.isDestroyed()) {
      first.win.show();
      first.win.focus();
    }
  });

  async function maybeOnboard() {
  if (config.onboarded) return;
  const first = [...widgets.values()][0];
  const parent = first && first.win && !first.win.isDestroyed() ? first.win : undefined;
  suppressBlurUntil = Date.now() + 120000;
  try {
    const welcome = {
      type: 'info',
      title: '欢迎使用 iOS Folder Widget',
      message: '桌面上的 iPhone 风格文件夹已经准备好了',
      detail: '• 右键文件夹：新建文件夹、设置壁纸、移除\n• 托盘图标（可能在右下角 ^ 里）可以新建更多组件、开关开机自启、退出\n• 关掉面板只是收起，不会退出程序\n• 文件都保存在真实的 Windows 文件夹里，不会丢',
      buttons: ['继续'],
      defaultId: 0,
      noLink: true,
    };
    if (parent) await dialog.showMessageBox(parent, welcome);
    else await dialog.showMessageBox(welcome);

    const ask = {
      type: 'question',
      title: '开机自动启动',
      message: '要开机自动启动吗？',
      detail: '勾选后登录 Windows 会自动显示这些文件夹；不勾也可以随时手动启动。',
      buttons: ['开机自动启动', '先不用'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    };
    const res = parent
      ? await dialog.showMessageBox(parent, ask)
      : await dialog.showMessageBox(ask);
    config.autoStart = res.response === 0;
  } catch (err) {
    log('首次引导失败', err.message);
    config.autoStart = !app.isPackaged;
  }
  config.onboarded = true;
  saveConfig();
  applyAutoStart();
  rebuildTray();
  suppressBlurUntil = Date.now() + 800;
  log('首次引导完成 autoStart=', config.autoStart);
}

app.whenReady().then(() => {
    loadConfig();
    loadOrders();
    loadTrash();
    cleanupTrash();
    applyAutoStart();

    const pos = pickPosition();
    const cliFolder = folderFromArgv(process.argv);
    const autoOpen = process.argv.includes('--open') || process.env.IOS_FOLDER_OPEN === '1';

    if (!config.widgets.length) {
      const folder = cliFolder && fs.existsSync(cliFolder) ? cliFolder : app.getPath('desktop');
      config.widgets = [{
        id: nextWidgetId++,
        folder,
        x: pos ? pos.x : 140,
        y: pos ? pos.y : 140,
      }];
    } else if (cliFolder && fs.existsSync(cliFolder)
      && !config.widgets.some((item) => path.resolve(item.folder) === path.resolve(cliFolder))) {
      const last = config.widgets[config.widgets.length - 1];
      config.widgets.push({
        id: nextWidgetId++,
        folder: cliFolder,
        x: (last.x || 140) + 40,
        y: (last.y || 140) + 40,
      });
    }
    for (const item of config.widgets) {
      if (!fs.existsSync(item.folder)) {
        try { fs.mkdirSync(item.folder, { recursive: true }); } catch { /* ignore */ }
      }
    }

    createTray();
    registerIpc();
    let first = true;
    for (const item of config.widgets) {
      createWidget({
        id: item.id,
        folder: item.folder,
        x: item.x,
        y: item.y,
        wallpaper: item.wallpaper,
        autoFolder: item.autoCreated === true,
        blur: item.blur,
        frost: item.frost,
        customBlur: item.customBlur,
        iconSize: item.iconSize,
        wallpaperFit: item.wallpaperFit,
        wallpaperPosition: item.wallpaperPosition,
        wallpaperScale: item.wallpaperScale,
        wallpaperBlur: item.wallpaperBlur,
        sortMode: item.sortMode,
        autoOpen: first && autoOpen,
      });
      first = false;
    }

    setTimeout(() => { maybeOnboard(); }, 900);

    screen.on('display-removed', ensureWindowsOnScreen);
    screen.on('display-metrics-changed', ensureWindowsOnScreen);

    nativeTheme.on('updated', () => {
      for (const w of widgets.values()) {
        if (w.win && !w.win.isDestroyed()) {
          w.win.webContents.send('ui:theme', { dark: nativeTheme.shouldUseDarkColors });
        }
      }
    });
  });

  app.on('before-quit', () => {
    quitting = true;
    for (const w of widgets.values()) {
      stopWatch(w);
      clearInterval(w.dragTimer);
    }
    saveConfig();
  });

  app.on('window-all-closed', () => app.quit());
}
