import { createApp } from './app.js';
import { config } from './config.js';
import { emailConfigured } from './services/reminders.js';

createApp().listen(config.PORT, () => {
  console.log(`🚀 HireBoard API running on port ${config.PORT}`);
  if (!emailConfigured()) console.log('⚠️  Email not configured (SMTP missing); reminders are skipped');
});
