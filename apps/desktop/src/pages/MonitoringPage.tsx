import { useEffect, useState } from 'react';
import { Activity, RefreshCcw, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useSerialPort } from '@weighbridge/shared';
import { apiClient } from '@weighbridge/shared/lib/apiClient';

type HealthState = {
  ok: boolean;
  message: string;
  checkedAt: string;
};

export default function MonitoringPage() {
  const { ports, isConnected, error: serialError, isLoading, listPorts } = useSerialPort();

  const [backend, setBackend] = useState<HealthState>({
    ok: false,
    message: 'Not checked yet',
    checkedAt: '',
  });

  async function checkBackend() {
    try {
      // Authenticated "ping" that matches your current setup.
      const resp = await apiClient.getCurrentUser();

      const ok = !!resp?.data?.user;
      setBackend({
        ok,
        message: ok ? 'Backend reachable (authenticated)' : 'Backend responded but no user returned',
        checkedAt: new Date().toLocaleTimeString(),
      });
    } catch (e: unknown) {
      setBackend({
        ok: false,
        message: e instanceof Error ? e.message : 'Backend check failed',
        checkedAt: new Date().toLocaleTimeString(),
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Scale / serial status */}
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="text-lg font-semibold text-gray-900 mb-2">Scale (Serial)</div>

          {serialError ? (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 p-3 rounded-lg">
              <AlertTriangle className="w-5 h-5 mt-0.5" />
              <div className="text-sm">{serialError}</div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className={`w-5 h-5 ${isConnected ? 'text-green-600' : 'text-gray-400'}`} />
              <span className="text-gray-800">{isConnected ? 'Connected' : 'Disconnected'}</span>
              <span className="text-gray-500">• Ports detected: {ports.length}</span>
            </div>
          )}

          <div className="mt-4 text-xs text-gray-500">
            Tip: Connect/disconnect the scale in Settings. This page is just visibility/health.
          </div>
        </div>

        {/* Backend status */}
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="text-lg font-semibold text-gray-900 mb-2">Backend</div>

          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className={`w-5 h-5 ${backend.ok ? 'text-green-600' : 'text-gray-400'}`} />
            <span className="text-gray-800">{backend.message}</span>
          </div>

          <div className="mt-2 text-xs text-gray-500">
            Last checked: {backend.checkedAt || '—'}
          </div>
        </div>
      </div>
    </div>
  );
}
