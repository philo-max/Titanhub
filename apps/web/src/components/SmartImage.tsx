'use client';

import React, { useState } from 'react';
import Image from 'next/image';

/**
 * Hostname patterns that mirror next.config.js `images.remotePatterns`.
 * When a remote URL's hostname matches, we use next/image (optimized).
 * Otherwise we fall back to a plain <img> to avoid next/image's synchronous
 * "hostname not configured" throw during render.
 *
 * Keep this list in sync with `remotePatterns` in next.config.js.
 */
const OPTIMIZED_HOSTNAMES: { hostname: string; protocol?: string }[] = [
  { hostname: 'lain.bgm.tv', protocol: 'https' },
  { hostname: 'lain.bgm.tv', protocol: 'http' },
  { hostname: 'bgmimg.anibt.net' },
  { hostname: 'www.gugu3.com' },
  { hostname: 'www.mdzypic.com' },
  { hostname: 'snzypic.vip' },
  { hostname: 'tupian.ffeiimg.com' },
  { hostname: 'uploads.mangadex.org' },
  { hostname: 'picsum.photos' },
  { hostname: 'tncache1-f1.v3mh.com' },
  { hostname: 'localhost', protocol: 'http' },
];

/** Wildcard hostname patterns (e.g. `*.byteimg.com`) */
const OPTIMIZED_WILDCARDS: string[] = [
  '.byteimg.com', // matches *.byteimg.com
];

function isOptimizedHostname(url: string): boolean {
  try {
    const parsed = new URL(url);
    const { hostname, protocol } = parsed;

    // Check exact matches
    for (const entry of OPTIMIZED_HOSTNAMES) {
      if (entry.hostname === hostname) {
        if (!entry.protocol || entry.protocol === protocol.replace(':', '')) {
          return true;
        }
      }
    }

    // Check wildcard matches (e.g. *.byteimg.com)
    for (const suffix of OPTIMIZED_WILDCARDS) {
      if (hostname.endsWith(suffix)) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Smart image component:
 * - Local images (starting with `/`) → next/image (always optimized)
 * - Remote images on whitelisted domains → next/image (optimized)
 * - Remote images on unknown domains → plain <img> (avoids next/image throw)
 * - On next/image load error → falls back to <img> then placeholder
 */
export default function SmartImage({
  src,
  alt,
  width,
  height,
  fill,
  sizes,
  className,
  priority,
  fallbackSrc = '/images/placeholder.png',
}: {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  fill?: boolean;
  sizes?: string;
  className?: string;
  priority?: boolean;
  fallbackSrc?: string;
}) {
  const [imgError, setImgError] = useState(false);
  const [optimError, setOptimError] = useState(false);

  // Empty or undefined src — use placeholder directly
  if (!src) {
    if (fill) {
      return (
        <Image
          src={fallbackSrc}
          alt={alt}
          fill
          sizes={sizes || '100vw'}
          className={className}
        />
      );
    }
    return (
      <Image
        src={fallbackSrc}
        alt={alt}
        width={width || 256}
        height={height || 352}
        className={className}
      />
    );
  }

  // Local images — always use next/image
  if (src.startsWith('/') && !src.startsWith('//')) {
    if (fill) {
      return (
        <Image src={src} alt={alt} fill sizes={sizes || '100vw'} className={className} priority={priority} />
      );
    }
    return (
      <Image src={src} alt={alt} width={width || 256} height={height || 352} className={className} priority={priority} />
    );
  }

  // Remote images: check if hostname is whitelisted
  const canOptimize = isOptimizedHostname(src);

  // If hostname is not whitelisted, or if next/image already errored,
  // use a plain <img> to avoid the synchronous hostname validation throw.
  if (!canOptimize || optimError) {
    if (imgError) {
      // Both next/image and <img> failed — show placeholder via next/image (local file)
      if (fill) {
        return (
          <Image src={fallbackSrc} alt={alt} fill sizes={sizes || '100vw'} className={className} />
        );
      }
      return (
        <Image src={fallbackSrc} alt={alt} width={width || 256} height={height || 352} className={className} />
      );
    }
    return (
      <img
        src={src}
        alt={alt}
        className={className}
        loading="lazy"
        decoding="async"
        onError={() => setImgError(true)}
      />
    );
  }

  // Whitelisted remote: use next/image with onError fallback
  if (fill) {
    return (
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes || '100vw'}
        className={className}
        priority={priority}
        onError={() => setOptimError(true)}
      />
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={width || 256}
      height={height || 352}
      className={className}
      priority={priority}
      onError={() => setOptimError(true)}
    />
  );
}
