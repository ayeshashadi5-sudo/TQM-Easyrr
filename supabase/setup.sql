-- TQM easy · إعداد قاعدة Supabase (شغّلي هذا الملف مرة واحدة في SQL Editor)
-- يجهّز جدولًا واحدًا مغلقًا بالكامل أمام الإنترنت، ودالة صغيرة تعرض أرقام التغيير فقط.
-- كل القراءة والكتابة تمر عبر دالة qmt التي تفحص الدخول والصلاحيات.

create table if not exists public.qmt_docs (
  coll        text        not null,
  id          text        not null,
  data        jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (coll, id)
);

alter table public.qmt_docs enable row level security;      -- بلا سياسات = لا وصول مباشر للمتصفح
revoke all on public.qmt_docs from anon, authenticated;

-- أرقام الإصدارات لكل مجموعة (للتحديث التلقائي بين المستخدمين). لا تحوي أي بيانات حساسة.
create or replace function public.qmt_ver()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(id, data -> 'v'), '{}'::jsonb) from public.qmt_docs where coll = '_ver'
$$;
revoke all on function public.qmt_ver() from public;
grant execute on function public.qmt_ver() to anon, authenticated;
