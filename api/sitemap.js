// /sitemap.xml → se genera solo con los productos y colecciones publicados
const CFG = require('../config.js');
const SITIO = (CFG.sitioUrl || '').replace(/\/$/, '');
const BASE = ['relojes', 'hogar', 'bebe', 'mascotas', 'deporte', 'tecnologia', 'belleza'];
const slug = t => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const xml = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const dia = d => (d ? new Date(d) : new Date()).toISOString().slice(0, 10);

async function publicas(ruta) {   // todas las filas, de 1000 en 1000 (límite de Supabase)
  const out = [];
  for (let off = 0; off < 100000; off += 1000) {
    const r = await fetch(`${CFG.supabaseUrl}/rest/v1/${ruta}&limit=1000&offset=${off}`, { headers: { apikey: CFG.supabaseKey } });
    if (!r.ok) break;
    const parte = await r.json(); out.push(...parte); if (parte.length < 1000) break;
  }
  return out;
}

module.exports = async (req, res) => {
  let prods = [];
  try {
    prods = await publicas('productos?publicado=eq.true&stock=gt.0&select=slug,nombre,categoria,imagenes,estado,actualizado,top&order=actualizado.desc,id');
  } catch (e) {}
  const ultima = prods[0] ? dia(prods[0].actualizado) : dia();
  const urls = [];
  const add = (loc, lastmod, prioridad, frec, imgs = [], titulo = '') => urls.push(
    `<url><loc>${xml(loc)}</loc><lastmod>${lastmod}</lastmod><changefreq>${frec}</changefreq><priority>${prioridad}</priority>` +
    imgs.slice(0, 5).map(i => `<image:image><image:loc>${xml(i)}</image:loc>${titulo ? `<image:title>${xml(titulo)}</image:title>` : ''}</image:image>`).join('') + '</url>');

  add(SITIO + '/', ultima, '1.0', 'daily');
  // Colecciones con productos
  const cols = new Map();
  for (const p of prods) { const k = BASE.includes(p.categoria) ? p.categoria : slug(p.categoria || ''); if (k && !cols.has(k)) cols.set(k, dia(p.actualizado)); }
  for (const [k, d] of cols) add(`${SITIO}/coleccion/${encodeURIComponent(k)}`, d, '0.8', 'daily');
  add(`${SITIO}/coleccion/todo`, ultima, '0.7', 'daily');
  add(`${SITIO}/coleccion/novedades`, ultima, '0.7', 'daily');
  if (prods.some(p => p.top)) add(`${SITIO}/coleccion/top`, ultima, '0.7', 'daily');
  if (prods.some(p => p.estado === 'Liquidación')) add(`${SITIO}/coleccion/liquidaciones`, ultima, '0.7', 'daily');
  // Productos
  for (const p of prods) add(`${SITIO}/producto/${encodeURIComponent(p.slug)}`, dia(p.actualizado), '0.9', 'weekly', (p.imagenes || []).filter(u => /^https:\/\//.test(u)), p.nombre);
  // Información
  for (const k of ['historia', 'faq', 'envios', 'devoluciones', 'pagos', 'contacto']) add(`${SITIO}/info/${k}`, '2026-11-18', '0.3', 'monthly');

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=86400');
  res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.join('\n')}
</urlset>`);
};
