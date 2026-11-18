import mongoose, { Schema, type Model } from 'mongoose';
import type { Insights } from './insights.schema.js';

export type InsightsStatus = 'pending' | 'completed' | 'failed';

/** One AI explanation per audit, generated once and then served from here. Expires with its audit. */
export interface AuditInsightsRecord {
  auditId: string;
  status: InsightsStatus;
  model: string;
  insights?: Insights;
  error?: string;
  startedAt: Date;
  generatedAt?: Date;
  expiresAt: Date;
}

const schema = new Schema<AuditInsightsRecord>({
  auditId: { type: String, required: true, unique: true },
  status: { type: String, enum: ['pending', 'completed', 'failed'], required: true },
  model: { type: String, required: true },
  insights: { type: Schema.Types.Mixed },
  error: String,
  startedAt: { type: Date, required: true },
  generatedAt: Date,
  expiresAt: { type: Date, required: true },
}, { timestamps: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AuditInsightsModel: Model<AuditInsightsRecord> =
  (mongoose.models.AuditInsights as Model<AuditInsightsRecord> | undefined)
  ?? mongoose.model<AuditInsightsRecord>('AuditInsights', schema);
