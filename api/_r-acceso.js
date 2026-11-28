// POST /api/acceso { email }  → manda al cliente el enlace para entrar en «Mi cuenta» con nuestro propio correo
// (Supabase genera el enlace; el correo sale por Resend con el diseño de la tienda, sin plantillas de Supabase).
const { CFG, claveSupabase } = require('./_srv.js');
const { enviar } = require('./_correo.js');

const recientes = new Map();   // freno simple contra abusos (por instancia)
const SITIO = (CFG.sitioUrl || 'https://www.epicoutlet.es').replace(/\/$/, '');

function correoAcceso(url, nuevo) {
  return `<!doctype html><html lang="es"><body style="margin:0;background:#F4F4F6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#16161A">
<div style="padding:24px 12px"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden">
<div style="background:#16161A;padding:18px 24px;font-size:22px;font-weight:800;color:#fff">Epic<span style="color:#FF6A00">Outlet</span><span style="font-size:13px;color:#9A9AA2">.es</span></div>
<div style="padding:26px 24px">
<h1 style="font-size:22px;margin:0 0 10px">${nuevo ? '¡Bienvenido a EpicOutlet.es!' : 'Entra en tu cuenta'}</h1>
<p style="font-size:15px;line-height:1.55;color:#3A3A40;margin:0 0 22px">${nuevo ? 'Pulsa el botón para crear tu cuenta. Desde ella podrás seguir tus pedidos y descargar tus facturas.' : 'Pulsa el botón para entrar en Mi cuenta y ver tus pedidos, el seguimiento y tus facturas. No necesitas contraseña.'}</p>
<a href="${url}" style="display:inline-block;background:#FF6A00;color:#16161A;font-weight:700;text-decoration:none;padding:14px 24px;border-radius:12px;font-size:15px">${nuevo ? 'Crear mi cuenta y entrar' : 'Entrar en mi cuenta'}</a>
<p style="font-size:13px;line-height:1.5;color:#6B6B73;margin:22px 0 0">El enlace caduca en 1 hora y solo se puede usar una vez. Ábrelo en el mismo móvil u ordenador donde lo pediste. Si no lo has pedido tú, ignora este correo.</p>
</div></div><p style="text-align:center;font-size:12px;color:#9A9AA2;margin:14px 0 0">EpicOutlet.es · contacto@epicoutlet.es</p></div></body></html>`;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b || '{}'); } catch (e) { b = {}; } }
  const email = String((b && b.email) || '').trim().toLowerCase().slice(0, 200);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: 'Escribe un correo válido.' });
  const ahora = Date.now(), ultimo = recientes.get(email) || 0;
  if (ahora - ultimo < 60000) return res.status(429).json({ error: 'Ya te hemos enviado un enlace. Espera un minuto antes de pedir otro.' });
  recientes.set(email, ahora);
  if (recientes.size > 5000) recientes.clear();

  const k = claveSupabase();
  const h = { apikey: k, 'Content-Type': 'application/json' }; if (k.startsWith('eyJ')) h.Authorization = 'Bearer ' + k;
  const origen = /^https?:\/\//.test(req.headers.origin || '') ? req.headers.origin : SITIO;
  try {
    const pedir = cuerpo => fetch(`${CFG.supabaseUrl}/auth/v1/admin/generate_link`, { method: 'POST', headers: h,
      body: JSON.stringify({ ...cuerpo, email, redirect_to: origen + '/cuenta', options: { redirect_to: origen + '/cuenta' } }) });
    let r = await pedir({ type: 'magiclink' });
    let j = await r.json().catch(() => ({}));
    if (!r.ok && (r.status === 404 || /not.?found/i.test(JSON.stringify(j)))) {
      // cliente nuevo: se crea la cuenta con una contraseña al azar que nunca usará (entra siempre por enlace)
      r = await pedir({ type: 'signup', password: require('crypto').randomBytes(24).toString('base64url') });
      j = await r.json().catch(() => ({}));
    }
    const url = j.action_link || (j.properties && j.properties.action_link);
    if (!r.ok || !url) { console.error('acceso', r.status, JSON.stringify(j).slice(0, 300)); return res.status(502).json({ error: 'No se ha podido preparar el enlace. Inténtalo de nuevo en unos minutos.' }); }
    const nuevo = !!(j.user ? !j.user.last_sign_in_at : j.last_sign_in_at == null && !j.email_confirmed_at);
    const e = await enviar({ para: email, asunto: nuevo ? 'Bienvenido a EpicOutlet.es: crea tu cuenta' : 'Tu enlace para entrar en EpicOutlet.es', html: correoAcceso(url, nuevo), texto: `Entra en tu cuenta de EpicOutlet.es: ${url}` });
    if (!e.ok) { console.error('acceso correo', e.motivo); return res.status(502).json({ error: 'No se ha podido enviar el correo. Inténtalo de nuevo en unos minutos.' }); }
    return res.status(200).json({ ok: true });
  } catch (e) { console.error('acceso', e); return res.status(500).json({ error: 'No se ha podido enviar el enlace.' }); }
};
