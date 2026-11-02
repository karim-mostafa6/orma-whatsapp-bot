// كل الكلام مع البوت بيعدي من هنا
export class AuthError extends Error {}

export async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && url !== '/api/login') throw new AuthError(data.error || 'سجّل دخول');
  if (!res.ok) throw new Error(data.error || 'حصلت مشكلة، جرّب تاني');
  return data;
}

export const fmtTime = (ms) =>
  ms ? new Date(ms).toLocaleString('ar-EG', { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' }) : '';

export const newId = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export const REASONS = {
  owner_reply: 'إنت رديت عليه',
  owner_command: 'وقّفته بـ #stop',
  dashboard: 'وقّفته من الصفحة',
};
export const reasonLabel = (r) => (r?.startsWith('flow:') ? `محتاج موظف — ${r.slice(5)}` : REASONS[r] || r || '');
