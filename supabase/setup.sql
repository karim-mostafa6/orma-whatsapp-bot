-- بوت ORMA: جدول واحد بيتحفظ فيه كل حاجة (جلسة الواتساب، الـ Flows، المحادثات، الإعدادات).
-- انسخ الكود ده كله، والزقه في Supabase ← SQL Editor ← New query، ودوس Run.
create table if not exists public.orma_kv (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- حماية: محدش يقدر يقرا الجدول ده غير البوت (بمفتاح service_role).
-- من غير الخطوة دي، أي حد معاه الـ anon key كان هيقدر يشوف جلسة الواتساب.
alter table public.orma_kv enable row level security;
revoke all on public.orma_kv from anon, authenticated;
