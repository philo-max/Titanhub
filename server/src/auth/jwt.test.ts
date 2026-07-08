import { describe, it, expect } from 'vitest';
import { signUserToken, verifyUserToken } from './jwt';

describe('JWT auth tokens', () => {
  it('verifies a token it signed and returns the user id', async () => {
    const token = await signUserToken('user-123');
    expect(token.split('.')).toHaveLength(3);
    expect(await verifyUserToken(token)).toBe('user-123');
  });

  it('rejects a token with a tampered signature', async () => {
    const token = await signUserToken('user-123');
    const [header, payload] = token.split('.');
    expect(
      await verifyUserToken(`${header}.${payload}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`)
    ).toBeNull();
  });

  it('rejects a token with a tampered payload', async () => {
    const tokenA = await signUserToken('user-a');
    const tokenB = await signUserToken('user-b');
    const [headerA, , sigA] = tokenA.split('.');
    const [, payloadB] = tokenB.split('.');
    expect(await verifyUserToken(`${headerA}.${payloadB}.${sigA}`)).toBeNull();
  });

  it('rejects garbage and legacy raw-uuid tokens', async () => {
    expect(await verifyUserToken('not-a-token')).toBeNull();
    expect(await verifyUserToken('0b0b87a2-1111-2222-3333-444455556666')).toBeNull();
    expect(await verifyUserToken('')).toBeNull();
  });
});
