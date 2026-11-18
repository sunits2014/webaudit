import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { extractFindings } from '../src/agent-inference/findings.js';
import { InvalidInsightsError, parseInsights } from '../src/agent-inference/agent-analysis.js';

// These tests import the openai and mongodb packages fresh (vi.resetModules); a cold first import can pass 5 s on a busy machine.
vi.setConfig({ testTimeout: 20_000 });

const lhr = {
  requestedUrl: 'https://example.com/',
  finalDisplayedUrl: 'https://example.com/',
  categories: {
    performance: {
      score: 0.76,
      auditRefs: [
        { id: 'largest-contentful-paint', group: 'metrics' },
        { id: 'document-latency-insight', group: 'insights' },
        { id: 'lcp-breakdown-insight', group: 'insights' },
        { id: 'render-blocking-insight', group: 'insights' },
        { id: 'cache-insight', group: 'insights' },
        { id: 'inp-breakdown-insight', group: 'insights' },
        { id: 'long-tasks', group: 'diagnostics' },
        { id: 'network-requests', group: 'hidden' },
      ],
    },
  },
  audits: {
    'largest-contentful-paint': { numericValue: 3965.4, score: 0.4, scoreDisplayMode: 'numeric' },
    'cumulative-layout-shift': { numericValue: 0.04567, score: 1, scoreDisplayMode: 'numeric' },
    'document-latency-insight': {
      title: 'Document request latency', score: 0, scoreDisplayMode: 'metricSavings', displayValue: 'Est savings of 1,750 ms',
      metricSavings: { FCP: 1750, LCP: 1750 },
      details: { type: 'checklist', items: {
        noRedirects: { label: 'Avoids redirects', value: true },
        serverResponseIsFast: { label: 'Server responded slowly (observed 1853 ms)', value: false },
      }, debugData: { type: 'debugdata', serverResponseTime: 1853 } },
    },
    'lcp-breakdown-insight': {
      title: 'LCP breakdown', score: 0, scoreDisplayMode: 'numeric', metricSavings: { LCP: 0 },
      details: { type: 'list', items: [
        { type: 'table', items: [{ subpart: 'timeToFirstByte', label: 'Time to first byte', duration: 2083.529 }] },
        { type: 'node', lhId: 'page-0-H1', selector: 'main > h1', nodeLabel: 'Hello', snippet: '<h1>', boundingRect: { top: 1 } },
      ] },
    },
    'render-blocking-insight': {
      title: 'Render-blocking requests', score: 0.5, scoreDisplayMode: 'metricSavings', metricSavings: { FCP: 10, LCP: 0 },
      details: { type: 'table', items: Array.from({ length: 8 }, (_, i) => ({ url: `https://example.com/${i}.css`, totalBytes: 1000 + i })) },
    },
    'cache-insight': { title: 'Cache', score: 1, scoreDisplayMode: 'metricSavings', metricSavings: { FCP: 0, LCP: 0 } },
    'inp-breakdown-insight': { title: 'INP', score: null, scoreDisplayMode: 'notApplicable' },
    'long-tasks': {
      title: 'Avoid long main-thread tasks', score: 1, scoreDisplayMode: 'informative', metricSavings: { TBT: 650 },
      details: { type: 'table', items: [{ url: 'https://example.com/app.js', duration: 236, startTime: 4338.17,
        subItems: { type: 'subitems', items: [{ x: 1 }] } }] },
    },
    'network-requests': { title: 'Network requests', score: 1, scoreDisplayMode: 'informative', details: { type: 'table', items: [{ url: 'x' }] } },
  },
};

describe('extractFindings', () => {
  const findings = extractFindings(lhr, 'mobile');

  it('keeps scores and rounded core metrics', () => {
    expect(findings).toMatchObject({ strategy: 'mobile', url: 'https://example.com/', scores: { performance: 76 } });
    expect(findings.metrics).toEqual({ LCP: 3965, CLS: 0.046 });
  });

  it('keeps failing or saving audits, biggest saving first, and drops passing, n/a and hidden ones', () => {
    expect(findings.issues.map((issue) => issue.id)).toEqual([
      'document-latency-insight', 'long-tasks', 'render-blocking-insight', 'lcp-breakdown-insight',
    ]);
  });

  it('reduces evidence to the readable parts', () => {
    const byId = Object.fromEntries(findings.issues.map((issue) => [issue.id, issue]));
    expect(byId['document-latency-insight']).toMatchObject({
      savings: { FCP: 1750, LCP: 1750 }, evidence: { failedChecks: ['Server responded slowly (observed 1853 ms)'] },
    });
    expect(byId['lcp-breakdown-insight']?.evidence).toEqual([
      [{ subpart: 'timeToFirstByte', label: 'Time to first byte', duration: 2084 }],
      { selector: 'main > h1', label: 'Hello', snippet: '<h1>' },
    ]);
    expect(byId['render-blocking-insight']?.evidence).toHaveLength(5);
    expect(byId['long-tasks']?.evidence).toEqual([{ url: 'https://example.com/app.js', duration: 236, startTime: 4338 }]);
    expect(byId['lcp-breakdown-insight']).not.toHaveProperty('savings');
  });

  it('rejects something that is not a Lighthouse report', () => {
    expect(() => extractFindings({ nope: true }, 'mobile')).toThrow('Not a Lighthouse report');
  });
});

