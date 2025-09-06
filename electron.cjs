const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const express = require('express');

let launcherWin;
let mainWin;
let staticServer;
let staticPort;

function createLauncherWindow() {
  launcherWin = new BrowserWindow({
    width: 500,
    height: 500,
    resizable: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  launcherWin.loadFile(path.join(__dirname, 'launcher.html'));
  launcherWin.setMenu(null);
}

function createMainWindow() {
  if (mainWin) {
    mainWin.focus();
    return;
  }

  // הגדרת נתיב האייקון בצורה חכמה
  const iconPath = path.join(__dirname, 'public', 'icon.svg');
  
  mainWin = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: iconPath, // שימוש במשתנה החדש
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const startUrl = process.env.ELECTRON_START_URL || new URL(path.join(__dirname, 'dist/index.html'), 'file:').toString();
  mainWin.loadURL(startUrl);
  mainWin.setMenu(null);

  mainWin.on('closed', () => {
    mainWin = null;
    if (!launcherWin) {
      createLauncherWindow();
    }
  });
}

// --- פונקציות לניהול השרת הסטטי (מהקוד הישן והטוב) ---
function getDistFolder() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'dist');
  }
  return path.join(__dirname, 'dist');
}

function startExpressServerAndOpenBrowser() {
  const root = getDistFolder(); // משתמשים בפונקציה החכמה שלך
  if (!root) return;

  const server = express();
  server.use(express.static(root));

  const listener = server.listen(0, '127.0.0.1', () => {
    const port = listener.address().port;
    shell.openExternal(`http://127.0.0.1:${port}`);
  });

  app.on('before-quit', () => {
    listener.close();
  });
}

// ----------------------------------------------------

app.whenReady().then(createLauncherWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createLauncherWindow(); });
app.on('before-quit', () => { if (staticServer) staticServer.close(); });

// --- IPC Handlers ---
ipcMain.on('quit-app', () => app.quit());
ipcMain.on('open-app', () => {
  createMainWindow();
  if (launcherWin) {
    launcherWin.close();
    launcherWin = null;
  }
});

// --- הלוגיקה הנכונה לפתיחה בדפדפן ---
ipcMain.on('open-browser', () => {
  if (process.env.ELECTRON_START_URL) {
    shell.openExternal(process.env.ELECTRON_START_URL);
  } else {
    startExpressServerAndOpenBrowser();
  }
});