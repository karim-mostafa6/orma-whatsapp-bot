-- بوت ORMA: كل البيانات (جلسة الواتساب، الـ Flows، المحادثات، الإعدادات) في جدول واحد مقفول.
-- انسخ الكود ده كله، والزقه في Supabase ← SQL Editor ← New query، ودوس Run.
--
-- الحماية: الجدول مقفول تماماً قدام المفتاح العام. البوت بيوصل له بس عن طريق دوال orma_kv_*
-- اللي بتطلب باسورد. الباسورد ده بيتسجّل (كبصمة sha256 بس) أول مرة البوت يشتغل.

create table if not exists public.orma_kv (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.orma_kv enable row level security;
revoke all on public.orma_kv from anon, authenticated;

create table if not exists public.orma_bot_secret (
  id int primary key default 1 check (id = 1),
  token_hash text not null
);
alter table public.orma_bot_secret enable row level security;
revoke all on public.orma_bot_secret from anon, authenticated;

create or replace function public.orma_kv_auth(p_token text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_token is null or not exists (
    select 1 from public.orma_bot_secret where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
  ) then
    raise exception 'orma: bad token' using errcode = '28000';
  end if;
end $$;

create or replace function public.orma_kv_claim(p_token text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'orma: bad token' using errcode = '28000';
  end if;
  lock table public.orma_bot_secret in exclusive mode;
  if not exists (select 1 from public.orma_bot_secret) then
    insert into public.orma_bot_secret(id, token_hash) values (1, encode(sha256(convert_to(p_token, 'UTF8')), 'hex'));
    return true;
  end if;
  perform public.orma_kv_auth(p_token);
  return true;
end $$;

create or replace function public.orma_kv_check(p_token text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform public.orma_kv_auth(p_token);
  return true;
end $$;

create or replace function public.orma_kv_load(p_token text, p_prefix text, p_offset int, p_limit int)
returns table(key text, value text)
language plpgsql security definer set search_path = public as $$
begin
  perform public.orma_kv_auth(p_token);
  return query
    select k.key, k.value from public.orma_kv k
    where starts_with(k.key, coalesce(p_prefix, ''))
    order by k.key
    offset greatest(p_offset, 0) limit least(greatest(p_limit, 1), 1000);
end $$;

create or replace function public.orma_kv_upsert(p_token text, p_rows jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.orma_kv_auth(p_token);
  insert into public.orma_kv(key, value, updated_at)
    select r->>'key', r->>'value', now() from jsonb_array_elements(p_rows) r
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

create or replace function public.orma_kv_delete(p_token text, p_keys text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.orma_kv_auth(p_token);
  delete from public.orma_kv where key = any(p_keys);
end $$;

revoke all on function public.orma_kv_auth(text) from public, anon, authenticated;
revoke all on function public.orma_kv_claim(text), public.orma_kv_check(text), public.orma_kv_load(text, text, int, int),
  public.orma_kv_upsert(text, jsonb), public.orma_kv_delete(text, text[]) from public;
grant execute on function public.orma_kv_claim(text), public.orma_kv_check(text), public.orma_kv_load(text, text, int, int),
  public.orma_kv_upsert(text, jsonb), public.orma_kv_delete(text, text[]) to anon, authenticated;
