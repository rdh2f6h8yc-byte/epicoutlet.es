// POST /api/aviso-prueba  (solo administrador) → manda una notificación de prueba a los dispositivos activados
const { esAdmin } = require('./_util.js');
const { avisar } = require('./_avisos.js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  if (!(await esAdmin(req))) return res.status(401).json({ error: 'Solo el administrador' });
  const r = await avisar({
    titulo: '🔔 Avisos activados',
    cuerpo: 'Así te llegarán los pedidos nuevos: número, importe, productos y cliente. Tócalo para abrir el pedido.',
    url: '/admin', etiqueta: 'prueba'
  }, true);
  return res.status(200).json(r);
};