describe('parseInsights', () => {
  const valid = { summary: 'Slow server.', issues: [{ metric: 'LCP', cause: 'TTFB 1.8 s', evidence: 'document-latency-insight', fix: 'Cache the HTML', impact: 'high' }] };

  it('accepts plain JSON and JSON wrapped in fences or prose', () => {
    expect(parseInsights(JSON.stringify(valid))).toEqual(valid);
    expect(parseInsights('Here you go:\n```json\n' + JSON.stringify(valid) + '\n```')).toEqual(valid);
  });

  it('caps the number of issues', () => {
    const many = { ...valid, issues: Array.from({ length: 12 }, () => valid.issues[0]) };
    expect(parseInsights(JSON.stringify(many)).issues).toHaveLength(8);
  });

  it.each([
    ['empty', ''],
    ['no JSON', 'I cannot help with that'],
    ['broken JSON', '{"summary": "x", '],
    ['wrong shape', JSON.stringify({ summary: 'x', issues: [{ metric: 'speed' }] })],
    ['extra fields', JSON.stringify({ ...valid, extra: true })],
  ])('rejects a reply that is %s', (_label, reply) => {
    expect(() => parseInsights(reply)).toThrow(InvalidInsightsError);
  });
});

describe('requestInsights', () => {
  const insights = { summary: 'ok', issues: [] };
  const record = (status: string, extra = {}) => ({ auditId: 'a1', status, model: 'm', startedAt: new Date(), expiresAt: new Date(), ...extra });

  async function load(options: {
    configured?: boolean; audit?: unknown; existing?: unknown; reports?: unknown[]; claimed?: boolean; generate?: () => Promise<unknown>;
  }) {
    vi.resetModules();
    const generateInsights = vi.fn(options.generate ?? (() => Promise.resolve({ insights, model: 'vendor/fallback:free' })));
    const repo = {
      find: vi.fn().mockResolvedValue(options.existing ?? null),
      claim: vi.fn().mockResolvedValue(options.claimed ?? true),
      complete: vi.fn().mockResolvedValue(record('completed', { insights })),
      fail: vi.fn((_id: string, error: string) => Promise.resolve(record('failed', { error }))),
    };
    vi.doMock('../src/agent-inference/agent-analysis.js', async (importOriginal) => ({
      ...(await importOriginal<object>()),
      isLlmConfigured: () => options.configured ?? true, llmModel: () => 'm', generateInsights,
    }));
    vi.doMock('../src/agent-inference/insights.repository.js', () => ({ insightsRepository: repo }));
    vi.doMock('../src/modules/audits/audit.repository.js', () => ({ auditRepository: {
      find: vi.fn().mockResolvedValue(options.audit === undefined ? { auditId: 'a1', status: 'completed', expiresAt: new Date() } : options.audit),
      getReports: vi.fn().mockResolvedValue(options.reports ?? [{ strategy: 'mobile', jsonGzip: gzipSync(JSON.stringify(lhr)) }]),
    } }));
    const service = await import('../src/agent-inference/insights.service.js');
    return { ...service, generateInsights, repo };
  }

  it('is off when no model is configured', async () => {
    const { requestInsights, generateInsights } = await load({ configured: false });
    await expect(requestInsights('a1')).resolves.toEqual({ kind: 'not_configured' });
    expect(generateInsights).not.toHaveBeenCalled();
  });

  it('refuses unknown and unfinished audits', async () => {
    await expect((await load({ audit: null })).requestInsights('a1')).resolves.toEqual({ kind: 'audit_not_found' });
    await expect((await load({ audit: { status: 'running' } })).requestInsights('a1')).resolves.toEqual({ kind: 'audit_not_ready' });
    await expect((await load({ reports: [] })).requestInsights('a1')).resolves.toEqual({ kind: 'no_reports' });
  });

  it('generates once from the trimmed findings and stores the result with the model that answered', async () => {
    const { requestInsights, generateInsights, repo } = await load({});
    const outcome = await requestInsights('a1');
    expect(outcome).toMatchObject({ kind: 'completed', record: { status: 'completed', insights } });
    expect(generateInsights).toHaveBeenCalledWith([expect.objectContaining({ strategy: 'mobile', url: 'https://example.com/' })]);
    expect(repo.complete).toHaveBeenCalledWith('a1', insights, 'vendor/fallback:free');
  });

  it('serves stored insights without calling the model', async () => {
    const { requestInsights, generateInsights } = await load({ existing: record('completed', { insights }) });
    await expect(requestInsights('a1')).resolves.toMatchObject({ kind: 'completed' });
    expect(generateInsights).not.toHaveBeenCalled();
  });

  it('reports pending when another request is already generating', async () => {
    const { requestInsights, generateInsights } = await load({ claimed: false, existing: record('pending') });
    await expect(requestInsights('a1')).resolves.toMatchObject({ kind: 'pending', record: { status: 'pending' } });
    expect(generateInsights).not.toHaveBeenCalled();
  });

  it('stores a failure with a message safe to show', async () => {
    const { requestInsights, repo } = await load({ generate: () => Promise.reject(new Error('socket hang up at 10.0.0.1')) });
    await expect(requestInsights('a1')).resolves.toMatchObject({ kind: 'failed', rateLimited: false, record: { error: 'Insights generation failed' } });
    expect(repo.fail).toHaveBeenCalledWith('a1', 'Insights generation failed');
  });
});

describe('stored report bytes', () => {
  it('turns what lean() returns (BSON Binary) into a Buffer zlib accepts', async () => {
    vi.doUnmock('../src/modules/audits/audit.repository.js'); // mocked by the requestInsights tests above
    vi.resetModules();
    const { Binary } = await import('mongodb');
    const { toBuffer } = await import('../src/modules/audits/audit.repository.js');
    const zipped = gzipSync('{"ok":true}');
    expect(toBuffer(zipped)).toBe(zipped);
    expect(toBuffer(new Binary(zipped)).equals(zipped)).toBe(true);
    expect(toBuffer(new Uint8Array(zipped)).equals(zipped)).toBe(true);
    expect(() => toBuffer({ nope: 1 })).toThrow('not binary');
  });
});
