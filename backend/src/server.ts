import { env } from './config/env.js';
import { app } from './app.js';
import { startScheduler } from './services/scheduler.js';
import { encryptLegacyGoogleTokens } from './services/googleTokenStore.js';

const PORT = env.PORT;

app.listen(PORT, () => {
  console.log(`🚀 Servidor DocsObs rodando na porta ${PORT} [${env.NODE_ENV}]`);
  console.log(`📡 Health check: http://localhost:${PORT}/api/v1/health`);

  void encryptLegacyGoogleTokens();

  if (env.CRON_ENABLED && env.NODE_ENV !== 'test') {
    startScheduler();
  }
});
