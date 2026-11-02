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
    faqFile: file('FAQ_FILE', 'data/faq.json'),
    stateFile: file('STATE_FILE', 'data/state.json'),

    minDelayMs: num('MIN_DELAY_MS', 2000),
    maxDelayMs: num('MAX_DELAY_MS', 4000),
    markAsRead: bool('MARK_AS_READ', true),

    handoffHours: num('HANDOFF_HOURS', 12),
    ownerReplyPauseHours: num('OWNER_REPLY_PAUSE_HOURS', 12),
    unmatchedBeforeHandoff: num('UNMATCHED_BEFORE_HANDOFF', 2),
    maxRepliesPerMinute: num('MAX_REPLIES_PER_MINUTE', 4),
    maxMessageAgeMinutes: num('MAX_MESSAGE_AGE_MINUTES', 60),
    notifyOwner: bool('NOTIFY_OWNER', true),
    deleteOwnerCommands: bool('DELETE_OWNER_COMMANDS', true),

    responder: (process.env.RESPONDER || 'keyword').toLowerCase(),
    llm: {
      baseUrl: process.env.LLM_BASE_URL || '',
      apiKey: process.env.LLM_API_KEY || '',
      model: process.env.LLM_MODEL || '',
    },

    logLevel: process.env.LOG_LEVEL || 'info',
  };

  if (cfg.maxDelayMs < cfg.minDelayMs) throw new Error('MAX_DELAY_MS لازم يكون أكبر من أو يساوي MIN_DELAY_MS');
  if (!['keyword', 'hybrid'].includes(cfg.responder)) throw new Error('RESPONDER لازم يكون keyword أو hybrid');
  if (cfg.responder === 'hybrid' && !(cfg.llm.baseUrl && cfg.llm.apiKey && cfg.llm.model)) {
    throw new Error('RESPONDER=hybrid محتاج LLM_BASE_URL و LLM_API_KEY و LLM_MODEL في .env');
  }
  return cfg;
}
