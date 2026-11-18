import mongoose, { Schema, type Model } from 'mongoose';
import type { AuditResult, AuditStatus, Category, Strategy } from './audit.types.js';

export interface AuditDocument extends mongoose.Document {
  auditId: string; url: string; strategy: Strategy[]; categories: Category[]; status: AuditStatus;
  results: AuditResult[]; startedAt?: Date; completedAt?: Date; error?: string;
  createdAt: Date; updatedAt: Date; expiresAt: Date;
}

const resultSchema = new Schema<AuditResult>({
  strategy: { type: String, required: true }, status: { type: String, required: true },
  scores: { type: Schema.Types.Mixed, default: {} }, metrics: { type: Schema.Types.Mixed, default: {} },
  durationMs: { type: Number, required: true }, fetchedAt: { type: String, required: true },
  error: String,
}, { _id: false });

const auditSchema = new Schema<AuditDocument>({
  auditId: { type: String, required: true, unique: true, index: true },
  url: { type: String, required: true, index: true },
  strategy: [{ type: String, enum: ['mobile', 'desktop'], required: true }],
  categories: [{ type: String, enum: ['performance', 'accessibility', 'best-practices', 'seo'], required: true }],
  status: { type: String, enum: ['running', 'completed', 'partial', 'failed'], default: 'running', index: true },
  results: { type: [resultSchema], default: [] },
  startedAt: Date, completedAt: Date, error: String,
  expiresAt: { type: Date, required: true, default: () => new Date(Date.now() + 15 * 24 * 60 * 60 * 1000) },
}, { timestamps: true, minimize: false });
auditSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AuditModel: Model<AuditDocument> = (mongoose.models.Audit as Model<AuditDocument> | undefined)
  ?? mongoose.model<AuditDocument>('Audit', auditSchema);
