-- =========================================================
-- Study Cycle — PDFs das listas na nuvem (Supabase Storage)
--
-- Rode UMA vez: Supabase → SQL Editor → New query → cole tudo → Run.
-- É seguro rodar de novo (tudo é "if not exists" / "or replace").
--
-- Como a segurança funciona (mesma ideia do app_state):
--   * O bucket é PRIVADO e a "anon key" sozinha não lê, lista nem grava nada.
--   * Antes de enviar / baixar / apagar um PDF, o app chama a função
--     pdf_grant(senha, caminho, operação). Ela confere a senha de
--     sincronização (reaproveitando get_app_state, que já recusa senha
--     errada com "invalid code") e libera SÓ aquele arquivo, SÓ aquela
--     operação, por 10 minutos.
--   * As políticas do Storage só aceitam a operação se existir essa
--     liberação válida.
-- =========================================================

-- 1) Bucket privado, só PDF, até 25 MB
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('list-pdfs', 'list-pdfs', false, 26214400, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = 26214400,
      allowed_mime_types = array['application/pdf'];

-- 2) Tabela de liberações temporárias (ninguém de fora acessa)
create table if not exists public.pdf_grants (
  path       text        not null,
  op         text        not null check (op in ('read', 'write', 'delete')),
  expires_at timestamptz not null,
  primary key (path, op)
);
alter table public.pdf_grants enable row level security;  -- sem políticas = fechada
revoke all on public.pdf_grants from anon, authenticated;

-- 3) Pedir liberação (confere a senha)
create or replace function public.pdf_grant(p_code text, p_path text, p_op text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.get_app_state(p_code);   -- levanta "invalid code" se a senha estiver errada
  if p_path !~ '^[a-z0-9]{6,64}\.pdf$' then raise exception 'invalid path'; end if;
  if p_op not in ('read', 'write', 'delete') then raise exception 'invalid op'; end if;
  delete from public.pdf_grants where expires_at < now();
  insert into public.pdf_grants (path, op, expires_at)
  values (p_path, p_op, now() + interval '10 minutes')
  on conflict (path, op) do update set expires_at = excluded.expires_at;
end;
$$;
revoke all on function public.pdf_grant(text, text, text) from public, anon, authenticated;
grant execute on function public.pdf_grant(text, text, text) to anon;

-- 4) Usada pelas políticas: "há liberação válida para este arquivo?"
create or replace function public.pdf_grant_ok(p_name text, p_op text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.pdf_grants
    where path = p_name and op = p_op and expires_at > now()
  );
$$;
revoke all on function public.pdf_grant_ok(text, text) from public, anon, authenticated;
grant execute on function public.pdf_grant_ok(text, text) to anon;

-- 5) Políticas do Storage
drop policy if exists "list-pdfs insert" on storage.objects;
drop policy if exists "list-pdfs select" on storage.objects;
drop policy if exists "list-pdfs delete" on storage.objects;

create policy "list-pdfs insert" on storage.objects
  for insert to anon
  with check (bucket_id = 'list-pdfs' and public.pdf_grant_ok(name, 'write'));

-- SELECT também vale para quem acabou de receber "write"/"delete":
-- o Storage precisa ler a linha logo após gravar/apagar.
create policy "list-pdfs select" on storage.objects
  for select to anon
  using (bucket_id = 'list-pdfs' and (
    public.pdf_grant_ok(name, 'read') or
    public.pdf_grant_ok(name, 'write') or
    public.pdf_grant_ok(name, 'delete')
  ));

create policy "list-pdfs delete" on storage.objects
  for delete to anon
  using (bucket_id = 'list-pdfs' and public.pdf_grant_ok(name, 'delete'));
