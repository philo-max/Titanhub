export const MAX_MANGA_IMAGE_RETRIES = 3;

export function canRetryMangaImage(retryCount: number): boolean {
  return retryCount < MAX_MANGA_IMAGE_RETRIES;
}

export function mangaImageAttemptKey(src: string, retryCount: number): string {
  return `${retryCount}:${src}`;
}
