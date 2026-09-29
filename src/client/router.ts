import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
let snapshot = { path: location.pathname, state: history.state as any };

function update() {
  snapshot = { path: location.pathname, state: history.state };
  listeners.forEach((l) => l());
}
window.addEventListener('popstate', update);

export function navigate(path: string, state: unknown = null, replace = false) {
  if (replace) history.replaceState(state, '', path);
  else history.pushState(state, '', path);
  window.scrollTo(0, 0);
  update();
}

export const useRoute = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
  );
