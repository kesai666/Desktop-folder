'use strict';

/* global api */

const PANEL = { width: 580, height: 620, left: 10, top: 10 };
const COMPACT = { width: 100, height: 100 };
const MINI_PAD = 30;
const COLS = 4;

const el = {
  root: document.getElementById('root'),
  mini: document.getElementById('mini'),
  miniWp: document.getElementById('miniWp'),
  miniGrid: document.getElementById('miniGrid'),
  miniEmpty: document.getElementById('miniEmpty'),
  miniLabel: document.getElementById('miniLabel'),
  panel: document.getElementById('panel'),
  panelWp: document.getElementById('panelWp'),
  grid: document.getElementById('grid'),
  title: document.getElementById('title'),
  subtitle: document.getElementById('subtitle'),
  back: document.getElementById('backBtn'),
  close: document.getElementById('closeBtn'),
  arrange: document.getElementById('arrangeBtn'),
  search: document.getElementById('search'),
  footHint: document.getElementById('footHint'),
  empty: document.getElementById('emptyState'),
  footCount: document.getElementById('footCount'),
  toast: document.getElementById('toast'),
  marquee: document.getElementById('marquee'),
};

const state = {
  rootDir: null,
  dir: null,
  entries: [],
  allEntries: [],
  query: '',
  sortMode: 'name',
  open: false,
  busy: false,
  editMode: false,
  draggingTile: null,
  orderDirty: false,
  windowPos: { x: 0, y: 0 },
  offset: { x: 0, y: 0 },
  display: null,
  wallpaper: null,
  customWallpaper: null,
  appearance: { blur: 26, frost: 100, customBlur: 10, iconSize: 64, wallpaperFit: 'cover', wallpaperPosition: 'center', wallpaperScale: 100, wallpaperBlur: true, gridSize: 3 },
  pad: MINI_PAD,
  selection: -1,
  anchor: -1,
  multi: new Set(),
  clipboard: null,
  marqueeJustEnded: false,
  renaming: null,
  toastTimer: 0,
  iconRun: 0,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const baseName = (p) => (p ? p.split(/[\\/]/).filter(Boolean).pop() || p : '');

function selectedIndices() {
  const set = state.multi && state.multi.size
    ? [...state.multi]
    : (state.selection >= 0 ? [state.selection] : []);
  return [...new Set(set)]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < state.entries.length)
    .sort((a, b) => a - b);
}

function selectedEntries() {
  return selectedIndices().map((i) => state.entries[i]).filter(Boolean);
}

function clearSelection() {
  state.multi.clear();
  state.selection = -1;
  state.anchor = -1;
}

function sortEntriesForView(entries, mode) {
  const copy = entries.slice();
  copy.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    if (mode === 'time') return (b.mtime || 0) - (a.mtime || 0);
    if (mode === 'size') return (b.size || 0) - (a.size || 0);
    if (mode === 'type') {
      const byExt = String(a.ext || '').localeCompare(String(b.ext || ''), 'zh-CN');
      if (byExt) return byExt;
    }
    return a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' });
  });
  return copy;
}

function applyFilter(resetSelection = true) {
  const query = state.query.trim().toLowerCase();
  let list = query
    ? state.allEntries.filter((entry) => entry.name.toLowerCase().includes(query))
    : state.allEntries.slice();
  if (state.sortMode !== 'custom') list = sortEntriesForView(list, state.sortMode);
  state.entries = list;
  if (resetSelection) clearSelection();
  render();
}

// ------------------------------------------------------------------ 初始化

function applySizes() {
  el.root.style.setProperty('--pad', `${MINI_PAD}px`);
  el.root.style.setProperty('--panel-x', `${PANEL.left}px`);
  el.root.style.setProperty('--panel-y', `${PANEL.top}px`);
  el.root.style.setProperty('--panel-w', `${PANEL.width}px`);
  el.root.style.setProperty('--panel-h', `${PANEL.height}px`);
}

async function init() {
  applySizes();
  const info = await api.init();
  state.rootDir = info.rootDir;
  state.dir = info.dir;
  state.allEntries = info.entries || [];
  state.entries = state.allEntries.slice();
  state.query = '';
  state.sortMode = info.sortMode || 'name';
  if (state.sortMode !== 'custom') {
    state.entries = sortEntriesForView(state.entries, state.sortMode);
  }
  state.windowPos = info.windowPos;
  state.display = info.display;
  state.wallpaper = info.wallpaper;
  state.customWallpaper = info.customWallpaper || null;
  applyAppearance(info.appearance);
  state.pad = info.sizes && Number.isFinite(info.sizes.miniPad) ? info.sizes.miniPad : MINI_PAD;
  el.root.style.setProperty('--pad', `${state.pad}px`);
  document.body.classList.toggle('dark', !!info.dark);
  render();
  applyLayout();
  fillIcons();
  startWatching();
}

