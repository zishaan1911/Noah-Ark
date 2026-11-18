import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { searchPlaces, type Place } from '../lib/geocode';
import type { Point } from '../lib/types';

interface Props {
  onSelect: (p: Point, label: string) => void;
}

const DEBOUNCE_MS = 350;
const MIN_GAP_MS = 1000; // Nominatim's usage policy: at most 1 request a second

export function SearchBox({ onSelect }: Props) {
  const uid = useId();
  const listId = `${uid}-list`;
  const [text, setText] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState<'idle' | 'loading' | 'empty' | 'error'>('idle');
  const lastRequest = useRef(0);

  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) return; // the change handler already cleared the list
    const ctl = new AbortController();
    const wait = Math.max(DEBOUNCE_MS, lastRequest.current + MIN_GAP_MS - Date.now());
    const timer = setTimeout(() => {
      lastRequest.current = Date.now();
      setStatus('loading');
      searchPlaces(q, ctl.signal)
        .then((r) => {
          setResults(r);
          setActive(-1);
          setStatus(r.length ? 'idle' : 'empty');
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setResults([]);
          setStatus('error');
        });
    }, wait);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [text]);

  const pick = (p: Place) => {
    onSelect(p.point, p.label);
    setText(p.label);
    setResults([]);
    setOpen(false);
    setStatus('idle');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && results.length) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp' && results.length) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === 'Enter' && open && results.length) {
      e.preventDefault();
      pick(results[active >= 0 ? active : 0]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    }
  };

  const showList = open && results.length > 0;
  const note =
    status === 'loading'
      ? 'Searching…'
      : status === 'empty'
        ? 'No places found'
        : status === 'error'
          ? 'Search is unavailable'
          : '';

  return (
    <div className="relative w-full lg:w-72">
      <div className="glass flex min-h-11 items-center gap-2 rounded-[14px] px-3">
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          className="shrink-0 text-sub"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-4-4" />
        </svg>
        <input
          type="search"
          role="combobox"
          aria-label="Search places"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={showList && active >= 0 ? `${uid}-opt-${active}` : undefined}
          placeholder="Search places"
          autoComplete="off"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value.trim().length < 2) {
              setResults([]);
              setStatus('idle');
            }
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className="min-h-11 min-w-0 flex-1 border-0 bg-transparent text-sm text-ink outline-none placeholder:text-sub"
        />
      </div>
      <span role="status" className={note && open ? 'mt-1 block px-3 text-xs text-sub' : 'sr-only'}>
        {note}
      </span>
      <ul
        id={listId}
        role="listbox"
        aria-label="Search results"
        hidden={!showList}
        className="glass absolute top-[calc(100%+6px)] right-0 left-0 z-30 m-0 flex list-none flex-col overflow-hidden rounded-[14px] p-1"
      >
        {results.map((r, i) => (
          <li
            key={`${r.label}-${r.point.lat}-${r.point.lon}`}
            id={`${uid}-opt-${i}`}
            role="option"
            aria-selected={i === active}
            // mousedown fires before the input's blur, so the pick is not lost
            onMouseDown={(e) => {
              e.preventDefault();
              pick(r);
            }}
            className={`flex min-h-11 cursor-pointer items-center rounded-[10px] px-3 text-sm text-ink ${
              i === active ? 'bg-fill' : ''
            }`}
          >
            {r.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
