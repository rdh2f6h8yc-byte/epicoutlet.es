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

-- Correo de acceso al panel
insert into public.admins (email) values ('almarainstalaciones@gmail.com')
on conflict do nothing;
