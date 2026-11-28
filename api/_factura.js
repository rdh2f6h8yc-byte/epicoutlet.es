// Facturas en PDF (sin librerías). Genera la factura de un pedido o su factura rectificativa.
// Fuentes estándar del PDF (Helvetica) con codificación WinAnsi: admite tildes, ñ, ç y €.

const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
const WINANSI = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99 };

// Texto → bytes WinAnsi (lo que no existe en esa tabla se aproxima: ș→s, ă→a…)
function aBytes(t) {
  const out = [];
  for (const ch of String(t == null ? '' : t)) {
    const c = ch.codePointAt(0);
    if (WINANSI[ch]) out.push(WINANSI[ch]);
    else if (c >= 32 && c <= 126) out.push(c);
    else if (c >= 160 && c <= 255) out.push(c);
    else if (c === 10 || c === 9) out.push(32);
    else {
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      const b = base.codePointAt(0);
      out.push(base && b >= 32 && b <= 255 ? b : 63);
    }
  }
  return out;
}
function ancho(t, tam, negrita) {
  const tabla = negrita ? W_BOLD : W_REG;
  let w = 0;
  for (const b of aBytes(t)) {
    let ref = b;
    if (b >= 192) { const base = String.fromCharCode(b).normalize('NFD')[0].charCodeAt(0); ref = base >= 32 && base <= 126 ? base : 110; }
    w += b === 0x80 ? 556 : (ref >= 32 && ref <= 126 ? tabla[ref - 32] : 556);
  }
  return w * tam / 1000;
}
function partir(t, tam, max, negrita) {
  const palabras = String(t || '').split(/\s+/).filter(Boolean), lineas = [];
  let l = '';
  for (const p of palabras) {
    const prueba = l ? l + ' ' + p : p;
    if (ancho(prueba, tam, negrita) <= max) l = prueba;
    else { if (l) lineas.push(l); l = p; while (ancho(l, tam, negrita) > max && l.length > 4) { let k = l.length - 1; while (k > 1 && ancho(l.slice(0, k), tam, negrita) > max) k--; lineas.push(l.slice(0, k)); l = l.slice(k); } }
  }
  if (l) lineas.push(l);
  return lineas.length ? lineas : [''];
}
const esc = bytes => bytes.map(b => (b === 40 || b === 41 || b === 92) ? [92, b] : [b]).flat();

