'use strict';

const $ = (id) => document.getElementById(id);
let appearance = { blur: 26, frost: 100, customBlur: 10, iconSize: 64, wallpaperFit: 'cover', wallpaperPosition: 'center', wallpaperScale: 100, wallpaperBlur: true };
let currentId = null;
let customWallpaper = null;
let saveTimer = 0;

function renderPreview() {
  const img = $('wpPreviewImg');
  const empty = $('wpEmpty');
  const name = $('wpName');
  if (!customWallpaper || !customWallpaper.fileUrl) {
    img.hidden = true;
    empty.hidden = false;
    if (name) name.textContent = '当前：桌面壁纸';
    return;
  }
  empty.hidden = true;
  img.hidden = false;
  img.src = customWallpaper.fileUrl;
  img.style.objectFit = appearance.wallpaperFit;
  img.style.objectPosition = appearance.wallpaperPosition;
  img.style.transform = `scale(${(appearance.wallpaperScale || 100) / 100})`;
  img.style.filter = appearance.wallpaperBlur ? `blur(${appearance.customBlur}px)` : 'none';
  const base = String(customWallpaper.file || '').split(/[\\/]/).pop();
  if (name) name.textContent = `当前：${base || '自定义壁纸'}`;
}

function setStatus(text) {
  $('status').textContent = text;
  clearTimeout(setStatus.timer);
  setStatus.timer = setTimeout(() => { $('status').textContent = ''; }, 1800);
}

function renderWidgets(data) {
  currentId = data.currentId;
  const root = $('widgetList');
  if (!root) return;
  root.replaceChildren();
  for (const widget of data.widgets || []) {
    const row = document.createElement('div');
    row.className = 'widget-item';
    const meta = document.createElement('div');
    meta.className = 'widget-meta';
    meta.textContent = widget.name;
    meta.title = widget.folder;
    if (widget.id === currentId) {
      const em = document.createElement('em');
      em.textContent = '当前';
      meta.appendChild(em);
    }
    const button = document.createElement('button');
    button.textContent = '移除';
    button.addEventListener('click', async () => {
      const res = await window.settings.removeWidget(widget.id);
      if (res && res.ok) {
        if (widget.id === currentId) window.settings.close();
        else {
          const next = await window.settings.get();
          renderWidgets(next);
          setStatus('已移除小组件');
        }
      } else if (res && !res.canceled) {
        setStatus(res.error || '移除失败');
      }
    });
    row.append(meta, button);
    root.appendChild(row);
  }
}

async function renderTrash() {
  const root = $('trashList');
  if (!root) return;
  const list = await window.settings.listTrash();
  root.replaceChildren();
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'trash-empty';
    empty.textContent = '回收站是空的';
    root.appendChild(empty);
    return;
  }
  for (const batch of list) {
    const row = document.createElement('div');
    row.className = 'trash-item';
    const meta = document.createElement('div');
    meta.className = 'trash-meta';
    const when = new Date(batch.deletedAt || Date.now()).toLocaleString('zh-CN', { hour12: false });
    const names = (batch.names || []).join('、');
    meta.textContent = `${when} · ${batch.count} 项${names ? ` · ${names}` : ''}`;
    meta.title = meta.textContent;
    const button = document.createElement('button');
    button.textContent = '恢复';
    button.addEventListener('click', async () => {
      const res = await window.settings.restoreTrash(batch.batchId);
      if (res && res.ok) {
        setStatus(`已恢复 ${res.restored} 项`);
        await renderTrash();
      } else {
        setStatus((res && res.error) || '恢复失败');
      }
    });
    row.append(meta, button);
    root.appendChild(row);
  }
}

function render(data) {
  $('folderPath').textContent = data.folder || '';
  appearance = { ...appearance, ...(data.appearance || {}) };
  $('blur').value = appearance.blur;
  $('frost').value = appearance.frost;
  $('customBlur').value = appearance.customBlur;
  $('iconSize').value = appearance.iconSize;
  $('wallpaperFit').value = appearance.wallpaperFit;
  $('wallpaperPosition').value = appearance.wallpaperPosition;
  $('wallpaperScale').value = appearance.wallpaperScale || 100;
  $('wallpaperBlur').checked = appearance.wallpaperBlur !== false;
  $('blurValue').textContent = `${appearance.blur}px`;
  $('frostValue').textContent = `${appearance.frost}%`;
  $('customBlurValue').textContent = `${appearance.customBlur}px`;
  $('iconSizeValue').textContent = `${appearance.iconSize}px`;
  $('wallpaperScaleValue').textContent = `${appearance.wallpaperScale || 100}%`;
  $('autoStart').checked = data.autoStart !== false;
  customWallpaper = data.customWallpaper || null;
  renderPreview();
}

