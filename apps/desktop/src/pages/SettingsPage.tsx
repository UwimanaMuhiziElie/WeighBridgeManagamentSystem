import { useEffect, useMemo, useState } from 'react';
import { Settings as SettingsIcon, RefreshCw, AlertCircle, CheckCircle, Play } from 'lucide-react';
import { useSerialPort, type SerialConfig } from '@weighbridge/shared';
import ApiServerSettings from '../components/ApiServerSettings'; 

const STORAGE_KEY = 'serialConfig';

function isProdBuild(): boolean {
  try {
    const env = (import.meta as any)?.env;
    if (typeof env?.PROD === 'boolean') return env.PROD;
    const mode = String(env?.MODE || '').toLowerCase();
    return mode === 'production';
  } catch {
    return false;
  }
}

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {}
  return null;
}

function safeParseSerialConfig(raw: string | null): SerialConfig | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);

    return {
      path: typeof v?.path === 'string' ? v.path : '',
      baudRate: Number.isFinite(Number(v?.baudRate)) ? Number(v.baudRate) : 9600,
      dataBits: v?.dataBits === 7 ? 7 : 8,
      stopBits: v?.stopBits === 2 ? 2 : 1,
      parity: v?.parity === 'even' ? 'even' : v?.parity === 'odd' ? 'odd' : 'none',

      // keep poll fields if present
      mode: v?.mode === 'stream' ? 'stream' : 'poll',
      requestCommand: typeof v?.requestCommand === 'string' ? v.requestCommand : 'P\r\n',
      pollIntervalMs: Number.isFinite(Number(v?.pollIntervalMs)) ? Math.max(200, Number(v.pollIntervalMs)) : 1000,
      responseWaitMs: Number.isFinite(Number(v?.responseWaitMs)) ? Math.max(50, Number(v.responseWaitMs)) : 300,
      encoding: typeof v?.encoding === 'string' ? v.encoding : 'ascii',
      xon: !!v?.xon,
      xoff: !!v?.xoff,
      rtscts: !!v?.rtscts,
    };
  } catch {
    return null;
  }
}

function fmtWeight(n: number | null | undefined) {
  if (n == null) return '—';
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  return `${x.toFixed(2)} kg`;
}

