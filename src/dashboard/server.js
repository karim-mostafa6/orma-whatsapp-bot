// صفحة التحكم: سيرفر صغير بيشتغل على جهازك بس (http://localhost:3000).
// مقفول على 127.0.0.1، يعني محدش من برّه جهازك يقدر يفتحه.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareFaq, render, unfilledVariables } from '../faq.js';

const PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'page.html');
const MAX_BODY = 1024 * 1024;

/**
 * @param {object} deps
 * @param {object} deps.whatsapp  من createWhatsApp (status, logout)
 * @param {{current:object}} deps.faq
 * @param {string} deps.faqFile
 * @param {import('../state.js').ChatState} deps.state
 * @param {Function} deps.responder
 * @param {() => object[]} deps.getActivity
 * @param {object} deps.logger
 */
export function createDashboard({ whatsapp, faq, faqFile, state, responder, getActivity, logger }) {
  const routes = {
    'GET /api/status': () => ({
      connection: whatsapp.status.connection,
      qr: whatsapp.status.qr,
      me: whatsapp.status.me,
      globalPaused: state.globalPaused,
      missing: unfilledVariables(faq.current),
    }),

    'GET /api/faq': () => JSON.parse(fs.readFileSync(faqFile, 'utf8')),

    'PUT /api/faq': (body) => {
      const prepared = prepareFaq(body); // لو فيه غلطة بيرمي Error برسالة بالعربي
      const tmp = `${faqFile}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`);
      fs.renameSync(tmp, faqFile);
      faq.current = prepared;
      logger.info('✅ الردود اتحفظت من صفحة التحكم');
      return { ok: true, missing: unfilledVariables(prepared) };
    },

    'GET /api/chats': () => state.listPaused(),

    'POST /api/chats/resume': ({ jid }) => {
      state.resume(String(jid));
      logger.info(`🤖 البوت رجع يرد على ${jid} (من صفحة التحكم)`);
      return { ok: true };
    },

    'POST /api/bot': ({ paused }) => {
      state.setGlobalPaused(paused);
      logger.info(paused ? '⏸️ البوت اتوقف لكل العملاء (من صفحة التحكم)' : '▶️ البوت رجع يشتغل (من صفحة التحكم)');
      return { ok: true, globalPaused: state.globalPaused };
    },

    'POST /api/test': async ({ text, faq: draft }) => {
      // بنجرّب على النسخة اللي في الصفحة (حتى لو لسه ما اتحفظتش)
      const f = draft ? prepareFaq(draft) : faq.current;
      const r = await responder(String(text || ''), f);
      if (r.type === 'answer') return { type: r.handoff ? 'answer_handoff' : 'answer', text: r.text, intents: r.intents };
      if (r.type === 'handoff') return { type: 'handoff', text: render(f.system.handoff, f.variables) };
      return { type: 'none', text: render(f.system.fallback, f.variables) };
    },

    'GET /api/activity': () => getActivity(),

    'POST /api/logout': async () => {
      logger.warn('🚪 فك ربط الرقم (من صفحة التحكم)');
      await whatsapp.logout();
      return { ok: true };
    },
  };

  return http.createServer(async (req, res) => {
    // حماية: نقبل بس طلبات جاية لـ localhost (ضد هجمات DNS rebinding)
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '')) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      fs.createReadStream(PAGE).pipe(res);
      return;
    }

    const handler = routes[`${req.method} ${url.pathname}`];
    if (!handler) {
      res.writeHead(404).end('Not found');
      return;
    }

    try {
      let body = {};
      if (req.method !== 'GET') {
        // لازم JSON: ده بيمنع أي موقع تاني مفتوح في المتصفح إنه يبعت أوامر للبوت
        if (!String(req.headers['content-type']).startsWith('application/json')) throw httpError(415, 'لازم JSON');
        body = await readJson(req);
      }
      const result = await handler(body);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(err.status || 400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
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

/** يشغّل الصفحة على أول بورت فاضي من 3000 لـ 3010 */
export function listen(server, startPort, logger) {
  return new Promise((resolve, reject) => {
    let port = startPort;
    const tryPort = () => {
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && port < startPort + 10) {
          port += 1;
          tryPort();
        } else reject(err);
      });
      server.listen(port, '127.0.0.1', () => {
        logger.info(`🌐 صفحة التحكم شغالة: http://localhost:${port}`);
        resolve(port);
      });
    };
    tryPort();
  });
}
