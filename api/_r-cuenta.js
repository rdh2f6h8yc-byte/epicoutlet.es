// POST /api/cuenta { accion: 'borrar' }  → el cliente borra su cuenta (sus pedidos se conservan por obligación fiscal)
const { CFG, claveSupabase, usuario, db } = require('./_srv.js');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  const u = await usuario(req);
  if (!u) return res.status(401).json({ error: 'Inicia sesión de nuevo' });
  let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b || '{}'); } catch (e) { b = {}; } }
  if (b.accion !== 'borrar') return res.status(400).json({ error: 'Acción no válida' });
  try {
    await db(`perfiles?id=eq.${u.id}`, { method: 'DELETE' }).catch(() => {});
    const k = claveSupabase();
    const h = { apikey: k }; if (k.startsWith('eyJ')) h.Authorization = 'Bearer ' + k;
    const r = await fetch(`${CFG.supabaseUrl}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: h });
    if (!r.ok) throw new Error('No se ha podido borrar la cuenta (' + r.status + ')');
    return res.status(200).json({ ok: true });
  } catch (e) { return res.status(500).json({ error: e.message }); }
};
