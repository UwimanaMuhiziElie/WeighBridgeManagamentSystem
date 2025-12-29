import { useEffect, useState } from 'react';
import { Filter, Calendar, X } from 'lucide-react';

export type ReportFiltersValue = {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
  status: '' | 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'draft' | 'sent' | 'paid' | 'overdue';
};

type Props = {
  value?: ReportFiltersValue;
  onChange?: (v: ReportFiltersValue) => void;
  onApply?: (v: ReportFiltersValue) => void;
  onClear?: () => void;
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function ReportFilters({ value, onChange, onApply, onClear }: Props) {
  const [local, setLocal] = useState<ReportFiltersValue>(
    value ?? { from: todayISO(), to: todayISO(), status: '' }
  );

  useEffect(() => {
    if (value) setLocal(value);
  }, [value]);

  function update(next: Partial<ReportFiltersValue>) {
    const merged = { ...local, ...next };
    setLocal(merged);
    onChange?.(merged);
  }

  function clear() {
    const cleared: ReportFiltersValue = { from: todayISO(), to: todayISO(), status: '' };
    setLocal(cleared);
    onChange?.(cleared);
    onClear?.();
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Filter className="w-4 h-4 text-gray-500" />
        <div className="text-sm font-semibold text-gray-900">Filters</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            From
          </label>
          <div className="relative">
            <Calendar className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="date"
              value={local.from}
              onChange={(e) => update({ from: e.target.value })}
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            To
          </label>
          <div className="relative">
            <Calendar className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="date"
              value={local.to}
              onChange={(e) => update({ to: e.target.value })}
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Status
          </label>
          <select
            value={local.status}
            onChange={(e) => update({ status: e.target.value as ReportFiltersValue['status'] })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white"
          >
            <option value="">All</option>
            <option value="pending">pending</option>
            <option value="in_progress">in_progress</option>
            <option value="completed">completed</option>
            <option value="cancelled">cancelled</option>

            <option value="draft">draft</option>
            <option value="sent">sent</option>
            <option value="paid">paid</option>
            <option value="overdue">overdue</option>
          </select>
        </div>
      </div>

      <div className="flex gap-2 mt-4">
        <button
          type="button"
          onClick={() => onApply?.(local)}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
        >
          Apply
        </button>
        <button
          type="button"
          onClick={clear}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-800"
        >
          <X className="w-4 h-4" />
          Clear
        </button>
      </div>
    </div>
  );
}
