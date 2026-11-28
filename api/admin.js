// Funciones del panel agrupadas en una sola. Cada una comprueba por su cuenta que eres administrador.
const RUTAS = {
  'aviso-prueba': require('./_r-aviso-prueba.js'),
  indexnow: require('./_r-indexnow.js'),
  'admin-pedido': require('./_r-admin-pedido.js'),
  imagen: require('./_r-imagen.js'),
  leer: require('./_r-leer.js')
};
module.exports = (req, res) => {
  const f = RUTAS[String((req.query && req.query.a) || '')];
  if (!f) return res.status(404).json({ error: 'No encontrado' });
  return f(req, res);
};
