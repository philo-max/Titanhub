import { describe, expect, it, vi } from 'vitest';
import { createStartGate, intentAfterQualitySwitch, startPlayback } from './autoplay';

const rejection = (name: string) => Object.assign(new Error(name), { name });

describe('startPlayback', () => {
  it('plays when the browser accepts the request', async () => {
    const media = { play: vi.fn(async () => undefined) };
    expect(await startPlayback(media, 'autoplay')).toEqual({ status: 'started' });
    expect(media.play).toHaveBeenCalledOnce();
  });

  it('reports a blocked autoplay without muting so the user can click play', async () => {
    const error = rejection('NotAllowedError');
    const media = { muted: false, play: vi.fn(async () => { throw error; }) };
    expect(await startPlayback(media, 'autoplay')).toEqual({ status: 'blocked', error });
    expect(media.muted).toBe(false);
    expect(media.play).toHaveBeenCalledOnce();
  });

  it('reports other playback failures with their error', async () => {
    const error = rejection('NotSupportedError');
    expect(await startPlayback({ play: async () => { throw error; } }, 'resume')).toEqual({ status: 'failed', error });
  });

  it('drops results that settle after the source changed or the player unmounted', async () => {
    let current = true;
    const blocked = rejection('NotAllowedError');
    const media = { play: vi.fn(async () => { current = false; throw blocked; }) };
    expect(await startPlayback(media, 'autoplay', () => current)).toEqual({ status: 'stale' });
    current = true;
    const accepted = { play: vi.fn(async () => { current = false; }) };
    expect(await startPlayback(accepted, 'autoplay', () => current)).toEqual({ status: 'stale' });
  });

  it('does not touch a paused video when no start was requested', async () => {
    const media = { play: vi.fn(async () => undefined) };
    expect(await startPlayback(media, 'none')).toEqual({ status: 'skipped' });
    expect(media.play).not.toHaveBeenCalled();
  });
});

describe('start intent', () => {
  it('autoplays once per entry so later restore events keep a manual pause', () => {
    const gate = createStartGate();
    gate.arm('autoplay');
    expect(gate.take()).toBe('autoplay');
    expect(gate.take()).toBe('none');
  });

  it('does not restart after a manual pause when metadata fires again', () => {
    const gate = createStartGate();
    gate.arm('autoplay');
    gate.arm('none');
    expect(gate.take()).toBe('none');
  });

  it('keeps the previous play state across quality switches', () => {
    expect(intentAfterQualitySwitch(true)).toBe('resume');
    expect(intentAfterQualitySwitch(false)).toBe('none');
    const gate = createStartGate();
    gate.arm('autoplay');
    gate.take();
    gate.arm(intentAfterQualitySwitch(false));
    expect(gate.take()).toBe('none');
  });
});
