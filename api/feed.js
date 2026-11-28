// /feed.xml → archivo de productos para Google Merchant Center (se genera solo, siempre al día).
// En Merchant Center: Productos → Fuentes de datos → Añadir → «Obtención programada» con esta URL.
const CFG = require('../config.js');
const SITIO = (CFG.sitioUrl || '').replace(/\/$/, '');
const xml = t => String(t == null ? '' : t).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const precio = n => Number(n).toFixed(2) + ' EUR';
// Estados de la tienda → condición de Google
const CONDICION = { 'Nuevo': 'new', 'Liquidación': 'new', 'Caja abierta': 'used', 'Reprecintado': 'refurbished' };
const CATS = { relojes: 'Relojes', hogar: 'Hogar', bebe: 'Bebé y juguetes', mascotas: 'Mascotas', deporte: 'Deporte', tecnologia: 'Tecnología', belleza: 'Belleza' };
const NOTA = { 'Caja abierta': 'Producto con caja abierta o embalaje deteriorado, revisado y en perfecto funcionamiento.', 'Reprecintado': 'Producto reprecintado, revisado y en perfecto funcionamiento.' };

function gtinDe(c) {
  if (!c || typeof c !== 'object') return '';
  for (const [k, v] of Object.entries(c)) if (/ean|gtin|upc|c[oó]digo de barras/i.test(k)) { const d = String(v).replace(/\D/g, ''); if ([8, 12, 13, 14].includes(d.length)) return d; }
  return '';
}

module.exports = async (req, res) => {
  const h = { apikey: CFG.supabaseKey };
  let prods = [], envio = null;
  try {
    const [r, a] = await Promise.all([
      fetch(`${CFG.supabaseUrl}/rest/v1/productos?publicado=eq.true&stock=gt.0&select=id,slug,nombre,categoria,estado,marca,precio,precio_anterior,stock,descripcion,caracteristicas,imagenes&order=actualizado.desc&limit=10000`, { headers: h }),
      fetch(`${CFG.supabaseUrl}/rest/v1/ajustes?clave=eq.envio&select=valor`, { headers: h })
    ]);
    if (r.ok) prods = await r.json();
    if (a.ok) { const v = ((await a.json())[0] || {}).valor; if (v && v.precio != null) envio = { precio: Number(v.precio), gratis: v.gratisDesde != null && v.gratisDesde !== '' ? Number(v.gratisDesde) : null }; }
  } catch (e) {}

  const items = prods.filter(p => p.slug && Number(p.precio) > 0 && (p.imagenes || []).some(u => /^https:\/\//.test(u))).map(p => {
    const imgs = (p.imagenes || []).filter(u => /^https:\/\//.test(u));
    // Solo el precio real: Google exige que un precio tachado sea uno que tú hayas cobrado antes
    const actual = Number(p.precio);
    const desc = [NOTA[p.estado], String(p.descripcion || '').replace(/\s+\n/g, '\n')].filter(Boolean).join('\n\n').slice(0, 4900) || p.nombre;
    const gtin = gtinDe(p.caracteristicas);
    const coste = envio ? (envio.gratis != null && actual >= envio.gratis ? 0 : envio.precio) : null;
    return `<item>
<g:id>${xml(p.id)}</g:id>
<g:title>${xml(String(p.nombre).slice(0, 150))}</g:title>
<g:description>${xml(desc)}</g:description>
<g:link>${xml(`${SITIO}/producto/${encodeURIComponent(p.slug)}`)}</g:link>
<g:image_link>${xml(imgs[0])}</g:image_link>
${imgs.slice(1, 11).map(u => `<g:additional_image_link>${xml(u)}</g:additional_image_link>`).join('\n')}
<g:availability>in_stock</g:availability>
<g:price>${precio(actual)}</g:price>
<g:condition>${CONDICION[p.estado] || 'new'}</g:condition>
${p.marca ? `<g:brand>${xml(p.marca)}</g:brand>` : ''}
${gtin ? `<g:gtin>${gtin}</g:gtin>` : '<g:identifier_exists>no</g:identifier_exists>'}
<g:product_type>${xml(CATS[p.categoria] || p.categoria || 'Outlet')}</g:product_type>
${coste != null ? `<g:shipping><g:country>ES</g:country><g:service>Estándar 1-3 días</g:service><g:price>${precio(coste)}</g:price></g:shipping>` : ''}
</item>`.replace(/\n\n+/g, '\n');
  });

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=86400');
  res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
<title>EpicOutlet.es</title>
<link>${SITIO}/</link>
<description>Productos de EpicOutlet.es: liquidaciones, sobrestock y reprecintados</description>
${items.join('\n')}
</channel>
</rss>`);
};
