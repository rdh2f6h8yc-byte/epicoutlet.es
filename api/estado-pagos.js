// GET /api/estado-pagos → dice qué claves de pago encuentra el servidor (nunca muestra las claves)
const { CFG, claveStripe, claveSupabase, secretoWebhook } = require('./_srv.js');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const sk = claveStripe(), sb = claveSupabase(), wh = secretoWebhook();
  const estado = {
    stripe: sk ? (sk.startsWith('sk_live_') ? 'ok (modo real)' : sk.startsWith('sk_test_') ? 'ok (modo prueba)' : sk.startsWith('rk_') ? 'ok (clave restringida)' : 'clave rara: debe empezar por sk_test_ o sk_live_') : 'FALTA STRIPE_SECRET_KEY',
    webhook: wh ? (wh.startsWith('whsec_') ? 'ok' : 'clave rara: debe empezar por whsec_') : 'FALTA STRIPE_WEBHOOK_SECRET',
    supabase: sb ? (sb.startsWith('sb_secret_') || sb.startsWith('eyJ') ? 'ok' : sb.startsWith('sb_publishable_') ? 'ERROR: has puesto la publishable, hace falta la Secret key (sb_secret_...)' : 'clave rara') : 'FALTA SUPABASE_SECRET_KEY',
    supabaseUrl: CFG.supabaseUrl ? 'ok' : 'falta en config.js'
  };
  if (sb && CFG.supabaseUrl) {
    try {
      const h = { apikey: sb }; if (sb.startsWith('eyJ')) h.Authorization = 'Bearer ' + sb;
      const r = await fetch(CFG.supabaseUrl + '/rest/v1/pedidos?select=id&limit=1', { headers: h });
      estado.tablaPedidos = r.ok ? 'ok' : r.status === 404 ? 'FALTA: ejecuta supabase/pedidos.sql' : r.status === 401 ? 'la Secret key de Supabase no es válida' : 'error ' + r.status;
    } catch (e) { estado.tablaPedidos = 'no se puede conectar con Supabase'; }
  }
  res.status(200).json(estado);
};
