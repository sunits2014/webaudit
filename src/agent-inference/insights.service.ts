import { gunzipSync } from 'node:zlib';
import OpenAI from 'openai';
import { env } from '../config/env.js';
import { auditRepository } from '../modules/audits/audit.repository.js';
import { logger } from '../utils/logger.js';
import { generateInsights, InvalidInsightsError, isLlmConfigured, llmModel } from './agent-analysis.js';
import { extractFindings } from './findings.js';
import type { AuditInsightsRecord } from './insights.model.js';
import { insightsRepository } from './insights.repository.js';

export type InsightsOutcome =
  | { kind: 'not_configured' }
  | { kind: 'audit_not_found' }
  | { kind: 'audit_not_ready' }
  | { kind: 'no_reports' }
  | { kind: 'completed'; record: AuditInsightsRecord }
  | { kind: 'pending'; record: AuditInsightsRecord | null }
  | { kind: 'failed'; record: AuditInsightsRecord | null; rateLimited: boolean };

/**
 * Returns the audit's insights, generating them on the first request. Later requests, and requests
 * that arrive while another one is generating, are answered from the stored record: the model is
 * called once per audit.
 */
export async function requestInsights(auditId: string): Promise<InsightsOutcome> {
  if (!isLlmConfigured()) return { kind: 'not_configured' };
  const audit = await auditRepository.find(auditId);
  if (!audit) return { kind: 'audit_not_found' };
  if (audit.status === 'running') return { kind: 'audit_not_ready' };

  const existing = await insightsRepository.find(auditId);
  if (existing?.status === 'completed') return { kind: 'completed', record: existing };

  const reports = await auditRepository.getReports(auditId);
  if (reports.length === 0) return { kind: 'no_reports' };

  const claimed = await insightsRepository.claim(auditId, llmModel(), audit.expiresAt, env.LLM_TIMEOUT_MS * 3);
  if (!claimed) return { kind: 'pending', record: await insightsRepository.find(auditId) };

  try {
    const findings = reports.map((report) => extractFindings(JSON.parse(gunzipSync(report.jsonGzip).toString('utf8')), report.strategy));
    const { insights, model } = await generateInsights(findings);
    const record = await insightsRepository.complete(auditId, insights, model);
    if (!record) throw new Error('Insights record disappeared while generating');
    return { kind: 'completed', record };
  } catch (error) {
    const rateLimited = error instanceof OpenAI.RateLimitError;
    logger.warn({ err: error, auditId }, 'Insights generation failed');
    const record = await insightsRepository.fail(auditId, describe(error));
    return { kind: 'failed', record, rateLimited };
  }
}

export const getInsights = (auditId: string) => insightsRepository.find(auditId);

/** What a caller may see about a failure: no provider internals, no request details. */
function describe(error: unknown): string {
  if (error instanceof OpenAI.RateLimitError) return 'The AI provider is rate limiting requests; try again later';
  if (error instanceof OpenAI.APIConnectionTimeoutError) return 'The AI provider did not answer in time';
  if (error instanceof OpenAI.APIConnectionError) return 'The AI provider could not be reached';
  if (error instanceof OpenAI.APIError) return `The AI provider returned an error (${String(error.status ?? 'unknown')})`;
  if (error instanceof InvalidInsightsError) return `The model's answer was unusable: ${error.message}`;
  return 'Insights generation failed';
}
