// Whether the online room is currently showing a match (dark, full-screen)
// or a regular page (lobby, name prompt) with the site chrome around it.
import { useSyncExternalStore } from 'react';

let inMatch = false;
const listeners = new Set<() => void>();
export function setRoomInMatch(v: boolean) {
  if (inMatch === v) return;
  inMatch = v;
  listeners.forEach((l) => l());
}
export const useRoomInMatch = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => inMatch,
  );
