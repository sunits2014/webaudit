import 'dotenv/config';
import { z } from 'zod';

/** An empty value (`LLM_API_KEY=` in a .env file) counts as unset. */
const optional = <T extends z.ZodType>(type: T) => z.preprocess((value) => (value === '' ? undefined : value), type.optional());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3503),
  MONGODB_URI: z.string().default('mongodb://localhost:27017/webaudit'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  AUDIT_TIMEOUT_MS: z.coerce.number().int().min(10000).max(600000).default(120000),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  CHROME_PATH: z.string().optional(),
  /**
   * Proxies in front of the app whose X-Forwarded-For entries are trusted: 1 on Cloud Run and Railway.
   * Set 0 when clients reach the app directly, or they could fake their IP and dodge the rate limits.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  // AI insights. Any OpenAI-compatible endpoint: OpenRouter, Groq, OpenAI, or Ollama/LM Studio locally.
  // LLM_BASE_URL or LLM_MODEL unset: insights are off and their endpoints answer 503.
  LLM_BASE_URL: optional(z.string().url()),
  LLM_API_KEY: optional(z.string()),
  LLM_MODEL: optional(z.string()),
  /**
   * OpenRouter only: comma-separated models to try, in order, when LLM_MODEL is rate-limited or down
   * (free models often are). Leave unset for other providers, which reject the extra parameter.
   */
  LLM_FALLBACK_MODELS: optional(z.string().transform((value) => value.split(',').map((model) => model.trim()).filter(Boolean))),
  /** Per attempt; one retry follows a timeout. Free models can take well over a minute. */
  LLM_TIMEOUT_MS: z.coerce.number().int().min(5000).max(300000).default(120000),
  /** Sent to OpenRouter as HTTP-Referer, so the app shows up in its dashboard. */
  LLM_APP_URL: optional(z.string().url()),
  INSIGHTS_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(3600000),
  INSIGHTS_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
});

export const env = schema.parse(process.env);
