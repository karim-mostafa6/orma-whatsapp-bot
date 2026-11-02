// تسجيل الدخول لصفحة التحكم.
// على الكمبيوتر (127.0.0.1) الباسورد اختياري. على السيرفر (مفتوح للنت) لازم باسورد.
// الجلسة كوكي موقّعة (HMAC) فبتفضل شغالة بعد restart، وبتتلغي لوحدها لو الباسورد اتغير.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const COOKIE = 'orma_session';
const MAX_AGE_S = 30 * 24 * 3600;

export function createAuth({ password, dataDir, secure, trustProxy = false, secret = '' }) {
  let secretFile = null;
  let fileSecret = crypto.randomBytes(32).toString('hex');
  if (secret) {
    fileSecret = secret; // من متغير بيئة (Render): الجلسات بتفضل شغالة بعد أي restart
  } else if (dataDir) {
    secretFile = path.join(dataDir, 'session.key');
    try {
      fileSecret = fs.readFileSync(secretFile, 'utf8').trim() || fileSecret;
    } catch {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(secretFile, fileSecret, { mode: 0o600 });
    }
  }
  // تغيير الباسورد بيغيّر المفتاح → كل الجلسات القديمة بتقفل
  const key = crypto.createHash('sha256').update(`${fileSecret}:${password || ''}`).digest();
  const sign = (v) => crypto.createHmac('sha256', key).update(v).digest('base64url');
  const attempts = new Map(); // ip → [timestamps]

  function token() {
    const exp = Math.floor(Date.now() / 1000) + MAX_AGE_S;
    return `${exp}.${sign(String(exp))}`;
  }

  function valid(tok) {
    const [exp, sig] = String(tok || '').split('.');
    if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
    const want = Buffer.from(sign(exp));
    const got = Buffer.from(sig);
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  }

  function cookieOf(req) {
    const m = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
    return m ? decodeURIComponent(m[1]) : '';
  }

  return {
    required: Boolean(password),
    isLoggedIn: (req) => !password || valid(cookieOf(req)),

    /** @returns {string|null} الكوكي لو الباسورد صح */
    login(req, given) {
      // ورا Caddy كل الطلبات جاية من 127.0.0.1، فالـ IP الحقيقي آخر قيمة في X-Forwarded-For
      // (Caddy بيضيف IP العميل في الآخر وبيتجاهل اللي العميل بعته بنفسه)
      const fwd = trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',').pop().trim() : '';
      const ip = fwd || req.socket.remoteAddress || '';
      const now = Date.now();
      const recent = (attempts.get(ip) || []).filter((t) => now - t < 60_000);
      if (recent.length >= 5) throw Object.assign(new Error('محاولات كتير. استنى دقيقة وجرّب تاني.'), { status: 429 });
      recent.push(now);
      attempts.set(ip, recent);
      const a = crypto.createHash('sha256').update(String(given || '')).digest();
      const b = crypto.createHash('sha256').update(String(password || '')).digest();
      if (!password || !crypto.timingSafeEqual(a, b)) return null;
      attempts.delete(ip);
      return `${COOKIE}=${token()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${MAX_AGE_S}${secure ? '; Secure' : ''}`;
    },

    logoutCookie: () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`,
  };
}
