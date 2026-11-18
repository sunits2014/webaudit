import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 20_000 });

let server: Server | undefined;
afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

/** The app with a limit of 2 requests per window, listening on a free port. */
async function start(trustProxyHops: string) {
  vi.resetModules();
  vi.stubEnv('RATE_LIMIT_MAX', '2');
  vi.stubEnv('TRUST_PROXY_HOPS', trustProxyHops);
  const { app } = await import('../src/app.js');
  server = app.listen(0);
  await new Promise((resolve) => server!.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  // An unknown route under /api/ is still counted by the API limiter (then answers 404).
  return (clientIp: string) => fetch(`http://127.0.0.1:${port}/api/v1/nothing`, { headers: { 'X-Forwarded-For': clientIp } }).then((r) => r.status);
}

describe('rate limiting behind a proxy', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('limits each client by its own address, not the proxy\'s', async () => {
    const call = await start('1');
    expect([await call('203.0.113.1'), await call('203.0.113.1'), await call('203.0.113.1')]).toEqual([404, 404, 429]);
    expect(await call('203.0.113.2')).toBe(404); // a different visitor still has their own allowance
  });

  it('ignores X-Forwarded-For when no proxy is trusted, so clients cannot fake their address', async () => {
    const call = await start('0');
    expect([await call('203.0.113.1'), await call('203.0.113.2'), await call('203.0.113.3')]).toEqual([404, 404, 429]);
  });
});
