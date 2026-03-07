import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import * as fs from 'node:fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;

// Keep these as "any" to avoid TS conflicts across ESM/CJS packaging differences
let serialPort: any = null;
let parser: any = null;

let SerialPortClass: any = null;
let ReadlineParserClass: any = null;

let pollTimer: NodeJS.Timeout | null = null;
let currentSerialCfg: any = null;

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

// ---- Printer deps (loaded lazily) ----
let printerPrint: any = null;
let printerGetPrinters: any = null;

// Thermal printable width from self-test: 72mm (default)
const THERMAL_PRINTABLE_WIDTH_MM = Number(process.env.THERMAL_PRINTABLE_WIDTH_MM ?? 72);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

function sendToRenderer(channel: string, ...args: any[]) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, ...args);
}

function resolvePreloadPath(): string {
  const candidates = ['preload.mjs', 'preload.js', 'preload.cjs'];
  for (const name of candidates) {
    const p = path.join(__dirname, name);
    if (fs.existsSync(p)) return p;
  }
  return path.join(__dirname, 'preload.mjs');
}

function isAllowedNavigation(url: string): boolean {
  if (!url) return false;
  if (VITE_DEV_SERVER_URL && url.startsWith(VITE_DEV_SERVER_URL)) return true;
  if (url.startsWith('file://')) return true;
  return false;
}

async function loadSerialDeps() {
  if (SerialPortClass && ReadlineParserClass) return;

  const sp = await import('serialport');
  const pr = await import('@serialport/parser-readline');

  SerialPortClass = (sp as any).SerialPort ?? (sp as any).default?.SerialPort ?? (sp as any).default;
  ReadlineParserClass = (pr as any).ReadlineParser ?? (pr as any).default?.ReadlineParser ?? (pr as any).default;

  if (!SerialPortClass) throw new Error('Failed to load SerialPort from "serialport"');
  if (!ReadlineParserClass) throw new Error('Failed to load ReadlineParser from "@serialport/parser-readline"');
}

/**
 * IMPORTANT: pdf-to-printer is CommonJS and often breaks under ESM bundling if imported the wrong way.
 * Using createRequire keeps it in CJS mode (prevents "__dirname is not defined").
 */
async function loadPrinterDeps() {
  if (printerPrint && printerGetPrinters) return;

  // 1) Preferred: require() via createRequire (stable in packaged builds)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('pdf-to-printer');
    printerPrint = (mod as any).print ?? (mod as any).default?.print;
    printerGetPrinters = (mod as any).getPrinters ?? (mod as any).default?.getPrinters;
  } catch {
    // 2) Fallback: dynamic import
    const mod = await import('pdf-to-printer');
    printerPrint = (mod as any).print ?? (mod as any).default?.print;
    printerGetPrinters = (mod as any).getPrinters ?? (mod as any).default?.getPrinters;
  }

  if (!printerPrint) throw new Error('Failed to load print() from "pdf-to-printer"');
  if (!printerGetPrinters) throw new Error('Failed to load getPrinters() from "pdf-to-printer"');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!isAllowedNavigation(url)) e.preventDefault();
  });

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
    if (process.env.ELECTRON_DEVTOOLS === '1') mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function decodeEscapes(input: string): string {
  const s = String(input ?? '');
  return s.replace(/\\r/g, '\r').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
}

function safeEncoding(enc: any): BufferEncoding {
  const v = String(enc ?? 'ascii').toLowerCase();
  const ok: BufferEncoding[] = ['ascii', 'utf8', 'utf-8', 'latin1', 'hex', 'base64'];
  return (ok.includes(v as any) ? (v === 'utf-8' ? 'utf8' : (v as any)) : 'ascii') as BufferEncoding;
}

