import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import { env } from './config/env.js';
import { databaseHealthy } from './config/database.js';
import { auditRouter } from './modules/audits/audit.routes.js';
import { requestLogger } from './middleware/request-logger.middleware.js';
import { notFound } from './middleware/not-found.middleware.js';
import { errorHandler } from './middleware/error.middleware.js';

export const app = express();
app.disable('x-powered-by');
// Behind Cloud Run's (or Railway's) proxy every request arrives from the proxy's address; the client's is the
// last X-Forwarded-For entry. Without this, every visitor would share one rate limit. 0 when nothing is in front.
app.set('trust proxy', env.TRUST_PROXY_HOPS);
app.use(cors());
app.use(helmet());
app.use(express.json({ limit: '32kb' }));
app.use(requestLogger);
app.use('/api/', rateLimit({ windowMs: env.RATE_LIMIT_WINDOW_MS, limit: env.RATE_LIMIT_MAX, standardHeaders: 'draft-8', legacyHeaders: false }));
app.get('/health', async (_req, res) => {
  const mongoOk = databaseHealthy();
  res.status(mongoOk ? 200 : 503).json({ status: mongoOk ? 'ok' : 'degraded', mongodb: mongoOk ? 'ok' : 'unavailable' });
});
app.use('/api/v1/audits', auditRouter);
app.use(notFound);
app.use(errorHandler);

