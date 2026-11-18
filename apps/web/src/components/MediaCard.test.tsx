import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import MediaCard from './MediaCard';

describe('MediaCard cover loading', () => {
  it('uses the existing optimized image path for MangaDex covers', () => {
    const html = renderToStaticMarkup(<MediaCard item={{
      id: 'manga-id',
      title: 'Manga',
      cover: 'https://uploads.mangadex.org/covers/manga-id/cover.jpg',
    }} />);
    expect(html).toContain('/_next/image?url=https%3A%2F%2Fuploads.mangadex.org');
    expect(html).toContain('alt="Manga"');
  });

  it('keeps the title fallback when no cover is supplied', () => {
    const html = renderToStaticMarkup(<MediaCard item={{ id: 'empty', title: '漫画', cover: '' }} />);
    expect(html).not.toContain('<img');
    expect(html).toContain('漫');
  });
});
