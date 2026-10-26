interface ResumePosition {
  progress?: number;
  position?: number | null;
}

interface ResumeIdentity {
  mediaType: string;
  pluginId: string;
  mediaId: string;
  chapterId?: string;
}

export function findResumeLog<T extends ResumeIdentity>(logs: T[], identity: ResumeIdentity): T | undefined {
  if (!identity.chapterId) return undefined;
  return logs.find((log) => log.mediaType === identity.mediaType
    && log.pluginId === identity.pluginId && log.mediaId === identity.mediaId
    && log.chapterId === identity.chapterId);
}

function finitePosition(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value: number, maximum: number): number {
  return Math.max(0, Math.min(value, maximum));
}

export function novelResumeRatio(log?: ResumePosition): number {
  const value = finitePosition(log?.position) ? log.position : log?.progress;
  return finitePosition(value) ? clamp(value, 1) : 0;
}

export function videoResumeTime(log: ResumePosition | undefined, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return finitePosition(log?.position)
    ? clamp(log.position, duration) : novelResumeRatio({ progress: log?.progress }) * duration;
}

export function mangaResumePage(log: ResumePosition | undefined, count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  const page = finitePosition(log?.position) ? Math.floor(log.position)
    : Math.ceil(novelResumeRatio({ progress: log?.progress }) * count) - 1;
  return clamp(page, count - 1);
}
