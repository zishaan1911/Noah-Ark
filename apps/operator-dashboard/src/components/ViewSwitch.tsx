import type { View } from '../lib/types';

const VIEWS: { id: View; label: string }[] = [
  { id: 'map', label: 'Map' },
  { id: 'chase', label: 'Chase' },
  { id: 'onboard', label: 'Onboard' },
];

export function ViewSwitch({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div role="radiogroup" aria-label="Camera view" className="flex gap-0.5 rounded-xl bg-fill p-0.5">
      {VIEWS.map((v) => {
        const on = v.id === view;
        return (
          <button
            key={v.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(v.id)}
            className={`min-h-11 min-w-16 cursor-pointer rounded-[10px] border-0 px-3 text-sm font-semibold transition-colors ${
              on ? 'bg-(--glass-solid) text-ink shadow-sm' : 'bg-transparent text-sub'
            }`}
          >
            {v.label}
          </button>
        );
      })}
    </div>
  );
}
