import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import Store from 'electron-store';

const store = new Store();
const isDev = process.env.NODE_ENV === 'development';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Constants from profiler.h
const PROF_EVENT_TYPE_MASK = 0x7F;
const PROF_EVENT_TASK_SWITCH = 0x01;
const PROF_EVENT_ISR = 0x02;
async function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
      zoomFactor: 0.85 // Set default zoom to 60%
    },
    autoHideMenuBar: true // Hide the menu bar
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

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

ipcMain.handle('open-file', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Log Files', extensions: ['log'] }]
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const filePath = result.filePaths[0];
    const content = fs.readFileSync(filePath, 'utf8');
    return content;
  }
  return null;
});

ipcMain.handle('open-file-binary', async () => {
  console.log("Main: Handling 'open-file-binary'");
  try {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Binary Log Files', extensions: ['bin', 'log', '*'] }]
    });

    console.log("Main: Dialog result received:", result ? JSON.stringify(result) : 'null/undefined');

    if (!result || typeof result !== 'object') {
         console.error("Main: Invalid dialog result structure received.");
         // Throw error back to renderer
         throw new Error("Dialog returned invalid result structure.");
    }

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      console.log("Main: Dialog cancelled or no file selected.");
      return null; // This is fine, renderer handles null
    }

    const filePath = result.filePaths[0];
    console.log(`Main: File selected: ${filePath}`);

    try {
      // *** Read synchronously, this might block but is simpler for now ***
      const fileContentBuffer = fs.readFileSync(filePath); // NO encoding specified
      console.log(`Main: File read successfully, size: ${fileContentBuffer.length}`);

      // Check if it's actually a buffer (extra safety)
      if (!(fileContentBuffer instanceof Buffer)) {
         console.error(`Main: fs.readFileSync did not return a Buffer for ${filePath}`);
         throw new Error('Internal error: Failed to read file as buffer.');
      }

      // Return the correct object structure
      return {
        type: 'binary',
        data: fileContentBuffer,
        filePath: filePath
      };
    } catch (readErr) {
      // *** Catch file reading errors and THROW them ***
      console.error(`Main: Error reading file "${filePath}":`, readErr);
      // This makes ipcRenderer.invoke() reject in the renderer
      throw new Error(`Failed to read file: ${readErr.message || readErr}`);
    }
  } catch (dialogErr) {
    // Catch errors specifically from showOpenDialog or initial checks
    console.error("Main: Error during dialog operation:", dialogErr);
     // This makes ipcRenderer.invoke() reject in the renderer
    throw new Error(`Dialog error: ${dialogErr.message || dialogErr}`);
  }
});

ipcMain.handle('load-default-binary-trace', async () => {
  const filePath = path.join(__dirname, '..', '..', 'src', 'data', 'default-trace.bin');
  console.log(`Attempting to load default trace from: ${filePath}`);

  try {
      if (!fs.existsSync(filePath)) {
          console.error(`Default trace file not found at: ${filePath}`);
          return { error: 'Default trace file not found.' };
      }

      let buffer = fs.readFileSync(filePath);
      console.log(`Successfully loaded default trace file, size: ${buffer.length}`);

      // Preprocess to remove 0x09 delimiters
      buffer = preprocessLogBinary(buffer);
      console.log(`Preprocessed buffer size: ${buffer.length}`);

      return { buffer };
  } catch (error) {
      console.error('Failed to read or preprocess default binary file:', error);
      return { error: error.message || 'Failed to read default trace file.' };
  }
});
// Preprocessing function
function preprocessLogBinary(buffer) {
  const cleanBytes = [];
  let i = 0;

  while (i < buffer.length) {
      if (buffer[i] === 0x09) {
          i++;
          continue;
      }

      if (buffer[i] >= 0x70 && buffer[i] <= 0x7F) {
          if (i + 2 >= buffer.length) break;
          const nameLen = buffer[i + 2];
          if (i + 3 + nameLen > buffer.length) break;
          for (let j = 0; j < 3 + nameLen; j++) {
              cleanBytes.push(buffer[i + j]);
          }
          i += 3 + nameLen;
      } else if (
          (buffer[i] & PROF_EVENT_TYPE_MASK) === PROF_EVENT_TASK_SWITCH ||
          (buffer[i] & PROF_EVENT_TYPE_MASK) === PROF_EVENT_ISR
      ) {
          if (i + 10 > buffer.length) break;
          for (let j = 0; j < 10; j++) {
              cleanBytes.push(buffer[i + j]);
          }
          i += 10;
      } else {
          console.warn(`Unknown byte 0x${buffer[i].toString(16)} at position ${i}`);
          i++;
      }
  }

  return Buffer.from(cleanBytes);
}
ipcMain.handle('save-settings', async (event, settings) => {
  store.set('settings', settings);
});

ipcMain.handle('load-settings', async () => {
  return store.get('settings');
});