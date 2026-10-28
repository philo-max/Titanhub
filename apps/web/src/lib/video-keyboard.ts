const SHORTCUTS = {
  ' ': 'togglePlay',
  arrowleft: 'seekBackward',
  arrowright: 'seekForward',
  arrowup: 'volumeUp',
  arrowdown: 'volumeDown',
  m: 'toggleMute',
  f: 'toggleFullscreen',
} as const;

export type VideoKeyboardAction = typeof SHORTCUTS[keyof typeof SHORTCUTS];

export function bindVideoKeyboard(target: EventTarget, handle: (action: VideoKeyboardAction) => void): () => void {
  const onKeyDown = (event: Event) => {
    const keyEvent = event as KeyboardEvent;
    if (keyEvent.defaultPrevented || keyEvent.isComposing || keyEvent.ctrlKey || keyEvent.altKey || keyEvent.metaKey || keyEvent.shiftKey) return;
    const element = keyEvent.target as Element | null;
    if (element?.closest?.('input, textarea, select, [contenteditable], [role="textbox"], [role="slider"]')) return;
    if (keyEvent.key === ' ' && element?.closest?.('button, a[href], [role="button"]')) return;
    const key = keyEvent.key.toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(SHORTCUTS, key)) return;
    const action = SHORTCUTS[key as keyof typeof SHORTCUTS];
    keyEvent.preventDefault();
    if (keyEvent.repeat && (action === 'togglePlay' || action === 'toggleMute' || action === 'toggleFullscreen')) return;
    handle(action);
  };
  target.addEventListener('keydown', onKeyDown);
  return () => target.removeEventListener('keydown', onKeyDown);
}
