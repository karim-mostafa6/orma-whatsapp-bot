// صفحة التحكم: API + ملفات الواجهة (web/dist).
// على الكمبيوتر بتشتغل على 127.0.0.1 بس. على السيرفر بتبقى ورا HTTPS وباسورد.
import fs from 'node:fs';
import http from 'node:http';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFlow } from '../flows/validate.js';
import { createDb } from '../db.js';
import { createEngine } from '../flows/engine.js';
import { unfilledVariables } from '../faq.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WEB_DIST = path.join(ROOT, 'web', 'dist');
const MAX_BODY = 2 * 1024 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

const httpError = (status, message) => Object.assign(new Error(message), { status });

/**
 * @param {object} deps
 * @param {object} deps.whatsapp  من createWhatsApp (status, logout)
 * @param {ReturnType<import('../db.js').createDb>} deps.db
 * @param {object} deps.engine
 * @param {object} deps.auth      من createAuth
 * @param {string[]} deps.allowedHosts  أسماء الدومين المسموحة (غير localhost)
 * @param {() => object[]} deps.getActivity
 * @param {object} deps.logger
 */
export function createDashboard({ whatsapp, db, engine, auth, allowedHosts = [], getActivity, logger, system = {} }) {
  let updating = false;

  /** تحديث البوت من GitHub (على السيرفر). بعد النجاح البوت بيقفل، و systemd بيشغّله بالنسخة الجديدة */
  function runUpdate() {
    if (!system.selfUpdate) throw httpError(400, 'التحديث من الصفحة متاح على السيرفر بس');
    if (updating) throw httpError(409, 'فيه تحديث شغال دلوقتي');
    updating = true;
    logger.info('⬇️ بننزّل آخر نسخة من البوت...');
    return new Promise((resolve, reject) => {
      execFile('bash', [path.join(ROOT, 'scripts', 'update.sh')], { cwd: ROOT, env: { ...process.env, UPDATE_BRANCH: system.updateBranch || 'main' }, timeout: 15 * 60_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
        updating = false;
        const out = String(stdout).trim().split('\n').pop() || '';
        if (err) {
          logger.error(`❌ التحديث فشل والبوت رجع للنسخة القديمة: ${String(stderr || err.message).slice(-300)}`);
          return reject(httpError(500, 'التحديث فشل، والبوت لسه شغال بالنسخة القديمة'));
        }
        if (out.startsWith('UP_TO_DATE')) {
          logger.info('✅ البوت على آخر نسخة أصلاً');
          return resolve({ updated: false });
        }
        logger.info(`✅ اتحدّث (${out.split(' ')[1] || ''}) — البوت بيعمل restart`);
        resolve({ updated: true, restarting: true });
        setTimeout(() => process.exit(0), 1500).unref?.();
      });
    });
  }

  const sims = new Map(); // تجارب "جرّب البوت": كل جلسة ليها بيانات في الذاكرة بس

  function contactSummary(c) {
    const last = c.messages[c.messages.length - 1];
    return {
      jid: c.jid,
      name: c.name,
      phone: c.phone,
      tags: c.tags,
      paused: engine.isPaused(c.jid) ? c.paused : null,
      lastInboundAt: c.lastInboundAt,
      lastMessage: last ? { dir: last.dir, text: last.text.slice(0, 120), at: last.at } : null,
    };
  }

  /** تجربة: محرّك منفصل ببيانات في الذاكرة، ما بيبعتش حاجة لحد */
  async function simulate({ session, text, flow, reset }) {
    const id = String(session || 'default').slice(0, 64);
    if (reset || !sims.has(id)) {
      const sdb = createDb(null);
      sdb.setSettings(JSON.parse(JSON.stringify(db.getSettings())));
      sdb.setFlows(flow ? [{ ...flow, status: 'active' }] : JSON.parse(JSON.stringify(db.listFlows())));
      const outbox = [];
      const silent = { info() {}, warn() {}, error() {}, debug() {} };
      const sim = {
        db: sdb,
        outbox,
        engine: createEngine({
          db: sdb,
          logger: silent,
          transport: { send: async (_jid, t) => outbox.push({ dir: 'bot', text: t }), notifyOwner: async (t) => outbox.push({ dir: 'owner', text: t }) },
        }),
      };
      sims.set(id, sim);
      if (sims.size > 50) sims.delete(sims.keys().next().value);
      if (reset && !text) return { messages: [] };
    }
    const sim = sims.get(id);
    sim.outbox.length = 0;
    const res = await sim.engine.handleInbound({ jid: 'test@s.whatsapp.net', text: String(text || ''), kind: text ? 'text' : 'media', name: 'تجربة' });
    const c = sim.db.getContact('test@s.whatsapp.net');
    return { messages: [...sim.outbox], result: res, paused: Boolean(c?.paused), tags: c?.tags || [] };
  }

  const routes = {
    'GET /api/me': () => ({ loggedIn: true, authRequired: auth.required, selfUpdate: Boolean(system.selfUpdate), version: system.version || '' }),
    'POST /api/system/update': () => runUpdate(),

    'GET /api/status': () => ({
      connection: whatsapp.status.connection,
      qr: whatsapp.status.qr,
      me: whatsapp.status.me,
      globalPaused: Boolean(db.getSettings().globalPaused),
      missing: unfilledVariables(db.getSettings()),
      waiting: db.listContacts().filter((c) => engine.isPaused(c.jid)).length,
      flows: { total: db.listFlows().length, active: db.listFlows().filter((f) => f.status === 'active').length },
    }),

    // ---------- Flows ----------
    'GET /api/flows': () => db.listFlows(),
    'POST /api/flows/save': ({ flow }) => {
      if (!flow || typeof flow !== 'object' || !flow.id) throw httpError(400, 'بيانات الـ Flow ناقصة');
      const clean = {
        id: String(flow.id).slice(0, 80),
        name: String(flow.name || '').slice(0, 120),
        status: ['active', 'paused'].includes(flow.status) ? flow.status : 'paused',
        priority: Number(flow.priority) || 0,
        description: String(flow.description || '').slice(0, 500),
        nodes: Array.isArray(flow.nodes) ? flow.nodes.map(({ id, type, position, data }) => ({ id, type, position, data })) : [],
        edges: Array.isArray(flow.edges) ? flow.edges.map(({ id, source, sourceHandle, target }) => ({ id, source, sourceHandle: sourceHandle || 'next', target })) : [],
      };
      const v = validateFlow(clean);
      if (clean.status === 'active' && v.errors.length) throw httpError(400, `مينفعش يتشغّل وفيه أخطاء: ${v.errors[0].text}`);
      const saved = db.saveFlow(clean);
      logger.info(`💾 الـ Flow «${saved.name}» اتحفظ`);
      return { ok: true, flow: saved, warnings: v.warnings };
    },
    'POST /api/flows/status': ({ id, status }) => {
      const f = db.getFlow(String(id));
      if (!f) throw httpError(404, 'الـ Flow مش موجود');
      if (status === 'active' && validateFlow(f).errors.length) throw httpError(400, 'صلّح الأخطاء اللي في الـ Flow الأول');
      db.saveFlow({ ...f, status: status === 'active' ? 'active' : 'paused' });
      return { ok: true };
    },
    'POST /api/flows/delete': ({ id }) => {
      db.deleteFlow(String(id));
      logger.info('🗑️ اتمسح Flow');
      return { ok: true };
    },

    // ---------- العملاء والمحادثات ----------
    'GET /api/contacts': () =>
      db
        .listContacts()
        .map(contactSummary)
        .sort((a, b) => Boolean(b.paused) - Boolean(a.paused) || (b.lastInboundAt || 0) - (a.lastInboundAt || 0))
        .slice(0, 300),
    'GET /api/contact': (_b, url) => {
      const c = db.getContact(url.searchParams.get('jid') || '');
      if (!c) throw httpError(404, 'العميل مش موجود');
      return { ...contactSummary(c), messages: c.messages, vars: c.vars };
    },
    'POST /api/contacts/resume': ({ jid }) => {
      engine.resumeContact(String(jid));
      logger.info(`🤖 البوت رجع يرد على ${db.getContact(String(jid))?.name || jid} (من صفحة التحكم)`);
      return { ok: true };
    },
    'POST /api/contacts/pause': ({ jid }) => {
      engine.pauseContact(String(jid), 'dashboard', null);
      return { ok: true };
    },

    // ---------- الإعدادات ----------
    'GET /api/settings': () => db.getSettings(),
    'PUT /api/settings': (body) => {
      const cur = db.getSettings();
      const b = body.behavior || {};
      const num = (v, d, min, max) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v))) : d);
      const next = {
        ...cur,
        variables: Object.fromEntries(Object.entries(body.variables || cur.variables).map(([k, v]) => [String(k).slice(0, 60), String(v).slice(0, 500)])),
        texts: { ...cur.texts, ...Object.fromEntries(Object.entries(body.texts || {}).map(([k, v]) => [k, String(v).slice(0, 2000)])) },
        behavior: {
          ...cur.behavior,
          minDelayMs: num(b.minDelayMs, cur.behavior.minDelayMs, 0, 30000),
          maxDelayMs: num(b.maxDelayMs, cur.behavior.maxDelayMs, 0, 60000),
          handoffHours: num(b.handoffHours, cur.behavior.handoffHours, 0, 720),
          ownerReplyPauseHours: num(b.ownerReplyPauseHours, cur.behavior.ownerReplyPauseHours, 0, 720),
          maxRepliesPerMinute: num(b.maxRepliesPerMinute, cur.behavior.maxRepliesPerMinute, 1, 30),
          notifyOwner: b.notifyOwner ?? cur.behavior.notifyOwner,
          markAsRead: b.markAsRead ?? cur.behavior.markAsRead,
          deleteOwnerCommands: b.deleteOwnerCommands ?? cur.behavior.deleteOwnerCommands,
        },
      };
      if (next.behavior.maxDelayMs < next.behavior.minDelayMs) next.behavior.maxDelayMs = next.behavior.minDelayMs;
      db.setSettings(next);
      logger.info('✅ الإعدادات اتحفظت');
      return { ok: true, settings: next };
    },
    'POST /api/bot': ({ paused }) => {
      db.setSettings({ ...db.getSettings(), globalPaused: Boolean(paused) });
      logger.info(paused ? '⏸️ البوت اتوقف لكل العملاء (من صفحة التحكم)' : '▶️ البوت رجع يشتغل (من صفحة التحكم)');
      return { ok: true };
    },

    // ---------- تجربة ----------
    'POST /api/simulate': (body) => simulate(body),

    'GET /api/activity': () => getActivity(),

    'POST /api/whatsapp/logout': async () => {
      logger.warn('🚪 فك ربط الرقم (من صفحة التحكم)');
      await whatsapp.logout();
      return { ok: true };
    },
  };

  function hostAllowed(host) {
    const name = String(host || '').replace(/:\d+$/, '').toLowerCase();
    return name === 'localhost' || name === '127.0.0.1' || allowedHosts.includes(name);
  }

  function serveStatic(url, res) {
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || !path.extname(rel)) rel = '/index.html'; // صفحات الواجهة كلها index.html
    const file = path.normalize(path.join(WEB_DIST, rel));
    if (!file.startsWith(WEB_DIST)) return res.writeHead(403).end();
    fs.readFile(file, (err, buf) => {
      if (err) {
        if (rel === '/index.html') {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end('الواجهة مش متبنية. شغّل: npm run build');
        }
        return res.writeHead(404).end('Not found');
      }
      const immutable = rel.startsWith('/assets/');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-store' });
      res.end(buf);
    });
  }

  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const url = new URL(req.url, 'http://localhost');
    // فحص سريع (من غير دخول ومن أي Host): Render وزيارات "ما تنامش" بتستخدمه، ومافيهوش أي بيانات
    if (url.pathname === '/api/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end('{"ok":true}');
    }

    // حماية: نقبل بس الدومين بتاعنا (ضد هجمات DNS rebinding)
    if (!hostAllowed(req.headers.host)) return res.writeHead(403).end('Forbidden');
    if (!url.pathname.startsWith('/api/')) return req.method === 'GET' ? serveStatic(url, res) : res.writeHead(405).end();

    const send = (status, data, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
      res.end(JSON.stringify(data));
    };

    try {
      let body = {};
      if (req.method !== 'GET') {
        // لازم JSON: ده بيمنع أي موقع تاني مفتوح في المتصفح إنه يبعت أوامر
        if (!String(req.headers['content-type']).startsWith('application/json')) throw httpError(415, 'لازم JSON');
        body = await readJson(req);
      }

      if (url.pathname === '/api/login' && req.method === 'POST') {
        const cookie = auth.login(req, body.password);
        if (!cookie) throw httpError(401, 'الباسورد غلط');
        logger.info('🔑 حد دخل صفحة التحكم');
        return send(200, { ok: true }, { 'Set-Cookie': cookie });
      }
      if (url.pathname === '/api/logout-session' && req.method === 'POST') return send(200, { ok: true }, { 'Set-Cookie': auth.logoutCookie() });
      if (!auth.isLoggedIn(req)) throw httpError(401, 'سجّل دخول الأول');

      const handler = routes[`${req.method} ${url.pathname}`];
      if (!handler) throw httpError(404, 'Not found');
      send(200, await handler(body, url));
    } catch (err) {
      send(err.status || 400, { error: err.message });
    }
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(httpError(413, 'البيانات كبيرة زيادة'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(httpError(400, 'JSON مش سليم'));
      }
    });
    req.on('error', reject);
  });
}

/** يشغّل الصفحة على أول بورت فاضي (من البورت المطلوب لحد +10) */
export function listen(server, startPort, host, logger) {
  return new Promise((resolve, reject) => {
    let port = startPort;
    const tryPort = () => {
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && port < startPort + 10) {
          port += 1;
          tryPort();
        } else reject(err);
      });
      server.listen(port, host, () => {
        logger.info(`🌐 صفحة التحكم شغالة على ${host}:${port}`);
        resolve(port);
      });
    };
    tryPort();
  });
}
