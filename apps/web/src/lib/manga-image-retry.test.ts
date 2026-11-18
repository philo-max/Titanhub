import { describe, expect, it } from 'vitest';
import { MAX_MANGA_IMAGE_RETRIES, canRetryMangaImage, mangaImageAttemptKey } from './manga-image-retry';

describe('manga image retry', () => {
  it('remounts with a new key while keeping signed source URLs untouched', () => {
    const src = 'https://cdn.example/a.jpg?X-Amz-Signature=abc%2F%3D&Expires=1';
    const keys = [0, 1, 2].map((attempt) => mangaImageAttemptKey(src, attempt));
    expect(new Set(keys).size).toBe(3);
    expect(src).toBe('https://cdn.example/a.jpg?X-Amz-Signature=abc%2F%3D&Expires=1');
    expect(keys.every((key) => key.endsWith(src))).toBe(true);
  });

  it('allows a bounded number of manual retries', () => {
    expect(MAX_MANGA_IMAGE_RETRIES).toBeGreaterThan(0);
    expect(canRetryMangaImage(0)).toBe(true);
    expect(canRetryMangaImage(MAX_MANGA_IMAGE_RETRIES - 1)).toBe(true);
    expect(canRetryMangaImage(MAX_MANGA_IMAGE_RETRIES)).toBe(false);
  });
});
