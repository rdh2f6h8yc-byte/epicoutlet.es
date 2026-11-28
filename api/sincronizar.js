// /api/sincronizar — comprueba cada día stock y precio de los productos en su proveedor.
// · Si el proveedor lo tiene agotado → stock 0 (desaparece de la tienda) y se recuerda su stock anterior.
// · Si vuelve a haber → se recupera el stock anterior.
// · Si el proveedor cambia el precio → se actualiza el coste y se avisa; si ya vende igual o más caro que tú, se oculta.
// Lo lanza el cron de Vercel (vercel.json) cada mañana, o el administrador con «Comprobar ahora».
// Trabaja por tandas: si no le da tiempo, se vuelve a llamar a sí mismo para seguir.
const crypto = require('crypto');
const { db, claveSupabase } = require('./_srv.js');
const { UA, esAdmin, extraerHTML, shopifyBase, desdeShopify, estadoDe } = require('./_util.js');
const { avisar } = require('./_avisos.js');

const PRESUPUESTO_MS = 40000, PARALELO = 3;
const espera = ms => new Promise(r => setTimeout(r, ms));
const claveInterna = () => crypto.createHmac('sha256', String(claveSupabase() || 'x')).update('eo-sync').digest('hex');

async function permitido(req) {
  if (req.headers['x-sync-clave'] && req.headers['x-sync-clave'] === claveInterna()) return 'interno';
  const cs = process.env.CRON_SECRET;
  if (cs && req.headers.authorization === 'Bearer ' + cs) return 'cron';
  if (!cs && /vercel-cron/i.test(req.headers['user-agent'] || '')) return 'cron';
  if (await esAdmin(req)) return 'admin';
  return null;
}

async function conTiempo(url, opt = {}, ms = 12000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opt, signal: ctl.signal, redirect: 'follow' }); } finally { clearTimeout(t); }
}

const basesShopify = {};
function baseDe(origen) {
  // se guarda la promesa para que las peticiones en paralelo esperen a la misma respuesta
  if (!basesShopify[origen]) basesShopify[origen] = (async () => {
    for (let intento = 0; intento < 2; intento++) {
      try { const r = await conTiempo(origen + '/', { headers: { 'User-Agent': UA } }); if (r.ok) return shopifyBase(await r.text(), origen + '/'); } catch (e) {}
      await espera(1500);
    }
    return null;
  })();
  return basesShopify[origen];
}

