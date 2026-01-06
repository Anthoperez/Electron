// electron/preload.js
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  getVersion: () => '1.0.0'
});

console.log(' Preload script cargado');