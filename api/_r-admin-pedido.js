// POST /api/admin-pedido (solo administrador)
//   { id, accion: 'reembolsar', importe?, motivo?, reponer?, avisar? }  → devuelve el dinero en Stripe, factura rectificativa y correo
//   { id, accion: 'aviso_envio' }            → correo «tu pedido está en camino» con el seguimiento
//   { id, accion: 'reenviar_confirmacion' }  → vuelve a mandar la confirmación con la factura
const { db, stripe, redondo } = require('./_srv.js');
const { esAdmin } = require('./_util.js');
const { correoEnviado, correoReembolso, correoConfirmacion, correoActivo } = require('./_correo.js');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  if (!(await esAdmin(req))) return res.status(401).json({ error: 'Solo el administrador' });
  let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b || '{}'); } catch (e) { b = {}; } }
  const id = String(b.id || '').replace(/[^a-f0-9-]/gi, '');
  if (!id) return res.status(400).json({ error: 'Falta el pedido' });
  const [p] = await db(`pedidos?id=eq.${id}`);
  if (!p) return res.status(404).json({ error: 'Pedido no encontrado' });

  try {
    if (b.accion === 'aviso_envio') {
      const r = await correoEnviado(p);
      return res.status(r.ok ? 200 : 502).json(r);
    }
    if (b.accion === 'reenviar_confirmacion') {
      const r = await correoConfirmacion(p);
      return res.status(r.ok ? 200 : 502).json(r);
    }
    if (b.accion === 'reembolsar') {
      const yaDevuelto = Number(p.reembolsado || 0);
      const pendiente = redondo(Number(p.total || 0) - yaDevuelto);
      const importe = b.importe != null && b.importe !== '' ? redondo(Number(String(b.importe).replace(',', '.'))) : pendiente;
      if (!(importe > 0) && pendiente > 0) return res.status(400).json({ error: 'Pon un importe mayor que 0.' });
      if (importe > pendiente + 0.001) return res.status(400).json({ error: `Como máximo puedes devolver ${pendiente.toFixed(2).replace('.', ',')} €.` });
      const motivo = String(b.motivo || '').trim().slice(0, 120) || null;

      // 1) Dinero en Stripe (los pedidos de prueba a 0 € no tienen pago)
      let refund = null;
      if (importe > 0) {
        if (!p.stripe_pago) return res.status(400).json({ error: 'Este pedido no tiene pago en Stripe asociado. Devuélvelo desde el panel de Stripe.' });
        refund = await stripe('refunds', { payment_intent: p.stripe_pago, amount: Math.round(importe * 100), reason: 'requested_by_customer', metadata: { pedido: String(p.numero), motivo: motivo || '' } });
      }
      const total = redondo(yaDevuelto + importe);
      const completo = total >= Number(p.total || 0) - 0.001;

      // 2) Factura rectificativa (si el pedido tenía factura)
      let rect = null;
      if (p.factura && importe > 0) {
        try {
          const num = await db('rpc/siguiente_factura', { method: 'POST', body: JSON.stringify({ p_serie: 'R' }) });
          rect = { numero: num, fecha: new Date().toISOString(), importe, motivo, parcial: !completo || yaDevuelto > 0 };
        } catch (e) { console.error('rectificativa', e.message); }
      }

      // 3) Pedido
      const cuando = new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      const nota = `Reembolso de ${importe.toFixed(2).replace('.', ',')} € el ${cuando}${motivo ? ' · ' + motivo : ''}${refund ? ' · Stripe ' + refund.id : ''}`;
      const cambios = { reembolsado: total, notas: [p.notas, nota].filter(Boolean).join('\n') };
      if (completo) cambios.estado = 'reembolsado';
      if (rect) { cambios.rectificativa = rect.numero; cambios.rectificativa_fecha = rect.fecha; cambios.motivo_reembolso = motivo; }
      try { await db(`pedidos?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(cambios) }); }
      catch (e) { // sin el SQL nuevo: guardamos al menos el estado y la nota
        await db(`pedidos?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ estado: completo ? 'reembolsado' : p.estado, notas: cambios.notas }) });
      }

      // 4) Devolver unidades al stock (opcional)
      if (b.reponer && completo && !String(p.notas || '').startsWith('PRUEBA')) {
        for (const l of p.productos || []) if (l.producto_id) await db('rpc/sumar_stock', { method: 'POST', body: JSON.stringify({ p_id: l.producto_id, n: l.cantidad }) }).catch(() => {});
      }

      // 5) Correo al cliente
      let correo = { ok: false, motivo: 'No se ha pedido avisar' };
      if (b.avisar !== false && p.cliente_email) correo = await correoReembolso({ ...p, ...cambios }, importe, motivo, rect).catch(e => ({ ok: false, motivo: e.message }));
      return res.status(200).json({ ok: true, importe, completo, rectificativa: rect && rect.numero, correo, correoActivo: correoActivo() });
    }
    return res.status(400).json({ error: 'Acción no válida' });
  } catch (e) {
    console.error('admin-pedido', e);
    return res.status(500).json({ error: e.message || 'Error' });
  }
};
