// Funciones pequeñas de la tienda agrupadas en una sola (el plan gratuito de Vercel admite pocas).
// Las direcciones de siempre (/api/pedido, /api/cupon…) llegan aquí por vercel.json.
const RUTAS = {
  pedido: require('./_r-pedido.js'),
  cupon: require('./_r-cupon.js'),
  factura: require('./_r-factura.js'),
  'estado-pagos': require('./_r-estado-pagos.js'),
  cuenta: require('./_r-cuenta.js'),
  acceso: require('./_r-acceso.js')
};
module.exports = (req, res) => {
  const f = RUTAS[String((req.query && req.query.a) || '')];
  if (!f) return res.status(404).json({ error: 'No encontrado' });
  return f(req, res);
};
