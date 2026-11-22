begin;
create table if not exists calendar_private.years(year integer primary key check(year between 2020 and 2100),state text not null default 'planned' check(state in ('active','archived','planned')),created_at timestamptz not null default now());
create unique index if not exists calendar_one_active_year on calendar_private.years(state) where state='active';
alter table calendar_private.years enable row level security;
insert into calendar_private.years(year,state) values(2026,'active'),(2027,'planned') on conflict(year) do nothing;
create table if not exists calendar_private.drive_state(state_hash text primary key,data jsonb not null,expires_at timestamptz not null);
create table if not exists calendar_private.drive_connection(id integer primary key check(id=1),data jsonb not null);
alter table calendar_private.drive_state enable row level security;
alter table calendar_private.drive_connection enable row level security;
create or replace function public.calendar_api(p_token text,p_action text,p_data jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u calendar_private.users;n calendar_private.notes;d jsonb;r jsonb;v_id text;can_read boolean;can_edit boolean;newpin text; y integer; rowdata jsonb; accepted jsonb; preview jsonb; rowresult text; reason text; fingerprint text; seen text[]; inserted_count integer; duplicate_count integer; conflict_count integer; error_count integer; row_index integer; old_data jsonb; seen_rows jsonb;
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

 if p_action='years' then
 select coalesce(jsonb_agg(jsonb_build_object('year',year,'state',state) order by year),'[]'::jsonb) into r from calendar_private.years;
 return jsonb_build_object('ok',true,'years',r,'isAdmin',u.role='ceo','userId',u.id);end if;
 if p_action in ('create_year','activate_year') then
 if u.role<>'ceo' then return '{"ok":false,"error":"للإدارة التنفيذية فقط"}';end if;
 if coalesce(p_data->>'year','') !~ '^(20[2-9][0-9]|2100)$' then return '{"ok":false,"error":"السنة غير صحيحة"}';end if;
 y=(p_data->>'year')::int;perform pg_advisory_xact_lock(20262027);
 insert into calendar_private.years(year)values(y) on conflict do nothing;
 if p_action='activate_year' then update calendar_private.years set state='archived' where state='active' and year<>y;update calendar_private.years set state='active' where year=y;end if;
 insert into calendar_private.audit(user_id,action,note_id)values(u.id,p_action,y::text);
 return '{"ok":true}';end if;
 if p_action in ('import_preview','import_commit') then
 if u.role<>'ceo' then return '{"ok":false,"error":"الاستيراد للإدارة التنفيذية فقط"}';end if;
 if jsonb_typeof(p_data->'notes') is distinct from 'array' or jsonb_array_length(p_data->'notes') not between 1 and 1000 or octet_length(p_data::text)>7000000 then return '{"ok":false,"error":"ملف فارغ أو أكبر من الحد المسموح"}';end if;
 perform pg_advisory_xact_lock(20262028);accepted='[]'::jsonb;preview='[]'::jsonb;seen=array[]::text[];seen_rows='{}'::jsonb;inserted_count=0;duplicate_count=0;conflict_count=0;error_count=0;row_index=0;
 for rowdata in select value from jsonb_array_elements(p_data->'notes') loop
 row_index=row_index+1;rowresult='new';reason='';old_data=null;fingerprint=null;
 begin
 if jsonb_typeof(rowdata) is distinct from 'object' or coalesce(rowdata->>'id','') !~ '^[A-Za-z0-9_-]{1,100}$' or coalesce(rowdata->>'date','') !~ '^(20[2-9][0-9]|2100)-[0-9]{2}-[0-9]{2}$' or (length(coalesce(rowdata->>'text',''))>20000 or length(trim(coalesce(rowdata->>'text','')||coalesce(rowdata->>'title','')))=0) or length(coalesce(rowdata->>'title',''))>200 or length(coalesce(rowdata->>'link',''))>20000 or coalesce(rowdata->>'from_role','') not in ('ceo','marketing','hr','ops','quality') or coalesce(rowdata->>'to_role','') not in ('ceo','marketing','hr','ops','quality','all') or coalesce(rowdata->>'status','new') not in ('new','read','done','rejected') or jsonb_typeof(coalesce(rowdata->'replies','[]'::jsonb))<>'array' or jsonb_typeof(coalesce(rowdata->'editLog','[]'::jsonb))<>'array' then raise exception using errcode='22007',message='بيانات غير صالحة';end if;
 perform (rowdata->>'date')::date;
 fingerprint=encode(extensions.digest(concat_ws(chr(31),rowdata->>'date',coalesce(rowdata->>'title',''),rowdata->>'text',rowdata->>'from_role',rowdata->>'to_role'),'sha256'),'hex');
 select data into old_data from calendar_private.notes where id=rowdata->>'id';
 if old_data is not null then
 if (old_data->>'date',coalesce(old_data->>'title',''),old_data->>'text',old_data->>'from_role',old_data->>'to_role') is not distinct from (rowdata->>'date',coalesce(rowdata->>'title',''),rowdata->>'text',rowdata->>'from_role',rowdata->>'to_role') then rowresult='duplicate';reason='المعرف موجود؛ سيبقى السجل الحالي بحالاته وتعديلاته';else rowresult='conflict';reason='المعرف موجود بمحتوى مختلف؛ لا يتم استبداله';end if;
 elsif seen_rows ? (rowdata->>'id') then if seen_rows->>(rowdata->>'id')=fingerprint then rowresult='duplicate';reason='المعرف مكرر داخل الملف';else rowresult='conflict';reason='المعرف مكرر بمحتوى مختلف داخل الملف';end if;
 elsif fingerprint=any(seen) or exists(select 1 from calendar_private.notes z where (z.data->>'date',coalesce(z.data->>'title',''),z.data->>'text',z.data->>'from_role',z.data->>'to_role') is not distinct from (rowdata->>'date',coalesce(rowdata->>'title',''),rowdata->>'text',rowdata->>'from_role',rowdata->>'to_role')) then rowresult='duplicate';reason='المحتوى موجود مسبقًا';
 end if;
 exception when invalid_datetime_format or datetime_field_overflow then rowresult='error';reason='راجع التاريخ والوصف والأقسام والحالة';end;
 preview=preview||jsonb_build_array(jsonb_build_object('row',coalesce(rowdata->>'source_row',row_index::text),'id',rowdata->>'id','date',rowdata->>'date','title',coalesce(rowdata->>'title',left(rowdata->>'text',70)),'result',rowresult,'reason',reason));
 if rowresult='new' then accepted=accepted||jsonb_build_array(rowdata||jsonb_build_object('source_fingerprint',fingerprint));seen=array_append(seen,fingerprint);seen_rows=seen_rows||jsonb_build_object(rowdata->>'id',fingerprint);elsif rowresult='duplicate' then duplicate_count=duplicate_count+1;elsif rowresult='conflict' then conflict_count=conflict_count+1;else error_count=error_count+1;end if;
 end loop;
 if p_action='import_commit' then
 if error_count>0 or conflict_count>0 then return jsonb_build_object('ok',false,'error','عالج الصفوف غير الصالحة أو المتعارضة قبل الحفظ','preview',preview);end if;
 for rowdata in select value from jsonb_array_elements(accepted) loop
 insert into calendar_private.years(year,state)values(left(rowdata->>'date',4)::int,'archived') on conflict do nothing;
 rowdata=(rowdata-'author_user_id')||jsonb_build_object('author_name',case when rowdata->>'from_role'='marketing' then 'التسويق' when rowdata->>'from_role'='ceo' then 'الإدارة التنفيذية' else rowdata->>'from_role' end,'imported_by',u.display_name,'imported_at',now());
 insert into calendar_private.notes(id,data,author_id,archived)values(rowdata->>'id',rowdata,null,coalesce(rowdata->>'archived','false') in ('true','yes','1')) on conflict do nothing;
 if found then inserted_count=inserted_count+1;end if;
 end loop;
 insert into calendar_private.audit(user_id,action,note_id)values(u.id,'import_commit',inserted_count::text);
 end if;
 return jsonb_build_object('ok',true,'preview',preview,'new',jsonb_array_length(accepted),'duplicates',duplicate_count,'conflicts',conflict_count,'errors',error_count,'inserted',inserted_count);end if;

 v_id=p_data->>'id';if coalesce(v_id,'') !~ '^[A-Za-z0-9_-]{1,100}$' then return '{"ok":false,"error":"معرف غير صالح"}';end if;select * into n from calendar_private.notes where id=v_id for update;
 can_read=n.id is not null and (u.role='ceo' or n.data->>'from_role'=u.department or n.data->>'to_role' in(u.department,'all') or n.data->>'shared'='yes');
 can_edit=n.id is not null and (u.role='ceo' or n.author_id=u.id or (n.author_id is null and n.data->>'from_role'=u.department));
 if p_action='save' then
 if n.id is not null and not can_edit then return '{"ok":false,"error":"غير مسموح"}';end if;
 if length(coalesce(p_data->>'text','')) not between 1 and 20000 or coalesce(p_data->>'date','') !~ '^(20[2-9][0-9]|2100)-[0-9]{2}-[0-9]{2}$' or coalesce(p_data->>'to_role','') not in ('ceo','marketing','hr','ops','quality','all') then return '{"ok":false,"error":"راجع التاريخ والوصف والقسم"}';end if;
 perform (p_data->>'date')::date;
 if not exists(select 1 from calendar_private.years where year=left(p_data->>'date',4)::int and state='active') then return '{"ok":false,"error":"هذه السنة مؤرشفة أو غير مفعلة؛ فعّلها من إدارة السنوات قبل التعديل"}';end if;

 d=jsonb_build_object('id',v_id,'date',p_data->>'date','title',left(coalesce(p_data->>'title',''),200),'text',p_data->>'text','link',coalesce(p_data->>'link',''),'to_role',p_data->>'to_role','color',case when coalesce(p_data->>'color','')~'^#[0-9a-fA-F]{6}$' then p_data->>'color' else '#7B52AB' end);
 if n.id is null then
 d=d||jsonb_build_object('from_role',u.department,'author_name',u.display_name,'author_user_id',u.id,'shared','no','status','new','replies','[]'::jsonb,'editLog','[]'::jsonb,'ts',now());
 insert into calendar_private.notes values(v_id,d,u.id,false);
 else
 update calendar_private.notes set data=data||d||jsonb_build_object('editLog',coalesce(data->'editLog','[]'::jsonb)||jsonb_build_array(jsonb_build_object('by',u.display_name,'ts',now(),'summary','تعديل العمل'))) where id=v_id;
 end if;
 else
 if not can_read then return '{"ok":false,"error":"غير مسموح"}';end if;
 if p_action<>'read' and not exists(select 1 from calendar_private.years where year=left(n.data->>'date',4)::int and state='active') then return '{"ok":false,"error":"السنة مؤرشفة للقراءة فقط"}';end if;
 if p_action='read' then
 insert into calendar_private.reads(note_id,user_id)values(v_id,u.id) on conflict do nothing;
 if exists(select 1 from calendar_private.years where year=left(n.data->>'date',4)::int and state='active') and n.data->>'from_role'<>u.department and n.data->>'to_role' in(u.department,'all') and coalesce(n.data->>'status','new')='new' then update calendar_private.notes set data=data||jsonb_build_object('status','read','statusTs',now()) where id=v_id;end if;
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

create or replace function public.calendar_drive(p_token text,p_action text,p_data jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u calendar_private.users;r jsonb;
begin
 select x.* into u from calendar_private.users x join calendar_private.sessions s on s.user_id=x.id where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.expires_at>now() and x.active and x.role='ceo';
 if u.id is null or u.must_change_pin then return '{"ok":false,"error":"جلسة الإدارة التنفيذية مطلوبة"}';end if;
 if octet_length(p_data::text)>32000 then return '{"ok":false,"error":"البيانات أكبر من الحد المسموح"}';end if;
 if p_action='get_settings' then select data->'settings' into r from calendar_private.drive_connection where id=1;
 elsif p_action='get_connection' then select data->'connection' into r from calendar_private.drive_connection where id=1;
 elsif p_action='save_settings' then
 if length(coalesce(p_data->'data'->>'credentials','')) not between 40 and 16000 then return '{"ok":false,"error":"إعدادات غير صالحة"}';end if;
 insert into calendar_private.drive_connection values(1,jsonb_build_object('settings',p_data->'data')) on conflict(id) do update set data=calendar_private.drive_connection.data||excluded.data;
 elsif p_action='save_connection' then
 if p_data->'data'->>'adminId' is distinct from u.id::text or length(coalesce(p_data->'data'->>'credentials','')) not between 40 and 16000 or coalesce(p_data->'data'->>'folderId','') !~ '^[A-Za-z0-9_-]+$' then return '{"ok":false,"error":"بيانات اتصال غير صالحة"}';end if;
 insert into calendar_private.drive_connection values(1,jsonb_build_object('connection',p_data->'data')) on conflict(id) do update set data=calendar_private.drive_connection.data||excluded.data;
 elsif p_action='save_state' then
 delete from calendar_private.drive_state where expires_at<now();
 if p_data->'data'->>'adminId' is distinct from u.id::text or length(coalesce(p_data->'data'->>'state',''))<32 then return '{"ok":false,"error":"جلسة تفويض غير صالحة"}';end if;
 insert into calendar_private.drive_state values(encode(extensions.digest(p_data->'data'->>'state','sha256'),'hex'),p_data->'data',now()+interval '10 minutes');
 elsif p_action='consume_state' then
 delete from calendar_private.drive_state where state_hash=encode(extensions.digest(p_data->>'state','sha256'),'hex') and data->>'adminId'=u.id::text and expires_at>now() returning data into r;
 else return '{"ok":false,"error":"إجراء غير معروف"}';end if;
 return jsonb_build_object('ok',true,'data',r);
end;$$;
revoke all on function public.calendar_drive(text,text,jsonb) from public,authenticated;
grant execute on function public.calendar_drive(text,text,jsonb) to anon;

revoke all on all tables in schema calendar_private from public,anon,authenticated;
notify pgrst, 'reload schema';
commit;
select year,state from calendar_private.years order by year;
