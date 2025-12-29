import { useEffect, useMemo, useState } from 'react';
import { Scale, Plug, PlugZap, RefreshCcw, AlertTriangle, Beaker, ClipboardCheck, FileText } from 'lucide-react';
import apiClient from '@weighbridge/shared/lib/apiClient';

type SerialPortInfo = {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  productId?: string;
  vendorId?: string;
};

type SerialConfig = {
  path: string;
  baudRate: number;
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  parity: 'none' | 'even' | 'odd';
};

type ListPortsResponse =
  | { success: true; ports: SerialPortInfo[] }
  | { success: false; error: string };

type BasicResponse =
  | { success: true }
  | { success: false; error: string };

type ElectronApi = {
  serial: {
    listPorts: () => Promise<ListPortsResponse>;
    connect: (config: SerialConfig) => Promise<BasicResponse>;
    disconnect: () => Promise<BasicResponse>;
    simulateWeight: (weight: number) => Promise<BasicResponse>;
    onWeightData: (cb: (weight: number) => void) => () => void;
    onError: (cb: (err: string) => void) => () => void;
  };
};

type Client = { id: string; company_name: string };
type Vehicle = { id: string; license_plate: string; vehicle_type: string; make?: string | null; model?: string | null };

type CreatedTx = { id: string; transaction_number: string; first_weight: number; status: string };
type CompleteResp = {
  transaction: any;
  invoice: any;
  pricing: { subtotal: number; total: number; breakdown: string };
};

const SERIAL_STORAGE_KEY = 'serialConfig';
const ACTIVE_TX_KEY = 'wb_active_tx_v1';
const QUEUE_KEY = 'wb_tx_queue_v1';

type QueueItem =
  | { id: string; kind: 'CREATE_TX'; createdAt: number; payload: any }
  | { id: string; kind: 'COMPLETE_TX'; createdAt: number; txId: string; payload: { second_weight: number } };

type StoredActive = {
  tx: CreatedTx;
  clientId: string;
  vehicleId: string;
  txType: 'inbound' | 'outbound';
  materialType: string;
  referenceNumber: string;
  notes: string;
  requestId: string; // idempotency for CREATE_TX
  createdAt: number;
};

function getElectronApi(): ElectronApi | null {
  const w = window as unknown as { electron?: ElectronApi };
  return w?.electron?.serial ? (w.electron as ElectronApi) : null;
}

function safeParseSerialConfig(raw: string | null): SerialConfig | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    const cfg: SerialConfig = {
      path: typeof v?.path === 'string' ? v.path : '',
      baudRate: Number.isFinite(Number(v?.baudRate)) ? Number(v.baudRate) : 9600,
      dataBits: v?.dataBits === 7 ? 7 : 8,
      stopBits: v?.stopBits === 2 ? 2 : 1,
      parity: v?.parity === 'even' ? 'even' : v?.parity === 'odd' ? 'odd' : 'none',
    };
    return cfg;
  } catch {
    return null;
  }
}

