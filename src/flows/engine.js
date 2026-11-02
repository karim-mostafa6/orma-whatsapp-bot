// المحرّك: بيختار الـ Flow المناسب لرسالة العميل ويمشي خطواته واحدة ورا التانية.
// الأسئلة والتأخيرات بتتحفظ (runs.json)، فلو البوت عمل restart بيكمّل من مكانه.
import { compileKeywords, scoreIntent } from '../matcher.js';
import { normalize, tokenVariants } from '../normalize.js';
import { render } from '../faq.js';
import { nodeOutputs } from './specs.js';
import { toMs } from './validate.js';

const MAX_STEPS = 40; // حماية من الـ loops
const MAX_INVALID_CHOICES = 2;

const compiledCache = new WeakMap();
function compiledFor(triggerData) {
  let c = compiledCache.get(triggerData);
  if (!c) {
    c = compileKeywords(triggerData.keywords || []);
    compiledCache.set(triggerData, c);
  }
  return c;
}

function textVariants(text) {
  const normText = normalize(text);
  const variants = new Set();
  for (const tok of normText.split(' ').filter(Boolean)) for (const v of tokenVariants(tok)) variants.add(v);
  return { normText, variants };
}

function keywordsHit(keywords, text) {
  const { normText, variants } = textVariants(text);
  if (!normText) return false;
  return scoreIntent({ compiled: compileKeywords(keywords) }, normText, variants).score > 0;
}

