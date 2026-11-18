# EpicOutlet.es

Tienda online de EpicOutlet para España: liquidaciones de stock, sobrestock, devoluciones y productos reprecintados.

## Estructura

- `index.html`: toda la web en un solo archivo (HTML, CSS y JavaScript, sin dependencias).
  - Inicio, categorías con filtros, buscador, fichas de producto y carrito (guardado en el navegador).
  - Páginas de información y legales: historia, contacto, preguntas frecuentes, envíos, devoluciones, métodos de pago, aviso legal, términos, privacidad y cookies.

## Dónde se cambia cada cosa (dentro de `index.html`)

- **Productos:** lista `PRODUCTS` (nombre, categoría, estado, precio, precio anterior, stock, descripción y características).
- **Categorías:** objeto `CATS`.
- **Datos de la empresa:** objeto `EMPRESA` (titular, NIF, dirección, correo, horario, Facebook).
- **Textos de las páginas legales e informativas:** objeto `PAGES`.

## Pendiente

- Conectar la pasarela de pago (botón «Finalizar compra») y poner su nombre en `[PASARELA DE PAGO]`.
- Fotos y productos reales.

## Publicación

Sitio estático: Vercel lo publica tal cual, sin build. Framework preset: **Other**.
