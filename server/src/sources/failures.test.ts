import { describe, expect, it } from 'vitest';
import { sourceFailure } from './failures';

describe('source failure categories', () => {
  it.each([
    ['CONFIG_REQUIRED: private service settings', 'CONFIG_REQUIRED', 'configuration_required'],
    ["Method 'explore' is not defined on the plugin.", 'HOME_UNSUPPORTED', 'unsupported'],
    ['Titanhub does not support Venera Cookie management', 'CAPABILITY_UNSUPPORTED', 'unsupported'],
    ['Sandbox execution rejected: interrupted', 'TIMEOUT', 'timeout'],
    ['Mangayomi HTTP 403: example.test', 'HTTP_403', 'error'],
    ['HTTP 429', 'HTTP_429', 'error'],
    ['Public DNS query failed: NXDOMAIN', 'DNS_ERROR', 'error'],
    ['SecurityError: private address', 'NETWORK_POLICY', 'error'],
    ['Unexpected token < in JSON', 'PARSE_ERROR', 'error'],
  ])('classifies %s', (message, code, status) => {
    expect(sourceFailure(new Error(message))).toMatchObject({ code, status });
  });

  it('does not expose upstream credentials or stack traces', () => {
    const result = sourceFailure(new Error('HTTP 403 https://user:password@example.test/?token=secret\n at source.js:1'));
    expect(JSON.stringify(result)).not.toMatch(/password|secret|source.js/);
  });
});
