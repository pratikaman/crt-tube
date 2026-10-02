'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Only the local cabinet receives this bridge. YouTube has no preload or Node access.
contextBridge.exposeInMainWorld('tube', {
  getState: () => ipcRenderer.invoke('tube:state'),
  tune: input => ipcRenderer.invoke('tube:tune', input),
  command: command => ipcRenderer.invoke('tube:command', command),
  settings: patch => ipcRenderer.invoke('tube:settings', patch),
  setScreen: bounds => ipcRenderer.send('tube:screen', bounds),
  setScene: bounds => ipcRenderer.send('tube:scene', bounds),
  setHitMask: mask => ipcRenderer.send('tube:hit-mask', mask),
  orbitGesture: active => ipcRenderer.send('tube:orbit-gesture', active),
  captureScreen: () => ipcRenderer.invoke('tube:capture-screen'),
  onInspect: callback => {
    const listener = () => callback();
    ipcRenderer.on('tube:inspect', listener);
    return () => ipcRenderer.removeListener('tube:inspect', listener);
  },
  resize: input => ipcRenderer.send('tube:resize', input),
  onToggleZoom: callback => {
    const listener = () => callback();
    ipcRenderer.on('tube:toggle-zoom', listener);
    return () => ipcRenderer.removeListener('tube:toggle-zoom', listener);
  },
  onEscape: callback => {
    const listener = () => callback();
    ipcRenderer.on('tube:escape', listener);
    return () => ipcRenderer.removeListener('tube:escape', listener);
  },
  subscribe: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('tube:state-changed', listener);
    return () => ipcRenderer.removeListener('tube:state-changed', listener);
  },
  onFocusSearch: callback => {
    const listener = () => callback();
    ipcRenderer.on('tube:focus-search', listener);
    return () => ipcRenderer.removeListener('tube:focus-search', listener);
  },
});
