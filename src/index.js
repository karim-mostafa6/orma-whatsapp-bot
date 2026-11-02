// نقطة التشغيل: بتشغّل البوت + صفحة التحكم، وبتفتح الصفحة في المتصفح لوحدها.
import { spawn } from 'node:child_process';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { watchFaq } from './faq.js';
import { ChatState } from './state.js';
import { createHandler } from './handler.js';
import { createWhatsApp } from './whatsapp.js';
import { createDashboard, listen } from './dashboard/server.js';
import { createKeywordResponder } from './responders/keyword.js';
import { createLlmResponder, createHybridResponder } from './responders/llm.js';

const config = loadConfig();

// آخر 100 حدث بيظهروا في صفحة التحكم
const activity = [];
const logger = createLogger(config.logLevel, (entry) => {
  if (entry.level === 'debug') return;
  activity.unshift(entry);
  if (activity.length > 100) activity.pop();
});

const faq = watchFaq(config.faqFile, logger);
const state = new ChatState(config.stateFile);

const keywordResponder = createKeywordResponder();
const responder =
  config.responder === 'hybrid'
    ? createHybridResponder(keywordResponder, createLlmResponder(config.llm), logger)
    : keywordResponder;

let handler = null;
const whatsapp = createWhatsApp({
  authDir: config.authDir,
  logger,
  onSocket: (sock) => sock.ev.on('messages.upsert', handler.onMessagesUpsert),
});
handler = createHandler({ getSock: whatsapp.getSock, faq, state, responder, config, logger });

const dashboard = createDashboard({
  whatsapp,
  faq,
  faqFile: config.faqFile,
  state,
  responder,
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
  state.flush();
  whatsapp.stop();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));

try {
  const port = await listen(dashboard, config.dashboardPort, logger);
  console.log(`\n================================================`);
  console.log(`  افتح صفحة التحكم:  http://localhost:${port}`);
  console.log(`  سيب الشباك ده مفتوح — لو قفلته البوت هيقف`);
  console.log(`================================================\n`);
  if (config.openBrowser) openBrowser(`http://localhost:${port}`);
  await whatsapp.start();
} catch (err) {
  logger.fatal({ err }, 'البوت ما قدرش يبدأ');
  process.exit(1);
}
