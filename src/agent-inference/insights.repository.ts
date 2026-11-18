import { AuditInsightsModel, type AuditInsightsRecord } from './insights.model.js';
import type { Insights } from './insights.schema.js';

const isDuplicateKey = (error: unknown) => typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;

export const insightsRepository = {
  find: (auditId: string) => AuditInsightsModel.findOne({ auditId }).lean<AuditInsightsRecord>(),

  /**
   * Marks the audit's insights as being generated, unless another request already is (or they are done).
   * A failed attempt can be retried, and so can a pending one older than `staleAfterMs` (its process died).
   * Atomic across instances: the upsert collides on the unique auditId when the record exists but is not claimable.
   */
  claim: async (auditId: string, model: string, expiresAt: Date, staleAfterMs: number): Promise<boolean> => {
    const now = new Date();
    try {
      await AuditInsightsModel.findOneAndUpdate(
        { auditId, $or: [{ status: 'failed' }, { status: 'pending', startedAt: { $lt: new Date(now.getTime() - staleAfterMs) } }] },
        { $set: { status: 'pending', model, startedAt: now, expiresAt }, $unset: { error: 1, insights: 1, generatedAt: 1 } },
        { upsert: true },
      );
      return true;
    } catch (error) {
      if (isDuplicateKey(error)) return false;
      throw error;
    }
  },

  complete: (auditId: string, insights: Insights, model: string) => AuditInsightsModel.findOneAndUpdate(
    { auditId },
    { $set: { status: 'completed', insights, model, generatedAt: new Date() }, $unset: { error: 1 } },
    { new: true },
  ).lean<AuditInsightsRecord>(),

  fail: (auditId: string, error: string) => AuditInsightsModel.findOneAndUpdate(
    { auditId },
    { $set: { status: 'failed', error } },
    { new: true },
  ).lean<AuditInsightsRecord>(),
};
