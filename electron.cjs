// electron.cjs
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');

let mainWin;

function createLauncherWindow() {
  const win = new BrowserWindow({
    width: 400,
    height: 200,
    resizable: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  win.loadFile(path.join(__dirname, 'launcher.html'));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: { nodeIntegration: true },
  });

  const startUrl =
    process.env.ELECTRON_START_URL ||
    `file://${path.join(__dirname, 'dist/index.html')}`;

  win.loadURL(startUrl);       // <-- actually load the page
}

app.whenReady().then(createLauncherWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.on('quit-app', () => app.quit());

ipcMain.on('restart-app', () => {
  app.relaunch();
  app.quit();
});

ipcMain.on('open-browser', () => {
  const startUrl =
    process.env.ELECTRON_START_URL ||
    `file://${path.join(__dirname, 'dist/index.html')}`;

  shell.openExternal(startUrl); // open in default browser
  // optionally also open the main Electron window:
  if (!mainWin) {
    mainWin = new BrowserWindow({ width: 1200, height: 800 });
    mainWin.loadURL(startUrl);
  }
});