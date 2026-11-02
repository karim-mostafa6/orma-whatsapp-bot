// حالة المحادثات اللي اتحوّلت لموظف (البوت ساكت فيها).
// بتتحفظ في data/state.json عشان لو البوت عمل restart ما يرجعش يرد على عميل إنت بتكلمه.
import fs from 'node:fs';
import path from 'node:path';

export class ChatState {
  /** @param {string|null} file مسار الملف، أو null للاختبارات (من غير حفظ) */
  constructor(file, { now = () => Date.now() } = {}) {
    this.file = file;
    this.now = now;
    this.paused = {}; // jid → { since, until|null, reason, label }
    this.globalPaused = false; // زرار "إيقاف البوت" من صفحة التحكم
    this.unmatched = new Map(); // jid → عدد الرسايل المتتالية اللي البوت ما فهمهاش
    this.saveTimer = null;
    if (file && fs.existsSync(file)) {
      try {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        this.paused = saved.paused || {};
        this.globalPaused = Boolean(saved.globalPaused);
      } catch {
        this.paused = {};
      }
    }
  }

  /** البوت ساكت في المحادثة دي؟ (ولو مدة الإيقاف خلصت، بيرجع يرد لوحده) */
  isPaused(jid) {
    const p = this.paused[jid];
    if (!p) return false;
    if (p.until !== null && this.now() >= p.until) {
      this.resume(jid);
      return false;
    }
    return true;
  }

  /**
   * @param {number|null} hours عدد الساعات، أو null = لحد ما تكتب #bot
   * @param {string} [label] اسم/رقم العميل عشان يظهر في صفحة التحكم
   */
  pause(jid, reason, hours, label) {
    const since = this.now();
    const prevLabel = this.paused[jid]?.label;
    this.paused[jid] = { since, until: hours ? since + hours * 3600_000 : null, reason, label: label || prevLabel || jidLabel(jid) };
    this.unmatched.delete(jid);
    this.save();
  }

  resume(jid) {
    if (!(jid in this.paused)) return false;
    delete this.paused[jid];
    this.unmatched.delete(jid);
    this.save();
    return true;
  }

  pausedInfo(jid) {
    return this.paused[jid] || null;
  }

  /** كل المحادثات المتوقفة دلوقتي (بعد ما نشيل اللي مدتها خلصت)، الأحدث الأول */
  listPaused() {
    for (const jid of Object.keys(this.paused)) this.isPaused(jid);
    return Object.entries(this.paused)
      .map(([jid, p]) => ({ jid, ...p }))
      .sort((a, b) => b.since - a.since);
  }

  setGlobalPaused(value) {
    this.globalPaused = Boolean(value);
    this.save();
  }

  bumpUnmatched(jid) {
    const n = (this.unmatched.get(jid) || 0) + 1;
    this.unmatched.set(jid, n);
    return n;
  }

  clearUnmatched(jid) {
    this.unmatched.delete(jid);
  }

  save() {
    if (!this.file) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 300);
  }

  /** كتابة آمنة: نكتب في ملف مؤقت وبعدين rename، عشان الملف ما يتكسرش لو الجهاز فصل في النص. */
  flush() {
    if (!this.file) return;
    clearTimeout(this.saveTimer);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ globalPaused: this.globalPaused, paused: this.paused }, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

/** "201001234567@s.whatsapp.net" → "+201001234567" */
export function jidLabel(jid) {
  const [user, server] = String(jid).split('@');
  const id = user.split(':')[0];
  return server === 's.whatsapp.net' ? `+${id}` : id;
}
