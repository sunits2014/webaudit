import { describe, expect, it, vi } from 'vitest';
import { auditRequestSchema } from '../src/modules/audits/audit.schema.js';
import { AuditModel } from '../src/modules/audits/audit.model.js';
import { AuditReportModel } from '../src/modules/audits/audit-report.model.js';

describe('audit request validation', () => {
  it('accepts HTTP(S) URLs and defaults categories and strategy', () => {
    expect(auditRequestSchema.parse({ url: 'https://example.com' })).toMatchObject({
      url: 'https://example.com', strategy: ['mobile'], categories: ['performance', 'accessibility', 'best-practices', 'seo'],
    });
  });
  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'https://user:pass@example.com', 'not a url'])(
    'rejects unsafe or malformed URL %s', (url) => expect(auditRequestSchema.safeParse({ url }).success).toBe(false),
  );
  it('rejects unknown fields and unsupported categories', () => {
    expect(auditRequestSchema.safeParse({ url: 'https://example.com', extra: true }).success).toBe(false);
    expect(auditRequestSchema.safeParse({ url: 'https://example.com', categories: ['custom'] }).success).toBe(false);
  });
});

describe('audit creation', () => {
  it('waits for Lighthouse and returns completed scores', async () => {
    vi.resetModules();
    const create = vi.fn().mockResolvedValue({});
    const addResult = vi.fn().mockResolvedValue(undefined);
    const updateStatus = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../src/modules/audits/audit.repository.js', () => ({ auditRepository: { create, addResult, updateStatus } }));
    vi.doMock('../src/services/lighthouse.service.js', () => ({
      runLighthouse: vi.fn().mockResolvedValue({ strategy: 'mobile', status: 'completed', scores: { performance: 99 },
        metrics: { 'largest-contentful-paint': 1200 }, durationMs: 1000, fetchedAt: '2026-11-17T00:00:00.000Z',
        jsonReport: '{"lighthouseVersion":"13.6.0"}', htmlReport: '<html>report</html>' }),
    }));
    const { createAudit } = await import('../src/modules/audits/audit.service.js');
    const result = await createAudit({ url: 'https://example.com', strategy: ['mobile'], categories: ['performance'] });
    expect(result.status).toBe('completed');
    expect(result.results[0]).toMatchObject({ status: 'completed', scores: { performance: 99 } });
    expect(result.reportUrl).toContain(result.auditId);
    expect(create).toHaveBeenCalledWith(result.auditId, expect.objectContaining({ url: 'https://example.com' }));
    expect(addResult).toHaveBeenCalledWith(result.auditId, expect.objectContaining({ htmlReport: '<html>report</html>' }));
    expect(updateStatus).toHaveBeenCalledWith(result.auditId, 'completed', expect.objectContaining({ completedAt: expect.any(Date) }));
    expect(result.auditId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('retrieves current status by audit id', async () => {
    vi.resetModules();
    const find = vi.fn().mockResolvedValue({ auditId: 'audit-123', status: 'running' });
    vi.doMock('../src/modules/audits/audit.repository.js', () => ({ auditRepository: { find } }));
    const { getAudit } = await import('../src/modules/audits/audit.service.js');
    await expect(getAudit('audit-123')).resolves.toMatchObject({ status: 'running' });
    expect(find).toHaveBeenCalledWith('audit-123');
  });
});

describe('URL SSRF guard', () => {
  it('rejects localhost and private literal addresses', async () => {
    const { assertPublicHttpUrl } = await import('../src/services/url-security.service.js');
    await expect(assertPublicHttpUrl('http://127.0.0.1')).rejects.toThrow();
    await expect(assertPublicHttpUrl('http://169.254.169.254')).rejects.toThrow();
  });
});

describe('report retention', () => {
  it('expires audit and full report documents after 15 days', () => {
    const before = Date.now();
    const audit = new AuditModel({ auditId: 'retention-test', url: 'https://example.com', strategy: ['mobile'], categories: ['performance'] });
    const expiresIn = audit.expiresAt.getTime() - before;
    expect(expiresIn).toBeGreaterThan(15 * 24 * 60 * 60 * 1000 - 1000);
    expect(expiresIn).toBeLessThanOrEqual(15 * 24 * 60 * 60 * 1000 + 1000);
    expect(AuditModel.schema.indexes()).toContainEqual([expect.objectContaining({ expiresAt: 1 }), expect.objectContaining({ expireAfterSeconds: 0 })]);
    expect(AuditReportModel.schema.indexes()).toContainEqual([expect.objectContaining({ expiresAt: 1 }), expect.objectContaining({ expireAfterSeconds: 0 })]);
  });
});

describe('error handling', () => {
  it('returns a generic 500 response for unexpected errors', async () => {
    const { errorHandler } = await import('../src/middleware/error.middleware.js');
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    errorHandler(new Error('internal detail'), {} as never, res as never, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  });
});
