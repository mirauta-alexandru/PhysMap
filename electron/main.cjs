const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');

const REPOSITORY_URL = 'https://github.com/mirauta-alexandru/PhysMap';
let mainWindow = null;

function isTrustedExternalUrl(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function openExternal(url) {
  if (isTrustedExternalUrl(url)) shell.openExternal(url);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'PhysMap',
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 650,
    backgroundColor: '#000000',
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file:')) return;
    event.preventDefault();
    openExternal(url);
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.setAboutPanelOptions({
  applicationName: 'PhysMap',
  applicationVersion: app.getVersion(),
  version: app.getVersion(),
  copyright: 'Copyright (c) mirauta-alexandru',
  website: REPOSITORY_URL,
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
