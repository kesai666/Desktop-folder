'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settings', {
  get: () => ipcRenderer.invoke('settings:get'),
  setAppearance: (appearance) => ipcRenderer.invoke('settings:appearance', appearance),
  setAutoStart: (enabled) => ipcRenderer.invoke('settings:auto-start', enabled),
  addWidget: () => ipcRenderer.invoke('settings:add-widget'),
  removeWidget: (id) => ipcRenderer.invoke('settings:remove-widget', id),
  openLogs: () => ipcRenderer.invoke('settings:open-logs'),
  openTrash: () => ipcRenderer.invoke('settings:open-trash'),
  emptyTrash: () => ipcRenderer.invoke('settings:empty-trash'),
  listTrash: () => ipcRenderer.invoke('trash:list'),
  restoreTrash: (batchId) => ipcRenderer.invoke('trash:restore', batchId),
  checkUpdate: () => ipcRenderer.invoke('settings:check-update'),
  remove: () => ipcRenderer.invoke('settings:remove'),
  close: () => ipcRenderer.invoke('settings:close'),
});