function clipRaw(raw: string, max = 700) {
  const s = String(raw ?? '');
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

// Windows COM10+ normalization (use for opening, NOT for dropdown storage)
function normalizeComPath(pathStr: string): string {
  const p = String(pathStr || '').trim();
  const m = p.match(/^COM(\d+)$/i);
  if (!m) return p;
  const n = Number(m[1]);
  if (Number.isFinite(n) && n >= 10) return `\\\\.\\COM${n}`;
  return p;
}

// Show a safe “escaped” view in input (so real CR/LF don’t break the input box)
function toEscapedView(s: string): string {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
}

// Convert user-typed escapes to real control chars before sending to serial
function fromEscapedView(s: string): string {
  return String(s ?? '')
    .replace(/\\\\/g, '\\') // unescape backslashes first
    .replace(/\\r/g, '\r')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t');
}

export default function SettingsPage() {
  const storage = safeLocalStorage();
  const simAllowed = useMemo(() => !isProdBuild(), []);

  const serial = useSerialPort();

  const ports = serial?.ports ?? [];
  const isConnected = !!serial?.isConnected;
  const serialError = serial?.error ?? '';
  const isLoading = !!serial?.isLoading;
  const hasElectron = !!serial?.hasElectron;

  const listPorts = serial?.listPorts;
  const connect = serial?.connect;
  const disconnect = serial?.disconnect;
  const simulateWeight = serial?.simulateWeight;

  // new (from updated hook)
  const testRead = serial?.testRead; // (opts) => { success, raw, weight }
  const lastRaw = serial?.lastRaw as string | null | undefined;
  const currentWeight = serial?.currentWeight as number | null | undefined;

  const [uiError, setUiError] = useState('');
  const error = uiError || serialError || '';

  const [config, setConfig] = useState<SerialConfig>(() => {
    const saved = safeParseSerialConfig(storage?.getItem(STORAGE_KEY) ?? null);
    return (
      saved ?? {
        path: '',
        baudRate: 9600,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',

        mode: 'poll',
        requestCommand: 'P\r\n',
        pollIntervalMs: 1000,
        responseWaitMs: 300,
        encoding: 'ascii',
        xon: false,
        xoff: false,
        rtscts: false,
      }
    );
  });

  // request command input uses escaped text
  const [requestCmdText, setRequestCmdText] = useState(() => toEscapedView(config.requestCommand ?? 'P\r\n'));
  useEffect(() => {
    // keep in sync when config loads/changes externally
    setRequestCmdText(toEscapedView(config.requestCommand ?? 'P\r\n'));
  }, [config.requestCommand]);

  const [simulatorWeight, setSimulatorWeight] = useState('1000');

  // Test Read state
  const [testLoading, setTestLoading] = useState(false);
  const [testAt, setTestAt] = useState<string>('');
  const [testRaw, setTestRaw] = useState<string>('');
  const [testWeight, setTestWeight] = useState<number | null>(null);

  async function refreshPorts() {
    setUiError('');
    await listPorts?.();
  }

  async function handleConnect() {
    if (!hasElectron) return setUiError('Serial features are available only inside the Electron desktop app.');
    if (!config.path) return setUiError('Select a serial port first.');
    if (!Number.isFinite(config.baudRate) || config.baudRate <= 0) {
      return setUiError('Baud rate must be a valid positive number.');
    }

    setUiError('');

    const requestCommandReal = fromEscapedView(requestCmdText || 'P\\r\\n');

    // connect using normalized path (COM10+), but store raw path for dropdown matching
    const cfgForConnect: SerialConfig = {
      ...config,
      path: normalizeComPath(config.path),

      mode: 'poll',
      requestCommand: requestCommandReal,
      pollIntervalMs: config.pollIntervalMs ?? 1000,
      responseWaitMs: config.responseWaitMs ?? 300,
      encoding: config.encoding ?? 'ascii',

      xon: false,
      xoff: false,
      rtscts: false,
    };

    const ok = await connect?.(cfgForConnect);
    if (ok) {
      const cfgForStorage: SerialConfig = {
        ...cfgForConnect,
        path: config.path, // store raw selection
      };
      storage?.setItem(STORAGE_KEY, JSON.stringify(cfgForStorage));
    }
  }

  async function handleDisconnect() {
    setUiError('');
    await disconnect?.();
    setTestAt('');
    setTestRaw('');
    setTestWeight(null);
  }

  async function handleSimulate() {
    if (!hasElectron) return setUiError('Serial features are available only inside the Electron desktop app.');
    if (!simAllowed) return setUiError('Weight simulator is disabled in production builds.');
    if (isConnected) return setUiError('Disconnect the serial port to use simulation.');

    const weight = parseFloat(simulatorWeight);
    if (!Number.isFinite(weight)) return setUiError('Simulation weight must be a valid number.');

    setUiError('');
    await simulateWeight?.(weight);
  }

  async function handleTestRead() {
    if (!hasElectron) return setUiError('Serial features are available only inside the Electron desktop app.');
    if (!isConnected) return setUiError('Connect to the serial port first.');
    if (typeof testRead !== 'function') {
      return setUiError('Test Read is not available. Please ensure Electron preload/main were updated (serial:test-read).');
    }

    setUiError('');
    setTestLoading(true);

    try {
      const r = await testRead({
        requestCommand: fromEscapedView(requestCmdText || 'P\\r\\n'),
        responseWaitMs: config.responseWaitMs ?? 300,
        encoding: config.encoding ?? 'ascii',
      });

      if (!r?.success) {
        setUiError(r?.error || 'Test Read failed.');
        setTestAt(new Date().toLocaleTimeString());
        setTestRaw('');
        setTestWeight(null);
        return;
      }

      setTestAt(new Date().toLocaleTimeString());
      setTestRaw(String(r.raw ?? ''));
      setTestWeight(typeof r.weight === 'number' && Number.isFinite(r.weight) ? r.weight : null);
    } catch (e: any) {
      setUiError(e?.message || 'Test Read failed.');
    } finally {
      setTestLoading(false);
    }
  }

  useEffect(() => {
    void refreshPorts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // default selection (still compares against raw port.path)
  useEffect(() => {
    if (isConnected) return;
    if (!ports?.length) return;
    if (config.path && ports.some((p: any) => p.path === config.path)) return;
    setConfig((c) => ({ ...c, path: ports[0].path }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ports, isConnected]);

  const simulatorEnabled = !!hasElectron && simAllowed && !isConnected;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

      {!hasElectron && (
        <div className="mb-6 bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-lg text-sm">
          This screen requires the Electron desktop runtime (preload bridge not found).
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <ApiServerSettings />
        </div>
        {/* Serial config */}
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
            {/* Port */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700">Serial Port</label>
                <button
                  type="button"
                  onClick={() => void refreshPorts()}
                  disabled={isLoading || !hasElectron}
                  className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1 disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>

              <select
                value={config.path}
                onChange={(e) => setConfig((c) => ({ ...c, path: e.target.value }))}
                disabled={isConnected || !hasElectron}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100"
              >
                <option value="">Select a port</option>
                {(ports || []).map((port: any) => (
                  <option key={port.path} value={port.path}>
                    {port.path}
                    {port.manufacturer && ` - ${port.manufacturer}`}
                  </option>
                ))}
              </select>
            </div>

            {/* Baud */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Baud Rate</label>
              <select
                value={config.baudRate}
                onChange={(e) => setConfig((c) => ({ ...c, baudRate: parseInt(e.target.value, 10) }))}
                disabled={isConnected || !hasElectron}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100"
              >
                {[1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200].map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            {/* Bits/parity */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Data Bits</label>
                <select
                  value={config.dataBits}
                  onChange={(e) => setConfig((c) => ({ ...c, dataBits: parseInt(e.target.value, 10) as 7 | 8 }))}
                  disabled={isConnected || !hasElectron}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100"
                >
                  <option value={7}>7</option>
                  <option value={8}>8</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Stop Bits</label>
                <select
                  value={config.stopBits}
                  onChange={(e) => setConfig((c) => ({ ...c, stopBits: parseInt(e.target.value, 10) as 1 | 2 }))}
                  disabled={isConnected || !hasElectron}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100"
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Parity</label>
                <select
                  value={config.parity}
                  onChange={(e) => setConfig((c) => ({ ...c, parity: e.target.value as SerialConfig['parity'] }))}
                  disabled={isConnected || !hasElectron}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100"
                >
                  <option value="none">None</option>
                  <option value="even">Even</option>
                  <option value="odd">Odd</option>
                </select>
              </div>
            </div>

            {/* Advanced (poll) */}
            <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
              <div className="text-sm font-medium text-gray-800 mb-2">Scale Poll Settings (PHP-compatible)</div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Request command</label>
                  <input
                    value={requestCmdText}
                    onChange={(e) => {
                      const next = e.target.value;
                      setRequestCmdText(next);
                      setConfig((c) => ({ ...c, requestCommand: fromEscapedView(next) }));
                    }}
                    disabled={isConnected || !hasElectron}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white disabled:bg-gray-100 font-mono text-sm"
                    placeholder="P\\r\\n"
                  />
                  <div className="text-[11px] text-gray-500 mt-1">
                    Use escaped form (recommended): <span className="font-mono">P\\r\\n</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Response wait (ms)</label>
                  <input
                    type="number"
                    value={config.responseWaitMs ?? 300}
                    onChange={(e) =>
                      setConfig((c) => ({ ...c, responseWaitMs: Math.max(50, Number(e.target.value || 0)) }))
                    }
                    disabled={isConnected || !hasElectron}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white disabled:bg-gray-100 text-sm"
                    min={50}
                    step={50}
                  />
                  <div className="text-[11px] text-gray-500 mt-1">Default: 300ms (matches PHP).</div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Poll interval (ms)</label>
                  <input
                    type="number"
                    value={config.pollIntervalMs ?? 1000}
                    onChange={(e) =>
                      setConfig((c) => ({ ...c, pollIntervalMs: Math.max(200, Number(e.target.value || 0)) }))
                    }
                    disabled={isConnected || !hasElectron}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white disabled:bg-gray-100 text-sm"
                    min={200}
                    step={100}
                  />
                  <div className="text-[11px] text-gray-500 mt-1">Default: 1000ms.</div>
                </div>
              </div>
            </div>

            {/* Connect/Disconnect */}
            <div className="pt-2">
              {isConnected ? (
                <button
                  type="button"
                  onClick={() => void handleDisconnect()}
                  disabled={isLoading || !hasElectron}
                  className="w-full bg-red-600 text-white py-2 px-4 rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  Disconnect
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleConnect()}
                  disabled={isLoading || !config.path || !hasElectron}
                  className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {isLoading ? 'Connecting...' : 'Connect'}
                </button>
              )}
            </div>

            {/* Test Read */}
            <div className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-gray-900">Test Read (Proof)</div>
                  <div className="text-xs text-gray-500">
                    Sends <span className="font-mono">{JSON.stringify(fromEscapedView(requestCmdText || 'P\\r\\n'))}</span>, waits{' '}
                    <span className="font-mono">{String(config.responseWaitMs ?? 300)}</span>ms, shows raw + parsed.
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => void handleTestRead()}
                  disabled={!hasElectron || !isConnected || testLoading}
                  className="px-3 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-800 disabled:opacity-50"
                >
                  {testLoading ? 'Testing…' : 'Test Read'}
                </button>
              </div>

              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                  <div className="text-xs text-gray-500">Parsed weight</div>
                  <div className="mt-1 text-lg font-bold text-gray-900">{fmtWeight(testWeight)}</div>
                  <div className="mt-1 text-[11px] text-gray-500">Last test: {testAt || '—'}</div>

                  <div className="mt-2 text-[11px] text-gray-500">
                    Live (last event): <span className="font-mono">{fmtWeight(currentWeight)}</span>
                  </div>
                </div>

                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                  <div className="text-xs text-gray-500">Raw response (truncated)</div>
                  <pre className="mt-1 text-[12px] leading-snug whitespace-pre-wrap font-mono text-gray-800 max-h-28 overflow-auto">
                    {clipRaw(testRaw || lastRaw || '') || '—'}
                  </pre>
                  <div className="text-[11px] text-gray-500 mt-1">
                    Tip: If raw is empty, scale may require different command or another app is holding the COM port.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Simulator (DEV ONLY) */}
        {simAllowed && (
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center gap-2 mb-6">
              <Play className="w-5 h-5 text-gray-600" />
              <h2 className="text-lg font-semibold text-gray-900">Weight Simulator (DEV ONLY)</h2>
            </div>

            <p className="text-sm text-gray-600 mb-4">This simulator is disabled in production builds.</p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Weight (kg)</label>
                <input
                  type="number"
                  value={simulatorWeight}
                  onChange={(e) => setSimulatorWeight(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  placeholder="1000"
                  step="0.01"
                />
              </div>

              <button
                type="button"
                onClick={() => void handleSimulate()}
                disabled={!simulatorEnabled}
                className="w-full bg-green-600 text-white py-2 px-4 rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                Simulate Weight
              </button>
            </div>
          </div>
        )}
      </div>

      {!simAllowed && <div className="mt-6 text-xs text-gray-500">Simulator hidden (production build).</div>}
    </div>
  );
}
