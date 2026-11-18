import type { Request, Response } from 'express';
import { auditRequestSchema } from './audit.schema.js';
import { createAudit, getAudit } from './audit.service.js';
import { reportService } from '../../services/report.service.js';

export async function submitAudit(req: Request, res: Response): Promise<void> {
  const input = auditRequestSchema.parse(req.body);
  res.status(200).json(await createAudit(input));
}

export async function readAudit(req: Request, res: Response): Promise<void> {
  const audit = await getAudit(String(req.params.id ?? ''));
  if (!audit) { res.status(404).json({ error: { code: 'AUDIT_NOT_FOUND', message: 'Audit not found' } }); return; }
  res.json(audit);
}

export async function readReport(req: Request, res: Response): Promise<void> {
  const audit = await getAudit(String(req.params.id ?? ''));
  if (!audit) { res.status(404).json({ error: { code: 'AUDIT_NOT_FOUND', message: 'Audit not found' } }); return; }
  res.json(await reportService.consolidated(audit));
}

export async function readHtmlReport(req: Request, res: Response): Promise<void> {
  const audit = await getAudit(String(req.params.id ?? ''));
  if (!audit) { res.status(404).json({ error: { code: 'AUDIT_NOT_FOUND', message: 'Audit not found' } }); return; }
  const strategy = typeof req.query.strategy === 'string' ? req.query.strategy : undefined;
  const html = await reportService.html(String(req.params.id ?? ''), strategy);
  if (!html) { res.status(404).json({ error: { code: 'REPORT_NOT_FOUND', message: 'HTML report not available yet for the requested strategy' } }); return; }
  res.type('html').send(html);
}
