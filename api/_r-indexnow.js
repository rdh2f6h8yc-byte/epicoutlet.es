// POST /api/indexnow  { urls: [...] }  → avisa a Bing, Yandex y otros buscadores de páginas nuevas o cambiadas
// (Google lee el sitemap.xml por su cuenta; para Google, envía el sitemap una vez en Search Console)
const { esAdmin } = require('./_util.js');
const CFG = require('../config.js');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  if (!(await esAdmin(req))) return res.status(401).json({ error: 'No autorizado' });
  if (!CFG.indexNowKey || !CFG.sitioUrl) return res.status(200).json({ enviado: 0 });
  let body = req.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const sitio = new URL(CFG.sitioUrl);
  const urls = [...new Set((Array.isArray(body && body.urls) ? body.urls : []).map(String))]
    .filter(u => { try { return new URL(u).host === sitio.host; } catch (e) { return false; } }).slice(0, 10000);
  if (!urls.length) return res.status(200).json({ enviado: 0 });
  urls.push(sitio.origin + '/sitemap.xml');
  try {
    const r = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: sitio.host, key: CFG.indexNowKey, keyLocation: `${sitio.origin}/${CFG.indexNowKey}.txt`, urlList: urls })
    });
    return res.status(200).json({ enviado: urls.length, estado: r.status });
  } catch (e) { return res.status(200).json({ enviado: 0, error: 'No se ha podido avisar' }); }
};
