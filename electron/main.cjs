const { app, BrowserWindow, ipcMain, screen, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const REPOSITORY_URL = 'https://github.com/mirauta-alexandru/PhysMap';
const RELEASES_URL = `${REPOSITORY_URL}/releases`;
const OUTPUT_FRAME_PREFIX = 'physmap-output-';
let mainWindow = null;
let outputWindow = null;
let outputDisplayId = null;
let updateState = {
  status: 'idle',
  currentVersion: app.getVersion(),
  availableVersion: null,
  progress: 0,
  message: 'Up to date',
  installMode: 'automatic',
};

function publicUpdateState() {
  return { ...updateState, packaged: app.isPackaged };
}

function sendUpdateState(patch = {}) {
  updateState = { ...updateState, ...patch, currentVersion: app.getVersion() };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('physmap:update-state', publicUpdateState());
  }
  return publicUpdateState();
}

function hasStableMacSignature() {
  if (process.platform !== 'darwin' || !app.isPackaged) return true;
  const result = spawnSync(
    'codesign',
    ['-dv', '--verbose=4', app.getPath('exe')],
    { encoding: 'utf8' },
  );
  const details = `${result.stdout || ''}\n${result.stderr || ''}`;
  return /TeamIdentifier=(?!not set)[^\s]+/.test(details);
}

function macInstallerUrl(version) {
  if (!version) return RELEASES_URL;
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const file = `PhysMap-${version}-mac-${arch}.dmg`;
  return `${RELEASES_URL}/download/v${version}/${file}`;
}

