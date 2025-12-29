import { useState, useEffect } from 'react';
import { useSerialPort, SerialPortInfo } from '@weighbridge/shared';
import { Settings as SettingsIcon, RefreshCw, AlertCircle, CheckCircle, Play } from 'lucide-react';

export default function SettingsPage() {
  const {
    ports,
    isConnected,
    error,
    isLoading,
    listPorts,
    connect,
    disconnect,
    simulateWeight,
  } = useSerialPort();

  const [config, setConfig] = useState({
    path: '',
    baudRate: 9600,
    dataBits: 8 as 7 | 8,
    stopBits: 1 as 1 | 2,
    parity: 'none' as 'none' | 'even' | 'odd',
  });

  const [simulatorWeight, setSimulatorWeight] = useState('1000');

  useEffect(() => {
    listPorts();
    const savedConfig = localStorage.getItem('serialConfig');
    if (savedConfig) {
      setConfig(JSON.parse(savedConfig));
    }
  }, []);

  async function handleConnect() {
    const success = await connect(config);
    if (success) {
      localStorage.setItem('serialConfig', JSON.stringify(config));
    }
  }

  async function handleDisconnect() {
    await disconnect();
  }

  async function handleSimulate() {
    const weight = parseFloat(simulatorWeight);
    if (!isNaN(weight)) {
      await simulateWeight(weight);
    }
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center gap-2 mb-6">
            <SettingsIcon className="w-5 h-5 text-gray-600" />
            <h2 className="text-lg font-semibold text-gray-900">Serial Port Configuration</h2>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {isConnected && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-600" />
              <p className="text-sm text-green-700">Connected to weighing scale</p>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700">
                  Serial Port
                </label>
                <button
                  onClick={listPorts}
                  disabled={isLoading}
                  className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>
              <select
                value={config.path}
                onChange={(e) => setConfig({ ...config, path: e.target.value })}
                disabled={isConnected}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
              >
                <option value="">Select a port</option>
                {ports.map((port) => (
                  <option key={port.path} value={port.path}>
                    {port.path}
                    {port.manufacturer && ` - ${port.manufacturer}`}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Baud Rate
              </label>
              <select
                value={config.baudRate}
                onChange={(e) => setConfig({ ...config, baudRate: parseInt(e.target.value) })}
                disabled={isConnected}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
              >
                <option value={1200}>1200</option>
                <option value={2400}>2400</option>
                <option value={4800}>4800</option>
                <option value={9600}>9600</option>
                <option value={19200}>19200</option>
                <option value={38400}>38400</option>
                <option value={57600}>57600</option>
                <option value={115200}>115200</option>
              </select>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Data Bits
                </label>
                <select
                  value={config.dataBits}
                  onChange={(e) => setConfig({ ...config, dataBits: parseInt(e.target.value) as 7 | 8 })}
                  disabled={isConnected}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
                >
                  <option value={7}>7</option>
                  <option value={8}>8</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Stop Bits
                </label>
                <select
                  value={config.stopBits}
                  onChange={(e) => setConfig({ ...config, stopBits: parseInt(e.target.value) as 1 | 2 })}
                  disabled={isConnected}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Parity
                </label>
                <select
                  value={config.parity}
                  onChange={(e) => setConfig({ ...config, parity: e.target.value as 'none' | 'even' | 'odd' })}
                  disabled={isConnected}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
                >
                  <option value="none">None</option>
                  <option value="even">Even</option>
                  <option value="odd">Odd</option>
                </select>
              </div>
            </div>

            <div className="pt-4">
              {isConnected ? (
                <button
                  onClick={handleDisconnect}
                  disabled={isLoading}
                  className="w-full bg-red-600 text-white py-2 px-4 rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  Disconnect
                </button>
              ) : (
                <button
                  onClick={handleConnect}
                  disabled={isLoading || !config.path}
                  className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {isLoading ? 'Connecting...' : 'Connect'}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center gap-2 mb-6">
            <Play className="w-5 h-5 text-gray-600" />
            <h2 className="text-lg font-semibold text-gray-900">Weight Simulator</h2>
          </div>

          <p className="text-sm text-gray-600 mb-4">
            Use this simulator for testing without a physical scale. Enter a weight value and click simulate to send it to the weighing interface.
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Weight (kg)
              </label>
              <input
                type="number"
                value={simulatorWeight}
                onChange={(e) => setSimulatorWeight(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="1000"
                step="0.01"
              />
            </div>

            <button
              onClick={handleSimulate}
              className="w-full bg-green-600 text-white py-2 px-4 rounded-lg hover:bg-green-700"
            >
              Simulate Weight
            </button>

            <div className="pt-4 border-t border-gray-200">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Quick Test Values</h3>
              <div className="grid grid-cols-3 gap-2">
                {[500, 1000, 2000, 5000, 10000, 15000].map((weight) => (
                  <button
                    key={weight}
                    onClick={() => {
                      setSimulatorWeight(weight.toString());
                      simulateWeight(weight);
                    }}
                    className="px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm"
                  >
                    {weight} kg
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