function fmtWeight(n: number | null) {
  if (n === null) return '—';
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(2)} kg`;
}

function uuidLike() {
  // crypto.randomUUID is best in modern browsers/electron
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (globalThis as any)?.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadQueue(): QueueItem[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueueItem[]) : [];
  } catch {
    return [];
  }
}

function saveQueue(q: QueueItem[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    // ignore
  }
}

function enqueue(item: QueueItem) {
  const q = loadQueue();
  if (q.some((x) => x.id === item.id && x.kind === item.kind)) return;
  q.push(item);
  q.sort((a, b) => a.createdAt - b.createdAt);
  saveQueue(q);
}

function removeFromQueue(item: QueueItem) {
  const q = loadQueue().filter((x) => !(x.id === item.id && x.kind === item.kind));
  saveQueue(q);
}

function saveActive(active: StoredActive | null) {
  try {
    if (!active) localStorage.removeItem(ACTIVE_TX_KEY);
    else localStorage.setItem(ACTIVE_TX_KEY, JSON.stringify(active));
  } catch {
    // ignore
  }
}

function loadActive(): StoredActive | null {
  try {
    const raw = localStorage.getItem(ACTIVE_TX_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v?.tx?.id) return null;
    return v as StoredActive;
  } catch {
    return null;
  }
}

// unwrap {success,data} nesting safely
function unwrapData(resp: any) {
  let cur = resp;
  for (let i = 0; i < 3; i++) {
    if (cur?.success === false) throw new Error(cur.error || cur.message || 'Request failed');
    if (cur && typeof cur === 'object' && 'data' in cur) cur = cur.data;
    else break;
  }
  return cur;
}

export default function WeighingPage() {
  const electron = useMemo(() => getElectronApi(), []);

  // ---- Serial state ----
  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [loadingPorts, setLoadingPorts] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string>('');
  const [lastWeight, setLastWeight] = useState<number | null>(null);
  const [lastUpdateAt, setLastUpdateAt] = useState<string>('');
  const [lastUpdateMs, setLastUpdateMs] = useState<number>(0);

  const [config, setConfig] = useState<SerialConfig>(() => {
    const saved = safeParseSerialConfig(localStorage.getItem(SERIAL_STORAGE_KEY));
    return (
      saved ?? {
        path: '',
        baudRate: 9600,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
      }
    );
  });

  const [simulateValue, setSimulateValue] = useState('123.45');

  const isStale = useMemo(() => {
    if (!connected) return false;
    if (!lastUpdateMs) return true;
    return Date.now() - lastUpdateMs > 5000;
  }, [connected, lastUpdateMs]);

  // ---- Workflow state ----
  const [clients, setClients] = useState<Client[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loadingClients, setLoadingClients] = useState(false);
  const [loadingVehicles, setLoadingVehicles] = useState(false);

  const [clientId, setClientId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [txType, setTxType] = useState<'inbound' | 'outbound'>('inbound');

  const [materialType, setMaterialType] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [notes, setNotes] = useState('');

  const [creatingTx, setCreatingTx] = useState(false);
  const [completingTx, setCompletingTx] = useState(false);

  const [activeTx, setActiveTx] = useState<CreatedTx | null>(null);
  const [completed, setCompleted] = useState<CompleteResp | null>(null);

  // Queue / sync state
  const [queueCount, setQueueCount] = useState<number>(() => loadQueue().length);
  const [syncing, setSyncing] = useState(false);

  async function loadClients() {
    setLoadingClients(true);
    setError('');
    try {
      const r = await apiClient.get('/api/clients?limit=200');
      const data = unwrapData(r);
      const arr = Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows : [];
      setClients(arr as Client[]);
    } catch (e: any) {
      setError(e?.message || 'Failed to load clients');
      setClients([]);
    } finally {
      setLoadingClients(false);
    }
  }

  async function loadVehicles(forClientId: string) {
    if (!forClientId) {
      setVehicles([]);
      return;
    }

    setLoadingVehicles(true);
    setError('');
    try {
      const r = await apiClient.get(`/api/vehicles?client_id=${encodeURIComponent(forClientId)}&limit=200`);
      const data = unwrapData(r);
      const arr = Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows : [];
      setVehicles(arr as Vehicle[]);
    } catch (e: any) {
      setError(e?.message || 'Failed to load vehicles');
      setVehicles([]);
    } finally {
      setLoadingVehicles(false);
    }
  }

  // ----- Serial controls -----
  async function refreshPorts() {
    if (!electron) {
      setError('Serial features are available only inside the Electron desktop app.');
      return;
    }

    setError('');
    setLoadingPorts(true);

    try {
      const resp = await electron.serial.listPorts();

      if (!resp.success) {
        setPorts([]);
        setError(resp.error || 'Failed to list ports');
        return;
      }

      const list = resp.ports || [];
      setPorts(list);

      const stillExists = !!config.path && list.some((p) => p.path === config.path);
      if (!stillExists && list.length > 0) {
        setConfig((c) => ({ ...c, path: list[0].path }));
      }
    } catch (e: unknown) {
      setPorts([]);
      setError(e instanceof Error ? e.message : 'Failed to list ports');
    } finally {
      setLoadingPorts(false);
    }
  }

  async function connectPort() {
    if (!electron) {
      setError('Serial features are available only inside the Electron desktop app.');
      return;
    }
    if (!config.path) {
      setError('Select a serial port first.');
      return;
    }
    if (!Number.isFinite(config.baudRate) || config.baudRate <= 0) {
      setError('Baud rate must be a valid positive number.');
      return;
    }

    setError('');
    setConnecting(true);

    try {
      const resp = await electron.serial.connect(config);

      if (!resp.success) {
        setConnected(false);
        setError(resp.error || 'Failed to connect');
        return;
      }

      localStorage.setItem(SERIAL_STORAGE_KEY, JSON.stringify(config));
      setConnected(true);
      setLastUpdateAt('');
      setLastUpdateMs(0);
    } catch (e: unknown) {
      setConnected(false);
      setError(e instanceof Error ? e.message : 'Failed to connect');
    } finally {
      setConnecting(false);
    }
  }

  async function disconnectPort() {
    if (!electron) return;

    setError('');
    try {
      const resp = await electron.serial.disconnect();
      if (!resp.success) {
        setError(resp.error || 'Failed to disconnect');
        return;
      }
      setConnected(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to disconnect');
    }
  }

  async function simulate() {
    if (!electron) {
      setError('Serial features are available only inside the Electron desktop app.');
      return;
    }

    const n = parseFloat(simulateValue);
    if (!Number.isFinite(n)) {
      setError('Simulation weight must be a valid number.');
      return;
    }

    setError('');
    try {
      const resp = await electron.serial.simulateWeight(n);
      if (!resp.success) setError(resp.error || 'Failed to simulate weight');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to simulate weight');
    }
  }

  // ----- Queue sync (the real Step2) -----
  async function flushQueue() {
    if (syncing) return;
    const q = loadQueue();
    if (q.length === 0) return;

    setSyncing(true);
    try {
      // If we already have an active tx, drop any queued CREATE_TX (it’s redundant)
      if (activeTx) {
        const filtered = q.filter((x) => x.kind !== 'CREATE_TX');
        saveQueue(filtered);
      }

      for (const item of loadQueue()) {
        try {
          if (item.kind === 'CREATE_TX') {
            // If app already has active tx now, skip
            if (activeTx) {
              removeFromQueue(item);
              continue;
            }

            const r = await apiClient.post('/api/transactions', item.payload, {
              headers: { 'Idempotency-Key': item.id },
            });

            const tx = unwrapData(r);
            if (!tx?.id) throw new Error('Transaction created but missing id');

            const created: CreatedTx = {
              id: String(tx.id),
              transaction_number: String(tx.transaction_number || ''),
              first_weight: Number(tx.first_weight ?? item.payload.first_weight ?? 0),
              status: String(tx.status || 'pending'),
            };

            setActiveTx(created);

            // Restore selection fields from payload
            setClientId(String(item.payload.client_id || ''));
            setVehicleId(String(item.payload.vehicle_id || ''));
            setTxType((item.payload.transaction_type === 'outbound' ? 'outbound' : 'inbound') as any);
            setMaterialType(String(item.payload.material_type || ''));
            setReferenceNumber(String(item.payload.reference_number || ''));
            setNotes(String(item.payload.notes || ''));

            saveActive({
              tx: created,
              clientId: String(item.payload.client_id || ''),
              vehicleId: String(item.payload.vehicle_id || ''),
              txType: (item.payload.transaction_type === 'outbound' ? 'outbound' : 'inbound') as any,
              materialType: String(item.payload.material_type || ''),
              referenceNumber: String(item.payload.reference_number || ''),
              notes: String(item.payload.notes || ''),
              requestId: item.id,
              createdAt: Date.now(),
            });

            removeFromQueue(item);
          }

          if (item.kind === 'COMPLETE_TX') {
            const r = await apiClient.patch(`/api/transactions/${item.txId}/complete`, item.payload, {
              headers: { 'Idempotency-Key': item.id },
            });

            const data = unwrapData(r);
            if (!data?.invoice?.id) throw new Error('Completed but invoice was not returned');

            setCompleted(data as CompleteResp);
            setActiveTx(null);
            saveActive(null);

            removeFromQueue(item);
          }
        } catch {
          // Stop at first failure; keep remaining items for next sync
          break;
        }
      }
    } finally {
      setQueueCount(loadQueue().length);
      setSyncing(false);
    }
  }

  // ----- Weighing workflow actions -----
  const canRecordFirst =
    !!clientId && !!vehicleId && connected && !isStale && lastWeight !== null && !activeTx && !creatingTx;

  const canRecordSecond =
    !!activeTx && connected && !isStale && lastWeight !== null && !completingTx;

  async function recordFirstWeight() {
    if (!canRecordFirst) return;

    setCreatingTx(true);
    setError('');
    setCompleted(null);

    const requestId = uuidLike();
    const body = {
      client_id: clientId,
      vehicle_id: vehicleId,
      transaction_type: txType,
      first_weight: lastWeight,
      material_type: materialType || '',
      reference_number: referenceNumber || '',
      notes: notes || '',
      idempotency_key: requestId, // body fallback
    };

    try {
      const r = await apiClient.post('/api/transactions', body, {
        headers: { 'Idempotency-Key': requestId },
      });

      const tx = unwrapData(r);
      if (!tx?.id) throw new Error('Transaction created but missing id');

      const created: CreatedTx = {
        id: String(tx.id),
        transaction_number: String(tx.transaction_number || ''),
        first_weight: Number(tx.first_weight ?? lastWeight ?? 0),
        status: String(tx.status || 'pending'),
      };

      setActiveTx(created);
      saveActive({
        tx: created,
        clientId,
        vehicleId,
        txType,
        materialType,
        referenceNumber,
        notes,
        requestId,
        createdAt: Date.now(),
      });
    } catch (e: any) {
      // ✅ If network/timeout: queue it (this is Step2)
      enqueue({ id: requestId, kind: 'CREATE_TX', createdAt: Date.now(), payload: body });
      setQueueCount(loadQueue().length);
      setError(`Backend not reachable. Saved locally and queued for sync (${loadQueue().length}).`);
    } finally {
      setCreatingTx(false);
    }
  }

  async function recordSecondWeightAndInvoice() {
    if (!canRecordSecond || !activeTx) return;

    setCompletingTx(true);
    setError('');

    const requestId = uuidLike();
    const payload = { second_weight: lastWeight };

    try {
      const r = await apiClient.patch(`/api/transactions/${activeTx.id}/complete`, payload, {
        headers: { 'Idempotency-Key': requestId },
      });

      const data = unwrapData(r);
      if (!data?.invoice?.id) throw new Error('Completed but invoice was not returned');

      setCompleted(data as CompleteResp);
      setActiveTx(null);
      saveActive(null);
    } catch (e: any) {
      // ✅ queue completion; Step1 makes /complete safe to retry
      enqueue({ id: requestId, kind: 'COMPLETE_TX', createdAt: Date.now(), txId: activeTx.id, payload });
      setQueueCount(loadQueue().length);
      setError(`Could not reach backend. Completion queued for sync (${loadQueue().length}).`);
    } finally {
      setCompletingTx(false);
    }
  }

  async function downloadInvoicePdf(invoiceId: string, invoiceNumber?: string) {
    setError('');
    try {
      const r = await apiClient.getBlob(`/api/invoices/${invoiceId}/pdf`);
      if ((r as any).success === false) {
        setError((r as any).error || 'Failed to download PDF');
        return;
      }
      const blob = (r as any).data as Blob;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${invoiceNumber || 'invoice'}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message || 'Failed to download PDF');
    }
  }

  function resetForNextVehicle() {
    setActiveTx(null);
    setCompleted(null);
    setMaterialType('');
    setReferenceNumber('');
    setNotes('');
    saveActive(null);
  }

  // ----- Effects -----
  useEffect(() => {
    void loadClients();

    // Restore active transaction (survive restart/power cut)
    const st = loadActive();
    if (st?.tx?.id) {
      setActiveTx(st.tx);
      setClientId(st.clientId);
      setVehicleId(st.vehicleId);
      setTxType(st.txType);
      setMaterialType(st.materialType);
      setReferenceNumber(st.referenceNumber);
      setNotes(st.notes);
    }

    // Try to sync immediately on startup
    setQueueCount(loadQueue().length);
    void flushQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setVehicleId('');
    setVehicles([]);
    if (clientId) void loadVehicles(clientId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  useEffect(() => {
    if (!electron) return;

    let mounted = true;

    const offWeight = electron.serial.onWeightData((w) => {
      if (!mounted) return;
      setLastWeight(w);
      setLastUpdateAt(new Date().toLocaleTimeString());
      setLastUpdateMs(Date.now());
    });

    const offErr = electron.serial.onError((msg) => {
      if (!mounted) return;
      setError(msg || 'Serial error');
      setConnected(false);
    });

    void refreshPorts();

    return () => {
      mounted = false;
      offWeight?.();
      offErr?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [electron]);

  // Auto-sync queue (lightweight)
  useEffect(() => {
    const t = setInterval(() => {
      if (loadQueue().length > 0) void flushQueue();
    }, 8000);

    const onOnline = () => void flushQueue();
    window.addEventListener('online', onOnline);

    return () => {
      clearInterval(t);
      window.removeEventListener('online', onOnline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTx, syncing]);

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <Scale className="w-8 h-8 text-blue-600" />
        <h1 className="text-3xl font-bold text-gray-900">Weighing</h1>
      </div>

      {!electron && (
        <div className="mb-6 bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-lg text-sm">
          This screen requires the Electron desktop runtime (preload bridge not found).
        </div>
      )}

      {queueCount > 0 && (
        <div className="mb-6 bg-blue-50 border border-blue-200 text-blue-900 px-4 py-3 rounded-lg text-sm flex items-center justify-between gap-3">
          <div>
            Pending sync actions: <span className="font-semibold">{queueCount}</span>
            {syncing ? <span className="ml-2 opacity-80">(syncing...)</span> : null}
          </div>
          <button
            type="button"
            onClick={() => void flushQueue()}
            className="px-3 py-2 rounded-lg border border-blue-300 bg-white hover:bg-blue-50 text-blue-900"
            disabled={syncing}
          >
            Sync now
          </button>
        </div>
      )}

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 mt-0.5" />
          <div className="text-sm">{error}</div>
        </div>
      )}

      {/* Boss workflow */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Record transaction</h2>
          {activeTx ? (
            <span className="text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-800">
              Active: {activeTx.transaction_number}
            </span>
          ) : (
            <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-700">
              No active transaction
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Client</label>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              disabled={loadingClients || !!activeTx}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white disabled:bg-gray-50"
            >
              <option value="">{loadingClients ? 'Loading...' : 'Select client'}</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.company_name}</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">Operators see only their branch clients.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Vehicle</label>
            <select
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              disabled={!clientId || loadingVehicles || !!activeTx}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white disabled:bg-gray-50"
            >
              <option value="">{loadingVehicles ? 'Loading...' : 'Select vehicle'}</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.license_plate} — {v.vehicle_type}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">Vehicles are filtered by selected client.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Transaction type</label>
            <select
              value={txType}
              onChange={(e) => setTxType(e.target.value as any)}
              disabled={!!activeTx}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white disabled:bg-gray-50"
            >
              <option value="inbound">inbound</option>
              <option value="outbound">outbound</option>
            </select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Material</label>
              <input
                value={materialType}
                onChange={(e) => setMaterialType(e.target.value)}
                disabled={!!completed}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-50"
                placeholder="e.g. sand"
              />
            </div>
            <div className="col-span-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Reference</label>
              <input
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                disabled={!!completed}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-50"
                placeholder="PO / Truck ref"
              />
            </div>
            <div className="col-span-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={!!completed}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-50"
                placeholder="optional"
              />
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 items-center">
          <div className="text-sm text-gray-700 mr-2">
            Current weight: <span className="font-semibold">{fmtWeight(lastWeight)}</span>
          </div>

          {!activeTx ? (
            <button
              type="button"
              onClick={() => void recordFirstWeight()}
              disabled={!canRecordFirst}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <ClipboardCheck className="w-4 h-4" />
              {creatingTx ? 'Recording...' : 'Record FIRST weight (Gross)'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void recordSecondWeightAndInvoice()}
              disabled={!canRecordSecond}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
            >
              <FileText className="w-4 h-4" />
              {completingTx ? 'Completing...' : 'Record SECOND weight (Tare) + Create Invoice'}
            </button>
          )}

          {completed?.invoice?.id && (
            <>
              <button
                type="button"
                onClick={() => void downloadInvoicePdf(completed.invoice.id, completed.invoice.invoice_number)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-800"
              >
                <FileText className="w-4 h-4" />
                Download invoice PDF
              </button>

              <button
                type="button"
                onClick={() => resetForNextVehicle()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-800"
              >
                New transaction
              </button>
            </>
          )}

          {connected && (
            <span className={`ml-auto px-2 py-0.5 rounded-full text-xs font-medium ${isStale ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-700'}`}>
              {isStale ? 'No recent readings' : 'Receiving data'}
            </span>
          )}
        </div>

        {completed && (
          <div className="mt-5 bg-gray-50 border border-gray-200 rounded-lg p-4">
            <div className="text-sm text-gray-900 font-semibold">Completed</div>
            <div className="text-sm text-gray-700 mt-1">
              Invoice: <span className="font-medium">{completed.invoice.invoice_number}</span> — Total:{' '}
              <span className="font-medium">{Number(completed.pricing?.total ?? 0).toFixed(2)}</span>
            </div>
            <div className="text-xs text-gray-600 mt-1">{completed.pricing?.breakdown}</div>
          </div>
        )}
      </div>

      {/* Live weight + Serial connection UI */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-gray-500">Live weight</div>
            <div className="mt-2 text-4xl font-bold text-gray-900">{fmtWeight(lastWeight)}</div>
            <div className="mt-2 text-sm text-gray-500">Last update: {lastUpdateAt || '—'}</div>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`px-3 py-1 rounded-full text-xs font-medium ${
                connected ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'
              }`}
            >
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Scale connection</h2>
          <button
            type="button"
            onClick={() => void refreshPorts()}
            disabled={loadingPorts || !electron}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-800 disabled:opacity-50"
          >
            <RefreshCcw className="w-4 h-4" />
            {loadingPorts ? 'Refreshing...' : 'Refresh ports'}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Serial port</label>
            <select
              value={config.path}
              onChange={(e) => setConfig((c) => ({ ...c, path: e.target.value }))}
              disabled={connected || !electron}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white disabled:bg-gray-50"
            >
              <option value="">Select a port</option>
              {ports.map((p) => (
                <option key={p.path} value={p.path}>
                  {p.path} {p.manufacturer ? `— ${p.manufacturer}` : ''}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">If no ports appear, check USB connection and drivers.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Baud rate</label>
              <input
                type="number"
                value={config.baudRate}
                onChange={(e) => setConfig((c) => ({ ...c, baudRate: Number(e.target.value) }))}
                disabled={connected || !electron}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-50"
                min={1}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Parity</label>
              <select
                value={config.parity}
                onChange={(e) => setConfig((c) => ({ ...c, parity: e.target.value as SerialConfig['parity'] }))}
                disabled={connected || !electron}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white disabled:bg-gray-50"
              >
                <option value="none">none</option>
                <option value="even">even</option>
                <option value="odd">odd</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Data bits</label>
              <select
                value={config.dataBits}
                onChange={(e) => setConfig((c) => ({ ...c, dataBits: Number(e.target.value) as 7 | 8 }))}
                disabled={connected || !electron}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white disabled:bg-gray-50"
              >
                <option value={7}>7</option>
                <option value={8}>8</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Stop bits</label>
              <select
                value={config.stopBits}
                onChange={(e) => setConfig((c) => ({ ...c, stopBits: Number(e.target.value) as 1 | 2 }))}
                disabled={connected || !electron}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white disabled:bg-gray-50"
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
              </select>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-5">
          {!connected ? (
            <button
              type="button"
              onClick={() => void connectPort()}
              disabled={connecting || !electron}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <PlugZap className="w-4 h-4" />
              {connecting ? 'Connecting...' : 'Connect'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void disconnectPort()}
              disabled={!electron}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-800 disabled:opacity-50"
            >
              <Plug className="w-4 h-4" />
              Disconnect
            </button>
          )}

          <div className="flex items-center gap-2 ml-auto">
            <Beaker className="w-4 h-4 text-gray-500" />
            <input
              type="text"
              value={simulateValue}
              onChange={(e) => setSimulateValue(e.target.value)}
              className="w-28 px-3 py-2 border border-gray-300 rounded-lg"
              placeholder="123.45"
            />
            <button
              type="button"
              onClick={() => void simulate()}
              disabled={!electron}
              className="px-3 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-800 disabled:opacity-50"
            >
              Simulate
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
