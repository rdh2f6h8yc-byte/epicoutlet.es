# EpicOutlet.es

Tienda online de EpicOutlet para España: liquidaciones de stock, sobrestock, devoluciones y productos reprecintados.

## Estructura

| Archivo | Qué es |
|---|---|
| `index.html` | La tienda: inicio, categorías, buscador, fichas, carrito y páginas legales. |
| `admin/index.html` | Panel privado (`/admin`) para añadir, editar y publicar productos. |
| `api/leer.js` | Lee un producto desde el enlace de un proveedor (solo administrador). |
| `api/imagen.js` | Descarga las fotos del proveedor para guardarlas en la tienda (solo administrador). |
| `api/checkout.js` | Crea el pago en Stripe con los precios y el stock de la base de datos. |
| `api/stripe-webhook.js` | Recibe el aviso de pago de Stripe, marca el pedido como pagado y resta stock. |
| `api/pedido.js` | Número de pedido para la página de «gracias». |
| `supabase/pedidos.sql` | Tabla de pedidos (si ya habías ejecutado `schema.sql` antes). |
| `config.js` | Dirección y clave pública de Supabase. |
| `supabase/schema.sql` | Tablas, seguridad y carpeta de fotos de Supabase. |

Si `config.js` está vacío, la tienda enseña productos de ejemplo.

## Puesta en marcha (una sola vez)

1. **Supabase:** crea un proyecto nuevo en supabase.com (región Europa).
2. **Base de datos:** en *SQL Editor → New query*, pega `supabase/schema.sql` y pulsa *Run* (ya incluye el correo de administrador almarainstalaciones@gmail.com).
3. **Usuario:** en *Authentication → Users → Add user*, crea el usuario almarainstalaciones@gmail.com y una contraseña (marca *Auto Confirm User*).
   Después, en *Authentication → Sign In / Providers*, desactiva *Allow new users to sign up*.
4. **Claves:** en *Project Settings → API Keys* copia la *Project URL* y la *Publishable key* y ponlas en `config.js`.
5. **Vercel:** importa este repositorio (preset *Other*). No hace falta ninguna variable de entorno.
6. **Atajo del iPhone:** entra en `/admin` → *Atajo iPhone* y sigue los pasos.

## Cómo añadir productos

- **Desde el iPhone:** en la página del producto del proveedor, en Safari, *Compartir → Añadir a EpicOutlet*.
- **Desde el panel:** *Importar* → pega el enlace de un producto o de una categoría entera. En las categorías eliges qué productos quieres y se importan todos de golpe (en tiendas Shopify, 250 por página).
- **A mano:** *Productos → + Nuevo*, con fotos de la galería o la cámara.

En el editor revisas el nombre, pones el precio de venta, el precio tachado (PVP), el estado y el stock, y marcas *Publicado*.
El coste, el proveedor y su enlace se guardan aparte y nunca se ven en la tienda.

## Pagos con Stripe (una sola vez)

1. **Supabase:** ejecuta `supabase/pedidos.sql` en *SQL Editor* (si instalaste antes de los pedidos).
2. **Stripe:** en *Developers → API keys* copia la *Secret key* (`sk_test_...` para probar, `sk_live_...` para vender).
3. **Webhook:** en *Developers → Webhooks → Add endpoint*, dirección `https://TU-DOMINIO/api/stripe-webhook`, eventos
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`.
   Copia su *Signing secret* (`whsec_...`).
4. **Supabase:** en *Project Settings → API Keys* copia la *Secret key* (`sb_secret_...`).
5. **Vercel → Settings → Environment Variables** (nunca en GitHub):
   `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SECRET_KEY`. Después, *Redeploy*.
6. **Panel → Ajustes → Gastos de envío:** pon el precio del envío y, si quieres, a partir de cuánto es gratis.

Cuando un cliente paga, el pedido aparece en *Panel → Pedidos* con el enlace para comprarlo al proveedor y la dirección del cliente lista para copiar.

## SEO

- Cada producto y colección tiene su dirección: `/producto/<slug>`, `/coleccion/<colección>`, `/info/<página>`.
- `api/pagina.js` devuelve esas páginas ya preparadas para Google: título, descripción, canonical, Open Graph,
  datos estructurados (Product con precio, estado, envío y devoluciones; BreadcrumbList; ItemList) y el contenido escrito.
- `/sitemap.xml` (`api/sitemap.js`) se genera solo con los productos publicados y sus fotos.
- `robots.txt` bloquea panel, API, carrito y cuenta. Las direcciones `*.vercel.app` llevan `noindex` para no duplicar.
- Al publicar o borrar productos desde el panel se avisa a Bing/Yandex con IndexNow (`api/indexnow.js`).
- Google: añade la propiedad en Search Console y envía `https://www.epicoutlet.es/sitemap.xml` una vez.
- Logo, favicon e iconos en `img/` y `favicon.ico`; `site.webmanifest` para guardar la tienda en el móvil.

