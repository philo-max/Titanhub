import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightSniffer } from './sniffer';
import http from 'http';

describe('PlaywrightSniffer E2E', () => {
  let server: http.Server;
  let serverUrl: string;

  beforeAll(() => {
    // Start local server to serve mock HTML page
    server = http.createServer((req, res) => {
      if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Mock Player Page</title>
          </head>
          <body>
            <h1>Loading dynamic streams...</h1>
            <script>
              // Dynamically fetch mock video URL after 500ms
              setTimeout(() => {
                fetch('/stream.m3u8');
              }, 500);
            </script>
          </body>
          </html>
        `);
      } else if (req.url === '/stream.m3u8') {
        res.writeHead(200, { 'Content-Type': 'application/x-mpegURL' });
        res.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=150000\n/stream-low.m3u8');
      } else if (req.url?.startsWith('/parser')) {
        // Parser page whose URL embeds the real m3u8 in its query string; it
        // loads the real stream shortly after, like site player iframes do
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <body>
            <script>
              setTimeout(() => { fetch('/real/index.m3u8'); }, 500);
            </script>
          </body>
          </html>
        `);
      } else if (req.url === '/real/index.m3u8') {
        res.writeHead(200, { 'Content-Type': 'application/x-mpegURL' });
        res.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=150000\n/real-low.m3u8');
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    return new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as any;
        serverUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await PlaywrightSniffer.close();
    return new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('sniffs dynamically triggered requests for .m3u8 streams', async () => {
    const sniffed = await PlaywrightSniffer.sniff(serverUrl);
    expect(sniffed).toContain('/stream.m3u8');
  });

  it('ignores parser pages that only carry m3u8 in the query string', async () => {
    // The parser page URL itself must not be mistaken for the manifest;
    // only the real .m3u8 pathname request qualifies
    const sniffed = await PlaywrightSniffer.sniff(
      `${serverUrl}/parser?url=${encodeURIComponent(`${serverUrl}/real/index.m3u8`)}`
    );
    expect(sniffed).toContain('/real/index.m3u8');
    expect(sniffed).not.toContain('/parser');
  });
});
