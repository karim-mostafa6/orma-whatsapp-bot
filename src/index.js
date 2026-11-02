// نقطة التشغيل: البوت + صفحة التحكم.
import { spawn } from 'node:child_process';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createDb } from './db.js';
import { createEngine } from './flows/engine.js';
import { defaultFlows, defaultSettings, readFaqSeed } from './flows/defaults.js';
import { createHandler } from './handler.js';
import { createWhatsApp } from './whatsapp.js';
import { createAuth } from './dashboard/auth.js';
import { createDashboard, listen } from './dashboard/server.js';

const config = loadConfig();

// آخر 100 حدث بيظهروا في صفحة التحكم
const activity = [];
const logger = createLogger(config.logLevel, (entry) => {
  if (entry.level === 'debug') return;
  activity.unshift(entry);
  if (activity.length > 100) activity.pop();
});

const db = createDb(config.dataDir);
if (db.isNew) {
  // أول تشغيل: نحوّل الردود القديمة (faq.json) لـ Flows جاهزة
  const seed = readFaqSeed(config.faqFile);
  if (!db.getSettings()) db.setSettings(defaultSettings(config, seed));
  if (!db.listFlows().length) db.setFlows(defaultFlows(seed));
  db.flush();
  logger.info(`✨ أول تشغيل: اتعمل ${db.listFlows().length} Flow جاهز من الردود القديمة`);
}

const whatsapp = createWhatsApp({
  authDir: config.authDir,
  logger,
  onSocket: (sock) => sock.ev.on('messages.upsert', handler.onMessagesUpsert),
});
const handler = createHandler({
  getSock: whatsapp.getSock,
  db,
  makeEngine: (transport) => createEngine({ db, transport, logger }),
  config,
  logger,
});

// التأخيرات والأسئلة اللي العميل ما ردش عليها
setInterval(() => handler.tick().catch((err) => logger.error({ err }, 'tick')), 10_000).unref();

const auth = createAuth({ password: config.adminPassword, dataDir: config.dataDir, secure: Boolean(config.publicHost) });
const dashboard = createDashboard({
  whatsapp,
  db,
  engine: handler.engine,
  auth,
  allowedHosts: config.publicHost ? [config.publicHost] : [],
  getActivity: () => activity,
  logger,
});

function openBrowser(url) {
  const cmd =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  } catch {
    /* لو ما قدرناش نفتح المتصفح، اللينك مكتوب في الشاشة */
  }
}

function shutdown(signal) {
  logger.info(`${signal}: بنقفل البوت...`);
  db.flush();
  whatsapp.stop();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));

try {
  const port = await listen(dashboard, config.dashboardPort, config.bindHost, logger);
  const url = config.publicHost ? `https://${config.publicHost}` : `http://localhost:${port}`;
  console.log(`\n================================================`);
  console.log(`  افتح صفحة التحكم:  ${url}`);
  if (!config.publicHost) console.log(`  سيب الشباك ده مفتوح — لو قفلته البوت هيقف`);
  console.log(`================================================\n`);
  if (config.openBrowser && !config.publicHost) openBrowser(url);
  await whatsapp.start();
} catch (err) {
  logger.fatal({ err }, 'البوت ما قدرش يبدأ');
  process.exit(1);
}
