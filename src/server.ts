import { createServer } from 'node:http';
import { app } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  await connectDatabase();
  const server = createServer(app);
  server.listen(env.PORT, () => logger.info({ port: env.PORT }, 'WebAudit API started'));
  const shutdown = () => server.close(async (error) => {
    if (error) logger.error({ err: error }, 'HTTP shutdown failed');
    await disconnectDatabase();
  });
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
main().catch((error: unknown) => { logger.fatal({ err: error }, 'API failed to start'); process.exitCode = 1; });
