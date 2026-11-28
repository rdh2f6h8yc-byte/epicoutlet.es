// POST /api/stripe-webhook  ← avisos de Stripe (pago completado, caducado…)
// En Stripe → Developers → Webhooks: añade esta dirección con los eventos
// checkout.session.completed, checkout.session.async_payment_succeeded,
// checkout.session.async_payment_failed y checkout.session.expired.
const { db, firmaValida, leerCrudo, secretoWebhook, sumarUsoCupon } = require('./_srv.js');
const { correoConfirmacion, correoCarrito } = require('./_correo.js');
const { avisar, avisoPedido } = require('./_avisos.js');

async function marcarPagado(s) {
  const id = (s.metadata || {}).pedido_id || s.client_reference_id;
  if (!id) return;
  const envio = s.shipping_details || (s.collected_information || {}).shipping_details || {};
  const cli = s.customer_details || {};
  const cambios = {
    estado: 'pagado',
    pagado: new Date().toISOString(),
    cliente_nombre: envio.name || cli.name || null,
    cliente_email: cli.email || null,
    cliente_telefono: cli.phone || null,
    direccion: envio.address || cli.address || null,
    total: typeof s.amount_total === 'number' ? s.amount_total / 100 : undefined,
    stripe_pago: s.payment_intent || null,
    stripe_session: s.id || undefined
  };
  // Solo pasa a "pagado" una vez, aunque Stripe repita el aviso. También desde "cancelado":
  // es el caso de un carrito recuperado (el cliente vuelve con el enlace del correo y paga).
  const hechos = await db(`pedidos?id=eq.${id}&estado=in.(pendiente,cancelado)`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(cambios) });
  if (!hechos || !hechos.length) return;
  const p = hechos[0];
  const prueba = String(p.notas || '').startsWith('PRUEBA');
  if (!prueba) {
    for (const l of p.productos || []) {
      if (l.producto_id) await db('rpc/descontar_stock', { method: 'POST', body: JSON.stringify({ p_id: l.producto_id, n: l.cantidad }) });
    }
    // Factura con numeración correlativa (necesita el SQL de la versión 2)
    try {
      const num = await db('rpc/siguiente_factura', { method: 'POST', body: JSON.stringify({ p_serie: 'EO' }) });
      if (num) { p.factura = num; p.factura_fecha = new Date().toISOString(); await db(`pedidos?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ factura: p.factura, factura_fecha: p.factura_fecha }) }); }
    } catch (e) { console.error('factura', e.message); }
    if (p.cupon) await sumarUsoCupon(p.cupon);
  }
  await avisar(avisoPedido(p)).catch(() => {});                         // aviso al iPhone
  await correoConfirmacion(p).catch(e => console.error('correo', e.message)); // correo al cliente con la factura
}

// El cliente llegó a la pantalla de pago de Stripe pero no pagó (la cerró o el banco rechazó el pago)
async function marcarSinPago(id, s, motivo) {
  const prev = await db(`pedidos?id=eq.${id}&estado=eq.pendiente&select=notas`);
  if (!prev || !prev.length) return;
  const cli = s.customer_details || {};
  const cuando = new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const texto = motivo === 'caducado'
    ? `SIN PAGO · El cliente abrió la pantalla de pago y no llegó a pagar; Stripe la cerró el ${cuando}.`
    : `SIN PAGO · El pago fue rechazado (banco o método de pago) el ${cuando}.`;
  const notas = [prev[0].notas, texto].filter(Boolean).join('\n');
  const cambios = { estado: 'cancelado', notas };
  if (cli.email) cambios.cliente_email = cli.email;
  if (cli.name) cambios.cliente_nombre = cli.name;
  if (cli.phone) cambios.cliente_telefono = cli.phone;
  const hechos = await db(`pedidos?id=eq.${id}&estado=eq.pendiente`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(cambios) });
  // Carrito abandonado: solo si el cliente aceptó comunicaciones y no le hemos escrito ya en los últimos 7 días
  const url = s.after_expiration && s.after_expiration.recovery && s.after_expiration.recovery.url;
  if (hechos && hechos.length && motivo === 'caducado' && url && cli.email && s.consent && s.consent.promotions === 'opt_in') {
    try {
      const desde = new Date(Date.now() - 7 * 864e5).toISOString();
      const previos = await db(`pedidos?cliente_email=eq.${encodeURIComponent(cli.email)}&correos->>carrito=gte.${desde}&select=id`).catch(() => []);
      if (!previos.length) await correoCarrito(hechos[0], url);
    } catch (e) { console.error('carrito', e.message); }
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Método no permitido');
  const raw = await leerCrudo(req);
  if (!firmaValida(raw, req.headers['stripe-signature'], secretoWebhook())) return res.status(400).send('Firma no válida');
  let ev; try { ev = JSON.parse(raw.toString('utf8')); } catch (e) { return res.status(400).send('JSON no válido'); }
  const s = ev.data && ev.data.object || {};
  try {
    if (ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') {
      if (s.payment_status === 'paid' || s.payment_status === 'no_payment_required') await marcarPagado(s);
    } else if (ev.type === 'checkout.session.expired' || ev.type === 'checkout.session.async_payment_failed') {
      const id = (s.metadata || {}).pedido_id || s.client_reference_id;
      if (id) await marcarSinPago(id, s, ev.type === 'checkout.session.expired' ? 'caducado' : 'rechazado');
    }
    return res.status(200).json({ recibido: true });
  } catch (e) {
    console.error('webhook', e);
    return res.status(500).send('Error'); // Stripe lo reintentará
  }
};

module.exports.config = { api: { bodyParser: false } };
