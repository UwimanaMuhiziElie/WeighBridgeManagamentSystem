import { Delete, X } from 'lucide-react';

type Props = {
  value: string;
  onChange: (v: string) => void;
  maxLen?: number;
  disabled?: boolean;
  label?: string;
};

function onlyDigits(s: string) {
  return s.replace(/\D/g, '');
}

export default function AssignedTruckIdPad({
  value,
  onChange,
  maxLen = 4,
  disabled,
  label = 'Assigned Truck ID',
}: Props) {
  const v = onlyDigits(value).slice(0, maxLen);

  function set(next: string) {
    onChange(onlyDigits(next).slice(0, maxLen));
  }

  function addDigit(d: string) {
    if (disabled) return;
    if (v.length >= maxLen) return;
    set(v + d);
  }

  function backspace() {
    if (disabled) return;
    set(v.slice(0, -1));
  }

  function clear() {
    if (disabled) return;
    set('');
  }

  return (
    <div className={disabled ? 'opacity-60 pointer-events-none' : ''}>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>

      <div className="flex items-center gap-2">
        <input
          value={v}
          onChange={(e) => set(e.target.value)}
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder="e.g. 6 or 25"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
        />

        <button
          type="button"
          onClick={backspace}
          className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-gray-300 bg-white hover:bg-gray-50"
          aria-label="Backspace"
        >
          <Delete className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={clear}
          className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-gray-300 bg-white hover:bg-gray-50"
          aria-label="Clear"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 mt-2 max-w-[220px]">
        {['1','2','3','4','5','6','7','8','9'].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => addDigit(d)}
            className="h-10 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 font-medium"
          >
            {d}
          </button>
        ))}
        <div />
        <button
          type="button"
          onClick={() => addDigit('0')}
          className="h-10 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 font-medium"
        >
          0
        </button>
        <div />
      </div>

      <div className="text-[11px] text-gray-500 mt-2">
        Enter the same number used on the scale terminal (supports double digits like 25).
      </div>
    </div>
  );
}
