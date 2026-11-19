// Notificaciones push al iPhone (Web Push con VAPID), sin servicios externos.
// El panel /admin, añadido a la pantalla de inicio, se suscribe y guarda la suscripción
// en la tabla ajustes (clave 'avisos'), que solo lee el administrador.
const crypto = require('crypto');
const { db, CFG } = require('./_srv.js');

const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deB64u = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// RFC 8291 (aes128gcm). salt y clave efímera se pueden fijar solo para pruebas.
function cifrar(texto, p256dh, auth, prueba) {
  const uaPub = deB64u(p256dh), authSec = deB64u(auth);
  const ecdh = crypto.createECDH('prime256v1');
  if (prueba && prueba.priv) ecdh.setPrivateKey(deB64u(prueba.priv)); else ecdh.generateKeys();
  const asPub = ecdh.getPublicKey();
  const compartido = ecdh.computeSecret(uaPub);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', compartido, authSec, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32));
  const salt = prueba && prueba.salt ? deB64u(prueba.salt) : crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const cifrado = Buffer.concat([c.update(Buffer.concat([Buffer.from(texto), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, cifrado]);
}

function cabeceraVapid(endpoint, v) {
  const clave = crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: v.d, x: v.x, y: v.y }, format: 'jwk' });
  const cab = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const sujeto = 'mailto:suportepicoutlet@gmail.com';
  const cuerpo = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: sujeto }));
  const firma = crypto.sign('sha256', Buffer.from(cab + '.' + cuerpo), { key: clave, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${cab}.${cuerpo}.${b64u(firma)}, k=${v.pub}`;
}

async function enviarUno(sub, mensaje, v) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(sub.endpoint, {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high', Authorization: cabeceraVapid(sub.endpoint, v) },
      body: cifrar(JSON.stringify(mensaje), sub.p256dh, sub.auth)
    });
    return { dispositivo: sub.dispositivo || '', estado: r.status, texto: r.ok ? '' : (await r.text()).slice(0, 160), endpoint: sub.endpoint };
  } catch (e) { return { dispositivo: sub.dispositivo || '', estado: 0, texto: e.name === 'AbortError' ? 'tiempo agotado' : String(e.message), endpoint: sub.endpoint }; }
  finally { clearTimeout(t); }
}

async function leerAvisos() {
  try { const r = await db('ajustes?clave=eq.avisos&select=valor'); return (r && r[0] && r[0].valor) || null; } catch (e) { return null; }
}

// mensaje: { titulo, cuerpo, url, etiqueta }.  forzar = enviar aunque estén desactivados (prueba)
async function avisar(m, forzar) {
  const av = await leerAvisos();
  if (!av || !av.vapid || !Array.isArray(av.subs) || !av.subs.length) return { ok: false, motivo: 'No hay ningún dispositivo activado', resultados: [] };
  if (av.activos === false && !forzar) return { ok: false, motivo: 'Avisos desactivados', resultados: [] };
  const mensaje = { title: String(m.titulo || 'EpicOutlet').slice(0, 120), body: String(m.cuerpo || '').slice(0, 900), url: m.url || '/admin', tag: m.etiqueta || '' };
  const resultados = await Promise.all(av.subs.map(s => enviarUno(s, mensaje, av.vapid)));
  const muertos = resultados.filter(r => r.estado === 404 || r.estado === 410).map(r => r.endpoint);
  if (muertos.length) {
    const nuevo = { ...av, subs: av.subs.filter(s => !muertos.includes(s.endpoint)) };
    await db('ajustes?clave=eq.avisos', { method: 'PATCH', body: JSON.stringify({ valor: nuevo }) }).catch(() => {});
  }
  const enviados = resultados.filter(r => r.estado >= 200 && r.estado < 300).length;
  return { ok: enviados > 0, enviados, resultados: resultados.map(({ endpoint, ...r }) => r) };
}

const eur = n => Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

function avisoPedido(p) {
  const prueba = String(p.notas || '').startsWith('PRUEBA');
  const lineas = (p.productos || []).slice(0, 3).map(l => `${l.cantidad > 1 ? l.cantidad + ' × ' : ''}${String(l.nombre || 'Producto').slice(0, 70)}`);
  if ((p.productos || []).length > 3) lineas.push(`y ${p.productos.length - 3} más`);
  const d = p.direccion || {};
  const quien = [p.cliente_nombre, d.city].filter(Boolean).join(' · ');
  return {
    titulo: `${prueba ? '🧪 Prueba · ' : '🛒 '}Pedido #${p.numero} · ${eur(p.total)}`,
    cuerpo: [lineas.join('\n'), quien].filter(Boolean).join('\n'),
    url: `/admin#pedido=${p.id}`,
    etiqueta: 'pedido-' + p.numero
  };
}

module.exports = { avisar, avisoPedido, cifrar, cabeceraVapid };
