import { z } from 'zod';
import { categories, strategies } from './audit.types.js';

export const auditRequestSchema = z.object({
  url: z.string().url().max(2048).refine((value) => {
    try { return ['http:', 'https:'].includes(new URL(value).protocol) && !new URL(value).username && !new URL(value).password; }
    catch { return false; }
  }, 'URL must use HTTP or HTTPS and cannot contain credentials'),
  strategy: z.array(z.enum(strategies)).min(1).max(2).default(['mobile']),
  categories: z.array(z.enum(categories)).min(1).default([...categories]),
}).strict();
