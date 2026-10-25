'use strict';

const $ = (id) => document.getElementById(id);
let appearance = { blur: 26, frost: 100, customBlur: 10 };
let saveTimer = 0;

function setStatus(text) {
  $('status').textContent = text;
  clearTimeout(setStatus.timer);
  setStatus.timer = setTimeout(() => { $('status').textContent = ''; }, 1800);
}

function render(data) {
  $('folderPath').textContent = data.folder || '';
  appearance = { ...appearance, ...(data.appearance || {}) };
  $('blur').value = appearance.blur;
  $('frost').value = appearance.frost;
  $('customBlur').value = appearance.customBlur;
  $('blurValue').textContent = `${appearance.blur}px`;
  $('frostValue').textContent = `${appearance.frost}%`;
  $('customBlurValue').textContent = `${appearance.customBlur}px`;
  $('autoStart').checked = data.autoStart !== false;
}

function syncLabels() {
  $('blurValue').textContent = `${$('blur').value}px`;
  $('frostValue').textContent = `${$('frost').value}%`;
  $('customBlurValue').textContent = `${$('customBlur').value}px`;
}

function scheduleSave() {
  syncLabels();
  appearance = {
    blur: Number($('blur').value),
    frost: Number($('frost').value),
    customBlur: Number($('customBlur').value),
  };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const res = await window.settings.setAppearance(appearance);
    if (res && res.ok) setStatus('外观已应用');
  }, 80);
}

for (const id of ['blur', 'frost', 'customBlur']) {
  $(id).addEventListener('input', scheduleSave);
}

$('autoStart').addEventListener('change', async () => {
  const res = await window.settings.setAutoStart($('autoStart').checked);
  if (res && res.ok) setStatus($('autoStart').checked ? '已开启开机启动' : '已关闭开机启动');
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
  if (res && res.ok) setStatus('应用回收站已清空');
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

window.settings.get().then(render).catch(() => setStatus('读取设置失败'));
