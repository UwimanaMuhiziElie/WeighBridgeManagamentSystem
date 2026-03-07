import { useEffect, useMemo, useState } from 'react';
import { Scale, Plug, PlugZap, RefreshCcw, AlertTriangle, Beaker, ClipboardCheck, FileText } from 'lucide-react';
import { useSerialPort, type SerialConfig, type SerialPortInfo } from '@weighbridge/shared';
import apiClient from '@weighbridge/shared/lib/apiClient';

type Client = { id: string; company_name: string };

type CreatedTx = {
  id: string;
  transaction_number: string;
  first_weight: number;
  status: string;
  client_id?: string | null;
  vehicle_id?: string | null;
  assigned_truck_id?: number | null;
  truck_side_number?: string | null;
  walk_in_name?: string | null;
};

type CompleteResp = {
  transaction: any;
  invoice: any | null;
  pricing: { subtotal: number; total: number; breakdown: string };
};

const STORAGE_KEY = 'serialConfig';
const RESUME_KEY = 'weighing_resume_tx';

// Optional (if later you add a printer picker UI)
const PRINTER_KEY = 'receipt_printer_name';

// ---- Stability (production-safe) ----
function readNumberEnv(key: string, fallback: number) {
  try {
    const v = (import.meta as any)?.env?.[key];
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  } catch {}
  return fallback;
}

const STABLE_TOL_KG = readNumberEnv('VITE_STABLE_TOL_KG', 2); // ±2kg
const STABLE_MS = readNumberEnv('VITE_STABLE_MS', 2500); // 2.5s
const WINDOW_MS = Math.max(STABLE_MS + 600, 3500);

type Sample = { w: number; t: number };

/**
 * TEMP MODE (Team Lead request):
 * - Serial connect is temporarily disabled (keep it visible but not clickable)
 * - Manual entry ("Record weight") is enabled (even in prod builds)
 */
function isManualWeightAllowed(): boolean {
  return true;
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

    const mode = v?.mode === 'stream' ? 'stream' : 'poll';

    const cfg: SerialConfig = {
      path: typeof v?.path === 'string' ? v.path : '',

      baudRate: Number.isFinite(Number(v?.baudRate)) ? Number(v.baudRate) : 9600,
      dataBits: v?.dataBits === 7 ? 7 : 8,
      stopBits: v?.stopBits === 2 ? 2 : 1,
      parity: v?.parity === 'even' ? 'even' : v?.parity === 'odd' ? 'odd' : 'none',

      mode,
      requestCommand: typeof v?.requestCommand === 'string' ? v.requestCommand : 'P\r\n',
      pollIntervalMs: Number.isFinite(Number(v?.pollIntervalMs)) ? Math.max(200, Number(v.pollIntervalMs)) : 1000,
      responseWaitMs: Number.isFinite(Number(v?.responseWaitMs)) ? Math.max(50, Number(v.responseWaitMs)) : 300,
      encoding: typeof v?.encoding === 'string' ? v.encoding : 'ascii',

      xon: !!v?.xon,
      xoff: !!v?.xoff,
      rtscts: !!v?.rtscts,
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

function pickErrorMessage(resp: any): string | null {
  if (!resp) return 'Request failed';
  if (resp.error) return String(resp.error);
  if (resp.success === false && resp.message) return String(resp.message);
  if (resp.success === false) return 'Request failed';
  return null;
}

function unwrapArray<T>(resp: any): T[] {
  const root = resp?.data ?? resp;

  const arr = Array.isArray(root)
    ? root
    : Array.isArray(root?.data)
      ? root.data
      : Array.isArray(root?.rows)
        ? root.rows
        : [];

  return Array.isArray(arr) ? (arr as T[]) : [];
}

function buildStableSamples(weight: number, now: number): Sample[] {
  const step = 200;
  const start = now - STABLE_MS;
  const count = Math.max(4, Math.ceil(STABLE_MS / step) + 1);
  const out: Sample[] = [];

  for (let i = 0; i < count; i++) {
    const t = start + i * step;
    out.push({ w: weight, t });
  }

  return out.filter((s) => now - s.t <= WINDOW_MS);
}

function digitsOnly(s: string) {
  return s.replace(/[^\d]/g, '');
}

function wordCount(s: string) {
  const t = (s || '').trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

function normalizeComPath(pathStr: string): string {
  const p = String(pathStr || '').trim();
  const m = p.match(/^COM(\d+)$/i);
  if (!m) return p;
  const n = Number(m[1]);
  if (Number.isFinite(n) && n >= 10) return `\\\\.\\COM${n}`;
  return p;
}

function formatManualWeightInput(value: string): string {
  // remove commas/spaces and keep only digits + dot
  const v = String(value || '').replace(/,/g, '').replace(/[^\d.]/g, '');
  if (!v) return '';

  // keep only the first dot
  const parts = v.split('.');
  const intPartRaw = parts[0] ?? '';
  const hadDot = v.includes('.');
  const decRaw = parts.slice(1).join(''); // merge extra dots away

  // format integer part with commas
  const intDigits = intPartRaw.replace(/^0+(?=\d)/, '');
  const intWithCommas = intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  // keep up to 2 decimals (optional)
  const dec = decRaw.slice(0, 2);

  if (hadDot) return `${intWithCommas || '0'}.${dec}`;
  return intWithCommas;
}

// Blob -> base64 (raw, without "data:...;base64,")
function blobToBase64Raw(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('Failed to read PDF'));
    r.onload = () => {
      const res = String(r.result ?? '');
      const idx = res.indexOf(',');
      if (idx >= 0) return resolve(res.slice(idx + 1));
      resolve(res);
    };
    r.readAsDataURL(blob);
  });
}

