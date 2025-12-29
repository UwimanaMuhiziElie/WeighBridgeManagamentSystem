import { useState, useEffect, useCallback } from 'react';
import { SerialConfig, SerialPortInfo } from '../types';

function getElectronSerial() {
  return window?.electron?.serial ?? null;
}

export function useSerialPort() {
  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [currentWeight, setCurrentWeight] = useState<number | null>(null);
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

    setIsLoading(true);
    setError(null);

    try {
      const result = await serial.connect(config);
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

  useEffect(() => {
    const serial = getElectronSerial();
    if (!serial) return;

    const unsubscribeWeight = serial.onWeightData((weight) => {
      setCurrentWeight(weight);
    });

    const unsubscribeError = serial.onError((msg) => {
      setError(msg || 'Serial error');
      setIsConnected(false);
    });

    return () => {
      unsubscribeWeight?.();
      unsubscribeError?.();
    };
  }, []);

  return {
    ports,
    isConnected,
    currentWeight,
    error,
    isLoading,
    hasElectron,
    listPorts,
    connect,
    disconnect,
    simulateWeight,
  };
}
