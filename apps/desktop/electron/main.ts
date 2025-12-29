import { app, BrowserWindow, ipcMain } from 'electron';
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let serialPort: SerialPort | null = null;
let parser: ReadlineParser | null = null;

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
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

ipcMain.handle('serial:list-ports', async () => {
  try {
    const ports = await SerialPort.list();
    return {
      success: true,
      ports: ports.map(port => ({
        path: port.path,
        manufacturer: port.manufacturer,
        serialNumber: port.serialNumber,
        productId: port.productId,
        vendorId: port.vendorId,
      })),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
});

ipcMain.handle('serial:connect', async (_event, config: {
  path: string;
  baudRate: number;
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  parity: 'none' | 'even' | 'odd';
}) => {
  try {
    if (serialPort && serialPort.isOpen) {
      serialPort.close();
    }

    serialPort = new SerialPort({
      path: config.path,
      baudRate: config.baudRate,
      dataBits: config.dataBits,
      stopBits: config.stopBits,
      parity: config.parity,
    });

    parser = serialPort.pipe(new ReadlineParser({ delimiter: '\r\n' }));

    parser.on('data', (data: string) => {
      const weight = parseWeight(data);
      if (weight !== null && mainWindow) {
        mainWindow.webContents.send('serial:weight-data', weight);
      }
    });

    serialPort.on('error', (error) => {
      if (mainWindow) {
        mainWindow.webContents.send('serial:error', error.message);
      }
    });

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
});

ipcMain.handle('serial:disconnect', async () => {
  try {
    if (serialPort && serialPort.isOpen) {
      serialPort.close();
      serialPort = null;
      parser = null;
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
});

ipcMain.handle('serial:simulate-weight', async (_event, weight: number) => {
  if (mainWindow) {
    mainWindow.webContents.send('serial:weight-data', weight);
    return { success: true };
  }
  return { success: false, error: 'Window not found' };
});

function parseWeight(data: string): number | null {
  const cleaned = data.trim().replace(/[^\d.-]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : parsed;
}
