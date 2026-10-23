import { createApp } from './app.js';
import { config } from './config.js';
import { initEmailService, startReminderCron } from './services/emailReminder.js';

createApp().listen(config.PORT, () => {
  console.log(`🚀 HireBoard API running on port ${config.PORT}`);
  if (initEmailService()) startReminderCron();
});