export default function WeighingPage() {
  const manualAllowed = useMemo(() => isManualWeightAllowed(), []);

  // ✅ TEMP: keep connect visible but disabled
  const SERIAL_CONNECT_DISABLED = true;

  // ---- Serial via shared hook ----
  const {
    ports,
    isConnected: connected,
    currentWeight,
    error: serialError,
    isLoading: serialLoading,
    hasElectron,
    listPorts,
    connect,
    disconnect,
    simulateWeight,
  } = useSerialPort();

  const storage = safeLocalStorage();

  const [uiError, setUiError] = useState<string>('');
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

  // ✅ Manual entry
  const [manualWeightText, setManualWeightText] = useState('');

  // ✅ Single source of truth for what UI shows
  const [displayWeight, setDisplayWeight] = useState<number | null>(null);

  const [lastUpdateAt, setLastUpdateAt] = useState<string>('');
  const [lastUpdateMs, setLastUpdateMs] = useState<number>(0);
  const [samples, setSamples] = useState<Sample[]>([]);

  function clearLiveWeight() {
    setDisplayWeight(null);
    setSamples([]);
    setLastUpdateAt('');
    setLastUpdateMs(0);
  }

  // ---- Workflow state ----
  const [clients, setClients] = useState<Client[]>([]);
  const [loadingClients, setLoadingClients] = useState(false);

  const [clientId, setClientId] = useState('');
  const [clientQuery, setClientQuery] = useState('');
  const [clientOpen, setClientOpen] = useState(false);

  const selectedClient = useMemo(
    () => clients.find((x) => String(x.id) === String(clientId)) ?? null,
    [clients, clientId]
  );

  const [isWalkIn, setIsWalkIn] = useState(false);
  const [walkInName, setWalkInName] = useState('');

  const [assignedTruckId, setAssignedTruckId] = useState('');
  const [truckSideNumber, setTruckSideNumber] = useState('');

  const [materialType, setMaterialType] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [notes, setNotes] = useState('');

  const [creatingTx, setCreatingTx] = useState(false);
  const [completingTx, setCompletingTx] = useState(false);
  const [printingReceipt, setPrintingReceipt] = useState(false);

  const [activeTx, setActiveTx] = useState<CreatedTx | null>(null);
  const [completed, setCompleted] = useState<CompleteResp | null>(null);

  // ---- Resume from Transactions ----
  useEffect(() => {
    if (activeTx) return;

    const raw = storage?.getItem(RESUME_KEY);
    if (!raw) return;

    try {
      const t = JSON.parse(raw);

      if (t?.id) {
        const cid = t?.client_id ? String(t.client_id) : '';
        const vid = t?.vehicle_id ? String(t.vehicle_id) : '';

        setActiveTx({
          id: String(t.id),
          transaction_number: String(t.transaction_number || ''),
          first_weight: Number(t.first_weight ?? 0),
          status: String(t.status || 'pending'),
          client_id: cid || null,
          vehicle_id: vid || null,
          assigned_truck_id: t?.assigned_truck_id != null ? Number(t.assigned_truck_id) : null,
          truck_side_number: t?.truck_side_number ? String(t.truck_side_number) : '',
          walk_in_name: t?.walk_in_name ? String(t.walk_in_name) : '',
        });

        if (t?.assigned_truck_id != null) setAssignedTruckId(String(t.assigned_truck_id));
        if (t?.truck_side_number) setTruckSideNumber(String(t.truck_side_number || ''));
        if (t?.walk_in_name) setWalkInName(String(t.walk_in_name || ''));

        if (cid) {
          setIsWalkIn(false);
          setClientId(cid);
        } else {
          setIsWalkIn(true);
          setClientId('');
        }

        setCompleted(null);
        setUiError('');
      }
    } catch {
      // ignore bad payload
    } finally {
      storage?.removeItem(RESUME_KEY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Weight updates -> samples + freshness (serial-driven updates) ----
  useEffect(() => {
    if (currentWeight === null || !Number.isFinite(currentWeight)) return;

    setDisplayWeight(currentWeight);

    const now = Date.now();
    setLastUpdateMs(now);
    setLastUpdateAt(new Date().toLocaleTimeString());

    setSamples((prev) => [...prev, { w: currentWeight, t: now }].filter((s) => now - s.t <= WINDOW_MS));
  }, [currentWeight]);

  // ---- Ports default selection ----
  useEffect(() => {
    if (connected) return;
    if (!ports?.length) return;
    if (config.path && ports.some((p) => p.path === config.path)) return;

    setConfig((c) => ({ ...c, path: ports[0].path }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ports, connected]);

  // ---- stale detection ----
  const hasFreshWeight = useMemo(() => {
    if (!lastUpdateMs) return false;
    return Date.now() - lastUpdateMs <= 5000;
  }, [lastUpdateMs]);

  const isStale = useMemo(() => {
    if (!connected) return false;
    if (!lastUpdateMs) return true;
    return Date.now() - lastUpdateMs > 5000;
  }, [connected, lastUpdateMs]);

  const canWeighNow = useMemo(() => {
    if (connected) return !isStale;
    return manualAllowed && hasFreshWeight;
  }, [connected, isStale, manualAllowed, hasFreshWeight]);

  const stableInfo = useMemo(() => {
    if (!canWeighNow) return { isStable: false, avg: null as number | null, range: 0, duration: 0, count: 0 };
    if (!samples.length) return { isStable: false, avg: null, range: 0, duration: 0, count: 0 };

    const nowT = samples[samples.length - 1].t;
    const duration = nowT - samples[0].t;

    const weights = samples.map((x) => x.w).filter(Number.isFinite);
    if (!weights.length) return { isStable: false, avg: null, range: 0, duration, count: samples.length };

    const minW = Math.min(...weights);
    const maxW = Math.max(...weights);
    const range = maxW - minW;
    const avg = weights.reduce((a, b) => a + b, 0) / weights.length;

    const isStableNow = duration >= STABLE_MS && range <= STABLE_TOL_KG;
    return { isStable: isStableNow, avg, range, duration, count: samples.length };
  }, [samples, canWeighNow]);

  const showStabilityBadge = canWeighNow && hasFreshWeight;

  // ---- Data loading ----
  async function loadClients() {
    setLoadingClients(true);
    setUiError('');
    try {
      const r = await apiClient.get('/api/clients?limit=200');
      const err = pickErrorMessage(r);
      if (err) {
        setUiError(err);
        setClients([]);
        return;
      }
      setClients(unwrapArray<Client>(r));
    } catch (e: any) {
      setUiError(e?.message || 'Failed to load clients');
      setClients([]);
    } finally {
      setLoadingClients(false);
    }
  }

  useEffect(() => {
    if (!clientId) return;
    const c = clients.find((x) => String(x.id) === String(clientId));
    if (c) setClientQuery(c.company_name);
  }, [clientId, clients]);

  // ---- Serial controls ----
  async function refreshPorts() {
    setUiError('');
    await listPorts();
  }

  async function connectPort() {
    if (SERIAL_CONNECT_DISABLED) {
      setUiError('Serial connection is temporarily disabled. Use manual "Record weight".');
      return;
    }

    if (!hasElectron) {
      setUiError('Serial features are available only inside the Electron desktop app.');
      return;
    }
    if (!config.path) {
      setUiError('Select a serial port first.');
      return;
    }
    if (!Number.isFinite(config.baudRate) || config.baudRate <= 0) {
      setUiError('Baud rate must be a valid positive number.');
      return;
    }

    setUiError('');

    const cfg: SerialConfig = {
      ...config,
      path: normalizeComPath(config.path),
      mode: 'poll',
      requestCommand: config.requestCommand ?? 'P\r\n',
      pollIntervalMs: config.pollIntervalMs ?? 1000,
      responseWaitMs: config.responseWaitMs ?? 300,
      encoding: config.encoding ?? 'ascii',
      xon: false,
      xoff: false,
      rtscts: false,
    };

    const ok = await connect(cfg);
    if (ok) {
      storage?.setItem(STORAGE_KEY, JSON.stringify(cfg));
      clearLiveWeight();
    }
  }

  async function disconnectPort() {
    setUiError('');
    await disconnect();
    clearLiveWeight();
  }

  // ✅ Manual record
  async function recordWeight() {
    if (connected) {
      setUiError('Disconnect the serial port to use manual weight entry.');
      return;
    }
    if (!manualAllowed) {
      setUiError('Manual weight entry is currently disabled.');
      return;
    }

    const raw = manualWeightText;
    setManualWeightText(''); // ✅ ALWAYS clear after click

    const n = parseFloat(raw.replace(/,/g, ''));
    if (!Number.isFinite(n)) {
      setUiError('Weight must be a valid number.');
      return;
    }

    setUiError('');

    const now = Date.now();
    setLastUpdateMs(now);
    setLastUpdateAt(new Date().toLocaleTimeString());
    setSamples(buildStableSamples(n, now));
    setDisplayWeight(n);

    if (hasElectron) {
      await simulateWeight(n);
    }
  }

  // ---- Assigned ID keypad helpers ----
  function pushDigit(d: string) {
    setAssignedTruckId((prev) => digitsOnly(prev + d).slice(0, 4));
  }
  function backspaceAssigned() {
    setAssignedTruckId((prev) => prev.slice(0, -1));
  }
  function clearAssigned() {
    setAssignedTruckId('');
  }

  const assignedIdNum = useMemo(() => {
    if (!assignedTruckId) return null;
    const n = Number(assignedTruckId);
    if (!Number.isInteger(n) || n < 0) return null;
    return n;
  }, [assignedTruckId]);

  const canRecordFirst = useMemo(() => {
    const hasCustomer = isWalkIn ? true : !!clientId;
    return (
      assignedIdNum !== null &&
      hasCustomer &&
      canWeighNow &&
      stableInfo.isStable &&
      stableInfo.avg !== null &&
      !activeTx &&
      !creatingTx
    );
  }, [assignedIdNum, isWalkIn, clientId, canWeighNow, stableInfo, activeTx, creatingTx]);

  const canRecordSecond = useMemo(() => {
    return !!activeTx && canWeighNow && stableInfo.isStable && stableInfo.avg !== null && !completingTx;
  }, [activeTx, canWeighNow, stableInfo, completingTx]);

  async function recordScaleIn() {
    if (!canRecordFirst) return;
    setCreatingTx(true);
    setUiError('');
    setCompleted(null);

    try {
      const stableWeight = stableInfo.avg!;
      clearLiveWeight(); // ✅ clear/fresh AFTER capturing the weight

      const body = {
        client_id: !isWalkIn ? clientId : null,
        vehicle_id: null,

        walk_in_name: isWalkIn ? (walkInName || '').trim() : '',
        assigned_truck_id: assignedIdNum,
        truck_side_number: (truckSideNumber || '').trim(),

        transaction_type: 'inbound',
        first_weight: stableWeight,

        material_type: materialType || '',
        reference_number: referenceNumber || '',
        notes: notes || '',

        first_weight_stable: true,
        first_weight_stability_ms: stableInfo.duration,
        first_weight_tolerance_kg: STABLE_TOL_KG,
      };

      const r = await apiClient.post('/api/transactions', body);
      const err = pickErrorMessage(r);
      if (err) {
        setUiError(err || 'Failed to create transaction');
        return;
      }

      const payload = (r as any)?.data ?? r;
      const tx = payload?.data ?? payload;

      if (!tx?.id) {
        setUiError('Transaction created but response is missing transaction id');
        return;
      }

      setActiveTx({
        id: tx.id,
        transaction_number: tx.transaction_number,
        first_weight: Number(tx.first_weight ?? stableWeight),
        status: tx.status,
        client_id: tx.client_id ?? null,
        vehicle_id: tx.vehicle_id ?? null,
        assigned_truck_id: tx.assigned_truck_id ?? assignedIdNum,
        truck_side_number: tx.truck_side_number ?? truckSideNumber,
        walk_in_name: tx.walk_in_name ?? (isWalkIn ? walkInName : ''),
      });
    } catch (e: any) {
      setUiError(e?.message || 'Failed to create transaction');
    } finally {
      setCreatingTx(false);
    }
  }

  async function recordScaleOutAndGenerateDoc() {
    if (!canRecordSecond || !activeTx) return;
    setCompletingTx(true);
    setUiError('');

    try {
      const stableWeight = stableInfo.avg!;
      clearLiveWeight(); // ✅ clear/fresh AFTER capturing the weight

      const r = await apiClient.patch(`/api/transactions/${activeTx.id}/complete`, {
        second_weight: stableWeight,
        second_weight_stable: true,
        second_weight_stability_ms: stableInfo.duration,
        second_weight_tolerance_kg: STABLE_TOL_KG,
      });

      const err = pickErrorMessage(r);
      if (err) {
        setUiError(err || 'Failed to complete transaction');
        return;
      }

      const payload = (r as any)?.data ?? r;
      const data = payload?.data ?? payload;

      setCompleted(data as CompleteResp);
    } catch (e: any) {
      setUiError(e?.message || 'Failed to complete transaction');
    } finally {
      setCompletingTx(false);
    }
  }

  async function downloadInvoicePdfFallback(blob: Blob, invoiceNumber?: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${invoiceNumber || 'document'}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // async function printReceipt(invoiceId: string, invoiceNumber?: string) {
  //   setUiError('');
  //   setPrintingReceipt(true);

  //   try {
  //     const r = await apiClient.getBlob(`/api/invoices/${invoiceId}/pdf`);
  //     const err = pickErrorMessage(r);
  //     if (err) {
  //       setUiError(err || 'Failed to fetch PDF');
  //       return;
  //     }

  //     const blob = (r as any).data as Blob;
  //     if (!(blob instanceof Blob)) {
  //       setUiError('PDF fetch failed: invalid response');
  //       return;
  //     }

  //     const printerApi = (window as any)?.electron?.printer;

  //     // ✅ Electron one-click print
  //     if (hasElectron && printerApi?.printPdf) {
  //       const pdfBase64 = await blobToBase64Raw(blob);

  //       const savedPrinterName = (storage?.getItem(PRINTER_KEY) || '').trim();

  //       // ✅ Use the new payload call (option1 preload supports it)
  //       let pr: any = null;
  //       try {
  //         pr = await printerApi.printPdf({
  //           pdfBase64,
  //           deviceName: savedPrinterName || undefined,
  //           preferMunbyn: true,
  //           silent: true,
  //           jobName: invoiceNumber ? `Receipt ${invoiceNumber}` : 'Weighbridge Receipt',
  //         });
  //       } catch (e: any) {
  //         pr = { success: false, error: e?.message || 'Print IPC failed' };
  //       }

  //       if (pr?.success) return;

  //       // Retry without specifying printer name (lets main process pick default physical printer)
  //       let pr2: any = null;
  //       try {
  //         pr2 = await printerApi.printPdf({
  //           pdfBase64,
  //           deviceName: undefined,
  //           preferMunbyn: true,
  //           silent: true,
  //           jobName: invoiceNumber ? `Receipt ${invoiceNumber}` : 'Weighbridge Receipt',
  //         });
  //       } catch (e: any) {
  //         pr2 = { success: false, error: e?.message || 'Print IPC failed' };
  //       }

  //       if (pr2?.success) return;

  //       // If still fails, fallback to download so they can print manually
  //       setUiError(pr?.error || pr2?.error || 'Printing failed (printer not installed / not reachable)');
  //       await downloadInvoicePdfFallback(blob, invoiceNumber);
  //       return;
  //     }

  //     // ✅ Non-Electron fallback: download like before
  //     await downloadInvoicePdfFallback(blob, invoiceNumber);
  //   } catch (e: any) {
  //     setUiError(e?.message || 'Failed to print receipt');
  //   } finally {
  //     setPrintingReceipt(false);
  //   }
  // }

  async function printReceipt(invoiceId: string, invoiceNumber?: string) {
    setUiError('');
    setPrintingReceipt(true);

    try {
      const r = await apiClient.getBlob(`/api/invoices/${invoiceId}/pdf`);
      const err = pickErrorMessage(r);
      if (err) {
        setUiError(err || 'Failed to fetch PDF');
        return;
      }

      const blob = (r as any).data as Blob;
      if (!(blob instanceof Blob)) {
        setUiError('PDF fetch failed: invalid response');
        return;
      }

      const printerApi = (window as any)?.electron?.printer;

      // ✅ Electron one-click print (MUNBYN preferred)
      if (hasElectron && printerApi?.printPdf) {
        const pdfBase64 = await blobToBase64Raw(blob);

        const savedPrinterName = (storage?.getItem(PRINTER_KEY) || '').trim();

        const pr = await printerApi.printPdf({
          pdfBase64,
          deviceName: savedPrinterName || undefined,
          preferMunbyn: true,
          silent: true,
          jobName: invoiceNumber ? `Receipt ${invoiceNumber}` : 'Weighbridge Receipt',
        });

        if (pr?.success) return;

        // IMPORTANT: do NOT auto-download here, because that triggers "Save as..."
        setUiError(pr?.error || 'Printing failed (check MUNBYN driver / connection / default printer).');
        return;
      }

      // Non-Electron fallback: download like before
      await downloadInvoicePdfFallback(blob, invoiceNumber);
    } catch (e: any) {
      setUiError(e?.message || 'Failed to print receipt');
    } finally {
      setPrintingReceipt(false);
    }
  }

  function startNextVehicleLeavePending() {
    setActiveTx(null);
    setCompleted(null);

    setAssignedTruckId('');
    setTruckSideNumber('');

    setMaterialType('');
    setReferenceNumber('');
    setNotes('');
    setWalkInName('');

    clearLiveWeight(); // ✅ fresh/empty
  }

  function resetForNextVehicle() {
    setActiveTx(null);
    setCompleted(null);

    setAssignedTruckId('');
    setTruckSideNumber('');

    setMaterialType('');
    setReferenceNumber('');
    setNotes('');

    setWalkInName('');
    setIsWalkIn(false);
    setClientId('');
    setClientQuery('');

    clearLiveWeight(); // ✅ fresh/empty
  }

  // ---- Effects ----
  useEffect(() => {
    void loadClients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refreshPorts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isStale) setSamples([]);
  }, [isStale]);

  const filteredClients = useMemo(() => {
    const q = (clientQuery || '').trim().toLowerCase();
    if (!q) return clients.slice(0, 30);
    return clients
      .filter((c) => String(c.company_name || '').toLowerCase().includes(q))
      .slice(0, 30);
  }, [clients, clientQuery]);

  const notesWords = useMemo(() => wordCount(notes), [notes]);

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <Scale className="w-8 h-8 text-blue-600" />
        <h1 className="text-3xl font-bold text-gray-900">Weighing</h1>
      </div>

      {!hasElectron && (
        <div className="mb-6 bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-lg text-sm">
          This screen requires the Electron desktop runtime (preload bridge not found).
        </div>
      )}

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 mt-0.5" />
          <div className="text-sm">{error}</div>
        </div>
      )}

      {/* Record workflow */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Record transaction</h2>
          {activeTx ? (
            <span className="text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-800">
              Active: {activeTx.transaction_number}
            </span>
          ) : (
            <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-700">No active transaction</span>
          )}
        </div>

        <div className="mb-4 text-sm text-gray-600">
          {activeTx ? (
            <>
              Stage: <span className="font-semibold text-gray-900">Scale-Out</span> (OUT) — record outbound reading to
              complete transaction
            </>
          ) : (
            <>
              Stage: <span className="font-semibold text-gray-900">Scale-In</span> (PRINT/SELECT) — record inbound
              reading to open transaction
            </>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Customer */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <div className="flex items-center justify-between gap-3">
              <label className="block text-sm font-medium text-gray-800">Customer</label>
              <label className="inline-flex items-center gap-2 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={isWalkIn}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setIsWalkIn(on);
                    setUiError('');
                    if (on) {
                      setClientId('');
                      setClientQuery('');
                      setClientOpen(false);
                    }
                  }}
                  disabled={!!activeTx}
                />
                Walk-in (no registration)
              </label>
            </div>

            {!isWalkIn ? (
              <div className="relative mt-2">
                <input
                  value={clientQuery}
                  onChange={(e) => {
                    const next = e.target.value;
                    setClientQuery(next);
                    setClientOpen(true);
                    if (selectedClient && next === selectedClient.company_name) return;
                    setClientId('');
                  }}
                  onFocus={() => setClientOpen(true)}
                  onBlur={() => setTimeout(() => setClientOpen(false), 150)}
                  disabled={loadingClients || !!activeTx}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white disabled:bg-gray-50"
                  placeholder={loadingClients ? 'Loading clients…' : 'Search client by name…'}
                />

                {clientOpen && !activeTx && !loadingClients && filteredClients.length > 0 && (
                  <div className="absolute z-10 mt-2 w-full bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden max-h-72 overflow-y-auto">
                    {filteredClients.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setClientId(String(c.id || '').trim());
                          setClientQuery(String(c.company_name || '').trim());
                          setClientOpen(false);
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm"
                      >
                        <div className="font-medium text-gray-900">{c.company_name}</div>
                        <div className="text-xs text-gray-500">{c.id}</div>
                      </button>
                    ))}
                  </div>
                )}

                {clientId ? (
                  <div className="mt-2 text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-1 rounded">
                    Selected client is ready.
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-gray-500">Type a name, then click a result to select the client.</div>
                )}
              </div>
            ) : (
              <div className="mt-2">
                <input
                  value={walkInName}
                  onChange={(e) => setWalkInName(e.target.value)}
                  disabled={!!activeTx}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white disabled:bg-gray-50"
                  placeholder="Walk-in name (optional)"
                />
                <div className="mt-2 text-xs text-gray-500">Walk-ins can proceed without registration. Name is optional.</div>
              </div>
            )}
          </div>

          {/* Assigned ID + Truck-side */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <label className="block text-sm font-medium text-gray-800">Assigned Truck ID (required)</label>
            <input
              value={assignedTruckId}
              onChange={(e) => setAssignedTruckId(digitsOnly(e.target.value).slice(0, 4))}
              disabled={!!activeTx || !!completed}
              className="w-full mt-2 px-3 py-2 border border-gray-300 rounded-lg bg-white disabled:bg-gray-50"
              placeholder="e.g. 6 or 25"
              inputMode="numeric"
            />

            <div className="mt-3 grid grid-cols-3 gap-2">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => pushDigit(d)}
                  disabled={!!activeTx || !!completed}
                  className="py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-800 disabled:opacity-50"
                >
                  {d}
                </button>
              ))}
              <button
                type="button"
                onClick={backspaceAssigned}
                disabled={!!activeTx || !!completed}
                className="py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-800 disabled:opacity-50"
              >
                ⌫
              </button>
              <button
                type="button"
                onClick={() => pushDigit('0')}
                disabled={!!activeTx || !!completed}
                className="py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-800 disabled:opacity-50"
              >
                0
              </button>
              <button
                type="button"
                onClick={clearAssigned}
                disabled={!!activeTx || !!completed}
                className="py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-800 disabled:opacity-50"
              >
                Clear
              </button>
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-800">Truck-side number (optional)</label>
              <input
                value={truckSideNumber}
                onChange={(e) => setTruckSideNumber(e.target.value)}
                disabled={!!completed}
                className="w-full mt-2 px-3 py-2 border border-gray-300 rounded-lg bg-white disabled:bg-gray-50"
                placeholder="Optional identifier written on truck"
              />
            </div>
          </div>

          {/* Material / Reference / Notes */}
          <div className="lg:col-span-2 bg-white border border-gray-200 rounded-xl p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Material</label>
                <input
                  value={materialType}
                  onChange={(e) => setMaterialType(e.target.value)}
                  disabled={!!completed}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-50"
                  placeholder="e.g. sand / mattress"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reference</label>
                <input
                  value={referenceNumber}
                  onChange={(e) => setReferenceNumber(e.target.value)}
                  disabled={!!completed}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-50"
                  placeholder="PO / ref"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={!!completed}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-50"
                  placeholder="Write a short sentence for later reference…"
                  rows={3}
                />
                <div className="mt-1 text-xs text-gray-500">{notesWords ? `${notesWords} words` : ''}</div>
              </div>
            </div>
          </div>
        </div>

        {/* ✅ Combined row: Live weight (left) + Manual record (right) */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
            {/* Left: Live weight */}
            <div className="min-w-[260px]">
              <div className="text-sm text-gray-500">Live weight</div>

              <div className="mt-2 text-4xl font-bold text-gray-900">{fmtWeight(displayWeight)}</div>

              <div className="mt-2 text-sm text-gray-500">Last update: {lastUpdateAt || '—'}</div>

              <div className="mt-2">
                <span
                  className={`inline-flex px-3 py-1 rounded-full text-xs font-medium ${
                    connected ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {connected ? 'Connected' : 'Disconnected'}
                </span>
              </div>

              {stableInfo.isStable && stableInfo.avg !== null ? (
                <div className="mt-3 text-xs px-2 py-1 rounded-lg bg-green-50 text-green-700 inline-block">
                  Stable ({STABLE_MS}ms, range {stableInfo.range.toFixed(2)}kg) — will record:{' '}
                  <span className="font-semibold">{stableInfo.avg.toFixed(2)} kg</span>
                </div>
              ) : showStabilityBadge ? (
                <div className="mt-3 text-xs px-2 py-1 rounded-lg bg-amber-50 text-amber-800 inline-block">
                  Not stable yet
                </div>
              ) : null}
            </div>

            {/* Right: Manual entry */}
            {manualAllowed && !connected && (
              <div className="w-full lg:w-auto">
                <div className="text-sm text-gray-500">Manual entry</div>
                <div className="mt-1 text-lg font-semibold text-gray-900">Record weight</div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Beaker className="w-4 h-4 text-gray-500" />
                  <input
                    type="text"
                    value={manualWeightText}
                    onChange={(e) => setManualWeightText(formatManualWeightInput(e.target.value))}
                    className="w-56 px-3 py-2 border border-gray-300 rounded-lg"
                    placeholder="e.g. 1,200.00"
                  />
                  <button
                    type="button"
                    onClick={() => void recordWeight()}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                  >
                    Record weight
                  </button>
                </div>

                <div className="mt-2 text-xs text-gray-500">
                  Type the weight displayed on the scale, then click <span className="font-medium">Record weight</span>.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Transaction actions */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between gap-3 mb-2">
          <h2 className="text-lg font-semibold text-gray-900">Transaction actions</h2>
          {activeTx ? (
            <span className="text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-800">
              Active: {activeTx.transaction_number}
            </span>
          ) : (
            <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-700">No active transaction</span>
          )}
        </div>

        <div className="mb-4 text-sm text-gray-600">
          {activeTx ? (
            <>
              Stage: <span className="font-semibold text-gray-900">Scale-Out</span> (OUT)
            </>
          ) : (
            <>
              Stage: <span className="font-semibold text-gray-900">Scale-In</span> (PRINT/SELECT)
            </>
          )}
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <div className="text-sm text-gray-700 mr-2">
            Ready: <span className="font-semibold">{fmtWeight(displayWeight)}</span>

            {stableInfo.isStable && stableInfo.avg !== null ? (
              <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700">
                Stable ({STABLE_MS}ms, range {stableInfo.range.toFixed(2)}kg) — will record:{' '}
                <span className="font-semibold">{stableInfo.avg.toFixed(2)} kg</span>
              </span>
            ) : showStabilityBadge ? (
              <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-800">Not stable yet</span>
            ) : null}
          </div>

          {!activeTx ? (
            <button
              type="button"
              onClick={() => void recordScaleIn()}
              disabled={!canRecordFirst}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <ClipboardCheck className="w-4 h-4" />
              {creatingTx ? 'Recording…' : 'SCALE-IN (PRINT/SELECT)'}
            </button>
          ) : !completed ? (
            <div className="inline-flex items-center gap-2">
              <button
                type="button"
                onClick={() => void recordScaleOutAndGenerateDoc()}
                disabled={!canRecordSecond}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
              >
                <FileText className="w-4 h-4" />
                {completingTx ? 'Completing…' : 'SCALE-OUT (OUT)'}
              </button>

              <button
                type="button"
                onClick={() => startNextVehicleLeavePending()}
                disabled={completingTx}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-800 disabled:opacity-50"
              >
                Start next vehicle (leave pending)
              </button>
            </div>
          ) : null}

          {completed?.invoice?.id && (
            <>
              <button
                type="button"
                onClick={() => void printReceipt(completed.invoice.id, completed.invoice.invoice_number)}
                disabled={printingReceipt}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <FileText className="w-4 h-4" />
                {printingReceipt ? 'Printing…' : 'Print receipt'}
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

          {completed && !completed?.invoice?.id && (
            <button
              type="button"
              onClick={() => resetForNextVehicle()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-800"
            >
              New transaction
            </button>
          )}
        </div>
      </div>

      {/* Scale connection */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Scale connection</h2>
          <button
            type="button"
            onClick={() => void refreshPorts()}
            disabled={serialLoading || !hasElectron}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-800 disabled:opacity-50"
          >
            <RefreshCcw className="w-4 h-4" />
            {serialLoading ? 'Refreshing...' : 'Refresh ports'}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Serial port</label>
            <select
              value={config.path}
              onChange={(e) => setConfig((c) => ({ ...c, path: e.target.value }))}
              disabled={connected || !hasElectron || SERIAL_CONNECT_DISABLED}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white disabled:bg-gray-50"
            >
              <option value="">Select a port</option>
              {ports.map((p: SerialPortInfo) => (
                <option key={p.path} value={p.path}>
                  {p.path} {p.manufacturer ? `— ${p.manufacturer}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Baud rate</label>
              <input
                type="number"
                value={config.baudRate}
                onChange={(e) => setConfig((c) => ({ ...c, baudRate: Number(e.target.value) }))}
                disabled={connected || !hasElectron || SERIAL_CONNECT_DISABLED}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-50"
                min={1}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Parity</label>
              <select
                value={config.parity}
                onChange={(e) => setConfig((c) => ({ ...c, parity: e.target.value as SerialConfig['parity'] }))}
                disabled={connected || !hasElectron || SERIAL_CONNECT_DISABLED}
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
                disabled={connected || !hasElectron || SERIAL_CONNECT_DISABLED}
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
                disabled={connected || !hasElectron || SERIAL_CONNECT_DISABLED}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white disabled:bg-gray-50"
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
              </select>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-5 items-center">
          {!connected ? (
            <button
              type="button"
              onClick={() => void connectPort()}
              disabled={serialLoading || !hasElectron || SERIAL_CONNECT_DISABLED}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <PlugZap className="w-4 h-4" />
              {SERIAL_CONNECT_DISABLED ? 'Connect (disabled)' : serialLoading ? 'Connecting...' : 'Connect'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void disconnectPort()}
              disabled={!hasElectron}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-800 disabled:opacity-50"
            >
              <Plug className="w-4 h-4" />
              Disconnect
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
