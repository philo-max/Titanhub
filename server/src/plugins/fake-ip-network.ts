import { isIP } from 'node:net';
import { request as httpRequest, type ClientRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const DNS_TIMEOUT_MS = 2500;
const DNS_RETRIES = 1;
const MAX_DNS_BYTES = 16384;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export class PinnedNetworkError extends Error {}

export function isPrivateOrReservedIp(ip: string): boolean {
  const privateIpRegex = /^(0\.|127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|169\.254\.|100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\.|192\.0\.0\.|198\.(1[8-9])\.|(22[4-9]|23[0-9])\.|(24[0-9]|25[0-5])\.)/;
  if (privateIpRegex.test(ip)) return true;
  const normalized = ip.toLowerCase();
  return normalized === '::1' || normalized === '::' || normalized.startsWith('fe80:') || normalized.startsWith('fc00:') || normalized.startsWith('fd00:') || normalized.startsWith('::ffff:') || normalized.startsWith('2001:db8:');
}

export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  return family !== 0 && (family !== 6 || /^[23][0-9a-f]{3}:/i.test(ip)) && !isPrivateOrReservedIp(ip) && !/^(192\.0\.2\.|192\.88\.99\.|198\.51\.100\.|203\.0\.113\.)/.test(ip);
}

async function boundedBody(response: { body: ReadableStream<Uint8Array> | null }, maximum: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new Error(`Response exceeded ${maximum} bytes limit.`);
      chunks.push(value);
    }
    return new Uint8Array(Buffer.concat(chunks));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

class TransientDnsError extends Error {}

const pendingLookups = new Map<string, Promise<string>>();

export function resolveFakeIpAddress(hostname: string): Promise<string> {
  const pending = pendingLookups.get(hostname);
  if (pending) return pending;
  const lookup = (async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await queryPublicDns(hostname);
      } catch (error) {
        if (attempt >= DNS_RETRIES || !(error instanceof TransientDnsError)) throw error;
      }
    }
  })().finally(() => pendingLookups.delete(hostname));
  pendingLookups.set(hostname, lookup);
  return lookup;
}

async function queryPublicDns(hostname: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DNS_TIMEOUT_MS);
  try {
    const query = new URLSearchParams({ name: hostname, type: 'A' });
    const response = await fetch(`https://cloudflare-dns.com/dns-query?${query}`, {
      headers: { accept: 'application/dns-json' }, redirect: 'error', signal: controller.signal,
    }).catch(error => {
      throw new TransientDnsError(error instanceof Error ? error.message : String(error));
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429 || response.status >= 500) throw new TransientDnsError('Public DNS resolver request failed.');
      throw new Error('Public DNS resolver request failed.');
    }
    const data: unknown = JSON.parse(Buffer.from(await boundedBody(response, MAX_DNS_BYTES)).toString('utf8'));
    if (!data || typeof data !== 'object' || !('Status' in data) || data.Status !== 0 || !('Answer' in data) || !Array.isArray(data.Answer)) {
      throw new Error('Invalid public DNS response.');
    }
    const addresses = data.Answer.filter(entry => entry && (entry.type === 1 || entry.type === 28));
    if (!addresses.length || addresses.some(entry => typeof entry.data !== 'string' || !isPublicAddress(entry.data) || isIP(entry.data) !== (entry.type === 1 ? 4 : 6))) {
      throw new Error('Public DNS answer contains invalid or non-public addresses.');
    }
    const selected = addresses.find(entry => entry.type === 1);
    if (!selected) throw new Error('Public DNS returned no IPv4 addresses.');
    return selected.data;
  } catch (error) {
    const message = `Public DNS validation failed: ${error instanceof Error ? error.message : String(error)}`;
    throw error instanceof TransientDnsError ? new TransientDnsError(message) : new Error(message);
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchPinnedPublic(url: string, address: string, options: RequestInit): Promise<Response> {
  if (isIP(address) !== 4 || !isPublicAddress(address)) throw new PinnedNetworkError('Pinned address must be public IPv4.');
  if (process.env.PROXY_URL || process.env.HTTP_PROXY || process.env.HTTPS_PROXY) {
    throw new PinnedNetworkError('Fake-IP with an explicit HTTP proxy cannot safely pin the destination; use TUN without an explicit proxy.');
  }
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new PinnedNetworkError('Pinned transport requires HTTP or HTTPS.');
  const body = options.body;
  if (body != null && typeof body !== 'string' && !(body instanceof Uint8Array) && !(body instanceof URLSearchParams)) {
    throw new PinnedNetworkError('Unsupported pinned request body.');
  }
  const method = (options.method || 'GET').toUpperCase();
  const requestHeaders = new Headers(options.headers);
  requestHeaders.delete('host');
  requestHeaders.set('accept-encoding', 'identity');
  const send = parsed.protocol === 'https:' ? httpsRequest : httpRequest;
  let request: ClientRequest | undefined;
  try {
    return await new Promise<Response>((resolve, reject) => {
      request = send(parsed, {
        method, headers: Object.fromEntries(requestHeaders.entries()),
        agent: false, signal: options.signal ?? undefined,
        lookup: (requested, settings, callback) => {
          if (requested !== parsed.hostname) { callback(new Error('Pinned hostname mismatch.'), []); return; }
          if (typeof settings === 'object' && settings.all) callback(null, [{ address, family: 4 }]);
          else callback(null, address, 4);
        },
      }, response => {
        void (async () => {
          if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
            throw new PinnedNetworkError('Pinned server ignored identity encoding request.');
          }
          const chunks: Uint8Array[] = [];
          let size = 0;
          for await (const chunk of response) {
            const bytes = Buffer.from(chunk);
            size += bytes.byteLength;
            if (size > MAX_RESPONSE_BYTES) throw new PinnedNetworkError(`Response exceeded ${MAX_RESPONSE_BYTES} bytes limit.`);
            chunks.push(bytes);
          }
          const headers = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) headers.append(name, entry);
          }
          const status = response.statusCode || 500;
          resolve(new Response([101, 204, 205, 304].includes(status) || method === 'HEAD' ? null : new Uint8Array(Buffer.concat(chunks)), {
            status, statusText: response.statusMessage, headers,
          }));
        })().catch(reject);
      });
      request.once('error', reject);
      request.end(body instanceof URLSearchParams ? body.toString() : body);
    });
  } finally {
    request?.destroy();
  }
}
