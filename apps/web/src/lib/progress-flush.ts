const FLUSH_PROGRESS_EVENT = 'titanhub:flush-progress';

export function bindProgressFlush(target: EventTarget, capture: () => void): () => void {
  target.addEventListener(FLUSH_PROGRESS_EVENT, capture);
  return () => target.removeEventListener(FLUSH_PROGRESS_EVENT, capture);
}

export function flushProgress(target: EventTarget = window): void {
  target.dispatchEvent(new Event(FLUSH_PROGRESS_EVENT));
}
