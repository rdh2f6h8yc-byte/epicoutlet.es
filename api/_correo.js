// Correos a clientes con Resend (https://resend.com). Necesita en Vercel la variable RESEND_API_KEY.
// Remitente: variable CORREO_REMITENTE (por defecto «EpicOutlet.es <pedidos@epicoutlet.es>»).
const { db, CFG } = require('./_srv.js');
const { facturaPDF } = require('./_factura.js');

const SITIO = (CFG.sitioUrl || 'https://www.epicoutlet.es').replace(/\/$/, '');
const REMITENTE = () => process.env.CORREO_REMITENTE || 'EpicOutlet.es <pedidos@epicoutlet.es>';
const RESPONDER = () => process.env.CORREO_RESPUESTA || 'contacto@epicoutlet.es';
const correoActivo = () => !!process.env.RESEND_API_KEY;

const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = n => (Number(n) || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const nombre1 = p => esc(String(p.cliente_nombre || '').trim().split(/\s+/)[0] || '').replace(/^./, c => c.toUpperCase());

async function enviar({ para, asunto, html, texto, adjuntos }) {
  if (!correoActivo()) return { ok: false, motivo: 'Falta RESEND_API_KEY en Vercel' };
  if (!para) return { ok: false, motivo: 'Sin correo del cliente' };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: REMITENTE(), to: [para], reply_to: RESPONDER(), subject: asunto, html, text: texto,
      attachments: (adjuntos || []).map(a => ({ filename: a.nombre, content: a.contenido.toString('base64') }))
    })
  });
  const j = await r.json().catch(() => ({}));
  return r.ok ? { ok: true, id: j.id } : { ok: false, motivo: j.message || ('Resend ' + r.status) };
}

