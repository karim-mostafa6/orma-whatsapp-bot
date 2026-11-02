// كل الإعدادات بتتقري من ملف .env (انسخ .env.example لـ .env وعدّل فيه).
import 'dotenv/config';
import path from 'node:path';
import crypto from 'node:crypto';
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
  // Render بيحط المتغيرات دي لوحده: RENDER=true, RENDER_EXTERNAL_HOSTNAME, RENDER_EXTERNAL_URL, PORT
  const onRender = Boolean(process.env.RENDER);
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


    dashboardPort: num('DASHBOARD_PORT', num('PORT', 3000)),
    openBrowser: bool('OPEN_BROWSER', !onRender),
    // على السيرفر: BIND_HOST=0.0.0.0 أو ورا Caddy على 127.0.0.1، و PUBLIC_HOST = الدومين
    bindHost: process.env.BIND_HOST || (onRender ? '0.0.0.0' : '127.0.0.1'),
    publicHost: (process.env.PUBLIC_HOST || process.env.RENDER_EXTERNAL_HOSTNAME || '').trim().toLowerCase(),
    adminPassword: process.env.ADMIN_PASSWORD || '',
    sessionSecret: process.env.SESSION_SECRET || '',
    trustProxy: bool('TRUST_PROXY', onRender), // ورا Caddy/Render: الـ IP الحقيقي في X-Forwarded-For
    // Supabase: تخزين الجلسة والبيانات (للاستضافات اللي بتمسح الملفات زي Render المجاني)
    supabaseUrl: (process.env.SUPABASE_URL || '').trim(),
    // طريقتين:
    //  1) SUPABASE_SERVICE_KEY (المفتاح السري): البوت بيكلّم الجدول مباشرة.
    //  2) SUPABASE_KEY (المفتاح العام publishable): البوت بيكلّم دوال orma_kv_* المحمية بباسورد،
    //     والباسورد ده مشتق من SESSION_SECRET اللي Render بيولّده ومحدش بيشوفه، وبيتسجّل أول تشغيل.
    supabaseKey: (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '').trim(),
    supabaseToken: '',
    // Render المجاني بينام بعد 15 دقيقة من غير زيارات: البوت بيزور نفسه كل شوية
    keepAliveUrl: process.env.KEEP_ALIVE_URL || (process.env.RENDER_EXTERNAL_URL ? `${process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '')}/api/health` : ''),
    keepAliveMinutes: num('KEEP_ALIVE_MINUTES', 10),
    selfUpdate: bool('SELF_UPDATE', false), // زرار «تحديث البوت» (على السيرفر بس)
    updateBranch: process.env.UPDATE_BRANCH || 'main',

    logLevel: process.env.LOG_LEVEL || 'info',
  };

  if (!process.env.SUPABASE_SERVICE_KEY && process.env.SUPABASE_KEY) {
    const base = (process.env.SUPABASE_BOT_TOKEN || cfg.sessionSecret || '').trim();
    if (base.length < 16) throw new Error('مع SUPABASE_KEY لازم SESSION_SECRET (أو SUPABASE_BOT_TOKEN) — 16 حرف على الأقل');
    cfg.supabaseToken = process.env.SUPABASE_BOT_TOKEN ? base : crypto.createHash('sha256').update(`orma-kv:${base}`).digest('hex');
  }
  if (cfg.maxDelayMs < cfg.minDelayMs) throw new Error('MAX_DELAY_MS لازم يكون أكبر من أو يساوي MIN_DELAY_MS');
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(cfg.bindHost);
  if ((!loopback || cfg.publicHost) && cfg.adminPassword.length < 8) {
    throw new Error('صفحة التحكم مفتوحة للنت: لازم ADMIN_PASSWORD في .env (8 حروف على الأقل)');
  }
  if (onRender && !(cfg.supabaseUrl && cfg.supabaseKey)) {
    throw new Error('على Render لازم SUPABASE_URL و SUPABASE_KEY، وإلا جلسة الواتساب هتضيع مع كل restart');
  }
  if (Boolean(cfg.supabaseUrl) !== Boolean(cfg.supabaseKey)) throw new Error('محتاج SUPABASE_URL و SUPABASE_KEY الاتنين مع بعض');
  return cfg;
}
