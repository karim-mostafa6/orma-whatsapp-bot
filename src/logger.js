// لوج بسيط ومقروء في التيرمنال (بدل JSON).
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50, silent: 100 };
const TAGS = { debug: 'DEBUG', info: 'INFO ', warn: 'WARN ', error: 'ERROR', fatal: 'FATAL' };

export function createLogger(level = 'info') {
  const min = LEVELS[level] ?? LEVELS.info;
  const log = (lvl) => (a, b) => {
    if (LEVELS[lvl] < min) return;
    // بيقبل log("رسالة") أو log({ err }, "رسالة")
    const msg = typeof a === 'string' ? a : b || '';
    const err = typeof a === 'object' && a ? a.err : null;
    const time = new Date().toLocaleString('en-GB', { hour12: false });
    const line = `[${time}] ${TAGS[lvl]} ${msg}${err ? ` — ${err.stack || err.message || err}` : ''}`;
    (LEVELS[lvl] >= LEVELS.warn ? console.error : console.log)(line);
  };
  return { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error'), fatal: log('fatal') };
}
