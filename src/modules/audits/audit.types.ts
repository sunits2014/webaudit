export const strategies = ['mobile', 'desktop'] as const;
export const categories = ['performance', 'accessibility', 'best-practices', 'seo'] as const;
export type Strategy = (typeof strategies)[number];
export type Category = (typeof categories)[number];
export type AuditStatus = 'running' | 'completed' | 'failed' | 'partial';
export interface AuditRequest { url: string; strategy: Strategy[]; categories: Category[] }
export interface AuditResult {
  strategy: Strategy; status: 'completed' | 'failed'; scores: Partial<Record<Category, number>>;
  metrics: Record<string, number | null>; durationMs: number; fetchedAt: string;
  jsonReport?: string; htmlReport?: string; error?: string;
}
