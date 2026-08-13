'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react';
import { useFleetStore } from '@/store/fleetStore';

// Mobile bottom sheet (agents.md §6) — below `md` the sidebar collapses to a
// drag-handle sheet snapping at 20% / 60% / 90% of viewport height, with the map
// full-bleed underneath. Pointer events + CSS `transform` + `touch-action: none`.
// No library: a three-stop sheet is ~40 lines of pointer maths, and a gesture
// package would cost more bundle than the feature is worth (§8 budget).
//
// Three deliberate choices:
//
//  1. Position is written to a CSS custom property (`--sheet-y`) rather than to
//     `transform` directly. The desktop opt-out then lives entirely in CSS — a
//     media query drops the transform — instead of needing a `matchMedia` hook
//     in JS, which would risk a hydration mismatch on first paint.
//
//  2. During a drag, `--sheet-y` is written imperatively — no React state per
//     pointermove. Re-rendering here at 60fps would reconcile the whole sidebar
//     (including the virtualised vehicle list) every frame. React owns the snap
//     index; the DOM owns the in-between pixels. Same principle as D3 owning the
//     map subtree (§4).
//
//  3. Snapping is nearest-point, not velocity-projected. On a three-stop sheet,
//     flick projection overshoots and feels unpredictable; "goes where you let
//     go" is the behaviour people can actually aim.
//
// Reduced motion needs no branch here: the global `prefers-reduced-motion` guard
// in globals.css crushes `transition-duration`, so snapping becomes instant.

/** Visible portion of the viewport at each snap point, per agents.md §6. */
const SNAP_PCT = [20, 60, 90] as const;

/** The sheet is as tall as its largest snap; translateY hides the remainder. */
const SHEET_PCT = SNAP_PCT[SNAP_PCT.length - 1];

/** Travel required before a drag is allowed to change the snap point. */
const DRAG_COMMIT_PX = 24;

const SNAP_LABELS = ['peek', 'half', 'full'] as const;

type SnapIndex = 0 | 1 | 2;

/** Downward offset for a snap, as a percentage of viewport height. */
function offsetPct(index: SnapIndex): number {
  return SHEET_PCT - SNAP_PCT[index];
}

/**
 * Snap offset in pixels. `window.innerHeight` is read on every call rather than
 * cached at pointerdown so a mid-drag orientation change — or a mobile browser
 * collapsing its URL bar, which silently changes the viewport — can't clamp the
 * sheet against a stale bound.
 */
function offsetPx(index: SnapIndex): number {
  return (window.innerHeight * offsetPct(index)) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Snap point closest to a pixel offset. */
function nearestSnap(px: number): SnapIndex {
  let nearest: SnapIndex = 0;
  let best = Infinity;
  for (let i = 0; i < SNAP_PCT.length; i += 1) {
    const distance = Math.abs(offsetPx(i as SnapIndex) - px);
    if (distance < best) {
      best = distance;
      nearest = i as SnapIndex;
    }
  }
  return nearest;
}

export function BottomSheet({ children }: { children: ReactNode }) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [snapIndex, setSnapIndex] = useState<SnapIndex>(0);

  // Drag bookkeeping — deliberately a ref, so none of it triggers a render.
  const dragRef = useRef({ active: false, pointerId: -1, startY: 0, startPx: 0, lastPx: 0 });

  /** Single writer for `--sheet-y`, so React and the drag never fight over it. */
  const writeOffset = useCallback((value: string) => {
    sheetRef.current?.style.setProperty('--sheet-y', value);
  }, []);

  // Settle on the snap point whenever it changes. This is intentionally an
  // effect rather than a `style` prop: if React owned the property it would skip
  // the write when a drag ended on the snap index it started from, leaving the
  // sheet stranded at whatever pixel offset the finger stopped at.
  useEffect(() => {
    writeOffset(`${offsetPct(snapIndex)}dvh`);
  }, [snapIndex, writeOffset]);

  // Raising on selection is the point of the sheet: tapping a hex on mobile
  // should reveal the detail it just loaded. Only ever raise — if the sheet is
  // already up, leave the user's choice alone.
  const selectedBinId = useFleetStore((s) => s.selectedBinId);
  useEffect(() => {
    if (selectedBinId) setSnapIndex((i) => (i === 0 ? 1 : i));
  }, [selectedBinId]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;

      const drag = dragRef.current;
      drag.active = true;
      drag.pointerId = event.pointerId;
      drag.startY = event.clientY;
      drag.startPx = offsetPx(snapIndex);
      drag.lastPx = drag.startPx;

      // Pointer capture keeps the drag alive when the finger leaves the handle —
      // which it will, since the handle is 36px tall and the travel is ~70dvh.
      event.currentTarget.setPointerCapture(event.pointerId);
      sheetRef.current?.setAttribute('data-dragging', 'true');
    },
    [snapIndex],
  );

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag.active || event.pointerId !== drag.pointerId) return;

    drag.lastPx = clamp(drag.startPx + (event.clientY - drag.startY), 0, offsetPx(0));
    sheetRef.current?.style.setProperty('--sheet-y', `${drag.lastPx}px`);
  }, []);

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      if (!drag.active || event.pointerId !== drag.pointerId) return;

      drag.active = false;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      sheetRef.current?.removeAttribute('data-dragging');

      // A tap, or a nudge too small to mean anything — settle back. The click
      // handler below takes it from here and cycles the snap point.
      if (Math.abs(drag.lastPx - drag.startPx) < DRAG_COMMIT_PX) {
        writeOffset(`${offsetPct(snapIndex)}dvh`);
        return;
      }

      const nearest = nearestSnap(drag.lastPx);
      // Ending on the same index won't re-run the settle effect, so write here.
      if (nearest === snapIndex) writeOffset(`${offsetPct(snapIndex)}dvh`);
      else setSnapIndex(nearest);
    },
    [snapIndex, writeOffset],
  );

  // Tap cycles up a step and wraps back to peek from the top — the affordance
  // for people who would rather not drag at all.
  const onHandleClick = useCallback(() => {
    setSnapIndex((i) => (i === 2 ? 0 : ((i + 1) as SnapIndex)));
  }, []);

  const onHandleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSnapIndex((i) => Math.min(i + 1, 2) as SnapIndex);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSnapIndex((i) => Math.max(i - 1, 0) as SnapIndex);
    }
  }, []);

  return (
    <div
      ref={sheetRef}
      id="fleet-sheet"
      className="fleet-sheet flex flex-col bg-surface md:w-80 md:shrink-0 md:border-l md:border-border"
      data-snap={SNAP_LABELS[snapIndex]}
    >
      <button
        type="button"
        className="fleet-sheet__handle group flex w-full shrink-0 cursor-grab touch-none items-center justify-center py-3 active:cursor-grabbing md:hidden"
        aria-controls="fleet-sheet"
        aria-expanded={snapIndex > 0}
        aria-label={`Fleet detail panel, ${SNAP_LABELS[snapIndex]} height. Drag, tap, or use arrow keys to resize.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={onHandleClick}
        onKeyDown={onHandleKeyDown}
      >
        <span
          aria-hidden="true"
          className="h-1 w-9 rounded-full bg-border-strong transition-colors group-hover:bg-text-muted"
        />
      </button>

      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
