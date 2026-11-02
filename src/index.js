// نقطة التشغيل: الاتصال بواتساب، طباعة الـ QR، حفظ الجلسة، وإعادة الاتصال لو النت فصل.
import fs from 'node:fs';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';

import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { watchFaq } from './faq.js';
import { ChatState } from './state.js';
import { createHandler } from './handler.js';
import { createKeywordResponder } from './responders/keyword.js';
import { createLlmResponder, createHybridResponder } from './responders/llm.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);
// لوج مكتبة Baileys نفسها كتير جداً، فبنخليه للأخطاء بس
const baileysLogger = pino({ level: 'error' });

const faq = watchFaq(config.faqFile, logger);
const state = new ChatState(config.stateFile);

const keywordResponder = createKeywordResponder();
const responder =
  config.responder === 'hybrid'
    ? createHybridResponder(keywordResponder, createLlmResponder(config.llm), logger)
    : keywordResponder;
logger.info(`طريقة الرد: ${config.responder === 'hybrid' ? `كلمات مفتاحية + LLM (${config.llm.model})` : 'كلمات مفتاحية (faq.json)'}`);

let sock = null;
let retries = 0;

const handler = createHandler({ getSock: () => sock, faq, state, responder, config, logger });

async function connect() {
  const { state: authState, saveCreds } = await useMultiFileAuthState(config.authDir);

  let version;
  try {
    ({ version } = await fetchLatestBaileysVersion());
  } catch {
    // لو ما قدرناش نجيب آخر إصدار، Baileys بيستخدم الإصدار المدمج فيه
  }

  sock = makeWASocket({
    version,
    auth: {
      creds: authState.creds,
      keys: makeCacheableSignalKeyStore(authState.keys, baileysLogger),
    },
    logger: baileysLogger,
    browser: Browsers.macOS('Desktop'),
    markOnlineOnConnect: false, // عشان إشعارات موبايلك تفضل شغالة
    syncFullHistory: false, // ما نحمّلش تاريخ المحادثات كله → رامات أقل
    shouldSyncHistoryMessage: () => false,
    emitOwnEvents: false, // رسايل البوت نفسه ما ترجعلوش كأنها رسايل جديدة
    generateHighQualityLinkPreview: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\n📱 امسح الكود ده من واتساب على موبايلك:');
      console.log('   الإعدادات ← الأجهزة المرتبطة ← ربط جهاز\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      retries = 0;
      logger.info(`✅ البوت متصل بواتساب كـ ${sock.user?.id?.split(':')[0] || ''} — مستني رسايل العملاء`);
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        logger.warn('🚪 الجهاز اتشال من "الأجهزة المرتبطة". هنمسح الجلسة القديمة ونطلع QR جديد...');
        fs.rmSync(config.authDir, { recursive: true, force: true });
        retries = 0;
        setTimeout(connect, 1000);
        return;
      }
      // أي فصل تاني (نت، سيرفر، restart مطلوب) → نعيد الاتصال مع زيادة وقت الانتظار تدريجياً
      retries += 1;
      const wait = Math.min(60_000, 2000 * 2 ** Math.min(retries - 1, 5));
      logger.warn(`⚠️ الاتصال اتقطع (كود ${code ?? '؟'}). محاولة تانية بعد ${Math.round(wait / 1000)} ثانية...`);
      setTimeout(connect, wait);
    }
  });

  sock.ev.on('messages.upsert', handler.onMessagesUpsert);
}

function shutdown(signal) {
  logger.info(`${signal}: بنقفل البوت...`);
  state.flush();
  try {
    sock?.end(undefined);
  } catch {
    /* ignore */
  }
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));

connect().catch((err) => {
  logger.fatal({ err }, 'البوت ما قدرش يبدأ');
  process.exit(1);
});
