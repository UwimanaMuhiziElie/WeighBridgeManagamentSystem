import { contextBridge, ipcRenderer } from 'electron';

export interface SerialPortInfo {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  productId?: string;
  vendorId?: string;
}

export type SerialMode = 'poll' | 'stream';
export type SerialEncoding = 'ascii' | 'utf8' | 'utf-8' | 'latin1' | 'hex' | 'base64';

export interface SerialConfig {
  path: string;
  baudRate: number;
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  parity: 'none' | 'even' | 'odd';

  mode?: SerialMode;
  requestCommand?: string; // e.g. "P\\r\\n"
  pollIntervalMs?: number;
  responseWaitMs?: number;
  encoding?: SerialEncoding;
  delimiter?: string;

  xon?: boolean;
  xoff?: boolean;
  rtscts?: boolean;
}

export type SerialTestReadOptions = {
  requestCommand?: string;
  responseWaitMs?: number;
  encoding?: SerialEncoding;
};

type ApiResult<T> = Promise<{ success: boolean; error?: string } & T>;

async function safeInvoke<T extends object>(channel: string, ...args: any[]): ApiResult<T> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as any;
  } catch (e: any) {
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e ?? 'IPC error'),
    } as any;
  }
}

// Printer payload type (supports old + new call styles)
export type PrintPdfPayload = {
  pdfBase64?: string; // new style
  base64?: string; // old style
  deviceName?: string | null;
  printerName?: string; // legacy
  jobName?: string;
  preferMunbyn?: boolean;
  silent?: boolean;
};

contextBridge.exposeInMainWorld('electron', {
  serial: {
    listPorts: (): ApiResult<{ ports?: SerialPortInfo[] }> => safeInvoke('serial:list-ports'),

    connect: (config: SerialConfig): ApiResult<{}> => safeInvoke('serial:connect', config),

    disconnect: (): ApiResult<{}> => safeInvoke('serial:disconnect'),

    simulateWeight: (weight: number): ApiResult<{}> => safeInvoke('serial:simulate-weight', weight),

    testRead: (opts?: SerialTestReadOptions): ApiResult<{ raw?: string; weight?: number | null }> =>
      safeInvoke('serial:test-read', opts ?? {}),

    onWeightData: (callback: (weight: number) => void) => {
      if (typeof callback !== 'function') return () => {};

      const subscription = (_event: unknown, weight: unknown) => {
        const n = typeof weight === 'number' ? weight : Number(weight);
        if (Number.isFinite(n)) callback(n);
      };

      ipcRenderer.on('serial:weight-data', subscription);
      return () => ipcRenderer.removeListener('serial:weight-data', subscription);
    },

    onRawData: (callback: (raw: string) => void) => {
      if (typeof callback !== 'function') return () => {};

      const subscription = (_event: unknown, raw: unknown) => {
        callback(typeof raw === 'string' ? raw : String(raw ?? ''));
      };

      ipcRenderer.on('serial:raw-data', subscription);
      return () => ipcRenderer.removeListener('serial:raw-data', subscription);
    },

    onError: (callback: (error: string) => void) => {
      if (typeof callback !== 'function') return () => {};

      const subscription = (_event: unknown, error: unknown) => {
        callback(typeof error === 'string' ? error : String(error ?? 'Serial error'));
      };

      ipcRenderer.on('serial:error', subscription);
      return () => ipcRenderer.removeListener('serial:error', subscription);
    },
  },

  // Printer bridge (backward + forward compatible)
  printer: {
    listPrinters: (): ApiResult<{ printers?: Array<{ name: string; displayName?: string; isDefault?: boolean }> }> =>
      safeInvoke('printer:list'),

    /**
     * Supports ALL of these:
     * 1) printPdf(base64, deviceName?)
     * 2) printPdf({ base64, deviceName })
     * 3) printPdf({ pdfBase64, deviceName, jobName, preferMunbyn, silent })
     */
    printPdf: (arg1: string | PrintPdfPayload, arg2?: string): ApiResult<{}> => {
      // Signature A: printPdf(base64, deviceName?)
      if (typeof arg1 === 'string') {
        const base64 = arg1;
        const deviceName = typeof arg2 === 'string' ? arg2 : undefined;

        return safeInvoke('printer:print-pdf', {
          base64,
          pdfBase64: base64, // main.ts accepts either
          deviceName,
          printerName: deviceName, // legacy alias
        });
      }

      // Signature B/C: printPdf(payloadObject)
      const payload = arg1 || {};

      const normalizedBase64 = payload.base64 ?? payload.pdfBase64 ?? '';
      const normalizedDeviceName = payload.deviceName ?? null;
      const normalizedPrinterName =
        (payload as any).printerName ?? (typeof normalizedDeviceName === 'string' ? normalizedDeviceName : undefined);

      return safeInvoke('printer:print-pdf', {
        ...payload,
        base64: normalizedBase64,
        pdfBase64: normalizedBase64,
        deviceName: normalizedDeviceName,
        printerName: normalizedPrinterName,
      });
    },
  },
});
