// Utilidades compartidas por las funciones /api (Vercel no las publica como ruta).
const CFG = require('../config.js');

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// Solo el administrador de la tienda puede usar estas funciones
async function esAdmin(req) {
  const auth = req.headers.authorization || '';
  if (!CFG.supabaseUrl || !CFG.supabaseKey || !auth.startsWith('Bearer ')) return false;
  try {
    const r = await fetch(CFG.supabaseUrl + '/rest/v1/rpc/es_admin', {
      method: 'POST',
      headers: { apikey: CFG.supabaseKey, Authorization: auth, 'Content-Type': 'application/json' },
      body: '{}'
    });
    return r.ok && (await r.json()) === true;
  } catch (e) { return false; }
}

// Evita que se usen direcciones internas
function urlSegura(u) {
  try {
    const x = new URL(String(u || '').trim());
    if (!/^https?:$/.test(x.protocol)) return null;
    const h = x.hostname.toLowerCase();
    if (/^(localhost|0\.|127\.|10\.|192\.168\.|169\.254\.|\[)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
        h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.')) return null;
    return x;
  } catch (e) { return null; }
}

const limpio = t => String(t == null ? '' : t)
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'")
  .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&euro;/gi, '€')
  .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

// "1.234,56 €" · "1,234.56" · "12.90" → número
function num(s) {
  if (typeof s === 'number') return s;
  s = String(s || '').replace(/[^\d.,]/g, '');
  if (!s) return null;
  const c = s.lastIndexOf(','), p = s.lastIndexOf('.');
  if (c > -1 && p > -1) s = c > p ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (c > -1) s = /,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if ((s.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(s)) s = s.replace(/\./g, '');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// Busca el producto dentro de los datos estructurados (JSON-LD)
function buscarProducto(o) {
  if (!o || typeof o !== 'object') return null;
  if (Array.isArray(o)) { for (const x of o) { const r = buscarProducto(x); if (r) return r; } return null; }
  const t = [].concat(o['@type'] || []);
  if (t.includes('Product')) return o;
  if (t.includes('ProductGroup')) {
    const v = buscarProducto(o.hasVariant) || {};
    return Object.assign({}, v, { name: o.name || v.name, description: o.description || v.description, image: o.image || v.image, brand: o.brand || v.brand });
  }
  return buscarProducto(o['@graph'] || null);
}

function nuevoDato(url) {
  return { url, nombre: '', precio: null, moneda: '', imagenes: [], descripcion: '', marca: '', sku: '', caracteristicas: {} };
}

function addImg(d, u, base) {
  if (u && typeof u === 'object') u = u.url || u.contentUrl || u.src || '';
  u = String(u || '').trim();
  if (!u || u.startsWith('data:')) return;
  try { u = new URL(u.startsWith('//') ? 'https:' + u : u, base).href; } catch (e) { return; }
  if (!d.imagenes.includes(u) && d.imagenes.length < 12) d.imagenes.push(u);
}

function aplicarLD(d, p, base) {
  d.nombre = d.nombre || limpio(p.name);
  d.descripcion = d.descripcion || limpio(p.description);
  d.marca = d.marca || limpio(p.brand && typeof p.brand === 'object' ? p.brand.name : p.brand);
  d.sku = d.sku || limpio(p.sku || p.gtin13 || p.gtin || p.mpn || '');
  [].concat(p.image || []).forEach(i => addImg(d, i, base));
  const of = [].concat(p.offers || [])[0] || {};
  const pr = of.price != null ? of.price : of.lowPrice != null ? of.lowPrice : ([].concat(of.offers || [])[0] || {}).price;
  if (d.precio == null && pr != null) d.precio = num(pr);
  d.moneda = d.moneda || of.priceCurrency || '';
  [].concat(p.additionalProperty || []).forEach(a => {
    if (a && a.name && a.value != null) d.caracteristicas[limpio(a.name)] = limpio(a.value);
  });
}

// Lee un producto a partir del HTML de su página
async function extraerHTML(html, url) {
  const d = nuevoDato(url);
  const base = url;
  const meta = n => {
    const re = new RegExp('<meta[^>]+(?:property|name|itemprop)=["\']' + n.replace(/[:.]/g, '\\$&') + '["\'][^>]*>', 'gi');
    return [...html.matchAll(re)].map(m => { const c = m[0].match(/content=["']([^"']*)["']/i); return c ? limpio(c[1]) : ''; }).filter(Boolean);
  };

  // Tiendas Shopify: ficha completa en /products/xxx.js
  try {
    const u = new URL(url);
    if (/\/products\//.test(u.pathname) && /cdn\.shopify\.com|Shopify\.theme|shopify-section/i.test(html)) {
      const r = await fetch(u.origin + u.pathname.replace(/\/$/, '') + '.js', { headers: { 'User-Agent': UA } });
      if (r.ok) {
        const j = await r.json();
        d.nombre = limpio(j.title); d.descripcion = limpio(j.description); d.marca = limpio(j.vendor);
        d.precio = typeof j.price === 'number' ? j.price / 100 : null;
        (j.images || []).forEach(i => addImg(d, i, base));
      }
    }
  } catch (e) { /* seguimos con el resto */ }

  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let j; try { j = JSON.parse(m[1].trim()); } catch (e) { continue; }
    const p = buscarProducto(j);
    if (p) { aplicarLD(d, p, base); break; }
  }

  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1];
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  d.nombre = d.nombre || meta('og:title')[0] || limpio(h1) || limpio(title);
  d.descripcion = d.descripcion || meta('og:description')[0] || meta('description')[0] || '';
  if (d.precio == null) {
    const m = meta('product:price:amount')[0] || meta('og:price:amount')[0] || meta('price')[0];
    if (m) d.precio = num(m);
  }
  if (d.precio == null) {
    const m = html.match(/itemprop=["']price["'][^>]*content=["']([^"']+)["']/i) || html.match(/content=["']([^"']+)["'][^>]*itemprop=["']price["']/i);
    if (m) d.precio = num(m[1]);
  }
  if (d.precio == null) {
    const m = html.replace(/<[^>]*>/g, ' ').match(/(\d[\d.\s]{0,9}[,.]\d{2})\s*€|€\s*(\d[\d.\s]{0,9}[,.]\d{2})/);
    if (m) d.precio = num(m[1] || m[2]);
  }
  d.moneda = d.moneda || meta('product:price:currency')[0] || meta('og:price:currency')[0] || '';
  if (d.imagenes.length < 2) meta('og:image').forEach(i => addImg(d, i, base));
  d.descripcion = d.descripcion.slice(0, 4000);
  return d;
}

module.exports = { CFG, UA, esAdmin, urlSegura, extraerHTML, num, limpio, buscarProducto };
