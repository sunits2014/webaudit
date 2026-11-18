import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { readAudit, readHtmlReport, readReport, submitAudit } from './audit.controller.js';
import { createInsights, readInsights } from '../../agent-inference/insights.controller.js';

/** Generating insights calls a paid or quota-limited model, so it gets a much tighter limit than the API. */
const insightsLimiter = rateLimit({
  windowMs: env.INSIGHTS_RATE_LIMIT_WINDOW_MS, limit: env.INSIGHTS_RATE_LIMIT_MAX, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: { code: 'TOO_MANY_INSIGHT_REQUESTS', message: 'Too many insight requests; try again later' } },
});

export const auditRouter = Router();
auditRouter.post('/', asyncHandler(submitAudit));
auditRouter.post('/:id/insights', insightsLimiter, asyncHandler(createInsights));
auditRouter.get('/:id/insights', asyncHandler(readInsights));
auditRouter.get('/:id/report.html', asyncHandler(readHtmlReport));
auditRouter.get('/:id/report', asyncHandler(readReport));
auditRouter.get('/:id', asyncHandler(readAudit));
