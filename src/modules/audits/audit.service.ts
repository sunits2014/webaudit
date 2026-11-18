import { randomUUID } from 'node:crypto';
import { auditRepository } from './audit.repository.js';
import type { AuditRequest, AuditResult, AuditStatus } from './audit.types.js';
import { runLighthouse } from '../../services/lighthouse.service.js';

export async function createAudit(input: AuditRequest) {
  const auditId = randomUUID();
  await auditRepository.create(auditId, input);
  try {
    const results: AuditResult[] = await Promise.all(input.strategy.map((strategy) =>
      runLighthouse(input.url, strategy, input.categories)));
    for (const result of results) await auditRepository.addResult(auditId, result);
    const successCount = results.filter((result) => result.status === 'completed').length;
    const status: AuditStatus = successCount === results.length ? 'completed' : successCount > 0 ? 'partial' : 'failed';
    const error = status === 'failed' ? 'All Lighthouse runs failed' : undefined;
    await auditRepository.updateStatus(auditId, status, { completedAt: new Date(), error });
    return {
      auditId, url: input.url, strategy: input.strategy, categories: input.categories, status,
      results: results.map(({ strategy, status: resultStatus, scores, metrics, durationMs, fetchedAt, error: resultError }) => ({
        strategy, status: resultStatus, scores, metrics, durationMs, fetchedAt,
        ...(resultError ? { error: resultError } : {}),
      })),
      reportUrl: `/api/v1/audits/${auditId}/report`, htmlReportUrl: `/api/v1/audits/${auditId}/report.html`,
      ...(error ? { error } : {}),
    };
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : 'Audit processing failed';
    await auditRepository.updateStatus(auditId, 'failed', { completedAt: new Date(), error });
    return { auditId, url: input.url, status: 'failed' as const, results: [], error };
  }
}

export const getAudit = (auditId: string) => auditRepository.find(auditId);
