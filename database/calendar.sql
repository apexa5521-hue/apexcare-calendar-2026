begin;
create schema if not exists calendar_private;
revoke all on schema calendar_private from public,anon,authenticated;
create extension if not exists pgcrypto with schema extensions;
create table if not exists calendar_private.users(id uuid primary key default gen_random_uuid(),username text unique not null,display_name text not null,department text not null,role text not null check(role in ('ceo','staff')),pin_hash text not null,active boolean not null default true,attempts int not null default 0,locked_until timestamptz,must_change_pin boolean not null default true);
create table if not exists calendar_private.sessions(token_hash text primary key,user_id uuid not null references calendar_private.users,expires_at timestamptz not null);
create table if not exists calendar_private.notes(id text primary key,data jsonb not null,author_id uuid references calendar_private.users,archived boolean not null default false);
create table if not exists calendar_private.reads(note_id text references calendar_private.notes,user_id uuid references calendar_private.users,read_at timestamptz default now(),primary key(note_id,user_id));
create table if not exists calendar_private.audit(id bigint generated always as identity primary key,user_id uuid,action text,note_id text,at timestamptz default now());
alter table calendar_private.users enable row level security;
alter table calendar_private.sessions enable row level security;
alter table calendar_private.notes enable row level security;
alter table calendar_private.reads enable row level security;
alter table calendar_private.audit enable row level security;
create or replace function public.calendar_login(p_username text,p_pin text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u calendar_private.users;token text;
begin
 select * into u from calendar_private.users where username=lower(trim(p_username)) for update;
 if u.id is null or not u.active then return jsonb_build_object('ok',false,'error','بيانات الدخول غير صحيحة');end if;
 if u.locked_until>now() then return jsonb_build_object('ok',false,'error','توقفت المحاولات مؤقتًا. حاول لاحقًا');end if;
 if coalesce(p_pin,'') !~ '^[0-9]{4}$' or extensions.crypt(p_pin,u.pin_hash) is distinct from u.pin_hash then
 update calendar_private.users set attempts=case when attempts>=4 then 0 else attempts+1 end,locked_until=case when attempts>=4 then now()+interval '15 minutes' else null end where id=u.id;
 return jsonb_build_object('ok',false,'error','بيانات الدخول غير صحيحة');end if;
 update calendar_private.users set attempts=0,locked_until=null where id=u.id;
 token=encode(extensions.gen_random_bytes(32),'hex');
 delete from calendar_private.sessions where expires_at<now();
 insert into calendar_private.sessions values(encode(extensions.digest(token,'sha256'),'hex'),u.id,now()+interval '8 hours');
 return jsonb_build_object('ok',true,'token',token,'user',jsonb_build_object('id',u.id,'username',u.username,'name',u.display_name,'department',u.department,'role',u.role,'mustChangePin',u.must_change_pin));
end;$$;
create or replace function public.calendar_api(p_token text,p_action text,p_data jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u calendar_private.users;n calendar_private.notes;d jsonb;r jsonb;v_id text;can_read boolean;can_edit boolean;newpin text;
begin
 select x.* into u from calendar_private.users x join calendar_private.sessions s on s.user_id=x.id where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.expires_at>now() and x.active;
 if u.id is null then return jsonb_build_object('ok',false,'error','انتهت الجلسة. سجل الدخول مجددًا');end if;
 if p_action='logout' then delete from calendar_private.sessions where token_hash=encode(extensions.digest(p_token,'sha256'),'hex');return '{"ok":true}';end if;
 if p_action='change_pin' then
 newpin=p_data->>'pin';if coalesce(newpin,'') !~ '^[0-9]{4}$' then return '{"ok":false,"error":"أدخل أربعة أرقام"}';end if;
 if extensions.crypt(p_data->>'currentPin',u.pin_hash) is distinct from u.pin_hash then return '{"ok":false,"error":"الرمز الحالي غير صحيح"}';end if;
 update calendar_private.users set pin_hash=extensions.crypt(newpin,extensions.gen_salt('bf',10)),must_change_pin=false where id=u.id;
 delete from calendar_private.sessions where user_id=u.id and token_hash<>encode(extensions.digest(p_token,'sha256'),'hex');
 return '{"ok":true}';end if;
 if u.must_change_pin then return '{"ok":false,"error":"غيّر الرمز الأولي قبل استخدام التقويم"}';end if;
 if p_action='list' then
 select coalesce(jsonb_agg(data||jsonb_build_object('archived',archived) order by data->>'date'),'[]'::jsonb) into r from calendar_private.notes where u.role='ceo' or data->>'from_role'=u.department or data->>'to_role' in (u.department,'all') or data->>'shared'='yes';
 return jsonb_build_object('ok',true,'notes',r);end if;
 if p_action='users' then
 if u.role<>'ceo' then return '{"ok":false,"error":"غير مسموح"}';end if;
 select jsonb_agg(jsonb_build_object('username',username,'name',display_name,'department',department,'active',active)) into r from calendar_private.users;
 return jsonb_build_object('ok',true,'users',coalesce(r,'[]'::jsonb));end if;
 if p_action='create_user' then
 if u.role<>'ceo' then return '{"ok":false,"error":"غير مسموح"}';end if;
 if coalesce(p_data->>'username','') !~ '^[A-Za-z0-9._-]{3,40}$' or coalesce(p_data->>'pin','') !~ '^[0-9]{4}$' or length(coalesce(p_data->>'name','')) not between 1 and 80 or p_data->>'department' not in ('marketing','hr','ops','quality') then return '{"ok":false,"error":"راجع بيانات المستخدم"}';end if;
 insert into calendar_private.users(username,display_name,department,role,pin_hash)values(lower(p_data->>'username'),p_data->>'name',p_data->>'department','staff',extensions.crypt(p_data->>'pin',extensions.gen_salt('bf',10)));
 return '{"ok":true}';end if;
 v_id=p_data->>'id';if coalesce(v_id,'') !~ '^[A-Za-z0-9_-]{1,100}$' then return '{"ok":false,"error":"معرف غير صالح"}';end if;select * into n from calendar_private.notes where id=v_id for update;
 can_read=n.id is not null and (u.role='ceo' or n.data->>'from_role'=u.department or n.data->>'to_role' in(u.department,'all') or n.data->>'shared'='yes');
 can_edit=n.id is not null and (u.role='ceo' or n.author_id=u.id or (n.author_id is null and n.data->>'from_role'=u.department));
 if p_action='save' then
 if n.id is not null and not can_edit then return '{"ok":false,"error":"غير مسموح"}';end if;
 if length(coalesce(p_data->>'text','')) not between 1 and 20000 or coalesce(p_data->>'date','') !~ '^2026-[0-9]{2}-[0-9]{2}$' or coalesce(p_data->>'to_role','') not in ('ceo','marketing','hr','ops','quality','all') then return '{"ok":false,"error":"راجع التاريخ والوصف والقسم"}';end if;
 perform (p_data->>'date')::date;
 d=jsonb_build_object('id',v_id,'date',p_data->>'date','title',left(coalesce(p_data->>'title',''),200),'text',p_data->>'text','link',coalesce(p_data->>'link',''),'to_role',p_data->>'to_role','color',case when coalesce(p_data->>'color','')~'^#[0-9a-fA-F]{6}$' then p_data->>'color' else '#7B52AB' end);
 if n.id is null then
 d=d||jsonb_build_object('from_role',u.department,'author_name',u.display_name,'author_user_id',u.id,'shared','no','status','new','replies','[]'::jsonb,'editLog','[]'::jsonb,'ts',now());
 insert into calendar_private.notes values(v_id,d,u.id,false);
 else
 update calendar_private.notes set data=data||d||jsonb_build_object('editLog',coalesce(data->'editLog','[]'::jsonb)||jsonb_build_array(jsonb_build_object('by',u.display_name,'ts',now(),'summary','تعديل العمل'))) where id=v_id;
 end if;
 else
 if not can_read then return '{"ok":false,"error":"غير مسموح"}';end if;
 if p_action='read' then
 insert into calendar_private.reads(note_id,user_id)values(v_id,u.id) on conflict do nothing;
 if n.data->>'from_role'<>u.department and n.data->>'to_role' in(u.department,'all') and coalesce(n.data->>'status','new')='new' then update calendar_private.notes set data=data||jsonb_build_object('status','read','statusTs',now()) where id=v_id;end if;
 elsif p_action='status' then
 if p_data->>'status' not in ('done','rejected') or not(u.role='ceo' or n.data->>'to_role' in(u.department,'all') or can_edit) then return '{"ok":false,"error":"غير مسموح"}';end if;
 update calendar_private.notes set data=data||jsonb_build_object('status',p_data->>'status','statusTs',now(),'status_by',u.display_name) where id=v_id;
 elsif p_action='reply' then
 if length(coalesce(p_data->>'text','')) not between 1 and 10000 then return '{"ok":false,"error":"الرد فارغ أو طويل جدًا"}';end if;
 update calendar_private.notes set data=data||jsonb_build_object('replies',coalesce(data->'replies','[]'::jsonb)||jsonb_build_array(jsonb_build_object('from_role',u.department,'author_name',u.display_name,'text',p_data->>'text','ts',now()))) where id=v_id;
 elsif p_action in ('archive','restore','share') then
 if not can_edit then return '{"ok":false,"error":"غير مسموح"}';end if;
 if p_action='share' then update calendar_private.notes set data=data||jsonb_build_object('shared','yes') where id=v_id;
 else update calendar_private.notes set archived=(p_action='archive') where id=v_id;end if;
 else return '{"ok":false,"error":"إجراء غير معروف"}';end if;
 end if;
 insert into calendar_private.audit(user_id,action,note_id)values(u.id,p_action,v_id);
 return '{"ok":true}';
exception when unique_violation then return '{"ok":false,"error":"اسم المستخدم مستخدم مسبقًا"}';when invalid_datetime_format or datetime_field_overflow then return '{"ok":false,"error":"التاريخ غير صحيح"}';
end;$$;
revoke all on all tables in schema calendar_private from public,anon,authenticated;
revoke all on function public.calendar_login(text,text) from public;
revoke all on function public.calendar_api(text,text,jsonb) from public;
grant execute on function public.calendar_login(text,text) to anon;
grant execute on function public.calendar_api(text,text,jsonb) to anon;
commit;

-- Initial accounts: one-time randomly generated PINs; reruns do not replace existing users.
create temporary table calendar_initial_credentials(username text,pin text) on commit preserve rows;
with requested(username,display_name,department,role) as (values('ruba','Ruba','marketing','staff'),('hams','Hams','marketing','staff'),('dr.anas','Dr.Anas','ceo','ceo')),
seeds as(select *,lpad((floor(random()*9000)+1000)::text,4,'0') pin from requested where not exists(select 1 from calendar_private.users u where u.username=requested.username)),
inserted as(insert into calendar_private.users(username,display_name,department,role,pin_hash,must_change_pin) select username,display_name,department,role,extensions.crypt(pin,extensions.gen_salt('bf',10)),false from seeds returning username)
insert into calendar_initial_credentials select s.username,s.pin from seeds s join inserted i using(username);
select username,pin as initial_pin from calendar_initial_credentials;
