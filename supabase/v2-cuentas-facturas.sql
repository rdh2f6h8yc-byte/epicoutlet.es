-- =====================================================================
-- EpicOutlet.es · versión 2: facturas, reembolsos, cupones y cuentas de clientes
-- Pega este archivo en Supabase → SQL Editor → New query → Run.
-- Se puede ejecutar más de una vez sin problema.
-- =====================================================================

-- 1) Campos nuevos en los pedidos
alter table public.pedidos add column if not exists factura text;                 -- EO-2026-00001
alter table public.pedidos add column if not exists factura_fecha timestamptz;
alter table public.pedidos add column if not exists rectificativa text;           -- R-2026-00001 (si se reembolsa)
alter table public.pedidos add column if not exists rectificativa_fecha timestamptz;
alter table public.pedidos add column if not exists motivo_reembolso text;
alter table public.pedidos add column if not exists reembolsado numeric(10,2) not null default 0;
alter table public.pedidos add column if not exists cupon text;
alter table public.pedidos add column if not exists descuento numeric(10,2) not null default 0;
alter table public.pedidos add column if not exists user_id uuid references auth.users (id) on delete set null;
alter table public.pedidos add column if not exists correos jsonb not null default '{}'::jsonb;  -- qué correos se han enviado
alter table public.pedidos add column if not exists enviado timestamptz;
create index if not exists pedidos_email_idx on public.pedidos (lower(cliente_email));
create index if not exists pedidos_user_idx on public.pedidos (user_id);

-- 2) Numeración correlativa de facturas por serie y año (sin huecos: solo se pide al cobrar)
create table if not exists public.facturas_serie (
  serie text not null,
  anio int not null,
  ultimo int not null default 0,
  primary key (serie, anio)
);
alter table public.facturas_serie enable row level security;   -- nadie desde fuera; solo el servidor

create or replace function public.siguiente_factura(p_serie text)
returns text language plpgsql security definer set search_path = public as $$
declare a int := extract(year from now() at time zone 'Europe/Madrid'); n int;
begin
  insert into public.facturas_serie (serie, anio, ultimo) values (p_serie, a, 1)
  on conflict (serie, anio) do update set ultimo = public.facturas_serie.ultimo + 1
  returning ultimo into n;
  return p_serie || '-' || a || '-' || lpad(n::text, 5, '0');
end $$;
revoke execute on function public.siguiente_factura(text) from public, anon, authenticated;

-- 3) Cuentas de clientes: cada cliente ve solo SUS pedidos (por su cuenta o por su correo verificado)
drop policy if exists "cliente ve sus pedidos" on public.pedidos;
create policy "cliente ve sus pedidos" on public.pedidos
  for select to authenticated
  using (estado not in ('pendiente', 'cancelado') and (user_id = auth.uid() or lower(cliente_email) = lower(auth.jwt() ->> 'email')));

create table if not exists public.perfiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nombre text,
  telefono text,
  direccion jsonb,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
alter table public.perfiles enable row level security;
drop policy if exists "cliente gestiona su perfil" on public.perfiles;
create policy "cliente gestiona su perfil" on public.perfiles
  for all to authenticated using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists "admin ve perfiles" on public.perfiles;
create policy "admin ve perfiles" on public.perfiles
  for select to authenticated using (public.es_admin());
drop trigger if exists perfiles_actualizado on public.perfiles;
create trigger perfiles_actualizado before update on public.perfiles
  for each row execute function public.tocar_actualizado();

-- 4) Devolver unidades al stock al reembolsar (solo el servidor)
create or replace function public.sumar_stock(p_id uuid, n integer)
returns void language sql security definer set search_path = public as $$
  update public.productos set stock = stock + greatest(n, 0) where id = p_id;
$$;
revoke execute on function public.sumar_stock(uuid, integer) from public, anon, authenticated;

-- Comprobación: debe salir "ok"
select 'ok' as resultado;
