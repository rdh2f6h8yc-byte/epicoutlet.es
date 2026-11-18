// GET /api/leer?url=...  → lee la ficha de un producto de un proveedor
const { UA, esAdmin, urlSegura, extraerHTML } = require('./_util.js');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!(await esAdmin(req))) return res.status(401).json({ error: 'No autorizado. Vuelve a entrar en el panel.' });
  const u = urlSegura(req.query.url);
  if (!u) return res.status(400).json({ error: 'El enlace no es válido.' });
  try {
    const r = await fetch(u.href, {
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8' }
    });
    if (!r.ok) return res.status(502).json({ error: `La web del proveedor ha respondido con un error (${r.status}). Prueba con el atajo del iPhone.` });
    const html = (await r.text()).slice(0, 3000000);
    const d = await extraerHTML(html, r.url || u.href);
    if (!d.nombre) return res.status(422).json({ error: 'No he encontrado ningún producto en esa página. Prueba con el atajo del iPhone.' });
    return res.status(200).json(d);
  } catch (e) {
    return res.status(502).json({ error: 'No he podido abrir esa página. Prueba con el atajo del iPhone.' });
  }
};
