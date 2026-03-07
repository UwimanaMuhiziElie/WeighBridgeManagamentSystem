import { useState, useEffect, useCallback } from 'react';
import type {
  SerialConfig,
  SerialPortInfo,
  SerialTestReadOptions,
  SerialTestReadResult,
} from '../types';

type ElectronSerial = {
  listPorts: () => Promise<{ success: boolean; ports?: SerialPortInfo[]; error?: string }>;
  connect: (config: SerialConfig) => Promise<{ success: boolean; error?: string }>;
  disconnect: () => Promise<{ success: boolean; error?: string }>;
  simulateWeight: (weight: number) => Promise<{ success: boolean; error?: string }>;

  testRead?: (opts?: SerialTestReadOptions) => Promise<SerialTestReadResult>;
  onRawData?: (callback: (raw: string) => void) => () => void;

  onWeightData: (callback: (weight: number) => void) => () => void;
  onError: (callback: (error: string) => void) => () => void;
};

function getElectronSerial(): ElectronSerial | null {
  if (typeof window === 'undefined') return null;
  return (window as any).electron?.serial ?? null;
}

function parseWeightSafe(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;

  const s = String(v ?? '').trim();
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;

  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

export function useSerialPort() {
  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [currentWeight, setCurrentWeight] = useState<number | null>(null);
  const [lastRaw, setLastRaw] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const hasElectron = !!getElectronSerial();

  const listPorts = useCallback(async () => {
    const serial = getElectronSerial();
    if (!serial) {
      setError('Serial features are available only inside the Electron desktop app.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await serial.listPorts();
      if (result.success && result.ports) {
        setPorts(result.ports);
      } else {
        setPorts([]);
        setError(result.error || 'Failed to list ports');
      }
    } catch (err) {
      setPorts([]);
      setError(err instanceof Error ? err.message : 'Failed to list ports');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const connect = useCallback(async (config: SerialConfig) => {
    const serial = getElectronSerial();
    if (!serial) {
      setError('Serial features are available only inside the Electron desktop app.');
      return false;
    }

    if (!config?.path) {
      setError('Please select a serial port.');
      return false;
    }

    setIsLoading(true);
    setError(null);

    const { path, ...userCfg } = config;
    const defaults: Partial<SerialConfig> = {
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',

      mode: 'poll',
      requestCommand: 'P\\r\\n',
      pollIntervalMs: 1000,
      responseWaitMs: 300,
      encoding: 'ascii',
      delimiter: '\\r\\n',

      xon: false,
      xoff: false,
      rtscts: false,
    };

    const cfg: SerialConfig = {
      path,
      ...defaults,
      ...userCfg,
      mode: config.mode ?? (defaults.mode as SerialConfig['mode']) ?? 'poll',
      requestCommand: config.requestCommand ?? defaults.requestCommand ?? 'P\\r\\n',
      pollIntervalMs: config.pollIntervalMs ?? defaults.pollIntervalMs ?? 1000,
      responseWaitMs: config.responseWaitMs ?? defaults.responseWaitMs ?? 300,
      encoding: config.encoding ?? defaults.encoding ?? 'ascii',
      delimiter: config.delimiter ?? defaults.delimiter ?? '\\r\\n',
      xon: config.xon ?? defaults.xon ?? false,
      xoff: config.xoff ?? defaults.xoff ?? false,
      rtscts: config.rtscts ?? defaults.rtscts ?? false,
    };

    try {
      const result = await serial.connect(cfg);
      if (result.success) {
        setIsConnected(true);
        return true;
      }
      setError(result.error || 'Failed to connect');
      setIsConnected(false);
      return false;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
      setIsConnected(false);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    const serial = getElectronSerial();
    if (!serial) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await serial.disconnect();
      if (result.success) {
        setIsConnected(false);
        setCurrentWeight(null);
        setLastRaw(null);
      } else {
        setError(result.error || 'Failed to disconnect');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const simulateWeight = useCallback(async (weight: number) => {
    const serial = getElectronSerial();
    if (!serial) {
      setError('Serial features are available only inside the Electron desktop app.');
      return;
    }

    try {
      const r = await serial.simulateWeight(weight);
      if (!r.success) setError(r.error || 'Failed to simulate weight');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to simulate weight');
    }
  }, []);

  const testRead = useCallback(async (opts?: SerialTestReadOptions) => {
    const serial = getElectronSerial();
    if (!serial) {
      return { success: false, error: 'Serial features are available only inside the Electron desktop app.' };
    }

    if (typeof serial.testRead !== 'function') {
      return { success: false, error: 'Test Read not available (missing serial:test-read in Electron).' };
    }

    try {
      const r = await serial.testRead(opts ?? {});
      if (!r?.success) return { success: false, error: r?.error || 'Test Read failed' };

      const raw = String(r.raw ?? '');
      setLastRaw(raw);

      const w = parseWeightSafe(r.weight);
      if (w !== null) setCurrentWeight(w);

      return { success: true, raw, weight: w };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Test Read failed' };
    }
  }, []);

  useEffect(() => {
    const serial = getElectronSerial();
    if (!serial) return;

    const unsubscribeWeight = serial.onWeightData((weight: unknown) => {
      const n = parseWeightSafe(weight);
      if (n !== null) setCurrentWeight(n);
    });

    const unsubscribeRaw = serial.onRawData?.((raw: string) => {
      const s = String(raw ?? '');
      setLastRaw(s.length > 700 ? s.slice(0, 700) : s);
    });

    const unsubscribeError = serial.onError((msg: string) => {
      setError(msg || 'Serial error');
      setIsConnected(false);
    });

    return () => {
      unsubscribeWeight?.();
      unsubscribeRaw?.();
      unsubscribeError?.();
    };
  }, []);

  return {
    ports,
    isConnected,
    currentWeight,
    lastRaw,
    error,
    isLoading,
    hasElectron,
    listPorts,
    connect,
    disconnect,
    simulateWeight,
    testRead,
  };
}