function parseWeight(data: string): number | null {
  const m = String(data ?? '').trim().match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function clearPoll() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function closeSerial(): Promise<void> {
  clearPoll();
  currentSerialCfg = null;

  try {
    if (parser) {
      try {
        parser.removeAllListeners?.();
      } catch {}
      parser = null;
    }

    if (serialPort) {
      try {
        serialPort.removeAllListeners?.();
      } catch {}

      if (serialPort.isOpen) {
        await new Promise<void>((resolve) => {
          try {
            serialPort.close((_: any) => resolve());
          } catch {
            resolve();
          }
        });
      }

      serialPort = null;
    }
  } catch {
    // swallow cleanup errors
  }
}

function validateSerialConfig(config: any) {
  const pathStr = typeof config?.path === 'string' ? config.path.trim() : '';
  if (!pathStr) return { ok: false as const, error: 'Invalid serial path' };

  const baudRate = Number(config?.baudRate);
  if (!Number.isFinite(baudRate) || baudRate <= 0) return { ok: false as const, error: 'Invalid baudRate' };

  const dataBits = Number(config?.dataBits);
  if (dataBits !== 7 && dataBits !== 8) return { ok: false as const, error: 'Invalid dataBits (7 or 8)' };

  const stopBits = Number(config?.stopBits);
  if (stopBits !== 1 && stopBits !== 2) return { ok: false as const, error: 'Invalid stopBits (1 or 2)' };

  const parity = String(config?.parity || '').toLowerCase();
  if (!['none', 'even', 'odd'].includes(parity)) return { ok: false as const, error: 'Invalid parity' };

  const mode = config?.mode === 'stream' ? 'stream' : 'poll';
  const requestCommand = typeof config?.requestCommand === 'string' ? config.requestCommand : 'P\\r\\n';
  const pollIntervalMs = Number.isFinite(Number(config?.pollIntervalMs))
    ? Math.max(200, Number(config.pollIntervalMs))
    : 1000;
  const responseWaitMs = Number.isFinite(Number(config?.responseWaitMs))
    ? Math.max(50, Number(config.responseWaitMs))
    : 300;
  const encoding = safeEncoding(config?.encoding);
  const delimiter = typeof config?.delimiter === 'string' ? config.delimiter : '\\r\\n';

  return {
    ok: true as const,
    value: {
      path: pathStr,
      baudRate,
      dataBits: dataBits as 7 | 8,
      stopBits: stopBits as 1 | 2,
      parity: parity as 'none' | 'even' | 'odd',

      mode,
      requestCommand,
      pollIntervalMs,
      responseWaitMs,
      encoding,
      delimiter,

      xon: !!config?.xon,
      xoff: !!config?.xoff,
      rtscts: !!config?.rtscts,
    },
  };
}

async function writePollOnce(opts?: { requestCommand?: string; responseWaitMs?: number; encoding?: any }) {
  if (!serialPort || !serialPort.isOpen) return { raw: '', weight: null as number | null };

  const cfg = currentSerialCfg ?? {};
  const cmd = decodeEscapes(String(opts?.requestCommand ?? cfg.requestCommand ?? 'P\\r\\n'));
  const waitMs = Number.isFinite(Number(opts?.responseWaitMs ?? cfg.responseWaitMs))
    ? Number(opts?.responseWaitMs ?? cfg.responseWaitMs)
    : 300;

  let collected = '';
  const onData = (line: any) => {
    const s = String(line ?? '').trim();
    if (!s) return;
    collected = collected ? `${collected}\n${s}` : s;
    sendToRenderer('serial:raw-data', s);
    const w = parseWeight(s);
    if (w !== null) sendToRenderer('serial:weight-data', w);
  };

  parser?.on?.('data', onData);

  try {
    await new Promise<void>((resolve, reject) => {
      serialPort.write(cmd, (err: any) => {
        if (err) return reject(err);
        serialPort.drain?.((drainErr: any) => (drainErr ? reject(drainErr) : resolve()));
      });
    });

    await sleep(waitMs);

    const raw = String(collected ?? '').trim();
    const weight = parseWeight(raw);
    return { raw, weight };
  } finally {
    parser?.off?.('data', onData);
  }
}

function startPollLoop() {
  clearPoll();
  const cfg = currentSerialCfg;
  if (!cfg || cfg.mode !== 'poll') return;

  void writePollOnce().catch(() => {});
  pollTimer = setInterval(() => {
    void writePollOnce().catch(() => {});
  }, cfg.pollIntervalMs ?? 1000);
}

app.whenReady().then(createWindow);

app.on('before-quit', () => {
  closeSerial().catch(() => {});
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// =================== PRINTER HELPERS ===================

type PrinterLike = {
  name: string;
  displayName?: string;
  isDefault?: boolean;
  status?: any;
};

function normalizePrinterName(name: unknown): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Block virtual printers that trigger “Save As…”
function isBlockedPrinter(name: string): boolean {
  const n = normalizePrinterName(name);
  if (!n) return true;

  // Always block the obvious virtual ones
  if (n.includes('microsoft print to pdf')) return true;
  if (n.includes('xps')) return true;
  if (n.includes('onenote')) return true;
  if (n === 'fax' || n.includes(' fax')) return true;
  if (n.includes('hp smart universal printing')) return true;

  // generic pdf/virtual
  if (n.includes('print to pdf')) return true;
  if (n === 'pdf' || n.endsWith(' pdf') || n.includes(' to pdf')) return true;

  return false;
}

function looksThermal(name: string): boolean {
  const n = normalizePrinterName(name);
  return (
    n.includes('munbyn') ||
    n.includes('pos') ||
    n.includes('thermal') ||
    n.includes('receipt') ||
    n.includes('epson') ||
    n.includes('esc/pos') ||
    n.includes('80') ||
    n.includes('58')
  );
}

// Prefer thermal printers (MUNBYN, POS-80C, etc.)
function scorePrinter(p: PrinterLike, preferThermal: boolean): number {
  const n = normalizePrinterName(p.name);
  if (!n || isBlockedPrinter(n)) return -9999;

  let score = 0;

  if (p.isDefault) score += 10;

  if (n.includes('munbyn')) score += 120;
  if (n.includes('pos-80c') || n.includes('pos 80c') || n.includes('pos80c')) score += 110;

  if (n.includes('pos')) score += 60;
  if (n.includes('thermal')) score += 55;
  if (n.includes('receipt')) score += 45;
  if (n.includes('epson')) score += 35;
  if (n.includes('label')) score += 25;
  if (n.includes('80')) score += 15;
  if (n.includes('58')) score += 10;

  if (!preferThermal) {
    score = Math.min(score, 25) + (p.isDefault ? 10 : 0);
  }

  return score;
}

function pickBestPrinter(printers: PrinterLike[], preferred?: string | null, preferThermal?: boolean): string | undefined {
  const list = Array.isArray(printers) ? printers.filter((p) => p?.name) : [];

  const allowed = list.filter((p) => !isBlockedPrinter(p.name));
  if (allowed.length === 0) return undefined;

  const pref = normalizePrinterName(preferred);
  if (pref) {
    const exact = allowed.find((p) => normalizePrinterName(p.name) === pref);
    if (exact?.name) return exact.name;

    const fuzzy = allowed.find((p) => normalizePrinterName(p.name).includes(pref));
    if (fuzzy?.name) return fuzzy.name;
  }

  const thermal = !!preferThermal;

  let best: PrinterLike | null = null;
  let bestScore = -9999;

  for (const p of allowed) {
    const s = scorePrinter(p, thermal);
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }

  if (thermal && best && bestScore < 25) {
    const def = allowed.find((p) => !!p.isDefault);
    if (def?.name) return def.name;
  }

  return best?.name;
}

function extractBase64Pdf(input: any): string {
  let s = String(input ?? '').trim();
  if (!s) return '';
  if (s.startsWith('data:')) {
    const idx = s.indexOf('base64,');
    if (idx >= 0) s = s.slice(idx + 'base64,'.length);
  }
  s = s.replace(/\s+/g, '');
  return s;
}

function sanitizeFilePart(name: string) {
  return String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function writeTempPdf(base64: string, jobName?: string): string {
  const safe = extractBase64Pdf(base64);
  if (!safe) throw new Error('Empty PDF payload');

  const buf = Buffer.from(safe, 'base64');
  if (!buf.length) throw new Error('Empty PDF data');

  const tmpDir = app.getPath('temp');
  const jobPart = jobName ? sanitizeFilePart(jobName) : 'Weighbridge-Receipt';
  const filePath = path.join(tmpDir, `${jobPart}-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`);
  fs.writeFileSync(filePath, buf);
  return filePath;
}

async function resolveTargetPrinterName(preferred?: string | null, preferThermal?: boolean): Promise<string | undefined> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      const printers = (await mainWindow.webContents.getPrintersAsync()) as any[];
      const normalized: PrinterLike[] = printers.map((p: any) => ({
        name: String(p?.name || ''),
        displayName: p?.displayName,
        isDefault: !!p?.isDefault,
        status: p?.status,
      }));
      return pickBestPrinter(normalized, preferred ?? null, !!preferThermal);
    } catch {
      // fallthrough
    }
  }

  try {
    await loadPrinterDeps();
    const raw = await printerGetPrinters();
    const names: string[] = Array.isArray(raw)
      ? raw
          .map((p: any) => (typeof p === 'string' ? p : p?.name))
          .filter((x: any) => typeof x === 'string' && x.trim())
      : [];

    const list: PrinterLike[] = names.map((n) => ({ name: n }));
    return pickBestPrinter(list, preferred ?? null, !!preferThermal);
  } catch {
    return undefined;
  }
}

async function createHiddenPrintWindow(jobName?: string) {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });

  if (jobName) {
    try {
      win.setTitle(jobName);
    } catch {}
  }

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (!url || !url.startsWith('file://')) e.preventDefault();
  });

  return win;
}

