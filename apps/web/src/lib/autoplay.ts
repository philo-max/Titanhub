export type StartIntent = 'autoplay' | 'resume' | 'none';

export type StartResult =
  | { status: 'started' | 'skipped' | 'stale' }
  | { status: 'blocked' | 'failed'; error: unknown };

interface PlayableMedia {
  play(): Promise<void> | void;
}

export interface StartGate {
  arm(intent: StartIntent): void;
  take(): StartIntent;
}

export function createStartGate(): StartGate {
  let pending: StartIntent = 'none';
  return {
    arm(intent) { pending = intent; },
    take() {
      const intent = pending;
      pending = 'none';
      return intent;
    },
  };
}

export function intentAfterQualitySwitch(wasPlaying: boolean): StartIntent {
  return wasPlaying ? 'resume' : 'none';
}

export async function startPlayback(media: PlayableMedia, intent: StartIntent, isCurrent: () => boolean = () => true): Promise<StartResult> {
  if (intent === 'none') return { status: 'skipped' };
  try {
    await media.play();
    return isCurrent() ? { status: 'started' } : { status: 'stale' };
  } catch (error) {
    if (!isCurrent()) return { status: 'stale' };
    const blocked = (error as { name?: unknown } | null)?.name === 'NotAllowedError';
    return { status: blocked ? 'blocked' : 'failed', error };
  }
}
