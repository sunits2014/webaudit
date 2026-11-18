import { createRequire } from 'node:module';
import { logger } from '../utils/logger.js';
const require = createRequire(import.meta.url);
const pinoHttp = require('pino-http') as typeof import('pino-http').default;
export const requestLogger = pinoHttp({ logger });
