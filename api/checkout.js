// POST /api/checkout  { items: [{ id, qty }] }  → { url } de pago de Stripe
// Los precios y el stock se leen siempre de la base de datos, nunca del navegador.
const { db, stripe, leerEnvio, pagosActivos, redondo } = require('./_srv.js');
const { esAdmin } = require('./_util.js');
const CUPON_PRUEBA = 'PRUEBA'; // todo gratis, solo con la sesión del panel abierta

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  if (!pagosActivos()) return res.status(503).json({ error: 'Los pagos todavía no están activados en la tienda.' });
  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body || '{}');
    const items = (Array.isArray(body && body.items) ? body.items : [])
      .map(i => ({ slug: String(i.id || '').replace(/[^a-z0-9-]/gi, '').slice(0, 120), qty: Math.max(1, Math.min(20, parseInt(i.qty, 10) || 1)) }))
      .filter(i => i.slug).slice(0, 50);
    if (!items.length) return res.status(400).json({ error: 'El carrito está vacío.' });
    const cupon = String((body && body.cupon) || '').trim().toUpperCase();
    let prueba = false;
    if (cupon) {
      if (cupon === CUPON_PRUEBA && await esAdmin(req)) prueba = true;
      else return res.status(400).json({ error: 'El código de descuento no es válido.', cupon: false });
    }

    const lista = items.map(i => `"${i.slug}"`).join(',');
    const prods = await db(`productos?select=id,slug,nombre,precio,stock,imagenes,publicado&slug=in.(${encodeURIComponent(lista)})`);

    const lineas = [], problemas = [];
    for (const it of items) {
      const p = prods.find(x => x.slug === it.slug);
      if (!p || !p.publicado || p.stock <= 0) { problemas.push({ id: it.slug, stock: 0 }); continue; }
      if (it.qty > p.stock) { problemas.push({ id: it.slug, stock: p.stock }); continue; }
      lineas.push({ producto_id: p.id, slug: p.slug, nombre: p.nombre, precio: Number(p.precio), cantidad: it.qty, imagen: (p.imagenes || [])[0] || null });
    }
    if (problemas.length) return res.status(409).json({ error: 'Algún producto se ha agotado o no queda esa cantidad. Hemos actualizado tu carrito.', problemas });

    if (prueba) lineas.forEach(l => { l.precio = 0; });
    const subtotal = redondo(lineas.reduce((a, l) => a + l.precio * l.cantidad, 0));
    const env = await leerEnvio();
    const envio = prueba ? 0 : env.gratisDesde != null && subtotal >= env.gratisDesde ? 0 : redondo(env.precio);
    const [pedido] = await db('pedidos', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ estado: 'pendiente', productos: lineas, subtotal, envio, total: redondo(subtotal + envio), notas: prueba ? 'PRUEBA · cupón de administrador (gratis, no resta stock)' : null }) });

    const origen = (req.headers.origin && /^https?:\/\//.test(req.headers.origin)) ? req.headers.origin : `https://${req.headers.host}`;
    const sesion = await stripe('checkout/sessions', {
      mode: 'payment',
      locale: 'es',
      client_reference_id: pedido.id,
      success_url: `${origen}/gracias?s={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origen}/carrito`,
      line_items: lineas.map(l => ({
        quantity: l.cantidad,
        price_data: {
          currency: 'eur',
          unit_amount: Math.round(l.precio * 100),
          product_data: { name: l.nombre.slice(0, 250), images: l.imagen && /^https:\/\//.test(l.imagen) ? [l.imagen] : undefined }
        }
      })),
      shipping_address_collection: { allowed_countries: ['ES'] },
      phone_number_collection: { enabled: true },
      shipping_options: [{ shipping_rate_data: {
        type: 'fixed_amount',
        display_name: prueba ? 'Envío gratis (pedido de prueba)' : envio ? 'Envío a domicilio (1–3 días laborables)' : 'Envío gratis (1–3 días laborables)',
        fixed_amount: { amount: Math.round(envio * 100), currency: 'eur' },
        delivery_estimate: { minimum: { unit: 'business_day', value: 1 }, maximum: { unit: 'business_day', value: 3 } }
      } }],
      metadata: { pedido_id: pedido.id, numero: pedido.numero, prueba: prueba ? 'si' : 'no' },
      payment_intent_data: prueba ? undefined : { metadata: { pedido_id: pedido.id, numero: pedido.numero }, description: `Pedido #${pedido.numero} · EpicOutlet.es` }
    });
    await db(`pedidos?id=eq.${pedido.id}`, { method: 'PATCH', body: JSON.stringify({ stripe_session: sesion.id }) });
    return res.status(200).json({ url: sesion.url });
  } catch (e) {
    console.error('checkout', e);
    if (/no-cost|amount|minimum/i.test(e.message || '')) return res.status(500).json({ error: 'Stripe no ha aceptado el pedido de 0 €: activa «Pedidos sin coste» (No-cost orders) en Stripe → Configuración → Checkout. Detalle: ' + e.message });
    return res.status(500).json({ error: 'No se ha podido iniciar el pago. Inténtalo de nuevo en unos minutos.' });
  }
};
