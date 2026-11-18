import mongoose, { Schema, type Model } from 'mongoose';
import type { Strategy } from './audit.types.js';

export interface AuditReportDocument extends mongoose.Document {
  auditId: string;
  strategy: Strategy;
  jsonGzip: Buffer;
  htmlGzip: Buffer;
  expiresAt: Date;
  createdAt: Date;
}

const schema = new Schema<AuditReportDocument>({
  auditId: { type: String, required: true, index: true },
  strategy: { type: String, enum: ['mobile', 'desktop'], required: true },
  jsonGzip: { type: Buffer, required: true },
  htmlGzip: { type: Buffer, required: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });

schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
schema.index({ auditId: 1, strategy: 1 }, { unique: true });

export const AuditReportModel: Model<AuditReportDocument> =
  (mongoose.models.AuditReport as Model<AuditReportDocument> | undefined)
  ?? mongoose.model<AuditReportDocument>('AuditReport', schema);
