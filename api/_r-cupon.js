// GET /api/cupon?c=CODIGO&s=subtotal → comprueba un cupón para mostrarlo en el carrito
const { validarCupon } = require('./_srv.js');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const subtotal = Math.max(0, Number(String(req.query.s || '0').replace(',', '.')) || 0);
  const r = await validarCupon(String(req.query.c || '').slice(0, 40), subtotal);
  return res.status(r.ok ? 200 : 400).json(r);
};
