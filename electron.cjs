const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const express = require('express');
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
let settings = { supabaseUrl: '', supabaseKey: '' };

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    }
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
}

function saveSettings(newSettings) {
  try {
    settings = newSettings;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch (error) { console.error('Failed to save settings:', error); }
}

loadSettings();
console.log('Initial settings loaded in main process electron.cjs:', settings); 

let launcherWin;
let mainWin;
let closingLauncherForOpenMain = false; // guard to avoid quitting when programmatically closing launcher
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
  // If user clicks the X on the launcher, quit the whole app
  launcherWin.on('close', () => {
    if (!closingLauncherForOpenMain) {
      app.quit();
    }
  });
  // Ensure reference is cleared when window is closed
  launcherWin.on('closed', () => {
    launcherWin = null;
    // reset the guard in case it was set for programmatic close
    closingLauncherForOpenMain = false;
  });
}

function createMainWindow() {
  if (mainWin) {
    mainWin.focus();
    return;
  }
  mainWin = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: path.join(__dirname, 'public', 'icon.svg'),
    webPreferences: {
      contextIsolation: true, // חשוב לאבטחה
      nodeIntegration: false, // חשוב לאבטחה
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
    staticServer = listener;
    staticPort = port;
    shell.openExternal(`http://127.0.0.1:${port}`);
  });
}

function stopExpressServer() {
  if (staticServer) {
    try {
      staticServer.close();
    } catch (error) {
      console.error('Failed to stop static server:', error);
    } finally {
      staticServer = undefined;
      staticPort = undefined;
    }
  }
}

// ----------------------------------------------------

app.whenReady().then(createLauncherWindow);
// Keep the app alive when all windows are closed so we can
// recreate the launcher window after the main window closes.
app.on('window-all-closed', () => {
  // Stop the local static server if running.
  stopExpressServer();
  // Intentionally do not quit the app on Windows/Linux.
});
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createLauncherWindow(); });

// --- IPC Handlers משודרגים ---
ipcMain.on('quit-app', () => app.quit());
ipcMain.on('open-app', () => {
  createMainWindow();
  if (launcherWin) {
    closingLauncherForOpenMain = true;
    launcherWin.close();
  }
});
ipcMain.on('open-browser', () => { /* ... נשאר זהה ... */ });

// IPC חדש לקבלת ושמירת הגדרות
ipcMain.on('get-settings', (event) => { event.returnValue = settings; });
ipcMain.on('save-settings', (event, newSettings) => { saveSettings(newSettings); });

// IPC חדש שיאפשר לאפליקציית הריאקט לקבל את ההגדרות
ipcMain.handle('get-supabase-config', async () => { return settings; });

// --- הלוגיקה הנכונה לפתיחה בדפדפן ---
ipcMain.on('open-browser', () => {
  if (process.env.ELECTRON_START_URL) {
    shell.openExternal(process.env.ELECTRON_START_URL);
  } else {
    startExpressServerAndOpenBrowser();
  }
});

// Ensure server is stopped on explicit app quit
app.on('before-quit', () => {
  stopExpressServer();
});
