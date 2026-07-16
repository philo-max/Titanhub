/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    // Whitelist of known cover CDN domains across all plugins.
    // Do NOT use hostname: '**' — it turns the Next.js image optimizer
    // into an open proxy that bypasses the plugin sandbox's SSRF protection.
    // When a new plugin adds a new CDN domain, add it here.
    remotePatterns: [
      // Bangumi
      { protocol: 'https', hostname: 'lain.bgm.tv' },
      { protocol: 'http', hostname: 'lain.bgm.tv' },
      { protocol: 'https', hostname: 'bgmimg.anibt.net' },
      // gugu3
      { protocol: 'https', hostname: 'www.gugu3.com' },
      // fcdm
      { protocol: 'https', hostname: 'www.mdzypic.com' },
      // 7sefun
      { protocol: 'https', hostname: 'snzypic.vip' },
      // aafun
      { protocol: 'https', hostname: 'tupian.ffeiimg.com' },
      // MangaDex
      { protocol: 'https', hostname: 'uploads.mangadex.org' },
      // Mock / placeholder
      { protocol: 'https', hostname: 'picsum.photos' },
      { protocol: 'https', hostname: 'tncache1-f1.v3mh.com' },
      // ByteDance ImageX (gugu3 video covers)
      { protocol: 'https', hostname: '*.byteimg.com' },
      // Local
      { protocol: 'http', hostname: 'localhost' },
    ],
    // Do NOT enable dangerouslyAllowSVG — SVG can embed <script> and the
    // optimizer does not sanitize content. If SVG covers are needed in the
    // future, serve them through a sanitizing proxy instead.
  },
};

module.exports = nextConfig;
