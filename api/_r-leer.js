// GET /api/leer?url=...&pagina=N
// Lee la ficha de un producto o la lista de productos de una categoría de un proveedor.
const { UA, esAdmin, urlSegura, extraerHTML, listaDesdeHTML, shopifyBase, desdeShopify, limpio } = require('./_util.js');

const H = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/json', 'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8' };

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!(await esAdmin(req))) return res.status(401).json({ error: 'No autorizado. Vuelve a entrar en el panel.' });
  const u = urlSegura(req.query.url);
  if (!u) return res.status(400).json({ error: 'El enlace no es válido.' });
  const pagina = Math.max(1, parseInt(req.query.pagina, 10) || 1);
  try {
    const r = await fetch(u.href, { redirect: 'follow', headers: H });
    if (!r.ok) return res.status(502).json({ error: `La web del proveedor ha respondido con un error (${r.status}). Prueba con el atajo del iPhone.` });
    const html = (await r.text()).slice(0, 4000000);
    const final = new URL(r.url || u.href);
    const origen = final.origin;
    const titulo = limpio(((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').split('|')[0]) || final.hostname;
    const esProducto = /\/products?\/[^/]+|\/producto\/[^/]+/.test(final.pathname);

    if (!esProducto) {
      // Categoría de una tienda Shopify: lista completa, 250 por página
      const sb = shopifyBase(html, final.href);
      if (sb) {
        const col = final.pathname.match(/\/collections\/([^/?#]+)/);
        const api = (col ? `${sb}/collections/${col[1]}` : sb) + `/products.json?limit=250&page=${pagina}`;
        try {
          const r2 = await fetch(api, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
          if (r2.ok) {
            const j = await r2.json();
            if (Array.isArray(j.products) && (j.products.length || pagina > 1)) {
              return res.status(200).json({ tipo: 'lista', completos: true, titulo, origen, url: final.href, pagina,
                hayMas: j.products.length === 250, productos: j.products.map(p => desdeShopify(p, origen)) });
            }
          }
        } catch (e) { /* probamos con la página */ }
      }
      // Otras tiendas: productos que aparecen en la página
      const l = listaDesdeHTML(html, final.href);
      if (l.productos.length >= 2) {
        return res.status(200).json({ tipo: 'lista', completos: false, titulo, origen, url: final.href, pagina,
          hayMas: !!l.siguiente, siguiente: l.siguiente, productos: l.productos });
      }
    }

    const d = await extraerHTML(html, final.href);
    if (!d.nombre) return res.status(422).json({ error: 'No he encontrado ningún producto en esa página. Prueba con el atajo del iPhone.' });
    d.tipo = 'producto';
    return res.status(200).json(d);
  } catch (e) {
    return res.status(502).json({ error: 'No he podido abrir esa página. Prueba con el atajo del iPhone.' });
  }
};
