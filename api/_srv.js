// Funciones del servidor para pagos y pedidos (Vercel no las publica como ruta).
// Claves secretas: SOLO en Vercel → Settings → Environment Variables, nunca en GitHub.
//   STRIPE_SECRET_KEY          sk_live_... (o sk_test_... para pruebas)
//   STRIPE_WEBHOOK_SECRET      whsec_...
//   SUPABASE_SECRET_KEY        sb_secret_... (o la antigua service_role)
const crypto = require('crypto');
const CFG = require('../config.js');

const env = (...nombres) => { for (const n of nombres) { const v = (process.env[n] || '').trim(); if (v) return v; } return ''; };
const claveSupabase = () => env('SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_SECRET');
const claveStripe = () => env('STRIPE_SECRET_KEY', 'STRIPE_SECRET', 'STRIPE_SK', 'STRIPE_API_KEY');
const secretoWebhook = () => env('STRIPE_WEBHOOK_SECRET', 'STRIPE_WEBHOOK_SIGNING_SECRET', 'STRIPE_WEBHOOK', 'STRIPE_SIGNING_SECRET');
const pagosActivos = () => !!(claveStripe() && claveSupabase() && CFG.supabaseUrl);

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
    headers: { Authorization: 'Bearer ' + claveStripe(), 'Content-Type': 'application/x-www-form-urlencoded' },
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

// Cliente con sesión iniciada en la tienda (cuentas de clientes de Supabase). Devuelve { id, email } o null.
async function usuario(req) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!t || t.length < 20) return null;
  try {
    const r = await fetch(CFG.supabaseUrl + '/auth/v1/user', { headers: { apikey: CFG.supabaseKey, Authorization: 'Bearer ' + t } });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.id ? { id: u.id, email: u.email || null } : null;
  } catch (e) { return null; }
}

// Cupones de descuento (Panel → Cupones). Se guardan en ajustes, clave 'cupones'.
async function leerCupones() {
  try { const r = await db('ajustes?clave=eq.cupones&select=valor'); return ((r && r[0] && r[0].valor) || {}).lista || []; } catch (e) { return []; }
}
async function validarCupon(codigo, subtotal) {
  const c = String(codigo || '').trim().toUpperCase();
  if (!c) return { ok: false, error: 'Escribe un código.' };
  const cup = (await leerCupones()).find(x => String(x.codigo || '').toUpperCase() === c);
  if (!cup || cup.activo === false) return { ok: false, error: 'Este código no existe o ya no está activo.' };
  if (cup.caduca && new Date(cup.caduca + 'T23:59:59+01:00') < new Date()) return { ok: false, error: 'Este código ha caducado.' };
  if (cup.max && Number(cup.usos || 0) >= Number(cup.max)) return { ok: false, error: 'Este código ya se ha usado el máximo de veces.' };
  if (cup.minimo && subtotal < Number(cup.minimo)) return { ok: false, error: `Este código es para compras desde ${Number(cup.minimo).toFixed(2).replace('.', ',')} €.` };
  let descuento = 0, envioGratis = false;
  if (cup.tipo === 'envio') envioGratis = true;
  else if (cup.tipo === 'eur') descuento = Math.min(Number(cup.valor) || 0, subtotal);
  else descuento = subtotal * Math.min(Number(cup.valor) || 0, 90) / 100;
  descuento = Math.round(descuento * 100) / 100;
  const texto = cup.tipo === 'envio' ? 'Envío gratis' : cup.tipo === 'eur' ? `−${descuento.toFixed(2).replace('.', ',')} €` : `−${Number(cup.valor)} %`;
  return { ok: true, codigo: c, descuento, envioGratis, texto, tipo: cup.tipo || 'pct', valor: Number(cup.valor) || 0, minimo: Number(cup.minimo) || 0 };
}
async function sumarUsoCupon(codigo) {
  if (!codigo) return;
  try {
    const r = await db('ajustes?clave=eq.cupones&select=valor');
    const v = (r && r[0] && r[0].valor) || { lista: [] };
    const cup = (v.lista || []).find(x => String(x.codigo).toUpperCase() === String(codigo).toUpperCase());
    if (!cup) return;
    cup.usos = Number(cup.usos || 0) + 1;
    await db('ajustes?clave=eq.cupones', { method: 'PATCH', body: JSON.stringify({ valor: v }) });
  } catch (e) {}
}

module.exports = { CFG, claveStripe, claveSupabase, secretoWebhook, db, stripe, form, firmaValida, leerCrudo, leerEnvio, pagosActivos, redondo, usuario, validarCupon, sumarUsoCupon };
