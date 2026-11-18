import { describe, expect, it, vi } from 'vitest';

/** Loads lighthouse.service with Lighthouse and Chrome stubbed; the stub records when each run starts and ends. */
async function loadWithStubbedLighthouse(failing: string[] = []) {
  vi.resetModules();
  const events: string[] = [];
  let active = 0;
  let maxActive = 0;
  vi.doMock('../src/config/env.js', () => ({ env: { CHROME_PATH: '', AUDIT_TIMEOUT_MS: 60_000 } }));
  vi.doMock('../src/utils/logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
  vi.doMock('../src/services/url-security.service.js', () => ({ validateRedirectChain: vi.fn().mockResolvedValue(undefined) }));
  vi.doMock('chrome-launcher', () => ({ launch: vi.fn().mockResolvedValue({ port: 9222, kill: vi.fn() }) }));
  vi.doMock('lighthouse', () => ({
    default: vi.fn(async (_url: string, options: { formFactor: string }) => {
      active++;
      maxActive = Math.max(maxActive, active);
      events.push(`start ${options.formFactor}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active--;
      events.push(`end ${options.formFactor}`);
      if (failing.includes(options.formFactor)) throw new Error(`${options.formFactor} blew up`);
      return {
        lhr: { categories: { performance: { score: 0.9 } }, audits: {}, fetchTime: '2026-11-17T00:00:00.000Z' },
        report: ['{"lighthouseVersion":"13.6.0"}', '<html>report</html>'],
      };
    }),
  }));
  const { runLighthouse } = await import('../src/services/lighthouse.service.js');
  return { runLighthouse, events, maxActive: () => maxActive };
}

describe('Lighthouse runs', () => {
  it('never overlap in one process: both strategies of an audit run one after the other', async () => {
    const { runLighthouse, events, maxActive } = await loadWithStubbedLighthouse();
    // What createAudit does: start every strategy at once.
    const results = await Promise.all([
      runLighthouse('https://example.com', 'mobile', ['performance']),
      runLighthouse('https://example.com', 'desktop', ['performance']),
    ]);
    expect(maxActive()).toBe(1);
    expect(events).toEqual(['start mobile', 'end mobile', 'start desktop', 'end desktop']);
    expect(results.map((r) => [r.strategy, r.status])).toEqual([['mobile', 'completed'], ['desktop', 'completed']]);
  });

  it('also queues runs from overlapping audits', async () => {
    const { runLighthouse, maxActive } = await loadWithStubbedLighthouse();
    await Promise.all(
      ['mobile', 'desktop', 'mobile', 'desktop'].map((s) => runLighthouse('https://example.com', s as 'mobile' | 'desktop', ['performance'])),
    );
    expect(maxActive()).toBe(1);
  });

  it('a failed run does not block the runs queued behind it', async () => {
    const { runLighthouse, events } = await loadWithStubbedLighthouse(['mobile']);
    const [mobile, desktop] = await Promise.all([
      runLighthouse('https://example.com', 'mobile', ['performance']),
      runLighthouse('https://example.com', 'desktop', ['performance']),
    ]);
    expect(mobile).toMatchObject({ status: 'failed', error: 'mobile blew up' });
    expect(desktop.status).toBe('completed');
    expect(events).toEqual(['start mobile', 'end mobile', 'start desktop', 'end desktop']);
  });
});
