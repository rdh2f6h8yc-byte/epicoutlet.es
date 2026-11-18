// Funciones del servidor para pagos y pedidos (Vercel no las publica como ruta).
// Claves secretas: SOLO en Vercel → Settings → Environment Variables, nunca en GitHub.
//   STRIPE_SECRET_KEY          sk_live_... (o sk_test_... para pruebas)
//   STRIPE_WEBHOOK_SECRET      whsec_...
//   SUPABASE_SECRET_KEY        sb_secret_... (o la antigua service_role)
const crypto = require('crypto');
const CFG = require('../config.js');

const claveSupabase = () => process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const pagosActivos = () => !!(process.env.STRIPE_SECRET_KEY && claveSupabase() && CFG.supabaseUrl);

// Base de datos con permisos de servidor
async function db(ruta, opt = {}) {
  const k = claveSupabase();
  const headers = { apikey: k, 'Content-Type': 'application/json', ...(opt.headers || {}) };
  if (k.startsWith('eyJ')) headers.Authorization = 'Bearer ' + k;
  const r = await fetch(CFG.supabaseUrl + '/rest/v1/' + ruta, { ...opt, headers });
  const txt = await r.text();
  let j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) {}
  if (!r.ok) throw new Error((j && (j.message || j.error)) || 'Supabase ' + r.status);
  return j;
}

// Stripe (sin librerías: API directa)
function form(obj, prefijo = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    const clave = prefijo ? `${prefijo}[${k}]` : k;
    if (typeof v === 'object') form(v, clave, out); else out.append(clave, String(v));
  }
  return out;
}
async function stripe(ruta, params) {
  const r = await fetch('https://api.stripe.com/v1/' + ruta, {
    method: params ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params ? form(params) : undefined
  });
  const j = await r.json();
  if (!r.ok) throw new Error((j.error && j.error.message) || 'Stripe ' + r.status);
  return j;
}

// Comprueba que el aviso viene de verdad de Stripe
function firmaValida(raw, cabecera, secreto) {
  if (!cabecera || !secreto) return false;
  const partes = {}; String(cabecera).split(',').forEach(p => { const [k, v] = p.split('='); (partes[k] = partes[k] || []).push(v); });
  const t = (partes.t || [])[0];
  if (!t || Math.abs(Date.now() / 1000 - Number(t)) > 600) return false;
  const esperada = crypto.createHmac('sha256', secreto).update(`${t}.${raw.toString('utf8')}`).digest('hex');
  return (partes.v1 || []).some(v => v && v.length === esperada.length && crypto.timingSafeEqual(Buffer.from(v), Buffer.from(esperada)));
}

async function leerCrudo(req) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  const trozos = [];
  for await (const c of req) trozos.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(trozos);
}

async function leerEnvio() {
  try {
    const r = await db('ajustes?clave=eq.envio&select=valor');
    const v = (r && r[0] && r[0].valor) || {};
    return { precio: Number(v.precio) || 0, gratisDesde: v.gratisDesde != null && v.gratisDesde !== '' ? Number(v.gratisDesde) : null };
  } catch (e) { return { precio: 0, gratisDesde: null }; }
}

const redondo = n => Math.round(n * 100) / 100;

module.exports = { CFG, db, stripe, form, firmaValida, leerCrudo, leerEnvio, pagosActivos, redondo };
