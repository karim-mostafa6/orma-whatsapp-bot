// الاتصال بواتساب: QR، حفظ الجلسة، إعادة الاتصال، وحالة الاتصال لصفحة التحكم.
import fs from 'node:fs';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';

/**
 * @param {object} opts
 * @param {string} opts.authDir
 * @param {object} opts.logger
 * @param {(sock:object)=>void} opts.onSocket بيتنادى مع كل socket جديد (عشان نربط استقبال الرسايل)
 */
export function createWhatsApp({ authDir, logger, onSocket }) {
  const baileysLogger = pino({ level: 'error' }); // لوج Baileys نفسه كتير جداً
  let sock = null;
  let retries = 0;
  let reconnectTimer = null;
  let generation = 0; // عشان أحداث socket قديم ما تأثرش على الجديد

  const status = {
    connection: 'connecting', // connecting | qr | open | reconnecting
    qr: null, // صورة الـ QR (data URL) لصفحة التحكم
    me: null, // رقمك بعد الربط
    since: Date.now(),
  };
  const setStatus = (patch) => Object.assign(status, patch, { since: Date.now() });

  async function connect() {
    clearTimeout(reconnectTimer);
    const gen = ++generation;
    const { state: authState, saveCreds } = await useMultiFileAuthState(authDir);

    let version;
    try {
      ({ version } = await fetchLatestBaileysVersion());
    } catch {
      // لو ما قدرناش نجيب آخر إصدار، Baileys بيستخدم الإصدار المدمج فيه
    }

    sock = makeWASocket({
      version,
      auth: { creds: authState.creds, keys: makeCacheableSignalKeyStore(authState.keys, baileysLogger) },
      logger: baileysLogger,
      browser: Browsers.macOS('Desktop'),
      markOnlineOnConnect: false, // عشان إشعارات موبايلك تفضل شغالة
      syncFullHistory: false, // ما نحمّلش تاريخ المحادثات → رامات أقل
      shouldSyncHistoryMessage: () => false,
      emitOwnEvents: false, // رسايل البوت نفسه ما ترجعلوش كأنها رسايل جديدة
      generateHighQualityLinkPreview: false,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (gen !== generation) return;

      if (qr) {
        setStatus({ connection: 'qr', qr: await QRCode.toDataURL(qr, { margin: 1, width: 320 }) });
        logger.info('📱 فيه QR جديد — افتح صفحة التحكم وامسحه من موبايلك');
        console.log('\n(أو امسح الكود ده من هنا: واتساب ← الإعدادات ← الأجهزة المرتبطة ← ربط جهاز)\n');
        qrcodeTerminal.generate(qr, { small: true });
      }

      if (connection === 'open') {
        retries = 0;
        const me = sock.user?.id?.split(':')[0] || null;
        setStatus({ connection: 'open', qr: null, me });
        logger.info(`✅ البوت متصل بواتساب (${me ? `+${me}` : ''}) — مستني رسايل العملاء`);
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          logger.warn('🚪 الجهاز اتشال من "الأجهزة المرتبطة". هنطلع QR جديد...');
          fs.rmSync(authDir, { recursive: true, force: true });
          retries = 0;
          setStatus({ connection: 'connecting', qr: null, me: null });
          reconnectTimer = setTimeout(connect, 1000);
          return;
        }
        // أي فصل تاني (نت، سيرفر، restart مطلوب) → نعيد الاتصال مع زيادة وقت الانتظار تدريجياً
        retries += 1;
        const wait = Math.min(60_000, 2000 * 2 ** Math.min(retries - 1, 5));
        setStatus({ connection: 'reconnecting', qr: null });
        logger.warn(`⚠️ الاتصال اتقطع (كود ${code ?? '؟'}). محاولة تانية بعد ${Math.round(wait / 1000)} ثانية...`);
        reconnectTimer = setTimeout(connect, wait);
      }
    });

    onSocket(sock);
  }

  /** فك ربط الرقم (زي "تسجيل الخروج" من الأجهزة المرتبطة) وإظهار QR جديد */
  async function logout() {
    try {
      await sock?.logout();
    } catch {
      // لو مش متصل أصلاً، نمسح الجلسة ونبدأ من جديد
      fs.rmSync(authDir, { recursive: true, force: true });
      setStatus({ connection: 'connecting', qr: null, me: null });
      await connect();
    }
  }

  return {
    start: connect,
    logout,
    status,
    getSock: () => sock,
    stop: () => {
      clearTimeout(reconnectTimer);
      try {
        sock?.end(undefined);
      } catch {
        /* ignore */
      }
    },
  };
}
