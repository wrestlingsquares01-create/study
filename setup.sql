-- PRSN Crimson. Run in your NEW Supabase project SQL Editor.
-- Creates the study board, private chat, attachments and ownership rules.
begin;
create schema if not exists prsn_private;
revoke all on schema prsn_private from public, anon, authenticated;
create table if not exists prsn_private.settings (id boolean primary key default true check(id), codeword text not null);
insert into prsn_private.settings(id,codeword) values(true,'Bachyo') on conflict(id) do nothing;
create table if not exists prsn_private.chat_members (user_id uuid primary key references auth.users(id) on delete cascade);
revoke all on all tables in schema prsn_private from public,anon,authenticated;

create or replace function public.prsn_has_chat() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from prsn_private.chat_members where user_id=(select auth.uid()));
$$;
create or replace function public.prsn_unlock_chat(codeword text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then return false; end if;
 if not exists(select 1 from prsn_private.settings s where lower(s.codeword)=lower(trim(prsn_unlock_chat.codeword))) then return false; end if;
 insert into prsn_private.chat_members(user_id) values(auth.uid()) on conflict do nothing;
 return true;
end;
$$;
revoke all on function public.prsn_has_chat() from public,anon;
revoke all on function public.prsn_unlock_chat(text) from public,anon;
grant execute on function public.prsn_has_chat() to authenticated;
grant execute on function public.prsn_unlock_chat(text) to authenticated;

create table if not exists public.prsn_study_posts (
 id bigint generated always as identity primary key,
 author_id uuid not null references auth.users(id) on delete cascade,
 author_name text not null check(char_length(author_name) between 1 and 20),
 kind text not null check(kind in ('prep','homework','resource')),
 subject text not null check(subject in ('Mathematics','Science','English','Hindi','Social Science','Sanskrit','General')),
 title text not null check(char_length(trim(title)) between 1 and 100),
 body text not null default '' check(char_length(body)<=4000),
 due_date date,
 file_path text, file_name text, file_type text,
 created_at timestamptz not null default now(),
 check((file_path is null and file_name is null and file_type is null) or
 (file_path is not null and file_name is not null and file_type in ('application/pdf','image/jpeg','image/png','image/webp','image/gif')))
);
create table if not exists public.prsn_chat_messages (
 id bigint generated always as identity primary key,
 author_id uuid not null references auth.users(id) on delete cascade,
 author_name text not null check(char_length(author_name) between 1 and 20),
 body text not null default '' check(char_length(body)<=2000),
 file_path text, file_name text, file_type text,
 created_at timestamptz not null default now(),
 check(char_length(trim(body))>0 or file_path is not null),
 check((file_path is null and file_name is null and file_type is null) or
 (file_path is not null and file_name is not null and file_type in ('application/pdf','image/jpeg','image/png','image/webp','image/gif')))
);
create index if not exists prsn_posts_created on public.prsn_study_posts(created_at desc,id desc);
create index if not exists prsn_posts_author on public.prsn_study_posts(author_id);
create index if not exists prsn_chat_author on public.prsn_chat_messages(author_id);
alter table public.prsn_study_posts enable row level security;
alter table public.prsn_chat_messages enable row level security;
revoke all on public.prsn_study_posts,public.prsn_chat_messages from anon,authenticated;
grant select,insert,delete on public.prsn_study_posts,public.prsn_chat_messages to authenticated;
grant usage,select on sequence public.prsn_study_posts_id_seq,public.prsn_chat_messages_id_seq to authenticated;

drop policy if exists prsn_board_read on public.prsn_study_posts;
create policy prsn_board_read on public.prsn_study_posts for select to authenticated using(true);
drop policy if exists prsn_board_write on public.prsn_study_posts;
create policy prsn_board_write on public.prsn_study_posts for insert to authenticated with check(
 author_id=(select auth.uid()) and (file_path is null or split_part(file_path,'/',1)=(select auth.uid())::text));
drop policy if exists prsn_board_delete on public.prsn_study_posts;
create policy prsn_board_delete on public.prsn_study_posts for delete to authenticated using(author_id=(select auth.uid()));
drop policy if exists prsn_chat_read on public.prsn_chat_messages;
create policy prsn_chat_read on public.prsn_chat_messages for select to authenticated using((select public.prsn_has_chat()));
drop policy if exists prsn_chat_write on public.prsn_chat_messages;
create policy prsn_chat_write on public.prsn_chat_messages for insert to authenticated with check(
 (select public.prsn_has_chat()) and author_id=(select auth.uid()) and (file_path is null or split_part(file_path,'/',1)=(select auth.uid())::text));
drop policy if exists prsn_chat_delete on public.prsn_chat_messages;
create policy prsn_chat_delete on public.prsn_chat_messages for delete to authenticated using((select public.prsn_has_chat()) and author_id=(select auth.uid()));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('prsn-study-files','prsn-study-files',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp','image/gif']),
('prsn-chat-files','prsn-chat-files',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp','image/gif'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
-- Restrictive guards prevent broad legacy storage policies from opening these buckets.
drop policy if exists prsn_file_guard on storage.objects;
create policy prsn_file_guard on storage.objects as restrictive for all to public
using(case when bucket_id in ('prsn-study-files','prsn-chat-files') then auth.uid() is not null and
 case when bucket_id='prsn-chat-files' then public.prsn_has_chat() else true end else true end)
with check(case when bucket_id in ('prsn-study-files','prsn-chat-files') then auth.uid() is not null and
 (storage.foldername(name))[1]=auth.uid()::text and case when bucket_id='prsn-chat-files' then public.prsn_has_chat() else true end else true end);
-- Safe for anon policy evaluation: has_chat only returns a boolean for the caller.
grant execute on function public.prsn_has_chat() to anon;
drop policy if exists prsn_file_read on storage.objects;
create policy prsn_file_read on storage.objects for select to authenticated using(bucket_id in ('prsn-study-files','prsn-chat-files'));
drop policy if exists prsn_file_insert on storage.objects;
create policy prsn_file_insert on storage.objects for insert to authenticated with check(bucket_id in ('prsn-study-files','prsn-chat-files') and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists prsn_file_delete on storage.objects;
create policy prsn_file_delete on storage.objects for delete to authenticated using(bucket_id in ('prsn-study-files','prsn-chat-files') and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists prsn_file_delete_guard on storage.objects;
create policy prsn_file_delete_guard on storage.objects as restrictive for delete to public using(bucket_id not in ('prsn-study-files','prsn-chat-files') or (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists prsn_file_update_guard on storage.objects;
create policy prsn_file_update_guard on storage.objects as restrictive for update to public using(bucket_id not in ('prsn-study-files','prsn-chat-files')) with check(bucket_id not in ('prsn-study-files','prsn-chat-files'));

do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='prsn_study_posts') then alter publication supabase_realtime add table public.prsn_study_posts; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='prsn_chat_messages') then alter publication supabase_realtime add table public.prsn_chat_messages; end if;
end $$;
commit;