async function startWatching() {
  api.onMoved((pos) => {
    state.windowPos = pos;
    applyLayout();
  });
  api.onMagnet(({ active }) => {
    el.root.classList.toggle('magnet', !!active);
  });
  let clickTimer = 0;
  api.onClick(() => {
    el.root.classList.remove('click');
    // 强制重排，保证连续吸附时每次都能重播动画
    void el.root.offsetWidth;
    el.root.classList.add('click');
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => el.root.classList.remove('click'), 240);
  });
  api.onDragEnded((info) => {
    state.windowPos = info.windowPos;
    if (info.display) state.display = info.display;
    if (info.wallpaper) state.wallpaper = info.wallpaper;
    if (info.customWallpaper !== undefined) state.customWallpaper = info.customWallpaper;
    applyLayout();
  });
  api.onDirChanged(async () => {
    if (state.renaming) return;
    if (state.open) await refresh({ keepSelection: true });
    else await refreshMini();
  });
  api.onTheme(({ dark }) => document.body.classList.toggle('dark', !!dark));
  api.onWallpaper((info) => {
    if (info && info.customWallpaper !== undefined) {
      state.customWallpaper = info.customWallpaper;
      applyLayout();
    }
  });
  api.onAppearance((info) => applyAppearance(info));
  api.onAutoOpen(() => open());
  api.onTrayOpen(() => open());
  api.onBlurClose(() => {
    if (state.open) close();
  });
  api.onDragOutDone(() => {
    refresh({ keepSelection: true });
  });

  // 壁纸 / 分辨率变更：低频轮询，代价很小
  setInterval(async () => {
    try {
      const info = await api.displayInfo();
      const changed = JSON.stringify(info.wallpaper) !== JSON.stringify(state.wallpaper)
        || JSON.stringify(info.customWallpaper) !== JSON.stringify(state.customWallpaper)
        || JSON.stringify(info.display) !== JSON.stringify(state.display);
      if (changed) {
        state.wallpaper = info.wallpaper;
        state.customWallpaper = info.customWallpaper || null;
        state.display = info.display;
        applyLayout();
      }
    } catch { /* 忽略 */ }
  }, 20000);
}

// ------------------------------------------------------------------ 布局 / 壁纸

function applyAppearance(info) {
  if (!info) return;
  const previousGrid = state.appearance.gridSize;
  state.appearance = { ...state.appearance, ...info };
  const blur = Math.min(40, Math.max(0, Number(state.appearance.blur) || 0));
  const frost = Math.min(100, Math.max(0, Number(state.appearance.frost) || 0));
  const customBlur = Math.min(30, Math.max(0, Number(state.appearance.customBlur) || 0));
  const wallpaperBlur = state.appearance.wallpaperBlur !== false;
  const wallpaperScale = Math.min(200, Math.max(100, Number(state.appearance.wallpaperScale) || 100));
  const gridSize = [2, 3, 4].includes(Number(state.appearance.gridSize)) ? Number(state.appearance.gridSize) : 3;
  const miniScale = gridSize === 2 ? 0.9 : gridSize === 4 ? 1.18 : 1;
  const miniVisual = Math.round(COMPACT.width * miniScale);
  const iconSize = Math.min(76, Math.max(52, Number(state.appearance.iconSize) || 64));
  const fit = state.appearance.wallpaperFit === 'contain' ? 'contain' : 'cover';
  const position = ['center', 'top', 'bottom', 'left', 'right'].includes(state.appearance.wallpaperPosition)
    ? state.appearance.wallpaperPosition
    : 'center';
  el.root.style.setProperty('--wp-blur', `${blur}px`);
  el.root.style.setProperty('--custom-blur', `${wallpaperBlur ? customBlur : 0}px`);
  el.root.style.setProperty('--frost-alpha', String(frost / 100));
  el.root.style.setProperty('--tile-icon', `${iconSize}px`);
  el.root.style.setProperty('--mini-cols', String(gridSize));
  el.root.style.setProperty('--mini-rows', String(gridSize));
  el.root.style.setProperty('--mini-scale', String(miniScale));
  el.root.style.setProperty('--mini-visual-size', `${miniVisual}px`);
  el.root.style.setProperty('--wp-fit', fit);
  el.root.style.setProperty('--wp-pos', position);
  el.root.style.setProperty('--wp-zoom', String(wallpaperScale / 100));
  if (previousGrid !== gridSize && state.entries.length) render();
}

