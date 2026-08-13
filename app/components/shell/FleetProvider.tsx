'use client';

import type { ReactNode } from 'react';
import { useFleetData } from '@/store/useFleetData';
import { useSSEStream } from '@/store/useSSEStream';
import { useUrlSync } from '@/store/useUrlSync';


// FleetProvider — the single client boundary that hosts app-level hooks.
//
// Not in agents.md §3's file list, but required: page.tsx is an RSC shell, and
// hooks (data bootstrap, URL sync, SSE subscription) can only run in a client
// component. Keeping them in ONE host means they mount once, and it renders
// {children} untouched — no context, no provider re-render cascade, so a filter
// or SSE tick never re-renders the tree through this component.

export function FleetProvider({ children }: { children: ReactNode }) {
  useFleetData(); // GET /api/bins → store.setSnapshot (fast first paint)
  useSSEStream(); // GET /api/stream → store.applyDiff (live diffs, no reconcile)
  useUrlSync(); // ?region=&status= ↔ store.filters


  return <>{children}</>;
}
