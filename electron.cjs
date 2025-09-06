const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
    },
  });

  // טוען את האתר שלנו. אם אנחנו בפיתוח, הוא יטען מ-localhost.
  // אם אנחנו בגרסה הארוזה, הוא יטען מקובץ HTML מקומי.
  const startUrl =
  process.env.ELECTRON_START_URL ||
  `file://${path.join(__dirname, 'dist/index.html')}`;  // remove ../


app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
}