function applyLayout() {
  const d = state.display;
  const wx = state.windowPos.x;
  const wy = state.windowPos.y;

  const custom = state.customWallpaper && state.customWallpaper.fileUrl
    ? state.customWallpaper.fileUrl
    : null;

  const place = (wpEl, left, top) => {
    if (!wpEl) return;
    if (custom) {
      wpEl.style.width = '100%';
      wpEl.style.height = '100%';
      wpEl.style.transform = 'none';
      wpEl.style.backgroundImage = `url("${custom}")`;
      wpEl.classList.add('custom');
      return;
    }
    wpEl.classList.remove('custom');
    if (d) {
      wpEl.style.width = `${d.width}px`;
      wpEl.style.height = `${d.height}px`;
      wpEl.style.transform = `translate(${d.x - (wx + left)}px, ${d.y - (wy + top)}px)`;
    }
    wpEl.style.backgroundImage = state.wallpaper && state.wallpaper.fileUrl
      ? `url("${state.wallpaper.fileUrl}")`
      : '';
  };

  place(el.miniWp, state.pad + state.offset.x, state.pad + state.offset.y);
  place(el.panelWp, PANEL.left, PANEL.top);

  el.root.style.setProperty('--ox', `${state.offset.x}px`);
  el.root.style.setProperty('--oy', `${state.offset.y}px`);
}

function setPanelOrigin() {
  const cx = state.pad + state.offset.x + COMPACT.width / 2 - PANEL.left;
  const cy = state.pad + state.offset.y + COMPACT.height / 2 - PANEL.top;
  el.panel.style.transformOrigin = `${cx}px ${cy}px`;
}
// ------------------------------------------------------------------ 渲染

function makeTile(entry, idx, mini) {
  const tile = document.createElement('div');
  tile.className = 'tile';
  tile.dataset.idx = String(idx);
  if (!mini) tile.draggable = true;

  const art = document.createElement('div');
  art.className = 'art';

  if (entry.isDir) {
    art.classList.add('subfolder');
    for (let i = 0; i < 9; i++) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      art.appendChild(dot);
    }
  } else if (entry.icon) {
    applyIcon(art, entry.icon);
  } else {
    applyFallback(art, entry);
  }

  tile.appendChild(art);

  if (!mini) {
    const label = document.createElement('div');
    label.className = 'tile-label';
    label.textContent = entry.name;
    tile.appendChild(label);
  }
  return tile;
}

function applyIcon(art, icon) {
  art.classList.remove('loading');
  art.classList.remove('fallback');
  art.classList.remove('glyph-plate');
  art.replaceChildren();
  const img = document.createElement('img');
  img.draggable = false;
  img.src = icon.url;
  if (icon.kind === 'thumb') {
    img.className = 'thumb';
  } else {
    img.className = 'glyph';
  }
  art.appendChild(img);
}

function applyFallback(art, entry) {
  art.classList.remove('loading');
  art.classList.remove('glyph-plate');
  art.classList.add('fallback');
  art.replaceChildren();
  const ext = document.createElement('span');
  ext.className = 'ext';
  const label = (entry.ext || '文件').slice(0, 4).toUpperCase();
  ext.textContent = label;
  art.appendChild(ext);
}

function paintIcon(entry) {
  const idx = state.entries.indexOf(entry);
  if (idx < 0 || !entry.icon) return;
  document.querySelectorAll(`.tile[data-idx="${idx}"] .art`).forEach((art) => applyIcon(art, entry.icon));
}

function updateSubtitle() {
  const indexes = selectedIndices();
  let text = state.dir;
  if (indexes.length > 1) text = `已选 ${indexes.length} 项 · ${state.dir}`;
  else if (indexes.length === 1) text = state.entries[indexes[0]].path;
  el.subtitle.textContent = text;
  el.subtitle.title = text;
  el.subtitle.scrollLeft = 0;
}

function render() {
  const name = baseName(state.dir);
  el.miniLabel.textContent = name;
  el.title.textContent = name;
  updateSubtitle();
  el.back.hidden = state.dir === state.rootDir;

  el.miniGrid.replaceChildren();
  const miniCount = Math.min(16, Math.max(4, (Number(state.appearance.gridSize) || 3) ** 2));
  state.entries.slice(0, miniCount).forEach((entry, i) => el.miniGrid.appendChild(makeTile(entry, i, true)));
  el.miniEmpty.hidden = state.entries.length > 0;

  el.grid.replaceChildren();
  state.entries.forEach((entry, i) => el.grid.appendChild(makeTile(entry, i, false)));

  el.empty.hidden = state.entries.length > 0;
  el.footCount.textContent = state.entries.length ? `共 ${state.entries.length} 项` : '空文件夹';

  state.multi = new Set([...state.multi].filter((i) => i < state.entries.length));
  if (state.selection >= state.entries.length) state.selection = -1;
  paintSelection();
}

function paintSelection() {
  el.grid.querySelectorAll('.tile.selected').forEach((t) => t.classList.remove('selected'));
  const indexes = selectedIndices();
  for (const idx of indexes) {
    const tile = el.grid.querySelector(`.tile[data-idx="${idx}"]`);
    if (tile) tile.classList.add('selected');
  }
  updateSubtitle();
}

