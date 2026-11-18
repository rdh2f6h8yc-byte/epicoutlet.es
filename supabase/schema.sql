-- =====================================================================
-- EpicOutlet.es · base de datos (Supabase)
-- Pega todo este archivo en Supabase → SQL Editor → New query → Run.
-- Correo con permiso para entrar al panel /admin: almarainstalaciones@gmail.com
-- =====================================================================

-- Quién puede administrar la tienda
create table if not exists public.admins (
  email text primary key
);
alter table public.admins enable row level security;  -- nadie la lee desde fuera

create or replace function public.es_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where email = auth.jwt() ->> 'email');
$$;

-- Productos (lo que ve el cliente)
create table if not exists public.productos (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  nombre text not null,
  categoria text not null default 'hogar',
  estado text not null default 'Nuevo'
    check (estado in ('Nuevo', 'Caja abierta', 'Reprecintado', 'Liquidación')),
  marca text,
  precio numeric(10,2) not null check (precio >= 0),
  precio_anterior numeric(10,2),
  stock integer not null default 1 check (stock >= 0),
  descripcion text not null default '',
  caracteristicas jsonb not null default '{}'::jsonb,
  imagenes text[] not null default '{}',
  top boolean not null default false,
  publicado boolean not null default false,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);

-- Datos privados del producto (solo el administrador los ve)
create table if not exists public.productos_privado (
  producto_id uuid primary key references public.productos(id) on delete cascade,
  coste numeric(10,2),
  proveedor text,
  origen_url text,
  notas text
);

create or replace function public.tocar_actualizado()
returns trigger language plpgsql as $$
begin new.actualizado := now(); return new; end $$;

drop trigger if exists productos_actualizado on public.productos;
create trigger productos_actualizado before update on public.productos
  for each row execute function public.tocar_actualizado();

-- Seguridad
alter table public.productos enable row level security;
alter table public.productos_privado enable row level security;

drop policy if exists "ver publicados" on public.productos;
create policy "ver publicados" on public.productos
  for select using (publicado or public.es_admin());

drop policy if exists "admin gestiona productos" on public.productos;
create policy "admin gestiona productos" on public.productos
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

drop policy if exists "admin gestiona privados" on public.productos_privado;
create policy "admin gestiona privados" on public.productos_privado
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

-- Fotos de productos (carpeta pública para ver, solo el admin sube)
insert into storage.buckets (id, name, public)
values ('productos', 'productos', true)
on conflict (id) do update set public = true;

drop policy if exists "admin sube fotos" on storage.objects;
create policy "admin sube fotos" on storage.objects
  for insert to authenticated with check (bucket_id = 'productos' and public.es_admin());

drop policy if exists "admin cambia fotos" on storage.objects;
create policy "admin cambia fotos" on storage.objects
  for update to authenticated using (bucket_id = 'productos' and public.es_admin());

drop policy if exists "admin borra fotos" on storage.objects;
create policy "admin borra fotos" on storage.objects
  for delete to authenticated using (bucket_id = 'productos' and public.es_admin());

-- Ajustes del panel (margen de beneficio, IVA, redondeo)
create table if not exists public.ajustes (
  clave text primary key,
  valor jsonb not null default '{}'::jsonb
);
alter table public.ajustes enable row level security;
drop policy if exists "admin gestiona ajustes" on public.ajustes;
create policy "admin gestiona ajustes" on public.ajustes
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

-- Correo de acceso al panel
insert into public.admins (email) values ('almarainstalaciones@gmail.com')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Pedidos y pagos (también en supabase/pedidos.sql)
-- ---------------------------------------------------------------------

create table if not exists public.pedidos (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity (start with 1001),
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'pagado', 'pedido_proveedor', 'enviado', 'entregado', 'cancelado', 'reembolsado')),
  productos jsonb not null default '[]'::jsonb,   -- [{producto_id, slug, nombre, precio, cantidad, imagen}]
  subtotal numeric(10,2),
  envio numeric(10,2),
  total numeric(10,2),
  cliente_nombre text,
  cliente_email text,
  cliente_telefono text,
  direccion jsonb,
  stripe_session text unique,
  stripe_pago text,
  ref_proveedor text,
  transportista text,
  seguimiento text,
  notas text,
  creado timestamptz not null default now(),
  pagado timestamptz,
  actualizado timestamptz not null default now()
);

drop trigger if exists pedidos_actualizado on public.pedidos;
create trigger pedidos_actualizado before update on public.pedidos
  for each row execute function public.tocar_actualizado();

alter table public.pedidos enable row level security;
drop policy if exists "admin gestiona pedidos" on public.pedidos;
create policy "admin gestiona pedidos" on public.pedidos
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

-- Resta stock cuando un pedido se paga (solo la usa el servidor)
create or replace function public.descontar_stock(p_id uuid, n integer)
returns void language sql security definer set search_path = public as $$
  update public.productos set stock = greatest(stock - n, 0) where id = p_id;
$$;
revoke execute on function public.descontar_stock(uuid, integer) from public, anon, authenticated;

-- Ajustes (por si no se creó antes) y precio de envío visible en la tienda
create table if not exists public.ajustes (
  clave text primary key,
  valor jsonb not null default '{}'::jsonb
);
alter table public.ajustes enable row level security;
drop policy if exists "admin gestiona ajustes" on public.ajustes;
create policy "admin gestiona ajustes" on public.ajustes
  for all to authenticated using (public.es_admin()) with check (public.es_admin());
drop policy if exists "leer envio" on public.ajustes;
create policy "leer envio" on public.ajustes for select using (clave = 'envio');
