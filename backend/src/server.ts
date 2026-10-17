import { createApp } from './app';
import { initDb } from './config/db';
import { env } from './config/env';
import { startReminderScheduler } from './scheduler/remind';

initDb();

const app = createApp();
app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[100Cities] backend listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

startReminderScheduler();
