import OpenAI from 'openai';
import { z } from 'zod';
import { env } from '../config/env.js';
import type { Findings } from './findings.js';
import { InsightsSchema, type Insights } from './insights.schema.js';

const MAX_ISSUES = 8;

export const SYSTEM_PROMPT = `You are a web performance engineer. You receive trimmed Lighthouse findings for one page,
one entry per form factor (mobile/desktop). Explain why the page is slow and what to change.

Rules:
- Use only the data given. Do not invent files, elements, numbers or causes that the findings do not show.
- Every issue must name its evidence: the Lighthouse audit id, and the URL or element selector it points at.
- Order issues by impact on Core Web Vitals (LCP, INP/TBT, CLS), biggest first. At most ${MAX_ISSUES} issues.
- Fixes must be concrete and specific to this page (what to change, where), not generic advice.
- If a metric is already good, do not create an issue for it.
- "summary" is two or three plain sentences a developer can read in ten seconds.
- Reply with JSON only, matching this schema exactly:
${JSON.stringify(jsonSchema())}`;

export const isLlmConfigured = () => Boolean(env.LLM_BASE_URL && env.LLM_MODEL);
export const llmModel = () => env.LLM_MODEL ?? '';

let client: OpenAI | undefined;
/** Created on first use, so the service starts (with insights off) when no LLM is configured. */
function llm(): OpenAI {
  if (!isLlmConfigured()) throw new Error('LLM is not configured');
  client ??= new OpenAI({
    baseURL: env.LLM_BASE_URL,
    apiKey: env.LLM_API_KEY ?? 'not-needed', // Ollama and LM Studio ignore the key
    timeout: env.LLM_TIMEOUT_MS,
    maxRetries: 1,
    defaultHeaders: {
      'X-Title': 'WebAudit',
      ...(env.LLM_APP_URL ? { 'HTTP-Referer': env.LLM_APP_URL } : {}),
    },
  });
  return client;
}

export interface GeneratedInsights {
  insights: Insights;
  /** The model that actually answered: with fallbacks configured it may not be LLM_MODEL. */
  model: string;
}

export async function generateInsights(findings: Findings[]): Promise<GeneratedInsights> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify({ reports: findings }) },
  ];
  const fallbacks = env.LLM_FALLBACK_MODELS ?? [];
  // `models` is OpenRouter's fallback list; it is not in the OpenAI types, so it rides along untyped.
  const routing = (fallbacks.length ? { models: [llmModel(), ...fallbacks] } : {}) as Record<string, never>;
  const request = { model: llmModel(), temperature: 0.2, messages, ...routing };
  let res: OpenAI.Chat.ChatCompletion;
  try {
    res = await llm().chat.completions.create({
      ...request,
      response_format: { type: 'json_schema', json_schema: { name: 'insights', strict: true, schema: jsonSchema() } },
    });
  } catch (error) {
    // Some models and providers reject structured outputs. The prompt carries the schema, so ask again without it.
    if (!(error instanceof OpenAI.BadRequestError)) throw error;
    res = await llm().chat.completions.create(request);
  }
  return { insights: parseInsights(res.choices[0]?.message.content), model: res.model || llmModel() };
}

export class InvalidInsightsError extends Error {}

/** Validates the model's reply. Tolerates code fences and text around the JSON, which small models often add. */
export function parseInsights(content: string | null | undefined): Insights {
  if (!content) throw new InvalidInsightsError('Model returned no content');
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start === -1 || end <= start) throw new InvalidInsightsError('Model reply contains no JSON object');
  let json: unknown;
  try { json = JSON.parse(content.slice(start, end + 1)); }
  catch { throw new InvalidInsightsError('Model reply is not valid JSON'); }
  const parsed = InsightsSchema.safeParse(json);
  if (!parsed.success) throw new InvalidInsightsError('Model reply does not match the insights schema');
  return { ...parsed.data, issues: parsed.data.issues.slice(0, MAX_ISSUES) };
}

function jsonSchema(): Record<string, unknown> {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(InsightsSchema) as Record<string, unknown>;
  void _ignored;
  return schema;
}