// Lee disponibilidad y precio del proveedor. Devuelve { disponible, precio }, o null si no se ha podido saber
// (bloqueo, demasiadas peticiones, error del servidor…): en ese caso no se toca nada.
async function pedirJS(url) {
  for (let intento = 0; intento < 3; intento++) {
    const r = await conTiempo(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (r.status === 429 || r.status >= 500) { await espera(1500 * (intento + 1)); continue; }
    return r;
  }
  return null;
}
async function leerProveedor(url) {
  const u = new URL(url);
  const handle = (u.pathname.match(/\/products\/([^/?#]+)/) || [])[1];
  if (handle) {
    const sb = await baseDe(u.origin);
    if (sb) {
      // Tienda Shopify (aunque la web sea a medida): su respuesta es la fiable
      const r = await pedirJS(`${sb}/products/${handle}.js`);
      if (!r) return null;
      if (r.status === 404) return { disponible: false, precio: null, retirado: true };
      if (!r.ok) return null;
      const txt = await r.text();
      if (!/^\s*\{/.test(txt)) return null;               // página de bloqueo o de verificación, no datos
      const d = desdeShopify(JSON.parse(txt), u.origin);
      return { disponible: d.disponible, precio: d.precio };
    }
  }
  const r = await conTiempo(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  if (!r.ok) return null;                                  // un 404 de una web desconocida no basta para darlo por retirado
  const d = await extraerHTML((await r.text()).slice(0, 3000000), r.url || url);
  if (!d.nombre) return null;
  return { disponible: d.disponible !== false, precio: d.precio };
}

/* ---------- Pedidos atascados: aviso al iPhone ---------- */
async function revisarAtascados() {
  try {
    const h24 = new Date(Date.now() - 24 * 3600e3).toISOString(), d4 = new Date(Date.now() - 4 * 864e5).toISOString();
    const sinPedir = await db(`pedidos?estado=eq.pagado&pagado=lt.${h24}&select=numero`);
    const sinSeg = await db(`pedidos?estado=eq.pedido_proveedor&seguimiento=is.null&actualizado=lt.${d4}&select=numero`);
    const partes = [];
    if (sinPedir.length) partes.push(`${sinPedir.map(p => '#' + p.numero).join(', ')} sin pedir al proveedor desde hace más de 24 h`);
    if (sinSeg.length) partes.push(`${sinSeg.map(p => '#' + p.numero).join(', ')} sin número de seguimiento desde hace más de 4 días`);
    if (partes.length) await avisar({ titulo: '⚠️ Pedidos atascados', cuerpo: partes.join(' · '), url: '/admin', etiqueta: 'atascados' }, true);
  } catch (e) {}
}

/* ---------- Importación automática de novedades ---------- */
function precioCon(aj, coste, cat) {
  const c = Number(coste); if (!(c > 0)) return null;
  const iva = Number(aj.iva) || 21;
  const margen = aj.cat && aj.cat[cat] != null && aj.cat[cat] !== '' ? Number(aj.cat[cat]) : Number(aj.margen != null ? aj.margen : 40);
  const x = (aj.costeConIva ? c / (1 + iva / 100) : c) * (1 + margen / 100) * (1 + iva / 100);
  if (aj.redondeo === 'no') return Math.round(x * 100) / 100;
  const fin = aj.redondeo === '99' ? 0.01 : 0.10;
  let r = Math.ceil(x) - fin; if (r < x - 1e-9) r += 1;
  return Math.round(r * 100) / 100;
}
const slugify = t => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'producto';
async function importarNovedades(inicio) {
  const fila = await db('ajustes?clave=in.(autoimport,precios)&select=clave,valor');
  const auto = ((fila.find(x => x.clave === 'autoimport') || {}).valor || {}).lista || [];
  const aj = (fila.find(x => x.clave === 'precios') || {}).valor || {};
  if (!auto.length) return { nuevos: 0 };
  const ya = new Set((await db('productos_privado?origen_url=not.is.null&select=origen_url&limit=50000')).map(x => x.origen_url));
  let total = 0; const nombres = [];
  for (const a of auto) {
    let nuevos = 0;
    try {
      const u = new URL(a.url);
      const r = await conTiempo(a.url, { headers: { 'User-Agent': UA } });
      if (!r.ok) continue;
      const sb = shopifyBase(await r.text(), a.url); if (!sb) continue;
      const col = u.pathname.match(/\/collections\/([^/?#]+)/);
      for (let pag = 1; pag <= 8 && Date.now() - inicio < PRESUPUESTO_MS && nuevos < 60; pag++) {
        const rj = await pedirJS(`${col ? `${sb}/collections/${col[1]}` : sb}/products.json?limit=250&page=${pag}`);
        if (!rj || !rj.ok) break;
        const prods = ((await rj.json()).products || []);
        for (const sp of prods) {
          if (nuevos >= 60 || Date.now() - inicio > PRESUPUESTO_MS) break;
          const d = desdeShopify(sp, u.origin);
          if (ya.has(d.url) || !d.disponible || !d.precio) continue;
          const precio = precioCon(aj, d.precio, a.coleccion); if (!precio) continue;
          const fotos = (d.imagenes || []).slice(0, a.fotos || 4);
          const estado = a.estado && a.estado !== 'auto' ? a.estado : (estadoDe(sp.tags, sp.title) || 'Nuevo');
          const filaP = { slug: `${slugify(d.nombre)}-${Math.random().toString(36).slice(2, 6)}`, nombre: String(d.nombre).slice(0, 250), categoria: a.coleccion, estado, marca: d.marca || null, precio,
            precio_anterior: aj.usarPvp !== false && d.pvp && d.pvp > precio ? d.pvp : null, stock: a.stock || 1, descripcion: d.descripcion || '', caracteristicas: d.caracteristicas || {},
            imagenes: fotos, top: false, publicado: !!a.publicar && fotos.length > 0 };
          try {
            const [nuevo] = await db('productos', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(filaP) });
            await db('productos_privado', { method: 'POST', body: JSON.stringify({ producto_id: nuevo.id, coste: d.precio, proveedor: u.hostname, origen_url: d.url, notas: d.sku ? `Ref. proveedor: ${d.sku}` : 'Importado automáticamente' }) });
            ya.add(d.url); nuevos++; if (nombres.length < 5) nombres.push(filaP.nombre.slice(0, 50));
          } catch (e) { console.error('autoimport', e.message); }
        }
        if (prods.length < 250) break;
      }
    } catch (e) { console.error('autoimport', e.message); }
    a.ultima = new Date().toISOString(); a.nuevos = nuevos; total += nuevos;
  }
  await db('ajustes?clave=eq.autoimport', { method: 'PATCH', body: JSON.stringify({ valor: { lista: auto } }) }).catch(() => {});
  if (total) await avisar({ titulo: `🆕 ${total} producto${total > 1 ? 's' : ''} nuevo${total > 1 ? 's' : ''} importado${total > 1 ? 's' : ''}`, cuerpo: nombres.join(' · ') + (total > nombres.length ? '…' : ''), url: '/admin', etiqueta: 'autoimport' }).catch(() => {});
  return { nuevos: total };
}

const eur = n => Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const quien = await permitido(req);
  if (!quien) return res.status(401).json({ error: 'No autorizado' });
  const inicio = Date.now();
  const continuar = quien === 'interno';
  if (continuar && req.query && req.query.fase === 'importar') {
    const r = await importarNovedades(inicio).catch(e => ({ error: e.message }));
    return res.status(200).json({ ok: true, importacion: r });
  }
  if (!continuar) await revisarAtascados();

  const fila = await db('ajustes?clave=eq.sync&select=valor').catch(() => []);
  let S = (fila && fila[0] && fila[0].valor) || {};
  S.ocultados = S.ocultados || {};
  if (!continuar) {
    if (S.enCurso && Date.now() - new Date(S.enCurso).getTime() < 10 * 60000) return res.status(200).json({ ok: true, yaEnCurso: true });
    S = { ...S, enCurso: new Date().toISOString(), cursor: 0, ronda: { revisados: 0, sinLeer: 0, agotados: [], vuelven: [], precios: [], perdidas: [], pendientes: [] } };
  }
  const guardar = () => db('ajustes', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ clave: 'sync', valor: S }) });

  const lista = await db('productos_privado?origen_url=not.is.null&select=producto_id,coste,origen_url,productos(id,nombre,precio,stock,publicado)&order=producto_id');
  const R = S.ronda;
  let i = S.cursor || 0;

  async function revisar(x) {
    const p = x.productos; if (!p) return;
    let info = null;
    try { info = await leerProveedor(x.origen_url); } catch (e) {}
    R.revisados++;
    if (!info) { R.sinLeer++; return; }
    const nombre = String(p.nombre || '').slice(0, 90);
    const oculto = S.ocultados[p.id];
    if (!info.disponible) {
      // no se oculta todavía: se apunta y se decide al final (freno de seguridad)
      if (p.stock > 0) R.pendientes.push({ id: p.id, nombre, stock: p.stock, tipo: 'agotado', retirado: !!info.retirado });
      return;
    }
    // precio del proveedor
    if (info.precio && x.coste != null && Math.abs(info.precio - Number(x.coste)) >= 0.01 && Math.abs(info.precio - Number(x.coste)) / Number(x.coste) > 0.005) {
      await db(`productos_privado?producto_id=eq.${p.id}`, { method: 'PATCH', body: JSON.stringify({ coste: info.precio }) });
      R.precios.push({ id: p.id, nombre, antes: Number(x.coste), ahora: info.precio, tuPrecio: Number(p.precio) });
    }
    if (info.precio && Number(p.precio) <= info.precio) {
      if (p.stock > 0) R.pendientes.push({ id: p.id, nombre, stock: p.stock, tipo: 'perdida', coste: info.precio, tuPrecio: Number(p.precio) });
      return;
    }
    if (oculto && p.stock === 0) {
      await db(`productos?id=eq.${p.id}`, { method: 'PATCH', body: JSON.stringify({ stock: oculto }) });
      R.vuelven.push({ id: p.id, nombre });
    }
    if (oculto) delete S.ocultados[p.id];
  }

  while (i < lista.length && Date.now() - inicio < PRESUPUESTO_MS) {
    await Promise.all(lista.slice(i, i + PARALELO).map(x => revisar(x).catch(() => { R.sinLeer++; })));
    i += PARALELO;
  }
  S.cursor = i;

  if (i < lista.length) {
    await guardar();
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    try { await conTiempo(`https://${host}/api/sincronizar`, { method: 'POST', headers: { 'x-sync-clave': claveInterna() } }, 1500); } catch (e) {}
    return res.status(202).json({ ok: true, sigue: true, revisados: R.revisados, total: lista.length });
  }

  // terminado: freno de seguridad. Si de golpe salen agotados muchísimos, lo más probable es que el
  // proveedor nos esté bloqueando o haya cambiado su web: no se oculta nada y se avisa.
  const pend = R.pendientes || []; delete R.pendientes;
  const limite = Math.max(15, Math.round(R.revisados * 0.25));
  R.frenado = pend.length > limite || R.sinLeer > Math.max(20, R.revisados * 0.3);
  if (R.frenado) R.sinOcultar = pend.length;
  else {
    for (let k = 0; k < pend.length; k += 10) {
      await Promise.all(pend.slice(k, k + 10).map(async x => {
        await db(`productos?id=eq.${x.id}`, { method: 'PATCH', body: JSON.stringify({ stock: 0 }) });
        S.ocultados[x.id] = x.stock;
        if (x.tipo === 'perdida') R.perdidas.push({ id: x.id, nombre: x.nombre, coste: x.coste, tuPrecio: x.tuPrecio });
        else R.agotados.push({ id: x.id, nombre: x.nombre, retirado: x.retirado });
      }).map(pr => pr.catch(() => {})));
    }
  }
  S.ultima = { fecha: new Date().toISOString(), total: lista.length, ...R };
  delete S.enCurso; delete S.ronda; delete S.cursor;
  await guardar();
  const partes = [];
  if (R.frenado) partes.push(`⚠️ ${R.sinOcultar} productos parecían agotados y ${R.sinLeer} no se han podido leer: puede que el proveedor esté bloqueando la revisión. No se ha ocultado nada`);
  if (R.agotados.length) partes.push(`${R.agotados.length} agotado${R.agotados.length > 1 ? 's' : ''} en el proveedor (ocultos)`);
  if (R.perdidas.length) partes.push(`${R.perdidas.length} con el proveedor más caro que tú (ocultos)`);
  if (R.precios.length) partes.push(`${R.precios.length} cambio${R.precios.length > 1 ? 's' : ''} de precio`);
  if (R.vuelven.length) partes.push(`${R.vuelven.length} vuelve${R.vuelven.length > 1 ? 'n' : ''} a estar a la venta`);
  // Después, la importación automática de novedades (en otra llamada, con su propio tiempo)
  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    await conTiempo(`https://${host}/api/sincronizar?fase=importar`, { method: 'POST', headers: { 'x-sync-clave': claveInterna() } }, 1500);
  } catch (e) {}
  if (partes.length) await avisar({ titulo: '🔄 Stock de proveedores revisado', cuerpo: partes.join(' · ') + '. Toca para ver el detalle.', url: '/admin#sync', etiqueta: 'sync' }).catch(() => {});
  return res.status(200).json({ ok: true, terminado: true, ...S.ultima });
};
