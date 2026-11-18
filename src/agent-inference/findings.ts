import type { Strategy } from '../modules/audits/audit.types.js';

/**
 * The slice of a Lighthouse report an LLM needs to explain a page's performance.
 * A full report is 300 KB to 2 MB of JSON; this keeps the metrics, the failing insights and
 * diagnostics, and a few rows of evidence for each, which is a few KB.
 */
export interface Findings {
  strategy: Strategy;
  url: string;
  scores: Record<string, number>;
  /** Core metrics, rounded (ms, except CLS which is unitless). */
  metrics: Record<string, number>;
  issues: FindingIssue[];
}

export interface FindingIssue {
  id: string;
  title: string;
  displayValue?: string;
  score: number | null;
  /** Estimated savings per metric, as Lighthouse reports them (ms, CLS units). Only non-zero entries. */
  savings?: Record<string, number>;
  evidence?: unknown;
}

const METRICS: Record<string, string> = {
  'first-contentful-paint': 'FCP',
  'largest-contentful-paint': 'LCP',
  'total-blocking-time': 'TBT',
  'cumulative-layout-shift': 'CLS',
  'speed-index': 'SpeedIndex',
  'interaction-to-next-paint': 'INP',
};
/** Always sent when present: it names the LCP element and where its time goes. */
const ALWAYS = new Set(['lcp-breakdown-insight']);
const SKIP_MODES = new Set(['notApplicable', 'manual', 'error']);
const MAX_ISSUES = 10;
const MAX_ROWS = 5;
const MAX_TEXT = 200;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: string) => (value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value);
const round = (value: number) => (Math.abs(value) < 10 ? Math.round(value * 1000) / 1000 : Math.round(value));

export function extractFindings(lhr: unknown, strategy: Strategy): Findings {
  if (!isObject(lhr) || !isObject(lhr.audits)) throw new Error('Not a Lighthouse report');
  const audits = lhr.audits as Record<string, Json>;
  const categories = isObject(lhr.categories) ? (lhr.categories as Record<string, Json>) : {};

  const scores: Record<string, number> = {};
  for (const [id, category] of Object.entries(categories)) {
    if (typeof category.score === 'number') scores[id] = Math.round(category.score * 100);
  }

  const metrics: Record<string, number> = {};
  for (const [id, name] of Object.entries(METRICS)) {
    const value = audits[id]?.numericValue;
    if (typeof value === 'number') metrics[name] = round(value);
  }

  // Performance audits in the groups that explain causes; 'metrics' are above and 'hidden' is raw data.
  const refs = Array.isArray(categories.performance?.auditRefs) ? (categories.performance.auditRefs as Json[]) : [];
  const ids = refs.filter((ref) => ref.group === 'insights' || ref.group === 'diagnostics').map((ref) => String(ref.id));

  const issues = ids
    .map((id) => toIssue(id, audits[id]))
    .filter((issue): issue is FindingIssue & { rank: number } => issue !== undefined)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, MAX_ISSUES)
    .map(({ rank: _rank, ...issue }) => { void _rank; return issue; });

  return { strategy, url: String(lhr.finalDisplayedUrl ?? lhr.requestedUrl ?? ''), scores, metrics, issues };
}

function toIssue(id: string, audit: Json | undefined): (FindingIssue & { rank: number }) | undefined {
  if (!audit || SKIP_MODES.has(String(audit.scoreDisplayMode))) return undefined;
  const score = typeof audit.score === 'number' ? audit.score : null;
  const savings: Record<string, number> = {};
  if (isObject(audit.metricSavings)) {
    for (const [metric, value] of Object.entries(audit.metricSavings)) {
      if (typeof value === 'number' && value > 0) savings[metric] = round(value);
    }
  }
  const maxSaving = Math.max(0, ...Object.values(savings));
  const failing = score !== null && score < 0.9 && audit.scoreDisplayMode !== 'informative';
  if (!ALWAYS.has(id) && !failing && maxSaving === 0) return undefined;

  const evidence = compactDetails(audit.details);
  return {
    id,
    title: String(audit.title ?? id),
    ...(typeof audit.displayValue === 'string' ? { displayValue: audit.displayValue } : {}),
    score,
    ...(maxSaving > 0 ? { savings } : {}),
    ...(evidence !== undefined ? { evidence } : {}),
    // Biggest estimated saving first; failing audits without an estimate after them, worst score first.
    rank: maxSaving > 0 ? 1_000 + maxSaving : failing ? 1 - (score ?? 1) : -1,
  };
}

/** Reduces an audit's `details` to the rows a reader would look at, dropping raw and debug data. */
function compactDetails(details: unknown): unknown {
  if (!isObject(details)) return undefined;
  switch (details.type) {
    case 'table':
    case 'opportunity': {
      const rows = Array.isArray(details.items) ? details.items.slice(0, MAX_ROWS).map(compactRow) : [];
      return rows.length ? rows : undefined;
    }
    case 'list': {
      const parts = Array.isArray(details.items) ? details.items.slice(0, MAX_ROWS).map(compactDetails).filter((part) => part !== undefined) : [];
      return parts.length ? parts : undefined;
    }
    case 'node':
      return compactNode(details);
    case 'checklist': {
      // Only the checks that failed; the passing ones are noise.
      const failed = isObject(details.items)
        ? Object.values(details.items).filter((item) => isObject(item) && item.value === false).map((item) => String((item as Json).label))
        : [];
      return failed.length ? { failedChecks: failed } : undefined;
    }
    case 'list-section': {
      const value = details.value;
      if (isObject(value) && value.type === 'network-tree') {
        const duration = isObject(value.longestChain) ? value.longestChain.duration : undefined;
        return typeof duration === 'number' ? { longestRequestChainMs: round(duration) } : undefined;
      }
      return compactDetails(value);
    }
    default:
      return undefined; // debugdata, filmstrip, screenshot, treemap-data, criticalrequestchain, …
  }
}

function compactRow(row: unknown): unknown {
  if (!isObject(row)) return row;
  const out: Json = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === 'subItems' || key === 'debugData') continue;
    if (typeof value === 'number') out[key] = round(value);
    else if (typeof value === 'string') out[key] = text(value);
    else if (typeof value === 'boolean') out[key] = value;
    else if (isObject(value) && value.type === 'node') out[key] = compactNode(value);
    else if (isObject(value) && value.type === 'source-location') out[key] = `${String(value.url)}:${String(value.line)}:${String(value.column)}`;
    else if (isObject(value) && (value.type === 'url' || value.type === 'code' || value.type === 'text') && typeof value.value === 'string') out[key] = text(value.value);
  }
  return out;
}

function compactNode(node: Json): Json {
  const out: Json = {};
  if (typeof node.selector === 'string') out.selector = text(node.selector);
  if (typeof node.nodeLabel === 'string') out.label = text(node.nodeLabel);
  if (typeof node.snippet === 'string') out.snippet = text(node.snippet);
  return out;
}