function openManualUpdate() {
  const version = updateState.availableVersion;
  const url = process.platform === 'darwin'
    ? macInstallerUrl(version)
    : version
      ? `${RELEASES_URL}/tag/v${version}`
      : RELEASES_URL;
  openExternal(url);
  return publicUpdateState();
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = app.getVersion().includes('-');

  autoUpdater.on('checking-for-update', () => {
    sendUpdateState({ status: 'checking', message: 'Checking GitHub...', progress: 0 });
  });
  autoUpdater.on('update-available', (info) => {
    const manualMacInstall = process.platform === 'darwin' && !hasStableMacSignature();
    sendUpdateState({
      status: manualMacInstall ? 'manual' : 'available',
      availableVersion: info.version,
      message: manualMacInstall
        ? 'One-time manual reinstall required for unsigned alpha builds'
        : `Version ${info.version} is available`,
      progress: 0,
      installMode: manualMacInstall ? 'manual' : 'automatic',
    });
  });
  autoUpdater.on('update-not-available', () => {
    sendUpdateState({
      status: 'current',
      availableVersion: null,
      message: 'You have the latest version',
      progress: 0,
      installMode: hasStableMacSignature() ? 'automatic' : 'manual',
    });
  });
  autoUpdater.on('download-progress', (progress) => {
    sendUpdateState({
      status: 'downloading',
      progress: Math.round(progress.percent || 0),
      message: `Downloading update... ${Math.round(progress.percent || 0)}%`,
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    sendUpdateState({
      status: 'downloaded',
      availableVersion: info.version,
      progress: 100,
      message: 'Update ready to install',
    });
  });
  autoUpdater.on('error', (error) => {
    const signatureError = process.platform === 'darwin'
      && /code signature|specified code requirement|shipit/i.test(error?.message || '');
    sendUpdateState({
      status: signatureError ? 'manual' : 'error',
      message: signatureError
        ? 'macOS requires a one-time manual reinstall for this alpha update'
        : error?.message || 'Update check failed',
      progress: 0,
      installMode: signatureError ? 'manual' : updateState.installMode,
    });
  });
}

async function checkForUpdates() {
  if (!app.isPackaged) {
    return sendUpdateState({
      status: 'development',
      message: 'Update checks run in installed builds',
    });
  }
  await autoUpdater.checkForUpdates();
  return publicUpdateState();
}

async function downloadUpdate() {
  if (!app.isPackaged || updateState.status !== 'available') return publicUpdateState();
  sendUpdateState({ status: 'downloading', message: 'Starting download...', progress: 0 });
  await autoUpdater.downloadUpdate();
  return publicUpdateState();
}

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

function getDisplays() {
  if (!mainWindow) return [];
  const editorDisplay = screen.getDisplayMatching(mainWindow.getBounds());
  return screen.getAllDisplays().map((display, index) => ({
    id: String(display.id),
    label: display.label || `Display ${index + 1}`,
    isPrimary: display.id === screen.getPrimaryDisplay().id,
    isEditor: display.id === editorDisplay.id,
    bounds: { ...display.bounds },
    size: { ...display.size },
    scaleFactor: display.scaleFactor,
  }));
}

function findDisplay(id) {
  return screen.getAllDisplays().find((display) => String(display.id) === String(id));
}

function notifyDisplaysChanged() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('physmap:displays-changed', getDisplays());
}

function closeOutputWindow() {
  if (outputWindow && !outputWindow.isDestroyed()) outputWindow.close();
  outputWindow = null;
  outputDisplayId = null;
}

function positionOutputWindow(window, display) {
  if (!window || window.isDestroyed() || !display) return;
  window.setBounds(display.bounds);
  if (process.platform === 'darwin') window.setSimpleFullScreen(true);
  else window.setFullScreen(true);
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
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  mainWindow.webContents.setWindowOpenHandler(({ url, frameName = '' }) => {
    if (url === 'about:blank' && frameName.startsWith(OUTPUT_FRAME_PREFIX)) {
      const displayId = frameName.slice(OUTPUT_FRAME_PREFIX.length);
      const display = findDisplay(displayId);
      if (!display) return { action: 'deny' };

      outputDisplayId = displayId;
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          title: 'PhysMap Output',
          x: display.bounds.x,
          y: display.bounds.y,
          width: display.bounds.width,
          height: display.bounds.height,
          minWidth: 1,
          minHeight: 1,
          frame: false,
          show: false,
          skipTaskbar: true,
          backgroundColor: '#000000',
          autoHideMenuBar: true,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
      };
    }
    openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('did-create-window', (window, details) => {
    if (!String(details.frameName || '').startsWith(OUTPUT_FRAME_PREFIX)) {
      window.close();
      return;
    }

    if (outputWindow && outputWindow !== window && !outputWindow.isDestroyed()) {
      outputWindow.close();
    }

    outputWindow = window;
    const display = findDisplay(outputDisplayId);
    window.setMenuBarVisibility(false);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    const showOutput = () => {
      if (window.isDestroyed()) return;
      positionOutputWindow(window, display);
      window.showInactive();
    };
    window.once('ready-to-show', showOutput);
    setTimeout(showOutput, 250);
    window.on('closed', () => {
      outputWindow = null;
      outputDisplayId = null;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('physmap:output-closed');
      }
    });
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file:')) return;
    event.preventDefault();
    openExternal(url);
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    closeOutputWindow();
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
  setupAutoUpdater();
  ipcMain.handle('physmap:list-displays', () => getDisplays());
  ipcMain.handle('physmap:close-output', () => closeOutputWindow());
  ipcMain.handle('physmap:update-state', () => publicUpdateState());
  ipcMain.handle('physmap:check-update', () => checkForUpdates());
  ipcMain.handle('physmap:download-update', () => downloadUpdate());
  ipcMain.handle('physmap:open-manual-update', () => openManualUpdate());
  ipcMain.handle('physmap:install-update', () => {
    if (updateState.status === 'downloaded') {
      setImmediate(() => autoUpdater.quitAndInstall(false, true));
    }
    return publicUpdateState();
  });

  createWindow();
  mainWindow.webContents.once('did-finish-load', () => {
    sendUpdateState();
    if (app.isPackaged) {
      setTimeout(() => checkForUpdates().catch(() => {}), 4000);
    }
  });

  screen.on('display-added', notifyDisplaysChanged);
  screen.on('display-removed', (_event, display) => {
    if (String(display.id) === outputDisplayId) closeOutputWindow();
    notifyDisplaysChanged();
  });
  screen.on('display-metrics-changed', (_event, display) => {
    if (String(display.id) === outputDisplayId) {
      positionOutputWindow(outputWindow, display);
    }
    notifyDisplaysChanged();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
