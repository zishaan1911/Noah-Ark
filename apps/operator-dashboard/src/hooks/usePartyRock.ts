import type { Mission, SosRequest } from '@contracts';
import { useEffect, useRef, useState } from 'react';
import { missionFromText, sosFromText } from '../lib/partyrock';

export type PartyRockItem = { kind: 'mission'; mission: Mission } | { kind: 'sos'; sos: SosRequest };

/**
 * Picks up a mission or SOS request copied from PartyRock: on returning to this tab (clipboard read, the browser
 * asks once) or on Ctrl+V anywhere. PartyRock cannot call out, so the clipboard is the hand-off.
 * shortcut: clipboard hand-off, replace with the mission-planner API once PartyRock output goes through Ark Brain.
 */
export function usePartyRock(): PartyRockItem | null {
  const [item, setItem] = useState<PartyRockItem | null>(null);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    const take = (text: string) => {
      const sos = sosFromText(text);
      const mission = sos ? null : missionFromText(text);
      const next: PartyRockItem | null = sos
        ? { kind: 'sos', sos }
        : mission
          ? { kind: 'mission', mission }
          : null;
      if (!next) return;
      const id = next.kind === 'sos' ? next.sos.id : next.mission.id;
      if (seen.current.has(id)) return; // the same copy is imported once
      seen.current.add(id);
      setItem(next);
    };
    const onFocus = () => {
      // Denied or unsupported clipboard access: Ctrl+V still works.
      navigator.clipboard?.readText().then(take, () => undefined);
    };
    const onPaste = (e: ClipboardEvent) => take(e.clipboardData?.getData('text') ?? '');
    window.addEventListener('focus', onFocus);
    document.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('paste', onPaste);
    };
  }, []);

  return item;
}
