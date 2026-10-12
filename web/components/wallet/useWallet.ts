'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { getServerSnapshot, getSnapshot, initWallet, subscribe } from '@/lib/wallet/store';

/** Shared wallet state. Server render and hydration always see the disconnected state. */
export function useWallet() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => initWallet(), []);
  return state;
}

/** Clipboard write with a fallback for browsers/webviews without the async Clipboard API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall back below */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