function inHours(value, date) {
  const m = String(value).match(/^\s*(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*$/);
  if (!m) return false;
  const from = Number(m[1]) * 60 + Number(m[2] || 0);
  const to = Number(m[3]) * 60 + Number(m[4] || 0);
  const cur = date.getHours() * 60 + date.getMinutes();
  return from <= to ? cur >= from && cur < to : cur >= from || cur < to; // يدعم 20:00-02:00
}

let runSeq = 0;

/**
 * @param {object} deps
 * @param {ReturnType<import('../db.js').createDb>} deps.db
 * @param {{send:(jid:string,text:string,key?:object)=>Promise<any>, notifyOwner:(text:string)=>Promise<any>}} deps.transport
 * @param {object} deps.logger
 */
export function createEngine({ db, transport, logger, now = () => Date.now(), rand = Math.random, onlyFlowId = null }) {
  const settings = () => db.getSettings();
  const activeFlows = () => db.listFlows().filter((f) => (onlyFlowId ? f.id === onlyFlowId : f.status === 'active'));
  const triggerOf = (flow) => flow.nodes.find((n) => n.type === 'trigger');
  const varsFor = (contact, run) => ({ ...settings().variables, name: contact?.name || '', ...(contact?.vars || {}), ...(run?.vars || {}) });

  // ---------- إيقاف/تشغيل البوت لعميل ----------
  function isPaused(jid) {
    const c = db.getContact(jid);
    if (!c?.paused) return false;
    if (c.paused.until !== null && now() >= c.paused.until) {
      c.paused = null;
      db.touchContact(c);
      return false;
    }
    return true;
  }

  function pauseContact(jid, reason, hours, patch = {}) {
    const c = db.getContact(jid) || db.upsertContact(jid, patch);
    const since = now();
    c.paused = { since, until: hours ? since + hours * 3600_000 : null, reason };
    c.unmatched = 0;
    db.touchContact(c);
    db.deleteRunsFor(jid); // أي سؤال مستني إجابة بيتلغي
  }

  function resumeContact(jid) {
    const c = db.getContact(jid);
    if (!c?.paused) return false;
    c.paused = null;
    c.unmatched = 0;
    db.touchContact(c);
    return true;
  }

  // ---------- اختيار الـ Flow ----------
  /** بيرجّع الـ Flows اللي كلماتها طابقت، الأقوى الأول */
  function keywordMatches(text, exceptFlowIds = new Set()) {
    const { normText, variants } = textVariants(text);
    if (!normText) return [];
    const hits = [];
    activeFlows().forEach((flow, order) => {
      if (exceptFlowIds.has(flow.id)) return;
      const t = triggerOf(flow);
      if (!t || t.data?.event !== 'keywords') return;
      const { score } = scoreIntent({ compiled: compiledFor(t.data) }, normText, variants);
      if (score > 0) hits.push({ flow, score, alone: Boolean(t.data.onlyIfAlone), priority: Number(flow.priority) || 0, order });
    });
    hits.sort((a, b) => b.priority - a.priority || b.score - a.score || a.order - b.order);
    // الترحيب والشكر ("onlyIfAlone") بيشتغلوا بس لو مفيش سؤال حقيقي في الرسالة
    const real = hits.filter((h) => !h.alone);
    return real.length ? real : hits;
  }

  function flowsByEvent(event) {
    return activeFlows()
      .filter((f) => triggerOf(f)?.data?.event === event)
      .sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0));
  }

  // ---------- تنفيذ الخطوات ----------
  function newRun(flow, contact, startNodeId, msgText) {
    return { id: `run_${now().toString(36)}_${(runSeq++).toString(36)}`, flowId: flow.id, jid: contact.jid, nodeId: startNodeId, vars: {}, lastText: msgText, wait: null, createdAt: now() };
  }

  function nextNodeId(flow, nodeId, handle) {
    return flow.edges.find((e) => e.source === nodeId && (e.sourceHandle || 'next') === handle)?.target || null;
  }

  async function say(contact, text, key) {
    if (!String(text).trim()) return;
    await transport.send(contact.jid, text, key);
    db.addMessage(contact.jid, 'out', text);
  }

  function evalRule(rule, contact, run) {
    const v = String(rule.value || '');
    switch (rule.type) {
      case 'message_contains':
        return keywordsHit(v.split(/[\n,،]+/).map((s) => s.trim()).filter(Boolean), run.lastText || '');
      case 'answer_contains':
        return keywordsHit(v.split(/[\n,،]+/).map((s) => s.trim()).filter(Boolean), run.vars.answer ?? run.lastText ?? '');
      case 'has_tag':
        return (contact.tags || []).includes(v.trim());
      case 'is_new_customer':
        return (contact.inboundCount || 0) <= 1;
      case 'within_hours':
        return inHours(v, new Date(now()));
      case 'unmatched_at_least':
        return (contact.unmatched || 0) >= (Number(v) || 1);
      default:
        return false;
    }
  }

  /**
   * يمشي الـ Flow من خطوة معيّنة لحد ما يخلص، أو يوصل لسؤال/تأخير (يتحفظ ويستنى).
   * @returns {Promise<'done'|'waiting'|'handoff'>}
   */
  async function runFrom(flow, run, contact, nodeId, key) {
    let current = nodeId;
    for (let steps = 0; current && steps < MAX_STEPS; steps++) {
      const node = flow.nodes.find((n) => n.id === current);
      if (!node) break;
      const d = node.data || {};
      const vars = varsFor(contact, run);
      let handle = 'next';

      switch (node.type) {
        case 'trigger':
          break;
        case 'send_message': {
          const texts = (d.texts || []).filter((t) => String(t).trim());
          if (texts.length) await say(contact, render(texts, vars, rand), key);
          key = null; // نعلّم الرسالة مقروءة مرة واحدة بس
          break;
        }
        case 'ask_choice': {
          const opts = (d.options || []).filter((o) => String(o).trim());
          const list = opts.map((o, i) => `*${i + 1}.* ${o}`).join('\n');
          await say(contact, `${render(d.text, vars)}\n\n${list}`, key);
          run.nodeId = node.id;
          run.wait = { kind: 'reply', until: now() + (Number(d.timeoutMinutes) || 60) * 60_000, invalid: 0 };
          db.saveRun(run);
          return 'waiting';
        }
        case 'ask_question':
          await say(contact, render(d.text, vars), key);
          run.nodeId = node.id;
          run.wait = { kind: 'reply', until: now() + (Number(d.timeoutMinutes) || 60) * 60_000, invalid: 0 };
          db.saveRun(run);
          return 'waiting';
        case 'condition': {
          const results = (d.rules || []).map((r) => evalRule(r, contact, run));
          const ok = d.logic === 'or' ? results.some(Boolean) : results.length > 0 && results.every(Boolean);
          handle = ok ? 'true' : 'false';
          break;
        }
        case 'delay': {
          const next = nextNodeId(flow, node.id, 'next');
          if (!next) break;
          run.nodeId = node.id;
          run.wait = { kind: 'delay', until: now() + toMs(d) };
          db.saveRun(run);
          return 'waiting';
        }
        case 'add_tag':
          if (d.tag && !contact.tags.includes(d.tag)) contact.tags.push(d.tag);
          db.touchContact(contact);
          break;
        case 'remove_tag':
          contact.tags = contact.tags.filter((t) => t !== d.tag);
          db.touchContact(contact);
          break;
        case 'handoff': {
          const s = settings();
          await say(contact, render(d.text || s.texts.handoff, vars, rand), key);
          const hours = Number(d.hours) > 0 ? Number(d.hours) : s.behavior.handoffHours;
          db.deleteRun(run.id);
          pauseContact(contact.jid, `flow:${flow.name}`, hours);
          logger.info(`👤 [${contact.name || contact.jid}] اتحوّل لموظف (${flow.name})`);
          if (s.behavior.notifyOwner) {
            const body = render(s.texts.ownerNotify, {
              reason: `محتاج موظف — ${flow.name}`,
              customer: `${contact.name ? `${contact.name} ` : ''}${contact.phone ? `(+${contact.phone}) wa.me/${contact.phone}` : contact.jid}`,
              message: run.lastText || '(صورة/ريكورد)',
            });
            await transport.notifyOwner(body).catch((err) => logger.warn(`ما قدرتش أبعتلك إشعار: ${err.message}`));
          }
          return 'handoff';
        }
        default:
          logger.warn(`خطوة نوعها مش معروف: ${node.type}`);
      }
      current = nextNodeId(flow, node.id, handle);
    }
    db.deleteRun(run.id);
    return 'done';
  }

  async function startFlow(flow, contact, text, key) {
    const t = triggerOf(flow);
    if (!t) return 'done';
    const run = newRun(flow, contact, t.id, text);
    logger.info(`▶️ [${contact.name || contact.jid}] "${String(text).slice(0, 60)}" → ${flow.name}`);
    return runFrom(flow, run, contact, t.id, key);
  }

  /** العميل رد على سؤال مستني إجابة */
  async function answerWaiting(run, contact, text, key) {
    const flow = db.getFlow(run.flowId);
    const node = flow?.nodes.find((n) => n.id === run.nodeId);
    if (!flow || !node) {
      db.deleteRun(run.id);
      return null;
    }
    run.lastText = text;

    // سؤال جديد من Flow تاني ("الشحن بكام؟" وإحنا مستنيين رقم اختيار) → يبدأ الـ Flow التاني
    const interrupt = keywordMatches(text, new Set([flow.id])).find((h) => !h.alone);

    if (node.type === 'ask_question') {
      if (interrupt) {
        db.deleteRun(run.id);
        return null;
      }
      run.vars[node.data.saveAs || 'answer'] = text;
      run.vars.answer = text;
      contact.vars[node.data.saveAs || 'answer'] = text;
      db.touchContact(contact);
      run.wait = null;
      return runFrom(flow, run, contact, nextNodeId(flow, node.id, 'answered'), key);
    }

    // ask_choice
    const opts = (node.data.options || []).filter((o) => String(o).trim());
    const norm = normalize(text);
    let picked = -1;
    const num = norm.match(/^(\d+)\b/);
    if (num && Number(num[1]) >= 1 && Number(num[1]) <= opts.length) picked = Number(num[1]) - 1;
    if (picked < 0) picked = opts.findIndex((o) => normalize(o) === norm);
    if (picked < 0) picked = opts.findIndex((o) => normalize(o).length >= 3 && norm.includes(normalize(o)));

    if (picked >= 0) {
      run.vars.answer = opts[picked];
      run.vars.choice = opts[picked];
      run.wait = null;
      return runFrom(flow, run, contact, nextNodeId(flow, node.id, `opt_${picked}`), key);
    }
    if (interrupt) {
      db.deleteRun(run.id);
      return null;
    }
    const other = nextNodeId(flow, node.id, 'other');
    if (other) {
      run.vars.answer = text;
      run.wait = null;
      return runFrom(flow, run, contact, other, key);
    }
    run.wait.invalid = (run.wait.invalid || 0) + 1;
    if (run.wait.invalid > MAX_INVALID_CHOICES) {
      db.deleteRun(run.id);
      return null; // يكمّل كرسالة عادية (غالباً هتروح لـ "رسالة البوت ما فهمهاش")
    }
    db.saveRun(run);
    await say(contact, render(settings().texts.invalidChoice, varsFor(contact, run)), key);
    return 'waiting';
  }

  // ---------- استقبال رسالة ----------
  /**
   * @param {{jid:string, text:string, kind:'text'|'media', key?:object, name?:string, phone?:string}} msg
   */
  async function handleInbound({ jid, text = '', kind = 'text', key = null, name = '', phone = '' }) {
    const existing = db.getContact(jid);
    const contact = db.upsertContact(jid, {
      ...(name && !existing?.name ? { name } : {}),
      ...(phone && !existing?.phone ? { phone } : {}),
      lastInboundAt: now(),
      inboundCount: (existing?.inboundCount || 0) + 1,
    });
    db.addMessage(jid, 'in', kind === 'media' && !text ? '📎 (صورة/ريكورد/ملف)' : text);

    if (settings().globalPaused) return { type: 'disabled' };
    if (isPaused(jid)) return { type: 'paused' };

    // 1) فيه سؤال مستني إجابة من العميل ده؟
    const waiting = db.runsFor(jid).find((r) => r.wait?.kind === 'reply');
    if (waiting && kind === 'text') {
      const res = await answerWaiting(waiting, contact, text, key);
      if (res) {
        contact.unmatched = 0;
        db.touchContact(contact);
        return { type: 'flow', result: res, flows: [db.getFlow(waiting.flowId)?.name] };
      }
    }
    // رسالة جديدة بتلغي أي تأخير/سؤال قديم لنفس العميل
    db.deleteRunsFor(jid);

    // 2) صورة/ريكورد من غير كلام
    if (kind === 'media' && !text) {
      const flow = flowsByEvent('media')[0];
      if (!flow) return { type: 'none' };
      const res = await startFlow(flow, contact, '', key);
      return { type: 'flow', result: res, flows: [flow.name] };
    }

    // 3) كلمات مفتاحية
    const hits = keywordMatches(text);
    if (hits.length) {
      contact.unmatched = 0;
      db.touchContact(contact);
      const top = hits[0];
      const chosen = [top, ...hits.slice(1).filter((h) => h.priority === top.priority && h.score * 2 >= top.score && !h.alone)].slice(0, settings().behavior.maxAnswersPerMessage || 2);
      const names = [];
      for (const h of chosen) {
        names.push(h.flow.name);
        const res = await startFlow(h.flow, contact, text, key);
        key = null;
        if (res !== 'done') return { type: 'flow', result: res, flows: names }; // سؤال أو تحويل → ما نكمّلش Flows تانية
      }
      return { type: 'flow', result: 'done', flows: names };
    }

    // 4) البوت ما فهمش
    contact.unmatched = (contact.unmatched || 0) + 1;
    db.touchContact(contact);
    const fallback = flowsByEvent('fallback')[0];
    if (!fallback) return { type: 'none' };
    const res = await startFlow(fallback, contact, text, key);
    return { type: 'flow', result: res, flows: [fallback.name], unmatched: true };
  }

  // ---------- المواعيد (تأخير خلص، أو العميل ما ردش) ----------
  async function tick() {
    const due = db.listRuns().filter((r) => r.wait && r.wait.until <= now());
    for (const run of due) {
      const flow = db.getFlow(run.flowId);
      const contact = db.getContact(run.jid);
      if (!flow || !contact || isPaused(run.jid) || settings().globalPaused) {
        db.deleteRun(run.id);
        continue;
      }
      const handle = run.wait.kind === 'delay' ? 'next' : 'timeout';
      run.wait = null;
      const next = nextNodeId(flow, run.nodeId, handle);
      if (!next) {
        db.deleteRun(run.id);
        continue;
      }
      try {
        await runFrom(flow, run, contact, next, null);
      } catch (err) {
        logger.error({ err }, `[${run.jid}] مشكلة وأنا بكمّل ${flow.name}`);
        db.deleteRun(run.id);
      }
    }
  }

  return { handleInbound, tick, isPaused, pauseContact, resumeContact, nodeOutputs };
}