// Plantilla común
function marco(titulo, cuerpo, pie = '') {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(titulo)}</title></head>
<body style="margin:0;background:#F4F4F6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#16161A">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F4F6"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden">
<tr><td style="background:#16161A;padding:18px 24px"><a href="${SITIO}" style="text-decoration:none;font-size:22px;font-weight:800;color:#fff">Epic<span style="color:#FF6A00">Outlet</span><span style="font-size:13px;color:#9A9AA2">.es</span></a></td></tr>
<tr><td style="padding:26px 24px 8px">${cuerpo}</td></tr>
<tr><td style="padding:8px 24px 24px;font-size:13px;line-height:1.5;color:#6B6B73">${pie}¿Dudas? Responde a este correo o escríbenos a <a href="mailto:contacto@epicoutlet.es" style="color:#16161A">contacto@epicoutlet.es</a>.</td></tr>
</table>
<div style="font-size:12px;color:#9A9AA2;padding:14px">EpicOutlet.es · Envío en 1–3 días laborables · 14 días de devolución</div>
</td></tr></table></body></html>`;
}
const boton = (url, txt) => `<a href="${url}" style="display:inline-block;background:#FF6A00;color:#16161A;font-weight:700;text-decoration:none;padding:13px 22px;border-radius:12px;font-size:15px">${esc(txt)}</a>`;
function tablaLineas(p) {
  const filas = (p.productos || []).map(l => `<tr>
    <td style="padding:10px 0;border-bottom:1px solid #EEE;width:56px">${l.imagen ? `<img src="${esc(l.imagen)}" width="48" height="48" alt="" style="border-radius:8px;object-fit:cover;display:block">` : ''}</td>
    <td style="padding:10px 8px;border-bottom:1px solid #EEE;font-size:14px;line-height:1.35">${esc(l.nombre)}<div style="color:#6B6B73;font-size:13px">${l.cantidad} × ${eur(l.precio)}</div></td>
    <td style="padding:10px 0;border-bottom:1px solid #EEE;font-size:14px;text-align:right;white-space:nowrap">${eur(l.precio * l.cantidad)}</td></tr>`).join('');
  const fila = (a, b, fuerte) => `<tr><td></td><td style="padding:5px 8px;font-size:14px;${fuerte ? 'font-weight:800' : 'color:#6B6B73'}">${a}</td><td style="padding:5px 0;font-size:14px;text-align:right;${fuerte ? 'font-weight:800' : ''}">${b}</td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${filas}
    ${fila('Envío', Number(p.envio) ? eur(p.envio) : 'Gratis')}
    ${Number(p.descuento) ? fila(`Descuento${p.cupon ? ' (' + esc(p.cupon) + ')' : ''}`, '−' + eur(p.descuento)) : ''}
    ${fila('Total (IVA incluido)', eur(p.total), true)}</table>`;
}
function dirHTML(p) {
  const d = p.direccion || {};
  return [p.cliente_nombre, [d.line1, d.line2].filter(Boolean).join(', '), [d.postal_code, d.city].filter(Boolean).join(' ')].filter(Boolean).map(esc).join('<br>');
}

async function empresaYIva() {
  try {
    const r = await db('ajustes?clave=in.(empresa,precios)&select=clave,valor');
    const e = (r.find(x => x.clave === 'empresa') || {}).valor || {};
    const pr = (r.find(x => x.clave === 'precios') || {}).valor || {};
    return { empresa: e, iva: Number(pr.iva) || 21 };
  } catch (e) { return { empresa: {}, iva: 21 }; }
}

async function marcar(p, clave, extra = {}) {
  const correos = { ...(p.correos || {}), [clave]: new Date().toISOString() };
  p.correos = correos;
  await db(`pedidos?id=eq.${p.id}`, { method: 'PATCH', body: JSON.stringify({ correos, ...extra }) }).catch(() => {});
}

// 1) Confirmación de pedido con la factura en PDF
async function correoConfirmacion(p) {
  const prueba = String(p.notas || '').startsWith('PRUEBA');
  const { empresa, iva } = await empresaYIva();
  const adjuntos = p.factura && !prueba ? [{ nombre: `Factura-${p.factura}.pdf`, contenido: facturaPDF(p, { empresa, iva }) }] : [];
  const html = marco(`Pedido #${p.numero}`, `
    <h1 style="font-size:24px;margin:0 0 8px">¡Gracias por tu compra${nombre1(p) ? ', ' + nombre1(p) : ''}!</h1>
    <p style="font-size:15px;line-height:1.55;color:#3A3A40;margin:0 0 18px">Hemos recibido tu pedido <strong>#${p.numero}</strong> y ya lo estamos preparando. Te avisaremos por correo en cuanto salga, con el número de seguimiento. La entrega suele tardar <strong>1–3 días laborables</strong>.</p>
    ${tablaLineas(p)}
    <p style="font-size:14px;line-height:1.5;margin:18px 0 6px"><strong>Se enviará a:</strong><br>${dirHTML(p)}</p>
    ${adjuntos.length ? `<p style="font-size:14px;color:#3A3A40;margin:14px 0">Te adjuntamos la factura <strong>${esc(p.factura)}</strong> en PDF.</p>` : ''}
    <p style="margin:20px 0 8px">${boton(`${SITIO}/cuenta`, 'Ver mi pedido')}</p>`,
    prueba ? '<strong>Pedido de prueba</strong> (cupón de administrador): no se ha cobrado nada. ' : '');
  const r = await enviar({ para: p.cliente_email, asunto: `Pedido #${p.numero} confirmado · EpicOutlet.es`, html,
    texto: `Gracias por tu compra. Pedido #${p.numero} por ${eur(p.total)}. Te avisaremos cuando salga.`, adjuntos });
  if (r.ok) await marcar(p, 'confirmacion');
  return r;
}

// 2) Pedido enviado, con el seguimiento
function urlSeguimiento(transp, num) {
  const t = String(transp || '').toLowerCase(), n = encodeURIComponent(num || '');
  if (!num) return null;
  if (/correos express/.test(t)) return `https://s.correosexpress.com/SeguimientoSinCP/search?shippingNumber=${n}`;
  if (/correos/.test(t)) return `https://www.correos.es/es/es/herramientas/localizador/envios/detalle?tracking-number=${n}`;
  if (/seur/.test(t)) return `https://www.seur.com/livetracking/?segOnlineIdentificador=${n}`;
  if (/gls/.test(t)) return `https://mygls.gls-spain.es/e/${n}`;
  if (/mrw/.test(t)) return `https://www.mrw.es/seguimiento_envios/MRW_resultados_consultas.asp?enviament=${n}`;
  if (/dhl/.test(t)) return `https://www.dhl.com/es-es/home/tracking.html?tracking-id=${n}`;
  if (/ups/.test(t)) return `https://www.ups.com/track?loc=es_ES&tracknum=${n}`;
  if (/ctt/.test(t)) return `https://www.cttexpress.com/localizador-de-envios/?sc=${n}`;
  if (/nacex/.test(t)) return `https://www.nacex.es/irSeguimiento.do?agencia_origen=&numero_albaran=${n}`;
  if (/inpost/.test(t)) return `https://inpost.es/seguimiento?number=${n}`;
  return `https://www.google.com/search?q=${encodeURIComponent((transp || '') + ' ' + num)}`;
}
async function correoEnviado(p) {
  const url = urlSeguimiento(p.transportista, p.seguimiento);
  const html = marco(`Pedido #${p.numero} enviado`, `
    <h1 style="font-size:24px;margin:0 0 8px">¡Tu pedido ya está en camino! 🚚</h1>
    <p style="font-size:15px;line-height:1.55;color:#3A3A40;margin:0 0 16px">Hola${nombre1(p) ? ' ' + nombre1(p) : ''}, tu pedido <strong>#${p.numero}</strong> ha salido y llegará en <strong>1–3 días laborables</strong>.</p>
    ${p.seguimiento ? `<div style="background:#F4F4F6;border-radius:12px;padding:14px 16px;font-size:14px;line-height:1.6;margin:0 0 18px">${p.transportista ? `Transportista: <strong>${esc(p.transportista)}</strong><br>` : ''}Nº de seguimiento: <strong>${esc(p.seguimiento)}</strong></div>` : ''}
    ${url ? `<p style="margin:0 0 18px">${boton(url, 'Seguir mi envío')}</p>` : ''}
    ${tablaLineas(p)}`);
  const r = await enviar({ para: p.cliente_email, asunto: `Tu pedido #${p.numero} ya está en camino`, html,
    texto: `Tu pedido #${p.numero} ya está en camino. ${p.transportista || ''} ${p.seguimiento || ''}`.trim() });
  if (r.ok) await marcar(p, 'enviado');
  return r;
}

