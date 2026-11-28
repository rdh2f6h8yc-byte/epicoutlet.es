// GET /api/factura?id=<pedido>&tipo=factura|rectificativa  → PDF
// Lo pueden descargar el administrador o el propio cliente con su cuenta.
const { db, usuario } = require('./_srv.js');
const { esAdmin } = require('./_util.js');
const { facturaPDF } = require('./_factura.js');
const { empresaYIva } = require('./_correo.js');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const id = String(req.query.id || '').replace(/[^a-f0-9-]/gi, '');
  if (!id) return res.status(400).json({ error: 'Falta el pedido' });
  const [p] = await db(`pedidos?id=eq.${id}`).catch(() => []);
  if (!p) return res.status(404).json({ error: 'Pedido no encontrado' });
  let permitido = await esAdmin(req);
  if (!permitido) {
    const u = await usuario(req);
    permitido = !!u && (p.user_id === u.id || (u.email && String(p.cliente_email || '').toLowerCase() === u.email.toLowerCase()));
  }
  if (!permitido) return res.status(401).json({ error: 'No autorizado' });
  const rect = req.query.tipo === 'rectificativa';
  if (rect ? !p.rectificativa : !p.factura) return res.status(404).json({ error: 'Este pedido no tiene factura todavía' });
  const { empresa, iva } = await empresaYIva();
  const opciones = { empresa, iva };
  if (rect) opciones.rectificativa = { numero: p.rectificativa, fecha: p.rectificativa_fecha, importe: Number(p.reembolsado), motivo: p.motivo_reembolso, parcial: Number(p.reembolsado) < Number(p.total) - 0.001 };
  const pdf = facturaPDF(p, opciones);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${rect ? 'Factura-rectificativa-' + p.rectificativa : 'Factura-' + p.factura}.pdf"`);
  return res.status(200).send(pdf);
};
