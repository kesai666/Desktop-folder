'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const api = {
  init: () => ipcRenderer.invoke('app:init'),
  listDir: (dir) => ipcRenderer.invoke('dir:list', dir),
  enter: (dir) => ipcRenderer.invoke('dir:enter', dir),
  up: () => ipcRenderer.invoke('dir:up'),
  icon: (entry) => ipcRenderer.invoke('icon:get', entry),
  openItem: (p) => ipcRenderer.invoke('item:open', p),
  reveal: (p) => ipcRenderer.invoke('item:reveal', p),
  trash: (p) => ipcRenderer.invoke('item:trash', p),
  rename: (p, name) => ipcRenderer.invoke('item:rename', p, name),
  dropPaths: (dir, paths) => ipcRenderer.invoke('item:drop', dir, paths),
  newFolder: (dir) => ipcRenderer.invoke('item:new-folder', dir),
  paste: (dir, paths, mode) => ipcRenderer.invoke('item:paste', dir, paths, mode),
  undoTrash: () => ipcRenderer.invoke('trash:undo'),
  listTrash: () => ipcRenderer.invoke('trash:list'),
  restoreTrash: (batchId) => ipcRenderer.invoke('trash:restore', batchId),
  emptyTrash: () => ipcRenderer.invoke('trash:empty'),
  openTrash: () => ipcRenderer.invoke('trash:open'),
  setOrder: (dir, names) => ipcRenderer.invoke('dir:order:set', dir, names),
  clearOrder: (dir) => ipcRenderer.invoke('dir:order:clear', dir),
  setSort: (mode) => ipcRenderer.invoke('view:sort', mode),
  dragOut: (paths, icon) => ipcRenderer.send('drag:out', paths, icon),
  menuRoot: () => ipcRenderer.invoke('menu:root'),
  menuItem: (entry) => ipcRenderer.invoke('menu:item', entry),
  addWidget: () => ipcRenderer.invoke('widget:add'),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  chooseWallpaper: () => ipcRenderer.invoke('wallpaper:choose'),
  clearWallpaper: () => ipcRenderer.invoke('wallpaper:clear'),
  removeWidget: () => ipcRenderer.invoke('widget:remove'),
  openSettings: () => ipcRenderer.invoke('settings:open'),
  expand: () => ipcRenderer.invoke('win:expand'),
  collapse: () => ipcRenderer.invoke('win:collapse'),
  displayInfo: () => ipcRenderer.invoke('display:info'),
  wallpaper: () => ipcRenderer.invoke('wallpaper:get'),
  dragStart: (startX, startY) => ipcRenderer.send('win:drag-start', startX, startY),
  dragEnd: () => ipcRenderer.send('win:drag-end'),
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
  onMoved: (cb) => ipcRenderer.on('win:moved', (e, pos) => cb(pos)),
  onMagnet: (cb) => ipcRenderer.on('win:magnet', (e, info) => cb(info)),
  onClick: (cb) => ipcRenderer.on('win:click', () => cb()),
  onDragEnded: (cb) => ipcRenderer.on('win:drag-ended', (e, info) => cb(info)),
  onDirChanged: (cb) => ipcRenderer.on('dir:changed', () => cb()),
  onTheme: (cb) => ipcRenderer.on('ui:theme', (e, info) => cb(info)),
  onWallpaper: (cb) => ipcRenderer.on('ui:wallpaper', (e, info) => cb(info)),
  onAppearance: (cb) => ipcRenderer.on('ui:appearance', (e, info) => cb(info)),
  onAutoOpen: (cb) => ipcRenderer.on('ui:auto-open', () => cb()),
  onTrayOpen: (cb) => ipcRenderer.on('ui:open', () => cb()),
  onBlurClose: (cb) => ipcRenderer.on('ui:blur-close', () => cb()),
  onDragOutDone: (cb) => ipcRenderer.on('drag:out-done', () => cb()),
  quit: () => ipcRenderer.send('app:quit'),
};

contextBridge.exposeInMainWorld('api', api);