// 3) Reembolso, con la factura rectificativa
async function correoReembolso(p, importe, motivo, rect) {
  const { empresa, iva } = await empresaYIva();
  const adjuntos = rect && p.factura ? [{ nombre: `Factura-rectificativa-${rect.numero}.pdf`, contenido: facturaPDF(p, { empresa, iva, rectificativa: rect }) }] : [];
  const html = marco(`Reembolso del pedido #${p.numero}`, `
    <h1 style="font-size:24px;margin:0 0 8px">Te hemos devuelto ${eur(importe)}</h1>
    <p style="font-size:15px;line-height:1.55;color:#3A3A40;margin:0 0 16px">Hola${nombre1(p) ? ' ' + nombre1(p) : ''}, hemos hecho el reembolso de <strong>${eur(importe)}</strong> de tu pedido <strong>#${p.numero}</strong>${motivo ? ` (${esc(motivo)})` : ''}.</p>
    <p style="font-size:15px;line-height:1.55;color:#3A3A40;margin:0 0 16px">Lo verás en el mismo método de pago que usaste, normalmente en <strong>5–10 días</strong> según tu banco.</p>
    ${adjuntos.length ? `<p style="font-size:14px;color:#3A3A40">Te adjuntamos la factura rectificativa <strong>${esc(rect.numero)}</strong>.</p>` : ''}
    <p style="font-size:14px;color:#3A3A40">Sentimos las molestias y esperamos verte pronto por EpicOutlet.es.</p>`);
  const r = await enviar({ para: p.cliente_email, asunto: `Reembolso de tu pedido #${p.numero} · EpicOutlet.es`, html,
    texto: `Te hemos devuelto ${eur(importe)} del pedido #${p.numero}.`, adjuntos });
  if (r.ok) await marcar(p, 'reembolso');
  return r;
}

// 4) Carrito abandonado (solo si el cliente aceptó recibir comunicaciones en la pantalla de pago)
async function correoCarrito(p, urlRecuperar) {
  const html = marco('Tu carrito te espera', `
    <h1 style="font-size:24px;margin:0 0 8px">¿Se te olvidó algo?</h1>
    <p style="font-size:15px;line-height:1.55;color:#3A3A40;margin:0 0 16px">Hola${nombre1(p) ? ' ' + nombre1(p) : ''}, dejaste esto a medias en EpicOutlet.es. Son unidades limitadas de outlet y pueden agotarse pronto.</p>
    ${tablaLineas(p)}
    <p style="margin:20px 0 8px">${boton(urlRecuperar || `${SITIO}/carrito`, 'Terminar mi compra')}</p>`,
    'Recibes este correo porque aceptaste recibir comunicaciones de EpicOutlet.es al iniciar el pago. Si no quieres más, respóndenos y te damos de baja. ');
  const r = await enviar({ para: p.cliente_email, asunto: 'Tu carrito te espera en EpicOutlet.es', html, texto: 'Dejaste tu compra a medias en EpicOutlet.es.' });
  if (r.ok) await marcar(p, 'carrito');
  return r;
}

module.exports = { enviar, correoActivo, correoConfirmacion, correoEnviado, correoReembolso, correoCarrito, empresaYIva, urlSeguimiento };
