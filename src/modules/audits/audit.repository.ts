import { AuditModel, type AuditDocument } from './audit.model.js';
import { AuditReportModel } from './audit-report.model.js';
import type { AuditRequest, AuditResult, AuditStatus, Strategy } from './audit.types.js';
import { gzipSync } from 'node:zlib';

export const auditRepository = {
  create: (auditId: string, input: AuditRequest) => AuditModel.create({
    auditId, ...input, status: 'running' as const, startedAt: new Date(),
  }),
  find: (auditId: string) => AuditModel.findOne({ auditId }).lean(),
  updateStatus: (auditId: string, status: AuditStatus, extra: Partial<AuditDocument> = {}) =>
    AuditModel.updateOne({ auditId }, { $set: { status, ...extra } }),
  addResult: async (auditId: string, result: AuditResult) => {
    const { jsonReport, htmlReport, ...summary } = result;
    if (jsonReport && htmlReport) {
      const audit = await AuditModel.findOne({ auditId }, { expiresAt: 1 }).lean();
      if (!audit) throw new Error('Audit record expired or could not be found');
      await AuditReportModel.create({ auditId, strategy: result.strategy, jsonGzip: gzipSync(jsonReport),
        htmlGzip: gzipSync(htmlReport), expiresAt: audit.expiresAt });
    }
    await AuditModel.updateOne({ auditId }, { $push: { results: summary }, $set: { status: 'running' } });
  },
  getReports: async (auditId: string) => (await AuditReportModel.find({ auditId }).lean()).map(withBuffers),
  getReport: async (auditId: string, strategy: Strategy) => {
    const report = await AuditReportModel.findOne({ auditId, strategy }).lean();
    return report ? withBuffers(report) : null;
  },
};

/**
 * `.lean()` returns binary fields as BSON `Binary`, not Node `Buffer`, and zlib rejects those.
 * Convert at the edge so callers can gunzip the reports directly.
 */
function withBuffers<T extends { jsonGzip: unknown; htmlGzip: unknown }>(report: T): T & { jsonGzip: Buffer; htmlGzip: Buffer } {
  return { ...report, jsonGzip: toBuffer(report.jsonGzip), htmlGzip: toBuffer(report.htmlGzip) };
}

export function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  const inner = (value as { buffer?: unknown } | null)?.buffer; // bson Binary keeps its bytes in .buffer
  if (inner instanceof Uint8Array) return Buffer.from(inner.buffer, inner.byteOffset, inner.byteLength);
  throw new TypeError('Stored report is not binary data');
}
