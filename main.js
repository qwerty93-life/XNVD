const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const auth = require('./src/auth');
const minecraft = require('./src/minecraft');
const mods = require('./src/mods');
const cosmetics = require('./src/cosmetics');
const updater = require('./src/updater');
const store = require('./src/store');

let mainWindow;
let splashWindow;

// ── Splash screen ─────────────────────────────────────────────────────────────
function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 460,
    height: 280,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    center: true,
    skipTaskbar: true,
    webPreferences: { contextIsolation: true }
  });
  splashWindow.loadFile('renderer/splash.html');
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
    splashWindow = null;
  }
}

// ── Main window ───────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 900,
    minHeight: 580,
    frame: false,
    show: false,               // hidden until ready-to-show fires
    backgroundColor: '#020608',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile('renderer/index.html');

  // Swap splash → main once the renderer has fully painted
  mainWindow.once('ready-to-show', () => {
    // Small delay so bar-fill animation has time to finish on splash
    setTimeout(() => {
      closeSplash();
      mainWindow.show();
      mainWindow.focus();
    }, 350);
  });
}

app.whenReady().then(async () => {
  createSplashWindow();
  createWindow();
  // Check for updates ~4 s after launch (non-blocking)
  setTimeout(async () => {
    const update = await updater.checkForUpdates();
    if (update.available) {
      mainWindow?.webContents.send('update:available', update);
    }
  }, 4000);
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ── Window ────────────────────────────────────────────────────────────────────
ipcMain.on('win:min', () => mainWindow?.minimize());
ipcMain.on('win:max', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize());
ipcMain.on('win:close', () => mainWindow?.close());

// ── Store ─────────────────────────────────────────────────────────────────────
ipcMain.handle('store:get', (_, k) => store.get(k));
ipcMain.handle('store:set', (_, k, v) => { store.set(k, v); return true; });

// ── Auth ──────────────────────────────────────────────────────────────────────
ipcMain.handle('auth:login', async () => {
  try {
    const account = await auth.loginWithMicrosoft(mainWindow);
    store.set('account', account);
    return { success: true, account };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('auth:refresh', async () => {
  const account = store.get('account');
  if (!account?.msRefreshToken) return { success: false, error: 'No stored account' };
  try {
    const refreshed = await auth.refreshAccount(account);
    store.set('account', refreshed);
    return { success: true, account: refreshed };
  } catch (err) {
    store.set('account', null);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('auth:logout', () => { store.set('account', null); return { success: true }; });

// ── Versions ──────────────────────────────────────────────────────────────────
ipcMain.handle('versions:list', () => minecraft.getVersionList());
ipcMain.handle('fabric:versions', (_, v) => minecraft.getFabricVersions(v));
ipcMain.handle('game:isInstalled', (_, { version, useFabric, gameDir }) =>
  minecraft.isInstalled(version, useFabric, gameDir || minecraft.getGameDir())
);
ipcMain.handle('game:getDir', () => minecraft.getGameDir());

// ── Install ───────────────────────────────────────────────────────────────────
ipcMain.handle('game:install', async (_, { version, useFabric, fabricVersion, gameDir }) => {
  try {
    await minecraft.install(version, useFabric, fabricVersion,
      p => mainWindow?.webContents.send('progress', p), gameDir);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── Mods ──────────────────────────────────────────────────────────────────────
ipcMain.handle('mods:search', async (_, { query, gameVersion }) => {
  try {
    const hits = await mods.searchMods(query, gameVersion);
    const gameDir = store.get('settings')?.gameDir || minecraft.getGameDir();
    return hits.map(h => ({ ...h, installed: mods.isModInstalled(h.slug, gameDir) }));
  } catch (err) {
    return [];
  }
});

ipcMain.handle('mods:versions', async (_, { slug, gameVersion }) => {
  try { return await mods.getModVersions(slug, gameVersion); }
  catch { return []; }
});

ipcMain.handle('mods:install', async (_, { slug, gameVersion, gameDir, versionId }) => {
  try {
    const filename = await mods.installMod(slug, gameVersion, gameDir || minecraft.getGameDir(), versionId || null);
    return { success: true, filename };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('mods:installed', (_, gameDir) => {
  const dir = gameDir || minecraft.getGameDir();
  return mods.getInstalledMods(dir).map(m => ({ ...m, sizeStr: mods.formatBytes(m.size) }));
});

ipcMain.handle('mods:remove', (_, { filename, gameDir }) => {
  try {
    mods.removeMod(filename, gameDir || minecraft.getGameDir());
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('mods:openFolder', (_, gameDir) => {
  const modsDir = require('path').join(gameDir || minecraft.getGameDir(), 'mods');
  fs.mkdirSync(modsDir, { recursive: true });
  shell.openPath(modsDir);
  return true;
});

// ── Launch ────────────────────────────────────────────────────────────────────
ipcMain.handle('game:launch', async (_, opts) => {
  const account = store.get('account');
  if (!account) return { success: false, error: 'Not logged in' };
  try {
    await minecraft.launch({ ...opts, account }, log => mainWindow?.webContents.send('game:log', log));
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── Updater ───────────────────────────────────────────────────────────────────
ipcMain.handle('updater:check', async () => updater.checkForUpdates());
ipcMain.handle('updater:info', () => ({
  current: updater.CURRENT_VERSION,
  owner: updater.GITHUB_OWNER,
  repo: updater.GITHUB_REPO,
  releasesPage: updater.RELEASES_PAGE
}));
ipcMain.on('updater:openRelease', (_, url) => {
  shell.openExternal(url || updater.RELEASES_PAGE);
});

// ── Cosmetics ─────────────────────────────────────────────────────────────────
ipcMain.handle('cosmetics:list', () => cosmetics.CAPES);

ipcMain.handle('cosmetics:get', (_, gameDir) => {
  const dir = gameDir || minecraft.getGameDir();
  return cosmetics.loadCosmetics(dir);
});

ipcMain.handle('cosmetics:equip', (_, { capeId, gameDir }) => {
  try {
    const dir = gameDir || minecraft.getGameDir();
    const cfg = cosmetics.equipCape(capeId, dir);
    return { success: true, ...cfg };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── Dialogs ───────────────────────────────────────────────────────────────────
ipcMain.handle('dialog:dir', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('dialog:file', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Java', extensions: ['exe', ''] }, { name: 'All', extensions: ['*'] }]
  });
  return r.canceled ? null : r.filePaths[0];
});
