// إرسال الرد بشكل طبيعي: "مقروءة" ← typing... لمدة 2–4 ثواني ← الرسالة.
// وفي الآخر بنرجّع الحالة "غير متصل" عشان موبايلك يفضل يجيله إشعارات الرسايل عادي
// (واتساب بيوقف إشعارات الموبايل طول ما فيه جهاز مربوط باين "متصل").

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function randomDelay(min, max, rand = Math.random) {
  return Math.round(min + rand() * (max - min));
}

/**
 * @param {object} sock  socket بتاع Baileys
 * @param {string} jid   المحادثة
 * @param {object|null} key مفتاح رسالة العميل (عشان نعلّمها مقروءة)، أو null
 * @param {string} text
 * @returns {Promise<object>} الرسالة اللي اتبعتت
 */
export async function sendLikeHuman(sock, jid, key, text, cfg, rand = Math.random) {
  const quiet = (p) => Promise.resolve(p).catch(() => {}); // حالة الـ typing مش أساسية، لو فشلت نكمّل عادي

  if (cfg.markAsRead && key) await quiet(sock.readMessages([key]));
  await quiet(sock.presenceSubscribe(jid));
  await quiet(sock.sendPresenceUpdate('available'));
  await quiet(sock.sendPresenceUpdate('composing', jid));
  await sleep(randomDelay(cfg.minDelayMs, cfg.maxDelayMs, rand));
  await quiet(sock.sendPresenceUpdate('paused', jid));
  try {
    return await sock.sendMessage(jid, { text });
  } finally {
    await quiet(sock.sendPresenceUpdate('unavailable'));
  }
}