async function fillIcons() {
  const run = ++state.iconRun;
  const order = state.entries.map((_, i) => i);
  order.sort((a, b) => (a < 9 ? 0 : 1) - (b < 9 ? 0 : 1));
  const queue = order.filter((i) => !state.entries[i].isDir && !state.entries[i].icon);

  const worker = async () => {
    while (queue.length) {
      if (run !== state.iconRun) return;
      const i = queue.shift();
      const entry = state.entries[i];
      let icon = null;
      try {
        icon = await api.icon(entry);
      } catch { /* 图标失败不致命 */ }
      if (run !== state.iconRun) return;
      if (icon) {
        entry.icon = icon;
        paintIcon(entry);
      }
    }
  };

  await Promise.all([worker(), worker(), worker(), worker()]);
}

// ------------------------------------------------------------------ 展开 / 收起

async function open() {
  if (state.open || state.busy) return;
  state.busy = true;
  try {
    const res = await api.expand();
    state.windowPos = res.windowPos;
    state.offset = res.offset || { x: 0, y: 0 };
    if (res.display) state.display = res.display;
    state.open = true;
    setEditMode(false);
    el.root.classList.remove('magnet');
    setPanelOrigin();
    applyLayout();
    el.root.classList.add('open');
    el.panel.setAttribute('aria-hidden', 'false');
    await refresh({ keepSelection: true });
    window.focus();
  } catch (err) {
    toast('展开失败：' + (err && err.message ? err.message : err));
  } finally {
    state.busy = false;
  }
}

async function close() {
  if (!state.open || state.busy) return;
  setEditMode(false);
  state.query = '';
  state.entries = state.allEntries.slice();
  clearSelection();
  if (el.search) {
    el.search.value = '';
    el.search.hidden = true;
  }
  state.open = false;
  state.busy = true;
  el.root.classList.remove('open');
  el.panel.setAttribute('aria-hidden', 'true');
  await sleep(240);
  try {
    const res = await api.collapse();
    state.windowPos = res.windowPos;
    if (res.display) state.display = res.display;
    state.offset = { x: 0, y: 0 };
    applyLayout();

    if (state.dir !== state.rootDir) {
      state.dir = state.rootDir;
      state.selection = -1;
      await refresh();
    }
  } catch (err) {
    toast('收起失败：' + (err && err.message ? err.message : err));
  } finally {
    state.busy = false;
  }
}

// ------------------------------------------------------------------ 数据操作

async function refresh({ keepSelection = false } = {}) {
  if (state.renaming) return;
  const before = state.selection;
  try {
    const res = await api.listDir(state.dir);
    const query = state.query.trim().toLowerCase();
    state.allEntries = res.entries || [];
    let list = query
      ? state.allEntries.filter((entry) => entry.name.toLowerCase().includes(query))
      : state.allEntries.slice();
    if (state.sortMode !== 'custom') list = sortEntriesForView(list, state.sortMode);
    state.entries = list;
    if (keepSelection && !query && before >= 0 && before < state.entries.length) {
      state.selection = before;
      state.multi = new Set([before]);
      state.anchor = before;
    } else if (!keepSelection || query) {
      clearSelection();
    }
    render();
    fillIcons();
  } catch (err) {
    toast('读取目录失败：' + (err && err.message ? err.message : err));
  }
}

async function refreshMini() {
  try {
    const res = await api.listDir(state.rootDir);
    state.dir = state.rootDir;
    state.allEntries = res.entries || [];
    state.query = '';
    if (el.search) el.search.value = '';
    applyFilter();
    fillIcons();
  } catch { /* 忽略 */ }
}

async function enterDir(entry) {
  const res = await api.enter(entry.path);
  if (!res) return;
  state.dir = res.dir;
  state.allEntries = res.entries || [];
  state.query = '';
  if (el.search) el.search.value = '';
  applyFilter();
  fillIcons();
  el.grid.scrollTop = 0;
}

async function goUp() {
  if (state.dir === state.rootDir) return;
  const res = await api.up();
  if (!res) return;
  state.dir = res.dir;
  state.allEntries = res.entries || [];
  state.query = '';
  if (el.search) el.search.value = '';
  applyFilter();
  fillIcons();
}

async function openEntry(idx) {
  const entry = state.entries[idx];
  if (!entry) return;
  if (entry.isDir) {
    await enterDir(entry);
    return;
  }
  const res = await api.openItem(entry.path);
  if (!res.ok) toast(res.error || '打不开这个文件');
}

