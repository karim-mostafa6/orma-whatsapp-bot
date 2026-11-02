// تخزين بسيط في ملفات JSON جوه فولدر data/ (من غير قاعدة بيانات خارجية).
// كل ملف بيتحفظ بأمان: نكتب في ملف مؤقت وبعدين rename، عشان ما يتكسرش لو الجهاز فصل.
import fs from 'node:fs';
import path from 'node:path';

const MAX_MESSAGES_PER_CONTACT = 60;

class JsonFile {
  /**
   * @param {string|null} file  مسار الملف (تخزين على الجهاز)، أو null
   * @param {*} fallback
   * @param {{kv: object, key: string, initial: string|undefined}|null} remote  تخزين في Supabase بدل الملف
   */
  constructor(file, fallback, remote = null) {
    this.file = file;
    this.remote = remote;
    this.timer = null;
    this.data = fallback;
    if (remote) {
      if (remote.initial !== undefined) {
        try {
          this.data = JSON.parse(remote.initial);
        } catch {
          /* قيمة بايظة: نبدأ من جديد */
        }
      }
    } else if (file && fs.existsSync(file)) {
      try {
        this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        // ملف بايظ: نحتفظ بنسخة منه ونبدأ من جديد بدل ما البوت يقع
        fs.copyFileSync(file, `${file}.broken-${Date.now()}`);
      }
    }
  }
  save() {
    if (!this.file && !this.remote) return;
    clearTimeout(this.timer);
    // Supabase: نستنى شوية أكتر عشان نجمّع التعديلات ونقلل الطلبات
    this.timer = setTimeout(() => this.flush(), this.remote ? 3000 : 250);
  }
  flush() {
    clearTimeout(this.timer);
    if (this.remote) {
      this.remote.kv.set(this.remote.key, JSON.stringify(this.data));
      return;
    }
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

/**
 * @param {string|null} dir فولدر البيانات، أو null للاختبارات (كله في الذاكرة)
 * @param {object} [opts]
 * @param {object} [opts.kv]        لو موجود: البيانات بتتحفظ في Supabase بدل الملفات
 * @param {Map<string,string>} [opts.kvData] البيانات اللي اتحمّلت من Supabase (data:*)
 */
export function createDb(dir, { now = () => Date.now(), kv = null, kvData = new Map() } = {}) {
  const f = (name) => (dir && !kv ? path.join(dir, name) : null);
  const remote = (name) => (kv ? { kv, key: `data:${name}`, initial: kvData.get(`data:${name}`) } : null);
  const settings = new JsonFile(f('settings.json'), null, remote('settings'));
  const flows = new JsonFile(f('flows.json'), null, remote('flows'));
  const contacts = new JsonFile(f('contacts.json'), {}, remote('contacts'));
  const runs = new JsonFile(f('runs.json'), [], remote('runs'));

  const db = {
    now,
    isNew: settings.data === null || flows.data === null,

    // ---------- الإعدادات ----------
    getSettings: () => settings.data,
    setSettings(value) {
      settings.data = value;
      settings.save();
    },

    // ---------- الـ Flows ----------
    listFlows: () => flows.data || [],
    getFlow: (id) => (flows.data || []).find((x) => x.id === id) || null,
    saveFlow(flow) {
      const list = flows.data || [];
      const i = list.findIndex((x) => x.id === flow.id);
      const stamped = { ...flow, updatedAt: now() };
      if (i >= 0) list[i] = stamped;
      else list.push({ ...stamped, createdAt: now() });
      flows.data = list;
      flows.save();
      return stamped;
    },
    deleteFlow(id) {
      flows.data = (flows.data || []).filter((x) => x.id !== id);
      runs.data = runs.data.filter((r) => r.flowId !== id);
      flows.save();
      runs.save();
    },
    setFlows(list) {
      flows.data = list;
      flows.save();
    },

    // ---------- العملاء ----------
    getContact: (jid) => contacts.data[jid] || null,
    upsertContact(jid, patch = {}) {
      const c = contacts.data[jid] || {
        jid,
        name: '',
        phone: '',
        tags: [],
        vars: {},
        firstSeenAt: now(),
        lastInboundAt: null,
        unmatched: 0,
        paused: null,
        messages: [],
        inboundCount: 0,
      };
      Object.assign(c, patch);
      contacts.data[jid] = c;
      contacts.save();
      return c;
    },
    touchContact(c) {
      contacts.data[c.jid] = c;
      contacts.save();
    },
    addMessage(jid, dir, text) {
      const c = contacts.data[jid];
      if (!c) return;
      c.messages.push({ at: now(), dir, text: String(text).slice(0, 2000) });
      if (c.messages.length > MAX_MESSAGES_PER_CONTACT) c.messages.splice(0, c.messages.length - MAX_MESSAGES_PER_CONTACT);
      contacts.save();
    },
    listContacts: () => Object.values(contacts.data),

    // ---------- التنفيذات المستنية (سؤال أو تأخير) ----------
    listRuns: () => runs.data,
    runsFor: (jid) => runs.data.filter((r) => r.jid === jid),
    saveRun(run) {
      const i = runs.data.findIndex((r) => r.id === run.id);
      if (i >= 0) runs.data[i] = run;
      else runs.data.push(run);
      runs.save();
    },
    deleteRun(id) {
      runs.data = runs.data.filter((r) => r.id !== id);
      runs.save();
    },
    deleteRunsFor(jid) {
      runs.data = runs.data.filter((r) => r.jid !== jid);
      runs.save();
    },

    /** يكتب كل حاجة دلوقتي (ولو Supabase: يستنى لحد ما تتحفظ) */
    async flush() {
      for (const x of [settings, flows, contacts, runs]) if (x.data !== null) x.flush();
      if (kv) await kv.flushNow();
    },
  };
  return db;
}
