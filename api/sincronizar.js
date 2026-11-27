// /api/sincronizar — comprueba cada día stock y precio de los productos en su proveedor.
// · Si el proveedor lo tiene agotado → stock 0 (desaparece de la tienda) y se recuerda su stock anterior.
// · Si vuelve a haber → se recupera el stock anterior.
// · Si el proveedor cambia el precio → se actualiza el coste y se avisa; si ya vende igual o más caro que tú, se oculta.
// Lo lanza el cron de Vercel (vercel.json) cada mañana, o el administrador con «Comprobar ahora».
// Trabaja por tandas: si no le da tiempo, se vuelve a llamar a sí mismo para seguir.
const crypto = require('crypto');
const { db, claveSupabase } = require('./_srv.js');
const { UA, esAdmin, extraerHTML, shopifyBase, desdeShopify } = require('./_util.js');
const { avisar } = require('./_avisos.js');

const PRESUPUESTO_MS = 40000, PARALELO = 6;
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
async function baseDe(origen) {
  if (origen in basesShopify) return basesShopify[origen];
  basesShopify[origen] = null;
  try { const r = await conTiempo(origen + '/', { headers: { 'User-Agent': UA } }); if (r.ok) basesShopify[origen] = shopifyBase(await r.text(), origen + '/'); } catch (e) {}
  return basesShopify[origen];
}

// Lee disponibilidad y precio del proveedor. Devuelve { disponible, precio } o null si no se ha podido leer.
async function leerProveedor(url) {
  const u = new URL(url);
  const handle = (u.pathname.match(/\/products\/([^/?#]+)/) || [])[1];
  if (handle) {
    const sb = await baseDe(u.origin);
    for (const base of [sb, u.origin].filter(Boolean)) {
      try {
        const r = await conTiempo(`${base}/products/${handle}.js`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
        if (r.status === 404) { if (base === u.origin || !sb) return { disponible: false, precio: null, retirado: true }; continue; }
        if (r.ok) { const d = desdeShopify(await r.json(), u.origin); return { disponible: d.disponible, precio: d.precio }; }
      } catch (e) {}
    }
  }
  const r = await conTiempo(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  if (r.status === 404 || r.status === 410) return { disponible: false, precio: null, retirado: true };
  if (!r.ok) return null;
  const d = await extraerHTML((await r.text()).slice(0, 3000000), r.url || url);
  if (!d.nombre) return null;
  return { disponible: d.disponible !== false, precio: d.precio };
}

const eur = n => Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const quien = await permitido(req);
  if (!quien) return res.status(401).json({ error: 'No autorizado' });
  const inicio = Date.now();
  const continuar = quien === 'interno';

  const fila = await db('ajustes?clave=eq.sync&select=valor').catch(() => []);
  let S = (fila && fila[0] && fila[0].valor) || {};
  S.ocultados = S.ocultados || {};
  if (!continuar) {
    if (S.enCurso && Date.now() - new Date(S.enCurso).getTime() < 10 * 60000) return res.status(200).json({ ok: true, yaEnCurso: true });
    S = { ...S, enCurso: new Date().toISOString(), cursor: 0, ronda: { revisados: 0, sinLeer: 0, agotados: [], vuelven: [], precios: [], perdidas: [] } };
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
      if (p.stock > 0) {
        S.ocultados[p.id] = p.stock;
        await db(`productos?id=eq.${p.id}`, { method: 'PATCH', body: JSON.stringify({ stock: 0 }) });
        R.agotados.push({ id: p.id, nombre, retirado: !!info.retirado });
      }
      return;
    }
    // precio del proveedor
    if (info.precio && x.coste != null && Math.abs(info.precio - Number(x.coste)) >= 0.01 && Math.abs(info.precio - Number(x.coste)) / Number(x.coste) > 0.005) {
      await db(`productos_privado?producto_id=eq.${p.id}`, { method: 'PATCH', body: JSON.stringify({ coste: info.precio }) });
      R.precios.push({ id: p.id, nombre, antes: Number(x.coste), ahora: info.precio, tuPrecio: Number(p.precio) });
    }
    if (info.precio && Number(p.precio) <= info.precio) {
      if (p.stock > 0) {
        S.ocultados[p.id] = p.stock;
        await db(`productos?id=eq.${p.id}`, { method: 'PATCH', body: JSON.stringify({ stock: 0 }) });
        R.perdidas.push({ id: p.id, nombre, coste: info.precio, tuPrecio: Number(p.precio) });
      }
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

  // terminado
  S.ultima = { fecha: new Date().toISOString(), total: lista.length, ...R };
  delete S.enCurso; delete S.ronda; delete S.cursor;
  await guardar();
  const partes = [];
  if (R.agotados.length) partes.push(`${R.agotados.length} agotado${R.agotados.length > 1 ? 's' : ''} en el proveedor (ocultos)`);
  if (R.perdidas.length) partes.push(`${R.perdidas.length} con el proveedor más caro que tú (ocultos)`);
  if (R.precios.length) partes.push(`${R.precios.length} cambio${R.precios.length > 1 ? 's' : ''} de precio`);
  if (R.vuelven.length) partes.push(`${R.vuelven.length} vuelve${R.vuelven.length > 1 ? 'n' : ''} a estar a la venta`);
  if (partes.length) await avisar({ titulo: '🔄 Stock de proveedores revisado', cuerpo: partes.join(' · ') + '. Toca para ver el detalle.', url: '/admin#sync', etiqueta: 'sync' }).catch(() => {});
  return res.status(200).json({ ok: true, terminado: true, ...S.ultima });
};
