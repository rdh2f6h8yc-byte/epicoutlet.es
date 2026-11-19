// POST /api/aviso-prueba  (solo administrador) → manda un aviso de prueba al iPhone
const { esAdmin } = require('./_util.js');
const { avisar } = require('./_avisos.js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  if (!(await esAdmin(req))) return res.status(401).json({ error: 'Solo el administrador' });
  let tema = '';
  try { tema = (typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}')).tema || ''; } catch (e) {}
  const r = await avisar({
    titulo: '🔔 EpicOutlet · aviso de prueba',
    mensaje: 'Así te llegarán los pedidos nuevos: número, importe, productos y cliente. Tócalo para abrir el panel.',
    url: 'https://www.epicoutlet.es/admin', etiquetas: ['bell'], prioridad: 4
  }, tema);
  return res.status(r.ok ? 200 : 502).json(r);
};