async function chooseFolder() {
  const res = await api.chooseFolder();
  if (!res) return;
  state.rootDir = res.rootDir;
  state.dir = res.dir || res.rootDir;
  state.allEntries = res.entries || [];
  state.query = '';
  if (el.search) el.search.value = '';
  applyFilter();
  if (res.wallpaper) state.wallpaper = res.wallpaper;
  if (res.customWallpaper !== undefined) state.customWallpaper = res.customWallpaper;
  document.body.classList.toggle('dark', !!res.dark);
  applyLayout();
  fillIcons();
  toast('已切换文件夹');
}

function startRename(entry) {
  const idx = state.entries.indexOf(entry);
  if (idx < 0) return;
  const tile = el.grid.querySelector(`.tile[data-idx="${idx}"]`);
  if (!tile) return;
  const label = tile.querySelector('.tile-label');
  if (!label) return;

  const input = document.createElement('input');
  input.className = 'rename-input';
  input.value = entry.name;
  label.replaceWith(input);
  state.renaming = entry;
  input.focus();
  input.select();

  const finish = async (commit) => {
    if (input.dataset.done === '1') return;
    input.dataset.done = '1';
    state.renaming = null;
    const value = input.value.trim();
    if (!commit || !value || value === entry.name) {
      render();
      return;
    }
    const res = await api.rename(entry.path, value);
    if (!res.ok) toast(res.error || '重命名失败');
    await refresh();
  };

  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('dblclick', (e) => e.stopPropagation());
}

function toast(msg) {
  clearTimeout(state.toastTimer);
  el.toast.textContent = msg;
  el.toast.hidden = false;
  state.toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2200);
}

// ------------------------------------------------------------------ 菜单

async function rootMenu() {
  const action = await api.menuRoot();
  if (!action) return;
  if (action === 'open') await open();
  else if (action === 'open-root') {
    const res = await api.openItem(state.dir);
    if (!res.ok) toast(res.error || '打不开这个文件夹');
  } else if (action === 'open-settings') await api.openSettings();
  else if (action === 'open-wallpaper-settings') await api.openSettings('wallpaper');
  else if (action === 'choose') await chooseFolder();
  else if (action.startsWith('sort-')) {
    state.sortMode = action.slice(5);
    api.setSort(state.sortMode);
    applyFilter();
    toast('已切换排序方式');
  } else if (action === 'paste') await pasteClipboard();
  else if (action === 'choose-wallpaper') {
    const res = await api.chooseWallpaper();
    if (res && res.ok) {
      state.customWallpaper = res.customWallpaper;
      applyLayout();
      toast('已设置文件夹壁纸');
    }
  } else if (action === 'clear-wallpaper') {
    const res = await api.clearWallpaper();
    if (res && res.ok) {
      state.customWallpaper = null;
      applyLayout();
      toast('已恢复桌面壁纸');
    }
  } else if (action === 'refresh') await refresh();
  else if (action === 'sort') await sortByName();
  else if (action === 'new-folder') await createFolder();
  else if (action === 'new-shortcut') await createShortcut();
  else if (action === 'add-widget') {
    const res = await api.addWidget();
    if (res && res.ok) toast(`已新建小组件：${res.name}`);
    else if (res && res.error) toast(res.error);
  } else if (action === 'remove-widget') await api.removeWidget();
  else if (action === 'quit') api.quit();
}

function setClipboard(mode, entries) {
  state.clipboard = { mode, paths: entries.map((entry) => entry.path) };
  toast(mode === 'cut' ? `已剪切 ${entries.length} 项` : `已复制 ${entries.length} 项`);
}

async function pasteClipboard() {
  if (!state.clipboard || !state.clipboard.paths.length) {
    toast('剪贴板为空');
    return;
  }
  const mode = state.clipboard.mode;
  const res = await api.paste(state.dir, state.clipboard.paths, mode);
  if (res && res.ok) {
    toast(mode === 'cut' ? '已移动到当前文件夹' : '已复制到当前文件夹');
    if (mode === 'cut') state.clipboard = null;
    clearSelection();
    await refresh();
  } else if (res && res.error) {
    toast(res.error);
  }
}

async function trashEntries(entries) {
  if (!entries.length) return;
  const res = await api.trash(entries.map((entry) => entry.path));
  if (res.ok) {
    toast(`已移到应用回收站：${res.trashed || entries.length} 项（Ctrl+Z 撤销）`);
    clearSelection();
    await refresh();
  } else if (res.error) {
    toast(res.error);
  }
}

async function undoTrash() {
  const res = await api.undoTrash();
  if (res && res.ok) {
    toast(`已撤销删除：${res.restored} 项`);
    clearSelection();
    await refresh();
  } else if (res && res.error) {
    toast(res.error);
  }
}

