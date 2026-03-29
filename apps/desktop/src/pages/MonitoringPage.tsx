import { useEffect, useMemo, useState } from 'react';
import { Activity, RefreshCcw, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useSerialPort } from '@weighbridge/shared';
import { apiClient } from '@weighbridge/shared';

type HealthState = {
  ok: boolean;
  message: string;
  checkedAt: string;
};

function nowTime() {
  return new Date().toLocaleTimeString();
}

export default function MonitoringPage() {
  const {
    ports,
    isConnected,
    currentWeight,     // 
    lastRaw,           //  (if your hook exposes it)
    hasElectron,       // 
    error: serialError,
    isLoading,
    listPorts,
  } = useSerialPort();

  const [backend, setBackend] = useState<HealthState>({
    ok: false,
    message: 'Not checked yet',
    checkedAt: '',
  });

  const [lastWeightAtMs, setLastWeightAtMs] = useState<number>(0);

  useEffect(() => {
    if (typeof currentWeight === 'number' && Number.isFinite(currentWeight)) {
      setLastWeightAtMs(Date.now());
    }
  }, [currentWeight]);

  const weightStale = useMemo(() => {
    if (!isConnected) return false;
    if (!lastWeightAtMs) return true;
    return Date.now() - lastWeightAtMs > 5000;
  }, [isConnected, lastWeightAtMs]);

  async function checkBackend() {
    try {
      const health = await apiClient.get('/health');

      // NOTE: depends on your apiClient wrapper shape
      if (!health?.success) {
        setBackend({
          ok: false,
          message: health?.error || 'Backend not reachable',
          checkedAt: nowTime(),
        });
        return;
      }

      const resp = await apiClient.get('/api/invoices?limit=1');

      if (resp?.success) {
        setBackend({
          ok: true,
          message: 'Backend reachable (authorized)',
          checkedAt: nowTime(),
        });
        return;
      }

      const code = resp?.statusCode;
      const msg = resp?.error || 'Authorized check failed';

      setBackend({
        ok: false,
        message:
          code === 401
            ? 'Session expired (401). Please sign in again.'
            : code === 403
              ? 'Backend reachable but forbidden (403). Check operator permissions.'
              : `Backend reachable, but API check failed: ${msg}`,
        checkedAt: nowTime(),
      });
    } catch (e: unknown) {
      setBackend({
        ok: false,
        message: e instanceof Error ? e.message : 'Backend check failed',
        checkedAt: nowTime(),
      });
    }
  }

  async function refreshAll() {
    await Promise.allSettled([listPorts(), checkBackend()]);
  }

  useEffect(() => {
    void refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <Activity className="w-8 h-8 text-blue-600" />
          <h1 className="text-3xl font-bold text-gray-900">Monitoring</h1>
        </div>

        <button
          type="button"
          onClick={() => void refreshAll()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-800"
          disabled={isLoading}
        >
          <RefreshCcw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {!hasElectron && (
        <div className="mb-6 bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-lg text-sm">
          This screen requires the Electron desktop runtime (preload bridge not found).
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="text-lg font-semibold text-gray-900 mb-2">Scale (Serial)</div>

          {serialError ? (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 p-3 rounded-lg">
              <AlertTriangle className="w-5 h-5 mt-0.5" />
              <div className="text-sm">{serialError}</div>
            </div>
          ) : (
            <div className="text-sm text-gray-800 space-y-1">
              <div className="flex items-center gap-2">
                <CheckCircle2 className={`w-5 h-5 ${isConnected ? 'text-green-600' : 'text-gray-400'}`} />
                <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
                <span className="text-gray-500">• Ports detected: {ports.length}</span>
              </div>

              {isConnected && (
                <div className={`text-xs ${weightStale ? 'text-amber-700' : 'text-gray-500'}`}>
                  {weightStale ? 'Connected but no weight updates in the last 5s (likely command/config mismatch).' : 'Weight updates flowing.'}
                </div>
              )}

              {typeof currentWeight === 'number' && Number.isFinite(currentWeight) && (
                <div className="text-xs text-gray-600">Latest weight: {currentWeight.toFixed(2)} kg</div>
              )}

              {!!lastRaw && (
                <div className="text-xs text-gray-500">
                  Raw: <span className="font-mono">{String(lastRaw).slice(0, 80)}</span>
                </div>
              )}
            </div>
          )}

          <div className="mt-4 text-xs text-gray-500">
            Tip: Connect/disconnect the scale in Weighing/Settings. This page is visibility/health.
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="text-lg font-semibold text-gray-900 mb-2">Backend</div>

          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className={`w-5 h-5 ${backend.ok ? 'text-green-600' : 'text-gray-400'}`} />
            <span className="text-gray-800">{backend.message}</span>
          </div>

          <div className="mt-2 text-xs text-gray-500">Last checked: {backend.checkedAt || '—'}</div>
        </div>
      </div>
    </div>
  );
}
