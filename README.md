# EpicOutlet.es

Tienda online de EpicOutlet para España: liquidaciones de stock, sobrestock, devoluciones y productos reprecintados.

## Estructura

| Archivo | Qué es |
|---|---|
| `index.html` | La tienda: inicio, categorías, buscador, fichas, carrito y páginas legales. |
| `admin/index.html` | Panel privado (`/admin`) para añadir, editar y publicar productos. |
| `api/leer.js` | Lee un producto desde el enlace de un proveedor (solo administrador). |
| `api/imagen.js` | Descarga las fotos del proveedor para guardarlas en la tienda (solo administrador). |
| `config.js` | Dirección y clave pública de Supabase. |
| `supabase/schema.sql` | Tablas, seguridad y carpeta de fotos de Supabase. |

Si `config.js` está vacío, la tienda enseña productos de ejemplo.

## Puesta en marcha (una sola vez)

1. **Supabase:** crea un proyecto nuevo en supabase.com (región Europa).
2. **Base de datos:** en *SQL Editor → New query*, pega `supabase/schema.sql`, cambia `TU_CORREO@ejemplo.com` por tu correo y pulsa *Run*.
3. **Usuario:** en *Authentication → Users → Add user*, crea tu usuario con ese correo y una contraseña (marca *Auto Confirm User*).
   Después, en *Authentication → Sign In / Providers*, desactiva *Allow new users to sign up*.
4. **Claves:** en *Project Settings → API Keys* copia la *Project URL* y la *Publishable key* y ponlas en `config.js`.
5. **Vercel:** importa este repositorio (preset *Other*). No hace falta ninguna variable de entorno.
6. **Atajo del iPhone:** entra en `/admin` → *Atajo iPhone* y sigue los pasos.

## Cómo añadir productos

- **Desde el iPhone:** en la página del producto del proveedor, en Safari, *Compartir → Añadir a EpicOutlet*.
- **Desde el panel:** *Importar* → pega el enlace del producto.
- **A mano:** *Productos → + Nuevo*, con fotos de la galería o la cámara.

En el editor revisas el nombre, pones el precio de venta, el precio tachado (PVP), el estado y el stock, y marcas *Publicado*.
El coste, el proveedor y su enlace se guardan aparte y nunca se ven en la tienda.

## Pendiente

- Conectar la pasarela de pago (botón «Finalizar compra») y poner su nombre en `[PASARELA DE PAGO]`.
- SEO: direcciones propias por producto, sitemap y datos estructurados.
