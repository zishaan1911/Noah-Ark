import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { prefersReducedMotion } from '../lib/prefs';

export type Detent = 'peek' | 'half' | 'full';

interface Props {
  detent: Detent;
  onDetent: (d: Detent) => void;
  /** Always visible, above the grabber's detent line. Also a drag handle. */
  peek: ReactNode;
  children: ReactNode;
}

const ORDER: Detent[] = ['peek', 'half', 'full'];
const PEEK_PX = 76;
const FULL_MARGIN_PX = 96;
// Apple's sheet spring: damping ratio 0.8, response 0.3 s.
const DAMPING = 0.8;
const RESPONSE_S = 0.3;
const DECEL = 0.998; // UIScrollView normal deceleration, per millisecond
const RUBBER = 0.55;
const STEP_S = 1 / 240;

const heights = (): Record<Detent, number> => {
  const vh = window.innerHeight;
  return { peek: PEEK_PX, half: Math.round(vh * 0.46), full: Math.max(PEEK_PX, vh - FULL_MARGIN_PX) };
};

/** How far a release at `v` px/s would coast, with Apple's deceleration rate. */
const project = (v: number) => ((v / 1000) * DECEL) / (1 - DECEL);

/** Past the ends the sheet follows the finger with diminishing returns. */
function rubber(h: number, lo: number, hi: number): number {
  const over = h > hi ? h - hi : h < lo ? lo - h : 0;
  if (!over) return h;
  const dim = hi - lo || 1;
  const eased = (1 - 1 / ((over * RUBBER) / dim + 1)) * dim;
  return h > hi ? hi + eased : lo - eased;
}

export function BottomSheet({ detent, onDetent, peek, children }: Props) {
  const sheetRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const spring = useRef({ h: heights()[detent], v: 0 });
  const raf = useRef(0);
  const drag = useRef<{ y0: number; h0: number; samples: { t: number; h: number }[] } | null>(null);
  const moved = useRef(false);
  const detentRef = useRef(detent);
  useEffect(() => {
    detentRef.current = detent;
  });
  // The spring owns the height after mount; React only sets the first one, so it never fights the animation.
  const [initialHeight] = useState(() => heights()[detent]);

  const paint = () => {
    if (sheetRef.current) sheetRef.current.style.height = `${spring.current.h}px`;
  };

  const animateTo = (target: number) => {
    cancelAnimationFrame(raf.current);
    if (prefersReducedMotion()) {
      spring.current = { h: target, v: 0 };
      paint();
      return;
    }
    const omega = (2 * Math.PI) / RESPONSE_S;
    const k = omega * omega;
    const c = 2 * DAMPING * omega;
    let last = performance.now();
    const tick = (now: number) => {
      let left = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = spring.current;
      while (left > 0) {
        const dt = Math.min(STEP_S, left);
        s.v += (-k * (s.h - target) - c * s.v) * dt;
        s.h += s.v * dt;
        left -= dt;
      }
      if (Math.abs(s.h - target) < 0.3 && Math.abs(s.v) < 4) {
        s.h = target;
        s.v = 0;
        paint();
        return;
      }
      paint();
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  // Move to the requested detent (the parent changed it, or a drag released onto it).
  useLayoutEffect(() => {
    if (!drag.current) animateTo(heights()[detent]);
    // animateTo only reads refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detent]);

  useEffect(() => {
    const onResize = () => {
      if (!drag.current) animateTo(heights()[detentRef.current]);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A collapsed sheet must not leave hidden controls in the tab order.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.inert = detent === 'peek';
  }, [detent]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    cancelAnimationFrame(raf.current);
    e.currentTarget.setPointerCapture(e.pointerId);
    moved.current = false;
    drag.current = {
      y0: e.clientY,
      h0: spring.current.h,
      samples: [{ t: performance.now(), h: spring.current.h }],
    };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dy = d.y0 - e.clientY;
    if (Math.abs(dy) > 4) moved.current = true;
    const hs = heights();
    spring.current.h = rubber(d.h0 + dy, hs.peek, hs.full);
    paint();
    const now = performance.now();
    d.samples.push({ t: now, h: spring.current.h });
    while (d.samples.length > 2 && now - d.samples[0].t > 100) d.samples.shift();
  };

  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const first = d.samples[0];
    const last = d.samples[d.samples.length - 1];
    const dt = (last.t - first.t) / 1000;
    const v = dt > 0.008 ? (last.h - first.h) / dt : 0;
    const hs = heights();
    const projected = spring.current.h + project(v);
    const next = ORDER.reduce((best, k) =>
      Math.abs(hs[k] - projected) < Math.abs(hs[best] - projected) ? k : best,
    );
    spring.current.v = v; // hand the finger's velocity to the spring
    animateTo(hs[next]);
    if (next !== detentRef.current) onDetent(next);
  };

  const cycle = () => {
    if (moved.current) {
      moved.current = false;
      return;
    }
    onDetent(ORDER[(ORDER.indexOf(detent) + 1) % ORDER.length]);
  };

  return (
    <section
      ref={sheetRef}
      aria-label="Live flight"
      style={{ height: initialHeight }}
      className="glass fixed inset-x-0 bottom-0 z-20 flex flex-col overflow-hidden rounded-t-[22px] lg:inset-x-auto lg:right-4 lg:bottom-4 lg:w-[400px] lg:rounded-[22px]"
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        className="flex shrink-0 cursor-grab touch-none flex-col items-stretch select-none active:cursor-grabbing"
        style={{ height: PEEK_PX }}
      >
        <button
          type="button"
          aria-label="Resize sheet"
          aria-expanded={detent !== 'peek'}
          onClick={cycle}
          className="mx-auto flex h-[22px] w-24 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0"
        >
          <span className="h-[5px] w-9 rounded-full bg-sub opacity-60" />
        </button>
        <div className="min-h-0 flex-1 px-4">{peek}</div>
      </div>
      <div
        ref={bodyRef}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pt-1 pb-5"
      >
        {children}
      </div>
    </section>
  );
}