function syncLabels() {
  $('blurValue').textContent = `${$('blur').value}px`;
  $('frostValue').textContent = `${$('frost').value}%`;
  $('customBlurValue').textContent = `${$('customBlur').value}px`;
  $('iconSizeValue').textContent = `${$('iconSize').value}px`;
  $('wallpaperScaleValue').textContent = `${$('wallpaperScale').value}%`;
}

function scheduleSave() {
  syncLabels();
  appearance = {
    blur: Number($('blur').value),
    frost: Number($('frost').value),
    customBlur: Number($('customBlur').value),
    iconSize: Number($('iconSize').value),
    wallpaperFit: $('wallpaperFit').value,
    wallpaperPosition: $('wallpaperPosition').value,
    wallpaperScale: Number($('wallpaperScale').value),
    wallpaperBlur: $('wallpaperBlur').checked,
  };
  renderPreview();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const res = await window.settings.setAppearance(appearance);
    if (res && res.ok) setStatus('外观已应用');
  }, 80);
}

for (const id of ['blur', 'frost', 'customBlur', 'iconSize', 'wallpaperScale']) {
  $(id).addEventListener('input', scheduleSave);
}
$('wallpaperFit').addEventListener('change', scheduleSave);
$('wallpaperPosition').addEventListener('change', scheduleSave);
$('wallpaperBlur').addEventListener('change', scheduleSave);

$('autoStart').addEventListener('change', async () => {
  const res = await window.settings.setAutoStart($('autoStart').checked);
  if (res && res.ok) setStatus($('autoStart').checked ? '已开启开机启动' : '已关闭开机启动');
});

$('resetAppearance').addEventListener('click', async () => {
  appearance = { blur: 26, frost: 100, customBlur: 10, iconSize: 64, wallpaperFit: 'cover', wallpaperPosition: 'center', wallpaperScale: 100, wallpaperBlur: true };
  $('blur').value = appearance.blur;
  $('frost').value = appearance.frost;
  $('customBlur').value = appearance.customBlur;
  $('iconSize').value = appearance.iconSize;
  $('wallpaperFit').value = appearance.wallpaperFit;
  $('wallpaperPosition').value = appearance.wallpaperPosition;
  $('wallpaperScale').value = appearance.wallpaperScale;
  $('wallpaperBlur').checked = appearance.wallpaperBlur;
  renderPreview();
  $('wallpaperFit').value = appearance.wallpaperFit;
  $('wallpaperPosition').value = appearance.wallpaperPosition;
  syncLabels();
  const res = await window.settings.setAppearance(appearance);
  if (res && res.ok) setStatus('已恢复默认外观');
});

$('chooseWallpaper').addEventListener('click', async () => {
  const res = await window.settings.chooseWallpaper();
  if (res && res.ok) {
    customWallpaper = res.customWallpaper || null;
    renderPreview();
    setStatus('壁纸已应用');
  } else if (res && res.error) {
    setStatus(res.error);
  }
});

$('clearWallpaper').addEventListener('click', async () => {
  const res = await window.settings.clearWallpaper();
  if (res && res.ok) {
    customWallpaper = null;
    renderPreview();
    setStatus('已恢复桌面壁纸');
  }
});

$('addWidget').addEventListener('click', async () => {
  const res = await window.settings.addWidget();
  if (res && res.ok) {
    setStatus(`已新建「${res.name}」`);
    const data = await window.settings.get();
    renderWidgets(data);
  } else setStatus((res && res.error) || '新建小组件失败');
});

$('openLogs').addEventListener('click', async () => {
  await window.settings.openLogs();
  setStatus('已打开日志文件夹');
});

$('openTrash').addEventListener('click', async () => {
  await window.settings.openTrash();
  setStatus('已打开应用回收站');
});

$('emptyTrash').addEventListener('click', async () => {
  const res = await window.settings.emptyTrash();
  if (res && res.ok) {
    setStatus('应用回收站已清空');
    renderTrash().catch(() => {});
  }
});

$('checkUpdate').addEventListener('click', async () => {
  setStatus('正在检查更新…');
  await window.settings.checkUpdate();
  setStatus('');
});

$('removeBtn').addEventListener('click', async () => {
  const res = await window.settings.remove();
  if (res && res.ok) window.settings.close();
});

$('closeBtn').addEventListener('click', () => window.settings.close());

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.settings.close();
});

window.settings.get().then((data) => {
  render(data);
  renderWidgets(data);
  renderTrash().catch(() => {});
  if (location.hash === '#wallpaper') {
    setTimeout(() => {
      document.getElementById('wpPreview')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }, 120);
  }
}).catch(() => setStatus('读取设置失败'));
