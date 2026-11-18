import type { Request, Response } from 'express';
import type { AuditInsightsRecord } from './insights.model.js';
import { getInsights, requestInsights } from './insights.service.js';

const fail = (res: Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } });

const view = (record: AuditInsightsRecord) => ({
  auditId: record.auditId,
  status: record.status,
  model: record.model,
  ...(record.generatedAt ? { generatedAt: record.generatedAt } : {}),
  ...(record.insights ? { insights: record.insights } : {}),
  ...(record.error ? { error: record.error } : {}),
});

/** POST /api/v1/audits/:id/insights: generate (once) and return the AI explanation of an audit. */
export async function createInsights(req: Request, res: Response): Promise<void> {
  const auditId = String(req.params.id ?? '');
  const outcome = await requestInsights(auditId);
  switch (outcome.kind) {
    case 'not_configured': fail(res, 503, 'INSIGHTS_NOT_CONFIGURED', 'AI insights are not enabled on this server'); return;
    case 'audit_not_found': fail(res, 404, 'AUDIT_NOT_FOUND', 'Audit not found'); return;
    case 'audit_not_ready': fail(res, 409, 'AUDIT_NOT_READY', 'The audit is still running; request insights when it has finished'); return;
    case 'no_reports': fail(res, 409, 'REPORTS_UNAVAILABLE', 'The audit has no Lighthouse report to explain'); return;
    case 'completed': res.status(200).json(view(outcome.record)); return;
    case 'pending': res.status(202).json(outcome.record ? view(outcome.record) : { auditId, status: 'pending' }); return;
    case 'failed':
      fail(res, outcome.rateLimited ? 429 : 502, outcome.rateLimited ? 'INSIGHTS_RATE_LIMITED' : 'INSIGHTS_FAILED',
        outcome.record?.error ?? 'Insights generation failed');
  }
}

/** GET /api/v1/audits/:id/insights: the stored explanation, without generating one. */
export async function readInsights(req: Request, res: Response): Promise<void> {
  const record = await getInsights(String(req.params.id ?? ''));
  if (!record) { fail(res, 404, 'INSIGHTS_NOT_FOUND', 'No insights for this audit yet; POST to generate them'); return; }
  res.json(view(record));
}
