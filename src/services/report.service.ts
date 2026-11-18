import { gunzipSync } from 'node:zlib';
import { auditRepository } from '../modules/audits/audit.repository.js';

type AuditSummary = {
  auditId?: string; url?: string; strategy?: string[]; categories?: string[]; status?: string;
  results?: unknown[]; createdAt?: Date; completedAt?: Date; expiresAt?: Date; error?: string;
};

export const reportService = {
  async consolidated(audit: AuditSummary) {
    const reports = await auditRepository.getReports(audit.auditId ?? '');
    return {
      auditId: audit.auditId, url: audit.url, strategy: audit.strategy, categories: audit.categories,
      status: audit.status, results: audit.results, createdAt: audit.createdAt, completedAt: audit.completedAt,
      expiresAt: audit.expiresAt, error: audit.error,
      lighthouseReports: reports.map((report) => ({
        strategy: report.strategy,
        report: JSON.parse(gunzipSync(report.jsonGzip).toString('utf8')) as unknown,
      })),
    };
  },
  async html(auditId: string, strategy?: string): Promise<string | undefined> {
    const allowed = strategy === 'mobile' || strategy === 'desktop' ? strategy : undefined;
    if (strategy && !allowed) return undefined;
    const report = allowed
      ? await auditRepository.getReport(auditId, allowed)
      : (await auditRepository.getReports(auditId))[0];
    return report ? gunzipSync(report.htmlGzip).toString('utf8') : undefined;
  },
};