async function itemMenu() {
  const entries = selectedEntries();
  if (!entries.length) return;
  const action = await api.menuItem(entries[0]);
  if (!action) return;
  if (action === 'open') await openEntry(state.entries.indexOf(entries[0]));
  else if (action === 'reveal') api.reveal(entries[0].path);
  else if (action === 'rename') {
    if (entries.length === 1) startRename(entries[0]);
    else toast('一次只能重命名一项');
  } else if (action === 'trash') await trashEntries(entries);
  else if (action === 'copy') setClipboard('copy', entries);
  else if (action === 'cut') setClipboard('cut', entries);
  else if (action === 'paste') await pasteClipboard();
  else if (action === 'undo-delete') await undoTrash();
  else if (action === 'trash-open') await api.openTrash();
  else if (action === 'trash-empty') {
    const res = await api.emptyTrash();
    if (res && res.ok) toast('已清空应用回收站');
  }
  else if (action === 'new-folder') await createFolder();
}

// ------------------------------------------------------------------ 收起态交互

el.mini.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || state.open) return;
  const startX = e.screenX;
  const startY = e.screenY;
  let moved = false;

  const onMove = (ev) => {
    if (moved) return;
    if (Math.hypot(ev.screenX - startX, ev.screenY - startY) > 6) {
      moved = true;
      el.mini.classList.add('dragging');
      api.dragStart(startX, startY);
    }
  };
  const onUp = (ev) => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    el.mini.classList.remove('dragging');
    if (moved) {
      api.dragEnd();
      return;
    }
    if (Math.hypot(ev.screenX - startX, ev.screenY - startY) <= 6) open();
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
});

el.mini.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  e.stopPropagation();
  rootMenu();
});

el.mini.addEventListener('dblclick', (e) => {
  e.preventDefault();
  open();
});

el.miniLabel.addEventListener('click', () => {
  if (!state.open) open();
});

// ------------------------------------------------------------------ 排列模式

function setEditMode(on) {
  state.editMode = !!on;
  state.draggingTile = null;
  state.orderDirty = false;
  el.root.classList.toggle('edit', state.editMode);
  el.arrange.textContent = state.editMode ? '完成' : '排列';
  el.arrange.classList.toggle('active', state.editMode);
  el.footHint.textContent = state.editMode
    ? '拖动图标排列 · 点「完成」保存'
    : '双击打开 · 拖入放入 · 拖出移出';
}

async function commitOrder() {
  if (!state.orderDirty) return;
  state.orderDirty = false;
  const tiles = [...el.grid.querySelectorAll('.tile')];
  const entries = tiles
    .map((tile) => state.entries[Number(tile.dataset.idx)])
    .filter(Boolean);
  if (!entries.length || entries.length !== state.entries.length) {
    render();
    return;
  }
  state.entries = entries;
  state.sortMode = 'custom';
  api.setSort('custom');
  if (!state.query) state.allEntries = entries.slice();
  render();
  const res = await api.setOrder(state.dir, entries.map((entry) => entry.name));
  if (res && res.ok) toast('排列已保存');
}

async function sortByName() {
  const res = await api.clearOrder(state.dir);
  if (res && res.ok) {
    state.sortMode = 'name';
    api.setSort('name');
    toast('已按名称排序');
    await refresh();
  }
}

async function createFolder() {
  if (!state.open) await open();
  const res = await api.newFolder(state.dir);
  if (!res || !res.ok) {
    toast((res && res.error) || '新建文件夹失败');
    return;
  }
  await refresh();
  const entry = state.entries.find((item) => item.path === res.path || item.name === res.name);
  if (!entry) return;
  const idx = state.entries.indexOf(entry);
  state.selection = idx;
  paintSelection();
  const tile = el.grid.querySelector(`.tile[data-idx="${idx}"]`);
  if (tile) tile.scrollIntoView({ block: 'nearest' });
  startRename(entry);
}

async function createShortcut() {
  if (!state.open) await open();
  const res = await api.newShortcut(state.dir);
  if (!res || !res.ok) {
    if (res && res.canceled) return;
    toast((res && res.error) || '创建快捷方式失败');
    return;
  }
  await refresh();
  const entry = state.entries.find((item) => item.path === res.path || item.name === res.name);
  if (!entry) return;
  const idx = state.entries.indexOf(entry);
  state.selection = idx;
  state.multi = new Set([idx]);
  state.anchor = idx;
  paintSelection();
  const tile = el.grid.querySelector(`.tile[data-idx="${idx}"]`);
  if (tile) tile.scrollIntoView({ block: 'nearest' });
  toast(`已创建快捷方式：${res.name}`);
}

// ------------------------------------------------------------------ 展开态交互

