// GET /api/pedido?s=cs_...  → número y estado del pedido, para la página de "gracias"
const { db, pagosActivos } = require('./_srv.js');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const s = String(req.query.s || '');
  if (!pagosActivos() || !/^cs_[A-Za-z0-9_]+$/.test(s)) return res.status(400).json({ error: 'Pedido no válido' });
  try {
    const r = await db(`pedidos?stripe_session=eq.${s}&select=numero,estado,total`);
    if (!r || !r.length) return res.status(404).json({ error: 'Pedido no encontrado' });
    return res.status(200).json(r[0]);
  } catch (e) { return res.status(500).json({ error: 'Error' }); }
};