class Lienzo {
  constructor() { this.paginas = []; this.nueva(); }
  nueva() { this.ops = []; this.paginas.push(this.ops); }
  texto(x, y, t, tam = 10, negrita = false, color = [0.09, 0.09, 0.1]) {
    this.ops.push({ x, y, t, tam, negrita, color });
  }
  derecha(xFin, y, t, tam = 10, negrita = false, color) { this.texto(xFin - ancho(t, tam, negrita), y, t, tam, negrita, color); }
  rect(x, y, w, h, color) { this.ops.push({ rect: [x, y, w, h], color }); }
  linea(x1, y1, x2, y2, color = [0.85, 0.85, 0.87], grosor = 0.8) { this.ops.push({ linea: [x1, y1, x2, y2], color, grosor }); }
  pdf() {
    const objs = [];
    const add = s => { objs.push(s); return objs.length; };
    const catalogo = add(null), paginas = add(null);
    const fReg = add(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'));
    const fBold = add(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'));
    const kids = [];
    for (const ops of this.paginas) {
      const partes = [];
      for (const o of ops) {
        const c = (o.color || [0, 0, 0]).map(v => v.toFixed(3)).join(' ');
        if (o.rect) partes.push(Buffer.from(`${c} rg ${o.rect.map(v => v.toFixed(2)).join(' ')} re f\n`, 'latin1'));
        else if (o.linea) partes.push(Buffer.from(`${c} RG ${o.grosor} w ${o.linea[0].toFixed(2)} ${o.linea[1].toFixed(2)} m ${o.linea[2].toFixed(2)} ${o.linea[3].toFixed(2)} l S\n`, 'latin1'));
        else {
          partes.push(Buffer.from(`BT ${c} rg /${o.negrita ? 'F2' : 'F1'} ${o.tam} Tf ${o.x.toFixed(2)} ${o.y.toFixed(2)} Td (`, 'latin1'));
          partes.push(Buffer.from(esc(aBytes(o.t))));
          partes.push(Buffer.from(') Tj ET\n', 'latin1'));
        }
      }
      const cuerpo = Buffer.concat(partes);
      const cont = add(Buffer.concat([Buffer.from(`<< /Length ${cuerpo.length} >>\nstream\n`), cuerpo, Buffer.from('\nendstream')]));
      kids.push(add(Buffer.from(`<< /Type /Page /Parent ${paginas} 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 ${fReg} 0 R /F2 ${fBold} 0 R >> >> /Contents ${cont} 0 R >>`)));
    }
    objs[catalogo - 1] = Buffer.from(`<< /Type /Catalog /Pages ${paginas} 0 R >>`);
    objs[paginas - 1] = Buffer.from(`<< /Type /Pages /Kids [${kids.map(k => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`);
    const trozos = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
    const offsets = []; let pos = trozos[0].length;
    objs.forEach((o, i) => { offsets.push(pos); const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from('\nendobj\n')]); trozos.push(b); pos += b.length; });
    const xref = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`, ...offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n')].join('');
    trozos.push(Buffer.from(xref + `trailer\n<< /Size ${objs.length + 1} /Root ${catalogo} 0 R >>\nstartxref\n${pos}\n%%EOF\n`, 'latin1'));
    return Buffer.concat(trozos);
  }
}

const eur = n => (Number(n) || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const r2 = n => Math.round(n * 100) / 100;
const fechaES = d => new Date(d || Date.now()).toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric' });

// Empresa emisora (Ajustes → Datos de facturación del panel; si faltan, los de la web)
const EMPRESA_DEF = { nombre: 'EpicOutlet.es', titular: 'EPIC OUTLET SL', nif: 'Y0401739N', direccion: 'Zăvoi, Caraș-Severin, 327435, Rumanía', email: 'contacto@epicoutlet.es', web: 'www.epicoutlet.es' };

/**
 * pedido: fila de la tabla pedidos.
 * opciones: { iva: 21, empresa: {...}, rectificativa: { numero, fecha, importe (con IVA, positivo), motivo } }
 */
function facturaPDF(pedido, opciones = {}) {
  const E = { ...EMPRESA_DEF, ...(opciones.empresa || {}) };
  const iva = Number(opciones.iva) || 21, f = 1 + iva / 100;
  const R = opciones.rectificativa || null;
  const signo = R ? -1 : 1;
  const L = new Lienzo();
  const naranja = [1, 0.416, 0], gris = [0.42, 0.42, 0.46], negro = [0.09, 0.09, 0.1];
  const X0 = 48, X1 = 547;
  let y = 790;

  // Cabecera
  L.texto(X0, y, 'Epic', 22, true, negro); L.texto(X0 + ancho('Epic', 22, true), y, 'Outlet', 22, true, naranja);
  L.texto(X0 + ancho('EpicOutlet', 22, true) + 2, y, '.es', 12, true, gris);
  L.derecha(X1, y + 2, R ? 'FACTURA RECTIFICATIVA' : 'FACTURA', R ? 14 : 18, true, negro);
  y -= 22;
  L.derecha(X1, y, `Nº ${R ? R.numero : pedido.factura}`, 10, true);
  L.derecha(X1, y - 14, `Fecha: ${fechaES(R ? R.fecha : (pedido.factura_fecha || pedido.pagado))}`, 9, false, gris);
  L.derecha(X1, y - 27, `Pedido #${pedido.numero}`, 9, false, gris);
  if (R) L.derecha(X1, y - 40, `Rectifica la factura ${pedido.factura || '—'}`, 9, false, gris);

  // Emisor
  L.texto(X0, y, E.titular, 10, true);
  let ye = y - 14;
  for (const t of [`NIF: ${E.nif}`, ...partir(E.direccion, 9, 250), E.email, E.web]) { L.texto(X0, ye, t, 9, false, gris); ye -= 12; }
  y = Math.min(ye, y - 50) - 18;

  // Cliente
  L.rect(X0, y - 64, X1 - X0, 74, [0.965, 0.965, 0.97]);
  L.texto(X0 + 12, y - 4, 'CLIENTE', 8, true, gris);
  const d = pedido.direccion || {};
  const dirL = [pedido.cliente_nombre || '', [d.line1, d.line2].filter(Boolean).join(', '), [d.postal_code, d.city, d.state].filter(Boolean).join(' '), d.country === 'ES' || !d.country ? 'España' : d.country].filter(Boolean);
  let yc = y - 18;
  dirL.slice(0, 4).forEach((t, i) => { L.texto(X0 + 12, yc, partir(t, 9.5, 300, i === 0)[0], 9.5, i === 0); yc -= 12; });
  if (pedido.cliente_email) L.derecha(X1 - 12, y - 18, pedido.cliente_email, 9, false, gris);
  if (pedido.cliente_telefono) L.derecha(X1 - 12, y - 30, pedido.cliente_telefono, 9, false, gris);
  y -= 92;

  // Tabla de conceptos
  const cDesc = X0 + 8, cCant = 352, cPU = 452, cImp = X1 - 8;
  L.rect(X0, y - 6, X1 - X0, 20, negro);
  L.texto(cDesc, y, 'Descripción', 8.5, true, [1, 1, 1]);
  L.derecha(cCant, y, 'Cant.', 8.5, true, [1, 1, 1]);
  L.derecha(cPU, y, 'Precio sin IVA', 8.5, true, [1, 1, 1]);
  L.derecha(cImp, y, 'Importe sin IVA', 8.5, true, [1, 1, 1]);
  y -= 24;

  const filas = [];
  if (R && R.parcial) filas.push({ desc: `Devolución parcial del pedido #${pedido.numero}${R.motivo ? ' · ' + R.motivo : ''}`, cant: 1, total: R.importe });
  else {
    for (const l of pedido.productos || []) filas.push({ desc: l.nombre, cant: l.cantidad, total: Number(l.precio) * l.cantidad });
    if (Number(pedido.envio) > 0) filas.push({ desc: 'Gastos de envío', cant: 1, total: Number(pedido.envio) });
    if (Number(pedido.descuento) > 0) filas.push({ desc: `Descuento${pedido.cupon ? ' (cupón ' + pedido.cupon + ')' : ''}`, cant: 1, total: -Number(pedido.descuento) });
  }
  for (const fi of filas) {
    if (y < 150) { L.nueva(); y = 790; }
    const base = r2(fi.total / f) * signo;
    const lineas = partir(fi.desc, 9, cCant - cDesc - 40);
    lineas.slice(0, 3).forEach((t, i) => L.texto(cDesc, y - i * 11, t, 9));
    L.derecha(cCant, y, String(fi.cant * (fi.cant ? 1 : 0)), 9);
    L.derecha(cPU, y, eur(r2(fi.total / f / (fi.cant || 1)) * signo), 9);
    L.derecha(cImp, y, eur(base), 9);
    y -= Math.min(lineas.length, 3) * 11 + 8;
    L.linea(X0, y + 4, X1, y + 4);
    y -= 6;
  }

  // Totales (a partir del total con IVA, para que cuadre con lo cobrado)
  const totalConIva = R ? R.importe : (Number(pedido.total) || filas.reduce((a, b) => a + b.total, 0));
  const total = r2(totalConIva) * signo, baseT = r2(total / f), cuota = r2(total - baseT);
  if (y < 160) { L.nueva(); y = 790; }
  y -= 8;
  const xt = 340;
  L.texto(xt, y, 'Base imponible', 9.5, false, gris); L.derecha(cImp, y, eur(baseT), 9.5); y -= 15;
  L.texto(xt, y, `IVA (${iva} %)`, 9.5, false, gris); L.derecha(cImp, y, eur(cuota), 9.5); y -= 10;
  L.linea(xt, y, X1, y, negro, 1); y -= 18;
  L.texto(xt, y, R ? 'TOTAL A DEVOLVER' : 'TOTAL', 12, true); L.derecha(cImp, y, eur(R ? -total : total), 12, true, R ? negro : naranja);
  y -= 30;

  // Pie
  const notas = R
    ? [`Factura rectificativa por devolución${R.motivo ? ' (' + R.motivo + ')' : ''}. El importe se ha reembolsado en el mismo método de pago del pedido.`]
    : [`Pagado con tarjeta u otro método de pago electrónico a través de Stripe el ${fechaES(pedido.pagado)}.`, 'Dispones de 14 días naturales desde la entrega para devolver el producto. Más información en www.epicoutlet.es/info/devoluciones'];
  for (const n of notas) for (const t of partir(n, 8.5, X1 - X0)) { L.texto(X0, y, t, 8.5, false, gris); y -= 11; }
  L.linea(X0, 60, X1, 60);
  L.texto(X0, 46, `${E.titular} · NIF ${E.nif} · ${E.email}`, 8, false, gris);
  L.derecha(X1, 46, 'Gracias por tu compra', 8, true, naranja);
  return L.pdf();
}

module.exports = { facturaPDF, EMPRESA_DEF, Lienzo, ancho, partir };
