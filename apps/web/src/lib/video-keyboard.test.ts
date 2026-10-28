import { describe, expect, it, vi } from 'vitest';
import { bindVideoKeyboard } from './video-keyboard';

function keyEvent(overrides: Record<string, unknown> = {}) {
  const event = new Event('keydown', { cancelable: true });
  Object.defineProperties(event, Object.fromEntries(
    Object.entries({ key: ' ', repeat: false, ...overrides }).map(([key, value]) => [key, { value }])
  ));
  return event;
}

describe('video keyboard shortcuts', () => {
  it.each([
    [' ', 'togglePlay'], ['ArrowLeft', 'seekBackward'], ['ArrowRight', 'seekForward'],
    ['ArrowUp', 'volumeUp'], ['ArrowDown', 'volumeDown'], ['m', 'toggleMute'],
    ['M', 'toggleMute'], ['f', 'toggleFullscreen'], ['F', 'toggleFullscreen'],
  ])('maps %s to %s', (key, action) => {
    const target = new EventTarget();
    const handle = vi.fn();
    bindVideoKeyboard(target, handle);
    const event = keyEvent({ key });
    target.dispatchEvent(event);
    expect(handle).toHaveBeenCalledWith(action);
    expect(event.defaultPrevented).toBe(true);
  });

  it('allows repeated seeking', () => {
    const target = new EventTarget();
    const handle = vi.fn();
    bindVideoKeyboard(target, handle);
    target.dispatchEvent(keyEvent({ key: 'ArrowRight', repeat: true }));
    expect(handle).toHaveBeenCalledWith('seekForward');
  });

  it('allows fullscreen while a control button has focus', () => {
    const target = new EventTarget();
    const handle = vi.fn();
    bindVideoKeyboard(target, handle);
    target.dispatchEvent(keyEvent({ key: 'f', target: { closest: (selector: string) => selector.includes('button') ? {} : null } }));
    expect(handle).toHaveBeenCalledWith('toggleFullscreen');
  });
  it('toggles playback once and prevents space from scrolling the page', () => {
    const target = new EventTarget();
    const toggle = vi.fn();
    const release = bindVideoKeyboard(target, toggle);
    const event = keyEvent();
    target.dispatchEvent(event);
    expect(toggle).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
    release();
    target.dispatchEvent(keyEvent());
    expect(toggle).toHaveBeenCalledOnce();
  });

  it.each([
    { key: 'Enter' }, { isComposing: true },
    { ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true },
  ])('leaves unrelated, repeated and modified keys alone: %j', (overrides) => {
    const target = new EventTarget();
    const toggle = vi.fn();
    bindVideoKeyboard(target, toggle);
    const event = keyEvent(overrides);
    target.dispatchEvent(event);
    expect(toggle).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it.each([' ', 'm', 'f'])('suppresses repeated %s without scrolling', (key) => {
    const target = new EventTarget();
    const handle = vi.fn();
    bindVideoKeyboard(target, handle);
    const event = keyEvent({ key, repeat: true });
    target.dispatchEvent(event);
    expect(handle).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('respects previously handled events', () => {
    const target = new EventTarget();
    const toggle = vi.fn();
    bindVideoKeyboard(target, toggle);
    const event = keyEvent();
    event.preventDefault();
    target.dispatchEvent(event);
    expect(toggle).not.toHaveBeenCalled();
  });

  it.each(['input', 'textarea', 'select', 'button', 'a[href]', '[contenteditable]'])('preserves %s keyboard interaction', (selector) => {
    const target = new EventTarget();
    const toggle = vi.fn();
    bindVideoKeyboard(target, toggle);
    const closest = vi.fn((selectors: string) => selectors.includes(selector) ? {} : null);
    const event = keyEvent({ target: { closest } });
    target.dispatchEvent(event);
    expect(toggle).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