el.grid.addEventListener('click', (e) => {
  if (state.marqueeJustEnded) {
    state.marqueeJustEnded = false;
    return;
  }
  const tile = e.target.closest('.tile');
  if (!tile) {
    clearSelection();
    paintSelection();
    return;
  }
  const idx = Number(tile.dataset.idx);
  if (e.shiftKey && state.anchor >= 0) {
    const from = Math.min(state.anchor, idx);
    const to = Math.max(state.anchor, idx);
    state.multi = new Set();
    for (let i = from; i <= to; i++) state.multi.add(i);
    state.selection = idx;
  } else if (e.ctrlKey || e.metaKey) {
    if (!state.multi.size && state.selection >= 0) state.multi.add(state.selection);
    if (state.multi.has(idx)) state.multi.delete(idx);
    else {
      state.multi.add(idx);
      state.anchor = idx;
    }
    state.selection = state.multi.size ? [...state.multi].pop() : -1;
  } else {
    state.multi = new Set([idx]);
    state.selection = idx;
    state.anchor = idx;
  }
  paintSelection();
});

// 框选：在网格空白处拖出选框，选中与选框相交的图标
el.grid.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || state.editMode || state.renaming || !state.open) return;
  if (e.target.closest('.tile')) return;
  const startX = e.clientX;
  const startY = e.clientY;
  let moved = false;
  el.marquee.hidden = false;

  const paint = (x, y) => {
    const left = Math.min(startX, x);
    const top = Math.min(startY, y);
    const width = Math.abs(x - startX);
    const height = Math.abs(y - startY);
    Object.assign(el.marquee.style, {
      left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`,
    });
    el.marquee.hidden = width < 3 && height < 3;
  };

  const onMove = (ev) => {
    if (Math.abs(ev.clientX - startX) > 3 || Math.abs(ev.clientY - startY) > 3) moved = true;
    paint(ev.clientX, ev.clientY);
  };

  const onUp = (ev) => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    el.marquee.hidden = true;
    if (!moved) return;
    const left = Math.min(startX, ev.clientX);
    const top = Math.min(startY, ev.clientY);
    const right = Math.max(startX, ev.clientX);
    const bottom = Math.max(startY, ev.clientY);
    const selected = new Set();
    for (const tile of el.grid.querySelectorAll('.tile')) {
      const rect = tile.getBoundingClientRect();
      if (rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top) {
        selected.add(Number(tile.dataset.idx));
      }
    }
    state.multi = selected;
    state.selection = selected.size ? [...selected].pop() : -1;
    state.anchor = selected.size ? [...selected][0] : -1;
    state.marqueeJustEnded = true;
    setTimeout(() => { state.marqueeJustEnded = false; }, 0);
    paintSelection();
  };

  paint(startX, startY);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
});

el.grid.addEventListener('dblclick', (e) => {
  if (state.editMode) return;
  const tile = e.target.closest('.tile');
  if (!tile) return;
  openEntry(Number(tile.dataset.idx));
});

el.grid.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const tile = e.target.closest('.tile');
  if (!tile) {
    rootMenu();
    return;
  }
  const idx = Number(tile.dataset.idx);
  if (!state.multi.has(idx)) {
    state.multi = new Set([idx]);
    state.selection = idx;
    state.anchor = idx;
  } else {
    state.selection = idx;
  }
  paintSelection();
  itemMenu();
});

el.panel.addEventListener('contextmenu', (e) => {
  if (e.target.closest('.grid')) return;
  e.preventDefault();
  rootMenu();
});

el.back.addEventListener('click', goUp);
el.close.addEventListener('click', close);
el.arrange.addEventListener('click', () => setEditMode(!state.editMode));
el.search.addEventListener('input', () => {
  state.query = el.search.value;
  applyFilter();
  fillIcons();
});

// 拖出（把条目拖到桌面 / 资源管理器）
// 走 Chromium 的 dragstart 上下文再调原生 startDrag，drag 才能被系统接住；
// 只靠 mousemove 调 startDrag 在本机实测会立刻返回、不产生任何复制。

el.grid.addEventListener('dragstart', (e) => {
  const tile = e.target.closest('.tile');
  if (!tile) return;
  const idx = Number(tile.dataset.idx);
  if (state.editMode) {
    state.draggingTile = tile;
    state.orderDirty = false;
    tile.classList.add('drag-src');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
    return;
  }
  const entry = state.entries[idx];
  if (!entry) return;
  e.preventDefault();
  if (!state.multi.has(idx)) {
    state.multi = new Set([idx]);
    state.selection = idx;
    state.anchor = idx;
  }
  paintSelection();
  const entries = selectedEntries();
  const paths = entries.length ? entries.map((item) => item.path) : [entry.path];
  const iconEntry = entries[0] || entry;
  api.dragOut(paths, iconEntry.icon ? iconEntry.icon.url : '');
});

el.grid.addEventListener('dragover', (e) => {
  if (!state.editMode || !state.draggingTile) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  const over = e.target.closest('.tile');
  if (!over || over === state.draggingTile) return;
  const rect = over.getBoundingClientRect();
  const after = e.clientX - rect.left > rect.width / 2;
  el.grid.insertBefore(state.draggingTile, after ? over.nextSibling : over);
  state.orderDirty = true;
});

el.grid.addEventListener('drop', (e) => {
  if (!state.editMode) return;
  e.preventDefault();
  commitOrder();
});

el.grid.addEventListener('dragend', () => {
  if (state.draggingTile) state.draggingTile.classList.remove('drag-src');
  state.draggingTile = null;
  if (state.editMode) commitOrder();
});

// 拖入（从资源管理器 / 桌面把文件拖进来）

function hasFiles(dataTransfer) {
  return !!dataTransfer && Array.from(dataTransfer.types || []).includes('Files');
}

function wireDrop(target, getDir) {
  let depth = 0;

  target.addEventListener('dragenter', (e) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    depth += 1;
    target.classList.add('dragover');
  });

  target.addEventListener('dragover', (e) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });

  target.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) target.classList.remove('dragover');
  });

  target.addEventListener('drop', async (e) => {
    if (!e.dataTransfer) return;
    e.preventDefault();
    depth = 0;
    target.classList.remove('dragover');
    const paths = Array.from(e.dataTransfer.files || [])
      .map((file) => api.getPathForFile(file))
      .filter(Boolean);
    if (!paths.length) return;
    const dir = getDir();
    const choice = await api.dropChoice(paths.length);
    if (choice === 'cancel') return;
    if (choice === 'shortcut') {
      const res = await api.dropShortcuts(dir, paths);
      if (res.errors && res.errors.length) toast(res.errors[0].error);
      else if (res.created && res.created.length) toast(`已创建 ${res.created.length} 个快捷方式`);
      await refresh();
      return;
    }
    const res = await api.dropPaths(dir, paths);
    if (res.errors && res.errors.length) toast(res.errors[0].error);
    else if (res.moved && res.moved.length) toast(`已移入 ${res.moved.length} 项`);
    await refresh();
  });
}

wireDrop(el.panel, () => state.dir);
wireDrop(el.mini, () => state.rootDir);

// ------------------------------------------------------------------ 键盘

function moveSelection(delta) {
  const total = state.entries.length;
  if (!total) return;
  const current = state.selection < 0 ? 0 : state.selection;
  state.selection = Math.max(0, Math.min(total - 1, current + delta));
  state.multi = new Set([state.selection]);
  state.anchor = state.selection;
  paintSelection();
  const tile = el.grid.querySelector(`.tile[data-idx="${state.selection}"]`);
  if (tile) tile.scrollIntoView({ block: 'nearest' });
}

document.addEventListener('keydown', (e) => {
  if (state.renaming) return;
  if (e.key === 'Escape') {
    if (el.search && !el.search.hidden) {
      el.search.value = '';
      state.query = '';
      el.search.hidden = true;
      applyFilter();
      fillIcons();
      return;
    }
    if (state.open) {
      if (state.editMode) setEditMode(false);
      else close();
    }
    return;
  }
  if (!state.open) return;
  if (e.ctrlKey && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault();
    el.search.hidden = false;
    el.search.focus();
    el.search.select();
    return;
  }
  if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
    const entries = selectedEntries();
    if (entries.length) {
      e.preventDefault();
      setClipboard('copy', entries);
    }
    return;
  }
  if (e.ctrlKey && (e.key === 'x' || e.key === 'X')) {
    const entries = selectedEntries();
    if (entries.length) {
      e.preventDefault();
      setClipboard('cut', entries);
    }
    return;
  }
  if (e.ctrlKey && (e.key === 'v' || e.key === 'V')) {
    e.preventDefault();
    pasteClipboard();
    return;
  }
  if (e.ctrlKey && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault();
    undoTrash();
    return;
  }
  if (e.ctrlKey && e.shiftKey && (e.key === 'N' || e.key === 'n')) {
    e.preventDefault();
    createFolder();
    return;
  }
  if (e.key === 'Backspace') {
    e.preventDefault();
    goUp();
  } else if (e.key === 'Enter') {
    if (!state.editMode && state.selection >= 0) openEntry(state.selection);
  } else if (e.key === 'F2') {
    const entries = selectedEntries();
    if (entries.length === 1) startRename(entries[0]);
    else if (entries.length > 1) toast('一次只能重命名一项');
  } else if (e.key === 'Delete') {
    const entries = selectedEntries();
    if (entries.length) trashEntries(entries);
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    moveSelection(-1);
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    moveSelection(1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    moveSelection(-COLS);
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    moveSelection(COLS);
  }
});

// ------------------------------------------------------------------ 启动

init().catch((err) => {
  console.error(err);
  toast('初始化失败：' + (err && err.message ? err.message : err));
});
