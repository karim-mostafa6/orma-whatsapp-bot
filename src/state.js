// حالة المحادثات اللي اتحوّلت لموظف (البوت ساكت فيها).
// بتتحفظ في data/state.json عشان لو البوت عمل restart ما يرجعش يرد على عميل إنت بتكلمه.
import fs from 'node:fs';
import path from 'node:path';

export class ChatState {
  /** @param {string|null} file مسار الملف، أو null للاختبارات (من غير حفظ) */
  constructor(file, { now = () => Date.now() } = {}) {
    this.file = file;
    this.now = now;
    this.paused = {}; // jid → { since, until|null, reason }
    this.unmatched = new Map(); // jid → عدد الرسايل المتتالية اللي البوت ما فهمهاش
    this.saveTimer = null;
    if (file && fs.existsSync(file)) {
      try {
        this.paused = JSON.parse(fs.readFileSync(file, 'utf8')).paused || {};
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

  /** @param {number|null} hours عدد الساعات، أو null = لحد ما تكتب #bot */
  pause(jid, reason, hours) {
    const since = this.now();
    this.paused[jid] = { since, until: hours ? since + hours * 3600_000 : null, reason };
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
    fs.writeFileSync(tmp, JSON.stringify({ paused: this.paused }, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