## Pendiente

## Google Analytics y cookies

1. En https://analytics.google.com crea una propiedad GA4 para `https://www.epicoutlet.es` (flujo de datos web) y copia el **ID de medición** (`G-XXXXXXXXXX`).
2. Ponlo en `config.js` → `gaId: 'G-XXXXXXXXXX'` y sube el cambio.
3. Con `gaId` relleno aparece el aviso de cookies (Aceptar / Rechazar / Configurar). Analytics **solo se carga si el cliente acepta** (normativa de la AEPD). El cliente puede cambiar su elección en «Configurar cookies» del pie de página.
4. Se envían: vistas de página (también al navegar sin recargar), `add_to_cart`, `begin_checkout` y `purchase` (con el número y el total del pedido; los pedidos de prueba a 0 € no se cuentan).
5. En Analytics → Administrar → Retención de datos, pon 14 meses; y en Eventos clave marca `purchase`.

## Avisos de pedidos en el iPhone

Notificaciones push propias (Web Push con VAPID, sin servicios externos):
1. En el iPhone, abre /admin en Safari → Compartir → Añadir a pantalla de inicio, y ábrelo desde el icono «EpicOutlet».
2. Ajustes → «Avisos de pedidos nuevos» → Activar notificaciones → Enviar aviso de prueba.

Las claves VAPID se generan en el panel la primera vez y, junto con los dispositivos suscritos, se guardan en `ajustes` (clave `avisos`), que solo lee el administrador. El webhook de Stripe avisa de cada pedido pagado (`api/_avisos.js`); al tocar la notificación se abre el pedido. Service worker: `/sw-admin.js` (alcance `/admin`), manifiesto: `/admin.webmanifest`.

## Versión 2: facturas, correos, reembolsos, cupones, clientes y cuentas

Puesta en marcha (una vez):
1. **SQL**: ejecuta `supabase/v2-cuentas-facturas.sql` en Supabase → SQL Editor.
2. **Correos (Resend)**: añade el dominio `epicoutlet.es` en resend.com (registros DNS), crea una API key y ponla en Vercel como `RESEND_API_KEY` (Production). Opcional: `CORREO_REMITENTE` (por defecto `EpicOutlet.es <pedidos@epicoutlet.es>`).
3. **Cuentas de clientes (Supabase → Authentication)**: URL Configuration → Site URL `https://www.epicoutlet.es` y Redirect URLs `https://www.epicoutlet.es/**`; SMTP Settings con Resend (`smtp.resend.com`, puerto 465, usuario `resend`, contraseña = API key).
4. Panel → Ajustes → **Datos de facturación** (revisa el NIF).

Qué hace:
- Al pagarse un pedido: factura correlativa (serie EO), correo de confirmación con la factura en PDF, aviso al iPhone.
- Panel → pedido: reembolso total o parcial en Stripe, factura rectificativa (serie R), correo al cliente; al marcar «enviado», correo con el seguimiento.
- Panel → Resumen (ventas, beneficio real, pendientes, más vendidos), Clientes (con exportación CSV), Cupones (%, € o envío gratis; mínimo, caducidad y límite de usos), cambios en bloque en Productos.
- Revisión diaria: avisos de pedidos atascados e importación automática de novedades de las colecciones marcadas.
- Carritos abandonados: si el cliente acepta comunicaciones en Stripe, recibe un correo con el enlace para terminar la compra (una vez cada 7 días como máximo).
- Tienda → Mi cuenta: acceso con enlace al correo, pedidos con seguimiento, facturas en PDF, datos y borrado de cuenta.
- Funciones pequeñas agrupadas en `api/tienda.js` y `api/admin.js` (límite de funciones del plan gratuito de Vercel); las direcciones antiguas siguen funcionando por `vercel.json`.