async function printPdfViaHiddenWindow(payload: {
  base64: string;
  deviceName?: string;
  silent?: boolean;
  jobName?: string;
  // micron units (Electron expects microns if you set pageSize)
  pageSizeMicrons?: { width: number; height: number };
}): Promise<{ success: boolean; error?: string }> {
  let win: BrowserWindow | null = null;
  let filePath = '';

  const LOAD_TIMEOUT_MS = 15000;
  const PRINT_TIMEOUT_MS = 25000;

  try {
    const base64 = extractBase64Pdf(payload?.base64);
    if (!base64) return { success: false, error: 'Missing PDF base64' };

    filePath = writeTempPdf(base64, payload?.jobName);
    win = await createHiddenPrintWindow(payload?.jobName);

    const fileUrl = pathToFileURL(filePath).toString();

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Print window load timeout')), LOAD_TIMEOUT_MS);

      const cleanup = () => {
        clearTimeout(t);
        try {
          win?.webContents.removeAllListeners('did-finish-load');
        } catch {}
        try {
          win?.webContents.removeAllListeners('did-fail-load');
        } catch {}
      };

      win!.webContents.once('did-finish-load', async () => {
        cleanup();
        await sleep(350);
        resolve();
      });

      win!.webContents.once('did-fail-load', (_e, code, desc) => {
        cleanup();
        reject(new Error(`Load failed (${code}): ${desc}`));
      });

      win!.loadURL(fileUrl).catch((err) => {
        cleanup();
        reject(err);
      });
    });

    const silent = payload?.silent !== false;

    const printOk = await new Promise<{ ok: boolean; reason?: string }>((resolve) => {
      const t = setTimeout(() => resolve({ ok: false, reason: 'Print timeout' }), PRINT_TIMEOUT_MS);

      win!.webContents.print(
        {
          silent,
          printBackground: true,
          deviceName: payload?.deviceName,
          margins: { marginType: 'none' },
          ...(payload.pageSizeMicrons ? { pageSize: payload.pageSizeMicrons } : {}),
        } as any,
        (success, failureReason) => {
          clearTimeout(t);
          if (success) resolve({ ok: true });
          else resolve({ ok: false, reason: failureReason || 'Print failed' });
        }
      );
    });

    if (!printOk.ok) return { success: false, error: printOk.reason || 'Print failed' };
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e instanceof Error ? e.message : String(e ?? 'Print failed') };
  } finally {
    try {
      if (win && !win.isDestroyed()) win.close();
    } catch {}
    try {
      if (filePath) fs.unlinkSync(filePath);
    } catch {}
  }
}

