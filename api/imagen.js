// GET /api/imagen?url=...  → descarga una foto del proveedor para guardarla en la tienda
const { UA, esAdmin, urlSegura } = require('./_util.js');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!(await esAdmin(req))) return res.status(401).json({ error: 'No autorizado' });
  const u = urlSegura(req.query.url);
  if (!u) return res.status(400).json({ error: 'Enlace no válido' });
  try {
    const r = await fetch(u.href, { redirect: 'follow', headers: { 'User-Agent': UA, Accept: 'image/*', Referer: u.origin + '/' } });
    const tipo = (r.headers.get('content-type') || '').split(';')[0].trim();
    if (!r.ok || !tipo.startsWith('image/')) return res.status(502).json({ error: 'No es una imagen' });
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 4000000) return res.status(413).json({ error: 'Imagen demasiado grande' });
    res.setHeader('Content-Type', tipo);
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(502).json({ error: 'No se ha podido descargar la imagen' });
  }
};
