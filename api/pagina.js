// Páginas de la tienda preparadas para Google: /producto/…, /coleccion/…, /info/…
// Devuelve la tienda (index.html) con título, descripción, canonical, Open Graph,
// datos estructurados (JSON-LD) y el contenido principal ya escrito en el HTML.
const fs = require('fs');
const path = require('path');
const CFG = require('../config.js');

const SITIO = (CFG.sitioUrl || '').replace(/\/$/, '');
let PLANTILLA = null;
const plantilla = () => PLANTILLA || (PLANTILLA = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8'));

const COLECCIONES_BASE = { relojes: 'Relojes', hogar: 'Hogar', bebe: 'Bebé y juguetes', mascotas: 'Mascotas', deporte: 'Deporte', tecnologia: 'Tecnología', belleza: 'Belleza' };
const ESPECIALES = { todo: 'Todos los productos', novedades: 'Novedades', top: 'Top ventas', liquidaciones: 'Liquidaciones' };
const INFO = {
  historia: ['Nuestra historia', 'Dos hermanos y una idea sencilla: productos interesantes a precio de outlet, de liquidaciones, sobrestock y devoluciones.'],
  contacto: ['Contacto', 'Escríbenos sobre pedidos, productos, envíos o devoluciones. Te respondemos de lunes a viernes de 9:00 a 17:00.'],
  faq: ['Preguntas frecuentes', 'Respuestas sobre el estado de los productos, envíos en 1–3 días, devoluciones en 14 días y formas de pago.'],
  envios: ['Política de envíos', 'Enviamos a toda España con entrega en 1 a 3 días laborables. Consulta precios, seguimiento y qué hacer si el paquete llega dañado.'],
  devoluciones: ['Política de devoluciones', 'Tienes 14 días para devolver tu compra. Te explicamos cómo hacerlo, quién paga el envío y cómo es el reembolso.'],
  pagos: ['Métodos de pago', 'Paga con tarjeta Visa, Mastercard, American Express o Maestro, Apple Pay, Google Pay o Klarna a plazos, con pago seguro 3D Secure.'],
  'aviso-legal': ['Aviso legal', 'Datos del titular de EpicOutlet.es y condiciones de uso del sitio web.'],
  terminos: ['Términos y condiciones', 'Condiciones de compra en EpicOutlet.es: productos, precios, pedidos, pago, envío, devoluciones y garantía.'],
  privacidad: ['Política de privacidad', 'Cómo tratamos tus datos personales en EpicOutlet.es y cómo ejercer tus derechos.'],
  cookies: ['Política de cookies', 'Qué cookies usa EpicOutlet.es y cómo puedes gestionarlas.']
};
const CONDICION = { 'Nuevo': 'NewCondition', 'Liquidación': 'NewCondition', 'Caja abierta': 'UsedCondition', 'Reprecintado': 'RefurbishedCondition' };
const ESTADO_TXT = { 'Nuevo': 'Nuevo, precintado de fábrica', 'Caja abierta': 'Nuevo, embalaje abierto', 'Reprecintado': 'Revisado y reprecintado', 'Liquidación': 'Últimas unidades' };

const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = o => JSON.stringify(o).replace(/</g, '\\u003c');
const eur = n => Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const recorta = (t, n) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length <= n ? t : t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…'; };
const slug = t => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const claveCol = c => COLECCIONES_BASE[c] ? c : slug(c);
const nombreCol = c => COLECCIONES_BASE[c] || c;
const pct = p => p.precio_anterior && Number(p.precio_anterior) > Number(p.precio) ? Math.round((1 - p.precio / p.precio_anterior) * 100) : 0;

async function sb(ruta) {
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/${ruta}`, { headers: { apikey: CFG.supabaseKey } });
  if (!r.ok) throw new Error('Supabase ' + r.status);
  return r.json();
}
async function sbTodas(ruta) {
  const out = [];
  for (let off = 0; off < 100000; off += 1000) { const parte = await sb(`${ruta}&limit=1000&offset=${off}`); out.push(...(parte || [])); if (!parte || parte.length < 1000) break; }
  return out;
}
const CAMPOS = 'slug,nombre,categoria,estado,marca,precio,precio_anterior,stock,descripcion,caracteristicas,imagenes,top,creado,actualizado';

function montar({ titulo, descripcion, url, imagen, robots = 'index, follow, max-image-preview:large', ogType = 'website', jsonld = [], cuerpo = '', estado = 200 }) {
  const seo = `<title>${esc(titulo)}</title>
<meta name="description" content="${esc(descripcion)}">
<meta name="robots" content="${robots}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${esc(titulo)}">
<meta property="og:description" content="${esc(descripcion)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(imagen || SITIO + '/img/og-image.png')}">
<meta name="twitter:card" content="summary_large_image">
${jsonld.map(j => `<script type="application/ld+json">${json(j)}</script>`).join('\n')}`;
  let html = plantilla().replace(/<!--SEO-->[\s\S]*?<!--\/SEO-->/, seo);
  html = html.replace('<main id="app"></main>', `<main id="app">${cuerpo}</main>`);
  return { html, estado };
}

const migas = items => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: items.map(([n, u], i) => ({ '@type': 'ListItem', position: i + 1, name: n, item: u })) });

async function paginaProducto(clave) {
  const filas = await sb(`productos?slug=eq.${encodeURIComponent(clave)}&publicado=eq.true&select=${CAMPOS}`);
  const p = filas[0];
  if (!p || p.stock <= 0) return noEncontrado('Este producto ya no está disponible', 'Puede que se haya agotado. Echa un vistazo a las demás ofertas.');
  const url = `${SITIO}/producto/${encodeURIComponent(p.slug)}`;
  const col = claveCol(p.categoria), colNombre = nombreCol(p.categoria);
  const imgs = (p.imagenes || []).filter(u => /^https:\/\//.test(u));
  const precio = Number(p.precio), descuento = pct(p);
  const titulo = `${recorta(p.nombre, 62)} | EpicOutlet.es`;
  const descripcion = recorta(`${p.nombre} por ${eur(precio)}${descuento ? ` (−${descuento} %)` : ''}. ${ESTADO_TXT[p.estado] || p.estado}. Envío en 1–3 días y 14 días de devolución.`, 160);
  let envio = null;
  try { const a = await sb('ajustes?clave=eq.envio&select=valor'); const v = a[0] && a[0].valor; if (v && v.precio != null) envio = { precio: Number(v.precio), gratisDesde: v.gratisDesde != null && v.gratisDesde !== '' ? Number(v.gratisDesde) : null }; } catch (e) {}
  const oferta = {
    '@type': 'Offer', url, priceCurrency: 'EUR', price: precio.toFixed(2),
    availability: 'https://schema.org/InStock',
    itemCondition: 'https://schema.org/' + (CONDICION[p.estado] || 'NewCondition'),
    seller: { '@type': 'Organization', name: 'EpicOutlet', '@id': SITIO + '/#organizacion' },
    hasMerchantReturnPolicy: { '@type': 'MerchantReturnPolicy', applicableCountry: 'ES', returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
      merchantReturnDays: 14, returnMethod: 'https://schema.org/ReturnByMail', returnFees: 'https://schema.org/ReturnFeesCustomerResponsibility' }
  };
  if (envio) {
    const coste = envio.gratisDesde != null && precio >= envio.gratisDesde ? 0 : envio.precio;
    oferta.shippingDetails = { '@type': 'OfferShippingDetails',
      shippingRate: { '@type': 'MonetaryAmount', value: coste.toFixed(2), currency: 'EUR' },
      shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'ES' },
      deliveryTime: { '@type': 'ShippingDeliveryTime',
        handlingTime: { '@type': 'QuantitativeValue', minValue: 0, maxValue: 1, unitCode: 'DAY' },
        transitTime: { '@type': 'QuantitativeValue', minValue: 1, maxValue: 3, unitCode: 'DAY' } } };
  }
  const producto = { '@context': 'https://schema.org', '@type': 'Product', name: p.nombre, url, sku: p.slug,
    image: imgs.length ? imgs.slice(0, 8) : [SITIO + '/img/og-image.png'], description: recorta(p.descripcion || p.nombre, 5000),
    category: colNombre, offers: oferta };
  if (p.marca) producto.brand = { '@type': 'Brand', name: p.marca };
  const specs = Object.entries(p.caracteristicas || {});
  if (specs.length) producto.additionalProperty = specs.slice(0, 30).map(([k, v]) => ({ '@type': 'PropertyValue', name: k, value: String(v) }));
  const cuerpo = `<div class="wrap" style="padding:24px 16px 48px">
  <nav class="crumbs" aria-label="Ruta"><a href="/">Inicio</a> / <a href="/coleccion/${esc(col)}">${esc(colNombre)}</a> / <span>${esc(p.nombre)}</span></nav>
  <article>
    <h1>${esc(p.nombre)}</h1>
    ${imgs[0] ? `<img src="${esc(imgs[0])}" alt="${esc(p.nombre)}" width="600" height="600" style="max-width:100%;height:auto">` : ''}
    <p><strong>${eur(precio)}</strong>${descuento ? ` <s>${eur(p.precio_anterior)}</s> (−${descuento} %)` : ''} · IVA incluido</p>
    <p>Estado: ${esc(ESTADO_TXT[p.estado] || p.estado)}${p.marca ? ` · Marca: ${esc(p.marca)}` : ''}</p>
    ${(p.descripcion || '').split('\n').filter(Boolean).map(l => `<p>${esc(l)}</p>`).join('')}
    ${specs.length ? `<dl>${specs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
    <p>Envío a toda España en 1–3 días laborables. 14 días para devolverlo.</p>
  </article>
</div>`;
  return montar({ titulo, descripcion, url, imagen: imgs[0], ogType: 'product', cuerpo,
    jsonld: [producto, migas([['Inicio', SITIO + '/'], [colNombre, `${SITIO}/coleccion/${encodeURIComponent(col)}`], [p.nombre, url]])] });
}

async function paginaColeccion(clave) {
  const todos = await sbTodas(`productos?publicado=eq.true&stock=gt.0&select=slug,nombre,categoria,estado,precio,precio_anterior,imagenes,top,creado&order=creado.desc,id`);
  let lista, nombre;
  if (ESPECIALES[clave]) {
    nombre = ESPECIALES[clave];
    const mes = Date.now() - 30 * 864e5;
    lista = clave === 'novedades' ? todos.filter(p => new Date(p.creado).getTime() > mes)
      : clave === 'top' ? todos.filter(p => p.top)
      : clave === 'liquidaciones' ? todos.filter(p => p.estado === 'Liquidación') : todos;
  } else {
    lista = todos.filter(p => claveCol(p.categoria) === clave);
    nombre = lista[0] ? nombreCol(lista[0].categoria) : COLECCIONES_BASE[clave];
  }
  if (!nombre || (!lista.length && !ESPECIALES[clave])) return noEncontrado('Colección no encontrada', 'Esta colección no existe o todavía no tiene productos.');
  const url = `${SITIO}/coleccion/${encodeURIComponent(clave)}`;
  const max = Math.max(0, ...lista.map(pct));
  const titulo = clave === 'todo' ? 'Todos los productos de outlet | EpicOutlet.es' : `${nombre} a precio de outlet${max >= 10 ? ` (hasta −${max} %)` : ''} | EpicOutlet.es`;
  const descripcion = recorta(`${nombre} con descuentos de outlet: ${lista.length} producto${lista.length === 1 ? '' : 's'} de liquidaciones, sobrestock y reprecintados${max >= 10 ? `, hasta −${max} %` : ''}. Estado indicado en cada producto. Envío en 1–3 días.`, 160);
  const cuerpo = `<div class="wrap" style="padding:24px 16px 48px">
  <nav class="crumbs" aria-label="Ruta"><a href="/">Inicio</a> / <span>${esc(nombre)}</span></nav>
  <h1>${esc(nombre)}</h1>
  <p>${esc(descripcion)}</p>
  <ul>${lista.slice(0, 200).map(p => `<li><a href="/producto/${esc(p.slug)}">${esc(p.nombre)}</a> · ${eur(p.precio)}</li>`).join('')}</ul>
</div>`;
  return montar({ titulo, descripcion, url, imagen: lista[0] && (lista[0].imagenes || [])[0], cuerpo,
    jsonld: [
      { '@context': 'https://schema.org', '@type': 'CollectionPage', name: nombre, url, description: descripcion,
        mainEntity: { '@type': 'ItemList', numberOfItems: lista.length,
          itemListElement: lista.slice(0, 50).map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITIO}/producto/${encodeURIComponent(p.slug)}`, name: p.nombre })) } },
      migas([['Inicio', SITIO + '/'], [nombre, url]])
    ] });
}

function paginaInfo(clave) {
  const i = INFO[clave];
  if (!i) return noEncontrado('Página no encontrada', 'La página que buscas no existe.');
  const url = `${SITIO}/info/${clave}`;
  return montar({ titulo: `${i[0]} | EpicOutlet.es`, descripcion: i[1], url,
    robots: ['aviso-legal', 'privacidad', 'cookies', 'terminos'].includes(clave) ? 'noindex, follow' : 'index, follow',
    cuerpo: `<div class="wrap" style="padding:24px 16px 48px"><h1>${esc(i[0])}</h1><p>${esc(i[1])}</p></div>`,
    jsonld: [migas([['Inicio', SITIO + '/'], [i[0], url]])] });
}

function paginaPrivada(ruta) {
  const t = { carrito: 'Carrito', cuenta: 'Mi cuenta', gracias: '¡Gracias por tu compra!', buscar: 'Buscar' }[ruta] || 'EpicOutlet.es';
  return montar({ titulo: `${t} | EpicOutlet.es`, descripcion: 'EpicOutlet.es — outlet online.', url: `${SITIO}/${ruta}`, robots: 'noindex, follow' });
}

function noEncontrado(t, d) {
  return { ...montar({ titulo: `${t} | EpicOutlet.es`, descripcion: d, url: SITIO + '/', robots: 'noindex, follow' }), estado: 404 };
}

module.exports = async (req, res) => {
  const tipo = String(req.query.t || ''), clave = String(req.query.k || '').slice(0, 200);
  let r;
  try {
    if (tipo === 'producto') r = await paginaProducto(clave);
    else if (tipo === 'coleccion') r = await paginaColeccion(clave);
    else if (tipo === 'info') r = paginaInfo(clave);
    else r = paginaPrivada(tipo);
  } catch (e) {
    console.error('pagina', e);
    r = { html: plantilla(), estado: 200 }; // si falla la base de datos, la tienda se carga igual
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', r.estado === 200 ? 'public, s-maxage=300, stale-while-revalidate=86400' : 'public, s-maxage=60');
  res.status(r.estado).send(r.html);
};