// -------------------- SERIAL IPC --------------------
ipcMain.handle('serial:list-ports', async () => {
  try {
    await loadSerialDeps();
    const ports = await SerialPortClass.list();

    return {
      success: true,
      ports: ports.map((port: any) => ({
        path: port.path,
        manufacturer: port.manufacturer,
        serialNumber: port.serialNumber,
        productId: port.productId,
        vendorId: port.vendorId,
      })),
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('serial:connect', async (_event, config: any) => {
  try {
    await loadSerialDeps();

    const v = validateSerialConfig(config);
    if (!v.ok) return { success: false, error: v.error };

    await closeSerial();
    currentSerialCfg = v.value;

    serialPort = new SerialPortClass({
      path: v.value.path,
      baudRate: v.value.baudRate,
      dataBits: v.value.dataBits,
      stopBits: v.value.stopBits,
      parity: v.value.parity,
      xon: v.value.xon,
      xoff: v.value.xoff,
      rtscts: v.value.rtscts,
      autoOpen: false,
    });

    await new Promise<void>((resolve, reject) => {
      try {
        serialPort.open((err: any) => (err ? reject(err) : resolve()));
      } catch (e) {
        reject(e);
      }
    });

    const delimiter = decodeEscapes(String(v.value.delimiter ?? '\\r\\n'));
    parser = serialPort.pipe(new ReadlineParserClass({ delimiter }));

    parser.on('data', (data: any) => {
      const s = String(data ?? '').trim();
      if (!s) return;
      sendToRenderer('serial:raw-data', s);
      const weight = parseWeight(s);
      if (weight !== null) sendToRenderer('serial:weight-data', weight);
    });

    serialPort.on('error', (err: any) => {
      sendToRenderer('serial:error', err?.message ?? String(err));
    });

    serialPort.on('close', () => {
      sendToRenderer('serial:error', 'Serial port disconnected');
      closeSerial().catch(() => {});
    });

    startPollLoop();
    return { success: true };
  } catch (error) {
    await closeSerial();
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('serial:disconnect', async () => {
  try {
    await closeSerial();
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('serial:simulate-weight', async (_event, weight: any) => {
  const n = typeof weight === 'number' ? weight : Number(weight);
  if (!Number.isFinite(n)) return { success: false, error: 'Invalid weight' };

  sendToRenderer('serial:weight-data', n);
  sendToRenderer('serial:raw-data', String(n));
  return { success: true };
});

ipcMain.handle('serial:test-read', async (_event, opts: any) => {
  try {
    if (!serialPort || !serialPort.isOpen) return { success: false, error: 'Serial port is not open' };

    const wasPolling = !!pollTimer;
    if (wasPolling) clearPoll();

    const r = await writePollOnce(opts);

    if (wasPolling) startPollLoop();

    return { success: true, raw: r.raw ?? '', weight: r.weight ?? null };
  } catch (e: any) {
    return { success: false, error: e instanceof Error ? e.message : String(e ?? 'Test Read failed') };
  }
});

// -------------------- PRINTER IPC --------------------

ipcMain.handle('printer:list', async () => {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return { success: true, printers: [] };

    const printers = await mainWindow.webContents.getPrintersAsync();
    return {
      success: true,
      printers: printers.map((p: any) => ({
        name: p.name,
        displayName: p.displayName,
        isDefault: !!p.isDefault,
        status: p.status,
        blocked: isBlockedPrinter(String(p.name || '')),
        thermalLike: looksThermal(String(p.name || '')),
      })),
    };
  } catch (e: any) {
    try {
      await loadPrinterDeps();
      const printers = await printerGetPrinters();
      return { success: true, printers };
    } catch (e2: any) {
      return { success: false, error: e2 instanceof Error ? e2.message : String(e2 ?? 'Failed to list printers') };
    }
  }
});

ipcMain.handle('printer:print-pdf', async (_event, arg1: any, arg2?: any) => {
  try {
    // Supports:
    // - printPdf(base64, deviceName?)
    // - printPdf({ pdfBase64/base64, deviceName/printerName, preferMunbyn, silent, jobName, paperWidthMm })
    const isStringCall = typeof arg1 === 'string';

    const base64 = isStringCall ? extractBase64Pdf(arg1) : extractBase64Pdf(arg1?.pdfBase64 ?? arg1?.base64);

    const preferredName = isStringCall
      ? typeof arg2 === 'string'
        ? arg2.trim()
        : ''
      : typeof arg1?.deviceName === 'string'
        ? arg1.deviceName.trim()
        : typeof arg1?.printerName === 'string'
          ? arg1.printerName.trim()
          : '';

    // preferMunbyn here means "prefer thermal printer"
    const preferThermal = isStringCall ? true : arg1?.preferMunbyn !== false;

    // silent default TRUE
    const silent = isStringCall ? true : arg1?.silent !== false;

    const jobName = !isStringCall && typeof arg1?.jobName === 'string' ? arg1.jobName : undefined;

    // IMPORTANT: use 72mm by default (printer self-test printable width)
    const paperWidthMm =
      !isStringCall && Number.isFinite(Number(arg1?.paperWidthMm))
        ? Math.max(58, Math.min(80, Number(arg1.paperWidthMm)))
        : THERMAL_PRINTABLE_WIDTH_MM;

    if (!base64) return { success: false, error: 'Missing PDF base64' };

    const deviceName = await resolveTargetPrinterName(preferredName || null, preferThermal);

    if (!deviceName) {
      return {
        success: false,
        error: 'No suitable physical printer found. Install/connect the thermal printer driver and retry.',
      };
    }

    if (isBlockedPrinter(deviceName)) {
      return {
        success: false,
        error: `Blocked printer selected (${deviceName}). Please select a real thermal printer.`,
      };
    }

    // 1) Try pdf-to-printer FIRST (best for thermal on Windows)
    try {
      await loadPrinterDeps();

      let tmpPath = '';
      try {
        tmpPath = writeTempPdf(base64, jobName);

        // If the PDF is already generated at 72mm, "noscale" is the correct choice.
        // Still, drivers vary: we fallback to "fit" then "shrink".
        const scaleAttempts: Array<'noscale' | 'fit' | 'shrink'> = preferThermal ? ['noscale', 'fit', 'shrink'] : ['fit', 'shrink', 'noscale'];

        let lastErr: any = null;
        for (const scale of scaleAttempts) {
          try {
            await printerPrint(tmpPath, {
              printer: deviceName,
              scale,
            } as any);

            return { success: true, printerUsed: deviceName, method: 'pdf-to-printer', scale, paperWidthMm };
          } catch (e: any) {
            lastErr = e;
          }
        }

        throw lastErr ?? new Error('pdf-to-printer failed');
      } finally {
        try {
          if (tmpPath) fs.unlinkSync(tmpPath);
        } catch {}
      }
    } catch (_e1: any) {
      // fall back below
    }

    // 2) Fallback: Electron hidden-window print
    // Set an explicit pageSize (microns) to encourage thermal sizing when drivers are weird
    const pageSizeMicrons = {
      width: Math.round(paperWidthMm * 1000),
      // long page; receipt height comes from PDF anyway but some drivers behave better with a "reasonable" height
      height: Math.round(220 * 1000),
    };

    const r2 = await printPdfViaHiddenWindow({
      base64,
      deviceName,
      silent,
      jobName,
      pageSizeMicrons,
    });

    if (r2.success) return { success: true, printerUsed: deviceName, method: 'electron', paperWidthMm };
    return { success: false, error: r2.error || 'Print failed', printerUsed: deviceName, method: 'electron', paperWidthMm };
  } catch (e: any) {
    return { success: false, error: e instanceof Error ? e.message : String(e ?? 'Print failed') };
  }
});
