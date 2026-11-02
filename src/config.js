// كل الإعدادات بتتقري من ملف .env (انسخ .env.example لـ .env وعدّل فيه).
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const num = (name, def) => {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`الإعداد ${name} لازم يكون رقم موجب (القيمة الحالية: "${v}")`);
  return n;
};
const bool = (name, def) => {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
};
const file = (name, def) => path.resolve(ROOT, process.env[name] || def);

export function loadConfig() {
  const cfg = {
    authDir: file('AUTH_DIR', 'auth'),
    dataDir: file('DATA_DIR', 'data'),
    faqFile: file('FAQ_FILE', 'data/faq.json'), // الردود القديمة: بتتحوّل لـ Flows أول مرة بس

    minDelayMs: num('MIN_DELAY_MS', 2000),
    maxDelayMs: num('MAX_DELAY_MS', 4000),
    markAsRead: bool('MARK_AS_READ', true),

    handoffHours: num('HANDOFF_HOURS', 12),
    ownerReplyPauseHours: num('OWNER_REPLY_PAUSE_HOURS', 12),
    maxRepliesPerMinute: num('MAX_REPLIES_PER_MINUTE', 4),
    maxMessageAgeMinutes: num('MAX_MESSAGE_AGE_MINUTES', 60),
    notifyOwner: bool('NOTIFY_OWNER', true),
    deleteOwnerCommands: bool('DELETE_OWNER_COMMANDS', true),


    dashboardPort: num('DASHBOARD_PORT', 3000),
    openBrowser: bool('OPEN_BROWSER', true),
    // على السيرفر: BIND_HOST=0.0.0.0 أو ورا Caddy على 127.0.0.1، و PUBLIC_HOST = الدومين
    bindHost: process.env.BIND_HOST || '127.0.0.1',
    publicHost: (process.env.PUBLIC_HOST || '').trim().toLowerCase(),
    adminPassword: process.env.ADMIN_PASSWORD || '',

    logLevel: process.env.LOG_LEVEL || 'info',
  };

  if (cfg.maxDelayMs < cfg.minDelayMs) throw new Error('MAX_DELAY_MS لازم يكون أكبر من أو يساوي MIN_DELAY_MS');
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(cfg.bindHost);
  if ((!loopback || cfg.publicHost) && cfg.adminPassword.length < 8) {
    throw new Error('صفحة التحكم مفتوحة للنت: لازم ADMIN_PASSWORD في .env (8 حروف على الأقل)');
  }
  return cfg;
}
