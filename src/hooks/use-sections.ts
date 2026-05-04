'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { listLabels, updateLabel } from '@/lib/gmail';
import { getAccessToken, getActiveEmail } from '@/lib/gmail-token';
import { Section } from '@/types/preferences';

const PRIMARY: Section = { id: 'primary', name: 'Inbox', gmailLabel: null };

function parseCleaveLabel(labelName: string): { order: number; displayName: string } {
  const match = labelName.match(/^Cleave\/(\d+)-(.+)$/);
  if (match) {
    return { order: parseInt(match[1], 10), displayName: match[2] };
  }
  // Legacy label without numeric prefix
  return { order: Infinity, displayName: labelName.slice('Cleave/'.length) };
}

export function useSections() {
  const [sections, setSections] = useState<Section[]>([PRIMARY]);
  // Each refresh increments this; only the latest in-flight call commits its
  // result. Without this, an account swap can race: the pre-swap refresh
  // (with the old account's token) resolves last and overwrites the
  // post-swap labels, leaving the UI showing the wrong account's sections.
  const refreshIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const myId = ++refreshIdRef.current;
    const token = getAccessToken();
    const emailAtFetch = getActiveEmail();
    if (!token) return;
    try {
      const labels = await listLabels(token);
      if (myId !== refreshIdRef.current || emailAtFetch !== getActiveEmail()) return;
      const derived: Section[] = labels
        .filter((l) => l.name.startsWith('Cleave/') && l.name !== 'Cleave/Snoozed')
        .map((l) => {
          const { order, displayName } = parseCleaveLabel(l.name);
          return { id: l.id, name: displayName, gmailLabel: l.id, _order: order };
        })
        .sort((a, b) => a._order - b._order)
        .map(({ _order, ...section }) => section);
      setSections([PRIMARY, ...derived]);
    } catch {
      // keep current sections on error
    }
  }, []);

  const reorder = useCallback(async (fromIndex: number, toIndex: number) => {
    const token = getAccessToken();
    if (!token || fromIndex === toIndex) return;

    // Work with non-primary sections only (fromIndex/toIndex are 1-based in the full array)
    const current = sections.slice(1); // remove PRIMARY
    const fi = fromIndex - 1;
    const ti = toIndex - 1;
    if (fi < 0 || fi >= current.length || ti < 0 || ti >= current.length) return;

    // Reorder the array
    const reordered = [...current];
    const [moved] = reordered.splice(fi, 1);
    reordered.splice(ti, 0, moved);

    // Optimistically update UI
    setSections([PRIMARY, ...reordered]);

    // Rename labels with new numeric prefixes
    try {
      await Promise.all(
        reordered.map((section, i) => {
          const newName = `Cleave/${String(i + 1).padStart(2, '0')}-${section.name}`;
          return updateLabel(token, section.id, { name: newName });
        })
      );
    } catch {
      // Revert on error by refreshing from Gmail
      await refresh();
    }
  }, [sections, refresh]);

  useEffect(() => {
    refresh();
    const onTokenReady = () => { refresh(); };
    window.addEventListener('cleave:token-ready', onTokenReady);
    return () => window.removeEventListener('cleave:token-ready', onTokenReady);
  }, [refresh]);

  return { sections, refresh, reorder };
}
