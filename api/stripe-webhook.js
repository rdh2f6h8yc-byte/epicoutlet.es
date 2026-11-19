// POST /api/stripe-webhook  ← avisos de Stripe (pago completado, caducado…)
// En Stripe → Developers → Webhooks: añade esta dirección con los eventos
// checkout.session.completed, checkout.session.async_payment_succeeded,
// checkout.session.async_payment_failed y checkout.session.expired.
const { db, firmaValida, leerCrudo, secretoWebhook } = require('./_srv.js');
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
    stripe_pago: s.payment_intent || null
  };
  // Solo pasa de "pendiente" a "pagado" una vez, aunque Stripe repita el aviso
  const hechos = await db(`pedidos?id=eq.${id}&estado=eq.pendiente`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(cambios) });
  if (!hechos || !hechos.length) return;
  await avisar(avisoPedido(hechos[0])).catch(() => {}); // aviso al iPhone (si falla, el pedido sigue igual)
  if (String(hechos[0].notas || '').startsWith('PRUEBA')) return; // los pedidos de prueba no restan stock
  for (const l of hechos[0].productos || []) {
    if (l.producto_id) await db('rpc/descontar_stock', { method: 'POST', body: JSON.stringify({ p_id: l.producto_id, n: l.cantidad }) });
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
      if (id) await db(`pedidos?id=eq.${id}&estado=eq.pendiente`, { method: 'PATCH', body: JSON.stringify({ estado: 'cancelado' }) });
    }
    return res.status(200).json({ recibido: true });
  } catch (e) {
    console.error('webhook', e);
    return res.status(500).send('Error'); // Stripe lo reintentará
  }
};

module.exports.config = { api: { bodyParser: false } };
