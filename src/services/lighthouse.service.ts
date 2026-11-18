import type { RunnerResult } from 'lighthouse';
import { env } from '../config/env.js';
import type { AuditResult, Category, Strategy } from '../modules/audits/audit.types.js';
import { validateRedirectChain } from './url-security.service.js';
import { logger } from '../utils/logger.js';

const categoryIds: Record<Category, string> = { performance: 'performance', accessibility: 'accessibility', 'best-practices': 'best-practices', seo: 'seo' };
const metricIds = ['first-contentful-paint', 'largest-contentful-paint', 'speed-index', 'total-blocking-time', 'cumulative-layout-shift', 'interaction-to-next-paint'];

/**
 * Lighthouse keeps process-wide state (its performance marks), so two runs at the same time
 * in one process break each other: the run that finishes second fails with
 * 'The "start lh:runner:gather" performance mark has not been set'. Every run therefore
 * waits for the previous one: the strategies of one audit and overlapping audits alike.
 */
let lastRun: Promise<unknown> = Promise.resolve();

export function runLighthouse(url: string, strategy: Strategy, categories: Category[]): Promise<AuditResult> {
  const run = lastRun.then(() => runLighthouseNow(url, strategy, categories));
  lastRun = run.catch(() => undefined); // a failed run must not block the ones queued behind it
  return run;
}

async function runLighthouseNow(url: string, strategy: Strategy, categories: Category[]): Promise<AuditResult> {
  // Timed from the start of this run, not from when it was queued.
  const started = Date.now();
  let chrome: { port: number; kill: () => void | Promise<void> } | undefined;
  try {
    await validateRedirectChain(url);
    const launcher = await import('chrome-launcher');
    const { default: lighthouse } = await import('lighthouse');
    const launched = await launcher.launch({ chromePath: env.CHROME_PATH || undefined, chromeFlags: ['--headless', '--no-sandbox', '--disable-dev-shm-usage'] });
    chrome = launched;
    const timeout = AbortSignal.timeout(env.AUDIT_TIMEOUT_MS);
    const run = lighthouse(url, {
      port: launched.port, output: ['json', 'html'], logLevel: 'error', onlyCategories: categories.map((c) => categoryIds[c]),
      formFactor: strategy, screenEmulation: strategy === 'mobile' ? { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false } : { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false },
    });
    const result = await Promise.race([run, new Promise<never>((_, reject) => timeout.addEventListener('abort', () => reject(new Error('Lighthouse audit timed out')), { once: true }))]);
    return await saveResult(result, strategy, Date.now() - started);
  } catch (error) {
    logger.warn({ err: error, strategy }, 'Lighthouse run failed');
    return { strategy, status: 'failed', scores: {}, metrics: {}, durationMs: Date.now() - started,
      fetchedAt: new Date().toISOString(), error: error instanceof Error ? error.message : 'Audit failed' };
  } finally {
    try { await chrome?.kill(); }
    catch (error: unknown) { logger.warn({ err: error }, 'Chrome cleanup failed'); }
  }
}

async function saveResult(result: RunnerResult | undefined, strategy: Strategy, durationMs: number): Promise<AuditResult> {
  if (!result?.lhr || !result.report) throw new Error('Lighthouse returned no report');
  const reports = Array.isArray(result.report) ? result.report : [result.report];
  const html = reports.find((entry) => entry.trimStart().startsWith('<')) ?? reports[1] ?? reports[0] ?? '';
  const json = reports.find((entry) => !entry.trimStart().startsWith('<')) ?? JSON.stringify(result.lhr);
  const scores: Partial<Record<Category, number>> = {};
  for (const category of ['performance', 'accessibility', 'best-practices', 'seo'] as const) {
    const score = result.lhr.categories[categoryIds[category]]?.score;
    if (score !== null && score !== undefined) scores[category] = Math.round(score * 100);
  }
  const metrics: Record<string, number | null> = {};
  for (const id of metricIds) metrics[id] = result.lhr.audits[id]?.numericValue ?? null;
  return { strategy, status: 'completed', scores, metrics, durationMs, fetchedAt: result.lhr.fetchTime,
    jsonReport: json, htmlReport: html };
}
