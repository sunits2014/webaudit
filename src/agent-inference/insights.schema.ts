import { z } from 'zod';

export const InsightIssueSchema = z.strictObject({
  metric: z.enum(['LCP', 'CLS', 'INP', 'TBT', 'FCP', 'other']),
  cause: z.string(),     // what is wrong, e.g. "hero.jpg is 1.2 MB and lazy-loaded"
  evidence: z.string(),  // the Lighthouse audit id or element it came from
  fix: z.string(),       // the concrete change to make
  impact: z.enum(['high', 'medium', 'low']),
});

export const InsightsSchema = z.strictObject({
  summary: z.string(),
  issues: z.array(InsightIssueSchema),
});

export type Insights = z.infer<typeof InsightsSchema>;
export type InsightIssue = z.infer<typeof InsightIssueSchema>;