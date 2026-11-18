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

/* Arregla letras rotas que vienen mal de algunos proveedores (ratĂłn → ratón, Ã© → é) */
const ROTAS = [['Ăˇ','á'],['Ă©','é'],['Ă­','í'],['Ăł','ó'],['Ăş','ú'],['Ăą','ñ'],['ĂĽ','ü'],['Ă‰','É'],['Ă“','Ó'],['Ă‘','Ñ'],['ĂŤ','Í'],['Ăš','Ú'],['Ă€','À'],
  ['Âż','¿'],['Âˇ','¡'],['Âş','º'],['ÂŞ','ª'],['Â°','°'],['â‚¬','€'],['â€“','–'],['â€”','—'],['â€ś','“'],['â€ť','”'],['â€™','’'],['â€˘','•'],
  ['Ã¡','á'],['Ã©','é'],['Ã­','í'],['Ã³','ó'],['Ãº','ú'],['Ã±','ñ'],['Ã¼','ü'],['Ã‰','É'],['Ã“','Ó'],['Ã‘','Ñ'],['Ãš','Ú'],['Â¿','¿'],['Â¡','¡'],['Âº','º'],['Âª','ª'],['â‚¬','€'],['â€¢','•'],['â€œ','“'],['â€','”']];
const arreglar = t => { t = String(t == null ? '' : t); if (!/[ĂÃÂâ]/.test(t)) return t; for (const [a, b] of ROTAS) t = t.split(a).join(b); return t; };
const limpio = t => arreglar(t)
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
  return { url, nombre: '', precio: null, pvp: null, moneda: '', imagenes: [], descripcion: '', marca: '', sku: '', caracteristicas: {}, estado: '', disponible: true };
}

// Dirección de la tienda Shopify que hay detrás (también en webs Shopify hechas a medida)
function shopifyBase(html, url) {
  const m = html.match(/([a-z0-9][a-z0-9-]*)\.myshopify\.com/i);
  if (m) return 'https://' + m[1].toLowerCase() + '.myshopify.com';
  if (/cdn\.shopify\.com\/s\/files|Shopify\.theme|shopify-section/i.test(html)) { try { return new URL(url).origin; } catch (e) {} }
  return null;
}

// Estado del producto según etiquetas, nombre o datos estructurados
function estadoDe(...textos) {
  const t = textos.flat().filter(Boolean).join(' ').toLowerCase();
  if (/reacondicionad|refurbish|renovad|reprecintad|resigilad|refurbishedcondition/.test(t)) return 'Reprecintado';
  if (/embalaje[- ]?deteriorad|caja[- ]?abierta|open[- ]?box|deteriorad|usedcondition|damagedcondition|como[- ]nuevo|segunda[- ]mano|sin[- ]caja/.test(t)) return 'Caja abierta';
  if (/liquidaci|fin[- ]de[- ]serie/.test(t)) return 'Liquidación';
  return 'Nuevo';
}

// Producto en formato Shopify (products.json o /products/xxx.js) → formato EpicOutlet
function desdeShopify(p, origen) {
  const vs = p.variants || [];
  const v = vs.find(x => x.available) || vs[0] || {};
  const precio = typeof p.price === 'number' ? p.price / 100 : num(v.price);
  const pvp = typeof p.compare_at_price === 'number' ? p.compare_at_price / 100 : num(v.compare_at_price);
  const d = nuevoDato(origen + '/products/' + p.handle);
  d.nombre = limpio(p.title);
  d.precio = precio;
  d.pvp = pvp && precio && pvp > precio ? pvp : null;
  d.marca = limpio(p.vendor);
  d.sku = limpio(v.sku || '');
  d.descripcion = limpio(p.body_html != null ? p.body_html : p.description).slice(0, 4000);
  (p.images || []).forEach(i => addImg(d, typeof i === 'string' ? i : i && i.src, origen));
  d.estado = estadoDe(p.tags, p.title);
  d.disponible = vs.length ? vs.some(x => x.available) : p.available !== false;
  return d;
}

// Lista de productos de una página de categoría (datos estructurados ItemList)
function listaDesdeHTML(html, url) {
  const productos = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let j; try { j = JSON.parse(m[1].trim()); } catch (e) { continue; }
    const listas = [].concat(j, j && j['@graph'] || []).filter(x => x && [].concat(x['@type'] || []).includes('ItemList'));
    for (const l of listas) for (const li of [].concat(l.itemListElement || [])) {
      const it = (li && li.item) || li || {};
      const prodUrl = it.url || it['@id'] || li.url;
      if (!it.name && !prodUrl) continue;
      const d = nuevoDato('');
      try { d.url = new URL(prodUrl, url).href; } catch (e) { continue; }
      d.nombre = limpio(it.name);
      [].concat(it.image || []).forEach(i => addImg(d, i, url));
      d.marca = limpio(it.brand && typeof it.brand === 'object' ? it.brand.name : it.brand);
      const of = [].concat(it.offers || [])[0] || {};
      d.precio = num(of.price != null ? of.price : of.lowPrice);
      d.moneda = of.priceCurrency || '';
      d.estado = estadoDe(of.itemCondition, it.itemCondition, it.name);
      d.disponible = !/OutOfStock|SoldOut|Discontinued/i.test(String(of.availability || ''));
      if (!productos.some(x => x.url === d.url)) productos.push(d);
    }
  }
  // Enlace a la página siguiente
  let siguiente = null;
  const dec = h => h.replace(/&amp;/g, '&');
  const rel = html.match(/<(?:link|a)[^>]+rel=["']next["'][^>]*>/i);
  const href = rel && rel[0].match(/href=["']([^"']+)["']/i);
  const dir = html.match(/href=["']([^"']*direction=next[^"']*)["']/i);
  const cand = href ? href[1] : dir ? dir[1] : null;
  if (cand) { try { siguiente = new URL(dec(cand), url).href; } catch (e) {} }
  return { productos, siguiente };
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
  d._cond = [of.itemCondition, p.itemCondition].filter(Boolean).join(' ');
  if (of.availability && /OutOfStock|SoldOut/i.test(String(of.availability))) d.disponible = false;
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

  // Tiendas Shopify: ficha completa (todas las fotos, PVP, estado) en /products/xxx.js
  try {
    const u = new URL(url);
    const h = u.pathname.match(/\/products\/([^/?#]+)/);
    const sb = h && shopifyBase(html, url);
    if (sb) {
      const r = await fetch(sb + '/products/' + h[1] + '.js', { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (r.ok) { const s = desdeShopify(await r.json(), u.origin); if (s.nombre) return s; }
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
  d.estado = d.estado || estadoDe(d._cond, d.nombre);
  delete d._cond;
  if (d.imagenes.length < 2) meta('og:image').forEach(i => addImg(d, i, base));
  d.descripcion = d.descripcion.slice(0, 4000);
  return d;
}

module.exports = { CFG, UA, esAdmin, urlSegura, extraerHTML, listaDesdeHTML, shopifyBase, desdeShopify, estadoDe, num, limpio, buscarProducto };
