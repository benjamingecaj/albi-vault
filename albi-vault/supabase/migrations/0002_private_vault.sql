create extension if not exists pgcrypto with schema extensions;

create table if not exists public.private_vault_config (
  singleton boolean primary key default true check (singleton),
  passphrase_hash text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.private_vault_entries (
  id uuid primary key default gen_random_uuid(),
  service text not null,
  username text,
  email text,
  password_ciphertext bytea,
  two_factor text,
  notes text,
  created_at timestamptz not null default now()
);
create table if not exists public.private_vault_events (
  id bigint generated always as identity primary key,
  actor uuid,
  action text not null,
  entry_id uuid,
  created_at timestamptz not null default now()
);
alter table public.private_vault_config enable row level security;
alter table public.private_vault_entries enable row level security;
alter table public.private_vault_events enable row level security;
revoke all on public.private_vault_config, public.private_vault_entries, public.private_vault_events from public, anon, authenticated;

create or replace function public.private_vault_rpc(
  p_action text,
  p_passphrase text default null,
  p_id uuid default null,
  p_service text default null,
  p_username text default null,
  p_email text default null,
  p_password text default null,
  p_two_factor text default null,
  p_notes text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_key text;
  v_hash text;
  v_data jsonb;
  v_entry_id uuid;
  v_secret text;
begin
  if v_actor is null or not exists (
    select 1 from public.vault_profiles
    where id = v_actor and role = 'admin' and active = true
  ) then raise exception 'Administrator access required'; end if;

  if p_action = 'status' then
    return jsonb_build_object('configured', exists(select 1 from public.private_vault_config));
  end if;

  if p_action = 'setup' then
    if length(coalesce(p_passphrase,'')) < 16 then raise exception 'Use at least 16 characters'; end if;
    insert into public.private_vault_config(singleton, passphrase_hash)
    values (true, extensions.crypt(p_passphrase, extensions.gen_salt('bf', 12)))
    on conflict (singleton) do nothing;
    if not found then raise exception 'Private Vault already configured'; end if;
    insert into public.private_vault_events(actor,action) values(v_actor,'setup');
    return '{"ok":true}'::jsonb;
  end if;

  select passphrase_hash into v_hash from public.private_vault_config where singleton = true;
  if v_hash is null then raise exception 'Private Vault is not configured'; end if;
  if p_passphrase is null or extensions.crypt(p_passphrase, v_hash) <> v_hash then
    insert into public.private_vault_events(actor,action) values(v_actor,'unlock_failed');
    raise exception 'Invalid private vault passphrase';
  end if;

  select encryption_key into v_key from public.vault_settings where singleton = true;
  if v_key is null then raise exception 'Encryption key is not configured'; end if;

  if p_action = 'list' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',id,'service',service,'username',username,'email',email,
      'two_factor',two_factor,'notes',notes,'has_password',password_ciphertext is not null
    ) order by service), '[]'::jsonb) into v_data from public.private_vault_entries;
    insert into public.private_vault_events(actor,action) values(v_actor,'list');
    return jsonb_build_object('entries',v_data);
  elsif p_action = 'add' then
    if length(trim(coalesce(p_service,''))) = 0 then raise exception 'Service is required'; end if;
    insert into public.private_vault_entries(service,username,email,password_ciphertext,two_factor,notes)
    values (trim(p_service),nullif(trim(coalesce(p_username,'')),''),nullif(trim(coalesce(p_email,'')),''),
      case when nullif(p_password,'') is null then null else extensions.pgp_sym_encrypt(p_password,v_key) end,
      nullif(trim(coalesce(p_two_factor,'')),''),nullif(trim(coalesce(p_notes,'')),''))
    returning id into v_entry_id;
    insert into public.private_vault_events(actor,action,entry_id) values(v_actor,'add',v_entry_id);
    return jsonb_build_object('ok',true);
  elsif p_action = 'reveal' then
    select case when password_ciphertext is null then null else extensions.pgp_sym_decrypt(password_ciphertext,v_key) end
      into v_secret from public.private_vault_entries where id = p_id;
    if not found then raise exception 'Entry not found'; end if;
    insert into public.private_vault_events(actor,action,entry_id) values(v_actor,'reveal',p_id);
    return jsonb_build_object('password',v_secret);
  elsif p_action = 'delete' then
    delete from public.private_vault_entries where id = p_id returning id into v_entry_id;
    if v_entry_id is null then raise exception 'Entry not found'; end if;
    insert into public.private_vault_events(actor,action,entry_id) values(v_actor,'delete',v_entry_id);
    return jsonb_build_object('ok',true);
  end if;
  raise exception 'Unknown action';
end;
$$;
revoke all on function public.private_vault_rpc(text,text,uuid,text,text,text,text,text,text) from public,anon;
grant execute on function public.private_vault_rpc(text,text,uuid,text,text,text,text,text,text) to authenticated;
