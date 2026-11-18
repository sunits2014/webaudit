import mongoose from 'mongoose';
import { env } from './env.js';
import { AuditModel } from '../modules/audits/audit.model.js';
import { AuditReportModel } from '../modules/audits/audit-report.model.js';

export async function connectDatabase(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  await Promise.all([AuditModel.createIndexes(), AuditReportModel.createIndexes()]);
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

export function databaseHealthy(): boolean {
  return mongoose.connection.readyState === 1;
}
