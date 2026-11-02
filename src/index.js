// نقطة التشغيل: البوت + صفحة التحكم.
import { spawn, execFileSync } from 'node:child_process';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createDb } from './db.js';
import { createEngine } from './flows/engine.js';
import { defaultFlows, defaultSettings, readFaqSeed } from './flows/defaults.js';
import { createHandler } from './handler.js';
import { createWhatsApp } from './whatsapp.js';
import { createAuth } from './dashboard/auth.js';
import { createDashboard, listen } from './dashboard/server.js';
import { createSupabaseKv } from './storage/supabaseKv.js';
import { useKvAuthState } from './storage/kvAuth.js';

const config = loadConfig();

// آخر 100 حدث بيظهروا في صفحة التحكم
const activity = [];
const logger = createLogger(config.logLevel, (entry) => {
  if (entry.level === 'debug') return;
  activity.unshift(entry);
  if (activity.length > 100) activity.pop();
});

// على Render: كل حاجة (الجلسة والبيانات) بتتحفظ في Supabase، لأن Render بيمسح الملفات مع كل restart
let kv = null;
let kvData = new Map();
if (config.supabaseUrl) {
  kv = createSupabaseKv({ url: config.supabaseUrl, key: config.supabaseKey, token: config.supabaseToken, logger });
  try {
    await kv.check();
    kvData = await kv.loadAll('data:');
    logger.info('🗄️ البيانات والجلسة بتتحفظ في Supabase');
  } catch (err) {
    logger.fatal(`❌ مش قادر أوصل لـ Supabase: ${err.message}`);
    process.exit(1);
  }
}

const db = createDb(config.dataDir, { kv, kvData });
if (db.isNew) {
  // أول تشغيل: نحوّل الردود القديمة (faq.json) لـ Flows جاهزة
  const seed = readFaqSeed(config.faqFile);
  if (!db.getSettings()) db.setSettings(defaultSettings(config, seed));
  if (!db.listFlows().length) db.setFlows(defaultFlows(seed));
  await db.flush();
  logger.info(`✨ أول تشغيل: اتعمل ${db.listFlows().length} Flow جاهز من الردود القديمة`);
}

const whatsapp = createWhatsApp({
  authDir: config.authDir,
  authProvider: kv ? () => useKvAuthState(kv) : null,
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

const auth = createAuth({ password: config.adminPassword, dataDir: config.dataDir, secure: Boolean(config.publicHost), trustProxy: config.trustProxy, secret: config.sessionSecret });

let version = '';
try {
  version = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
} catch {
  /* مش git checkout (مثلاً نسخة ويندوز الجاهزة) */
}
const dashboard = createDashboard({
  whatsapp,
  db,
  engine: handler.engine,
  auth,
  allowedHosts: config.publicHost ? [config.publicHost] : [],
  getActivity: () => activity,
  logger,
  system: { selfUpdate: config.selfUpdate, updateBranch: config.updateBranch, version },
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

async function shutdown(signal) {
  logger.info(`${signal}: بنقفل البوت...`);
  whatsapp.stop();
  await Promise.race([db.flush(), new Promise((r) => setTimeout(r, 8000))]); // Supabase: نستنى الحفظ
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

  // Render المجاني بينام لو مفيش زيارات 15 دقيقة، فالبوت بيزور نفسه
  if (config.keepAliveUrl) {
    const ping = () => fetch(config.keepAliveUrl, { signal: AbortSignal.timeout(15_000) }).catch(() => {});
    setInterval(ping, config.keepAliveMinutes * 60_000).unref();
    logger.info(`⏰ البوت هيزور نفسه كل ${config.keepAliveMinutes} دقايق عشان ما ينامش`);
  }
} catch (err) {
  logger.fatal({ err }, 'البوت ما قدرش يبدأ');
  process.exit(1);
}
