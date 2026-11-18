-- =====================================================================
-- EpicOutlet.es · pedidos y pagos
-- Pega este archivo en Supabase → SQL Editor → New query → Run.
-- (Necesita que antes se haya ejecutado schema.sql)
-- =====================================================================

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
