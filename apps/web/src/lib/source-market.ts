interface SourceVersion {
  id: string;
  version: string;
  installable?: boolean;
}

export async function installMarketSources<T extends SourceVersion>(
  sources: T[],
  installed: SourceVersion[],
  install: (source: T) => Promise<void>,
  progress: (completed: number, total: number) => void,
) {
  const pending = sources.filter(source => source.installable !== false && !installed.some(current => current.id === source.id && current.version === source.version));
  const succeeded: string[] = [];
  const failed: { id: string; error: string }[] = [];
  progress(0, pending.length);
  for (const source of pending) {
    try {
      await install(source);
      succeeded.push(source.id);
    } catch (error) {
      failed.push({ id: source.id, error: error instanceof Error ? error.message : String(error) });
    }
    progress(succeeded.length + failed.length, pending.length);
  }
  return { succeeded, failed };
}
