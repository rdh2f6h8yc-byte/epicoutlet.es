// Avisos al iPhone a través de ntfy.sh (app gratuita «ntfy»).
// El nombre del canal es secreto: se guarda en la tabla ajustes (clave 'avisos'), que solo lee el administrador.
const { db, CFG } = require('./_srv.js');

async function temaAvisos() {
  try {
    const r = await db('ajustes?clave=eq.avisos&select=valor');
    const v = r && r[0] && r[0].valor;
    return v && v.tema && v.activos !== false ? String(v.tema) : '';
  } catch (e) { return ''; }
}

async function avisar({ titulo, mensaje, url, etiquetas, prioridad }, temaForzado) {
  const tema = temaForzado || await temaAvisos();
  if (!/^[A-Za-z0-9_-]{12,64}$/.test(tema)) return { ok: false, motivo: 'sin canal' };
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 5000);
  try {
    const r = await fetch('https://ntfy.sh/', {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: tema, title: titulo, message: mensaje, click: url || undefined, tags: etiquetas || [], priority: prioridad || 4 })
    });
    return { ok: r.ok, estado: r.status };
  } catch (e) { return { ok: false, motivo: e.name === 'AbortError' ? 'tiempo agotado' : e.message }; }
  finally { clearTimeout(t); }
}

const eur = n => Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

function avisoPedido(p) {
  const sitio = (CFG.sitioUrl || 'https://www.epicoutlet.es').replace(/\/$/, '');
  const prueba = String(p.notas || '').startsWith('PRUEBA');
  const lineas = (p.productos || []).slice(0, 4).map(l => `${l.cantidad > 1 ? l.cantidad + ' × ' : ''}${String(l.nombre || 'Producto').slice(0, 70)}`);
  if ((p.productos || []).length > 4) lineas.push(`y ${(p.productos.length - 4)} más`);
  const d = p.direccion || {};
  const quien = [p.cliente_nombre, d.city].filter(Boolean).join(' · ');
  return {
    titulo: `${prueba ? '🧪 Prueba · ' : '🛒 '}Pedido #${p.numero} · ${eur(p.total)}`,
    mensaje: [lineas.join('\n'), quien].filter(Boolean).join('\n'),
    url: `${sitio}/admin#pedido=${p.id}`,
    etiquetas: [prueba ? 'test_tube' : 'moneybag'],
    prioridad: prueba ? 3 : 5
  };
}

module.exports = { avisar, avisoPedido };
