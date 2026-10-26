import { describe, expect, it, vi } from 'vitest';
import { bindProgressFlush, flushProgress } from './progress-flush';

describe('final progress capture', () => {
  it('captures synchronously before queued writes are drained', () => {
    const target = new EventTarget();
    const queue: number[] = [];
    const release = bindProgressFlush(target, () => queue.push(4.75));
    flushProgress(target);
    expect(queue).toEqual([4.75]);
    release();
  });

  it('removes the callback when a reader is replaced', () => {
    const target = new EventTarget();
    const oldReader = vi.fn();
    const newReader = vi.fn();
    bindProgressFlush(target, oldReader)();
    const release = bindProgressFlush(target, newReader);
    flushProgress(target);
    expect(oldReader).not.toHaveBeenCalled();
    expect(newReader).toHaveBeenCalledOnce();
    release();
  });
});
