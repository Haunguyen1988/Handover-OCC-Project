'use client';

import { useEffect } from 'react';
import { shiftForTime } from '../lib/format';
import type { Shift } from '../lib/types';

/**
 * Sets `data-shift` on `<html>` so the page picks up shift-aware accents
 * (Morning gold / Night indigo). Pass an explicit shift
 * to lock the accent (e.g. on the detail page show the handover's shift).
 */
export function useShiftTheme(explicit?: Shift | null) {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const shift = explicit ?? shiftForTime();
    const value = shift.toLowerCase();
    document.documentElement.setAttribute('data-shift', value);
  }, [explicit]);
}
