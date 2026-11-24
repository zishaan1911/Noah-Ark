import type { Mission } from '@contracts';
import { useEffect, useRef, useState } from 'react';
import { missionFromText } from '../lib/partyrock';

/**
 * Picks up a mission copied from the PartyRock dispatch app: on returning to this tab (clipboard read, the browser
 * asks once) or on Ctrl+V anywhere. PartyRock cannot call out, so the clipboard is the hand-off.
 * shortcut: clipboard hand-off, replace with the mission-planner API once PartyRock output goes through Ark Brain.
 */
export function usePartyRockMission(): Mission | null {
  const [mission, setMission] = useState<Mission | null>(null);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    const take = (text: string) => {
      const m = missionFromText(text);
      if (!m || seen.current.has(m.id)) return; // the same copy is imported once
      seen.current.add(m.id);
      setMission(m);
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

  return mission;
}
