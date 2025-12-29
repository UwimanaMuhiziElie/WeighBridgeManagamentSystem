import { contextBridge, ipcRenderer } from 'electron';

export interface SerialPortInfo {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  productId?: string;
  vendorId?: string;
}

export interface SerialConfig {
  path: string;
  baudRate: number;
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  parity: 'none' | 'even' | 'odd';
}

contextBridge.exposeInMainWorld('electron', {
  serial: {
    listPorts: () => ipcRenderer.invoke('serial:list-ports'),
    connect: (config: SerialConfig) => ipcRenderer.invoke('serial:connect', config),
    disconnect: () => ipcRenderer.invoke('serial:disconnect'),
    simulateWeight: (weight: number) => ipcRenderer.invoke('serial:simulate-weight', weight),
    onWeightData: (callback: (weight: number) => void) => {
      const subscription = (_event: any, weight: number) => callback(weight);
      ipcRenderer.on('serial:weight-data', subscription);
      return () => ipcRenderer.removeListener('serial:weight-data', subscription);
    },
    onError: (callback: (error: string) => void) => {
      const subscription = (_event: any, error: string) => callback(error);
      ipcRenderer.on('serial:error', subscription);
      return () => ipcRenderer.removeListener('serial:error', subscription);
    },
  },
});
