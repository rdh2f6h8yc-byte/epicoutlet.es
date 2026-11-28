/* =====================================================================
   EpicOutlet · Panel v2: resumen, clientes, cupones, facturas, reembolsos,
   correos, cambios en bloque e importación automática.
   Usa las variables y funciones del script principal (sb, session, PEDIDOS, PRODS…).
   ===================================================================== */

let NEG = { comisionPct: 1.5, comisionFija: 0.25, envioProveedor: 0 };   // para el beneficio real
let EMP = {};                                                             // datos de facturación
let CUPONES = [];                                                         // [{codigo, tipo, valor, minimo, caduca, max, usos, activo}]
let AUTOIMP = [];                                                         // [{url, titulo, coleccion, estado, stock, publicar, fotos}]
let SEL = new Set();                                                      // productos seleccionados (cambios en bloque)
let busCli = '', cliAbierto = null, periodoRes = 30;

async function cargarV2() {
  try {
    const { data } = await sb.from('ajustes').select('clave,valor').in('clave', ['negocio', 'empresa', 'cupones', 'autoimport']);
    for (const r of data || []) {
      if (r.clave === 'negocio') NEG = { ...NEG, ...r.valor };
      if (r.clave === 'empresa') EMP = r.valor || {};
      if (r.clave === 'cupones') CUPONES = (r.valor && r.valor.lista) || [];
      if (r.clave === 'autoimport') AUTOIMP = (r.valor && r.valor.lista) || [];
    }
  } catch (e) {}
}
async function guardarClave(clave, valor) {
  const { error } = await sb.from('ajustes').upsert({ clave, valor });
  if (error) throw error;
}
async function apiPanel(ruta, cuerpo) {
  const r = await fetch(ruta, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token }, body: JSON.stringify(cuerpo || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || j.motivo || ('Error ' + r.status));
  return j;
}
async function abrirPDF(id, tipo) {
  const w = window.open('', '_blank');
  try {
    const r = await fetch(`/api/factura?id=${encodeURIComponent(id)}&tipo=${tipo || 'factura'}`, { headers: { Authorization: 'Bearer ' + session.access_token } });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'No disponible');
    const url = URL.createObjectURL(await r.blob());
    if (w) w.location = url; else location.href = url;
  } catch (e) { if (w) w.close(); toast(e.message); }
}

/* ---------- Cálculos de dinero ---------- */
const VENDIDO = ['pagado', 'pedido_proveedor', 'enviado', 'entregado', 'reembolsado'];
const esPrueba = p => String(p.notas || '').startsWith('PRUEBA');
function cuentasPedido(p) {
  const ivaF = 1 + (Number(AJ.iva) || 21) / 100;
  const cobrado = Number(p.total || 0) - Number(p.reembolsado || 0);
  let coste = 0, sinCoste = false;
  if (p.estado !== 'reembolsado') for (const l of p.productos || []) { const c = costeDe(l.producto_id); if (c == null) sinCoste = true; else coste += c * l.cantidad; }
  const costeNeto = AJ.costeConIva ? coste / ivaF : coste;
  const comision = Number(p.total) > 0 ? Number(p.total) * NEG.comisionPct / 100 + NEG.comisionFija : 0;   // Stripe no devuelve su comisión
  const envioProv = p.estado === 'reembolsado' ? 0 : Number(NEG.envioProveedor) || 0;
  const beneficio = cobrado / ivaF - costeNeto - comision - envioProv;
  return { cobrado, coste, comision, envioProv, beneficio, sinCoste };
}

/* ---------- RESUMEN ---------- */
function pintarResumen() {
  const ahora = new Date(), hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  const ini = new Date(hoy); ini.setDate(ini.getDate() - (periodoRes - 1));
  const mesIni = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
  const vend = PEDIDOS.filter(p => VENDIDO.includes(p.estado) && !esPrueba(p));
  const fechaP = p => new Date(p.pagado || p.creado);
  const sumar = arr => arr.reduce((a, p) => { const c = cuentasPedido(p); a.ventas += c.cobrado; a.benef += c.beneficio; a.n++; if (c.sinCoste) a.incompleto = true; return a; }, { ventas: 0, benef: 0, n: 0, incompleto: false });
  const dHoy = sumar(vend.filter(p => fechaP(p) >= hoy)), dMes = sumar(vend.filter(p => fechaP(p) >= mesIni)), dPer = sumar(vend.filter(p => fechaP(p) >= ini));
  // Ventas por día
  const dias = [];
  for (let i = 0; i < periodoRes; i++) { const d = new Date(ini); d.setDate(d.getDate() + i); dias.push({ d, v: 0 }); }
  vend.forEach(p => { const f = fechaP(p); if (f >= ini) { const k = Math.floor((new Date(f.getFullYear(), f.getMonth(), f.getDate()) - ini) / 864e5); if (dias[k]) dias[k].v += cuentasPedido(p).cobrado; } });
  const max = Math.max(1, ...dias.map(x => x.v));
  const W = 600, H = 140, bw = W / dias.length;
  const barras = dias.map((x, i) => `<rect x="${(i * bw + 1).toFixed(1)}" y="${(H - (x.v / max) * (H - 6)).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${((x.v / max) * (H - 6)).toFixed(1)}" rx="2" fill="${x.v ? 'var(--brand)' : '#E7E7EA'}"><title>${x.d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}: ${eur(x.v)}</title></rect>`).join('');
  // Más vendidos
  const top = {};
  vend.filter(p => fechaP(p) >= ini && p.estado !== 'reembolsado').forEach(p => (p.productos || []).forEach(l => { const k = l.producto_id || l.nombre; top[k] = top[k] || { nombre: l.nombre, imagen: l.imagen, n: 0, eur: 0 }; top[k].n += l.cantidad; top[k].eur += l.precio * l.cantidad; }));
  const topL = Object.values(top).sort((a, b) => b.n - a.n || b.eur - a.eur).slice(0, 5);
  // Pendientes y atascados
  const h = 3600e3;
  const porPedir = PEDIDOS.filter(p => p.estado === 'pagado');
  const atascados = PEDIDOS.filter(p => (p.estado === 'pagado' && Date.now() - fechaP(p) > 24 * h) || (p.estado === 'pedido_proveedor' && !p.seguimiento && Date.now() - new Date(p.actualizado || p.pagado) > 4 * 24 * h));
  const sinSeg = PEDIDOS.filter(p => p.estado === 'pedido_proveedor');
  const nCli = new Set(vend.map(p => String(p.cliente_email || '').toLowerCase()).filter(Boolean)).size;
  const kpi = (t, v, s, color) => `<div class="card" style="padding:14px 16px;margin:0"><div class="small">${t}</div><div style="font:700 24px/1.2 var(--head,inherit);margin-top:4px;${color ? 'color:' + color : ''}">${v}</div>${s ? `<div class="small">${s}</div>` : ''}</div>`;
  $('#app').innerHTML = `
    <div class="row" style="justify-content:space-between;margin-bottom:12px">
      <div><h1 style="font-size:26px">Resumen</h1><div class="small">Sin contar pedidos de prueba. Beneficio después de IVA, coste del proveedor, comisión de Stripe${NEG.envioProveedor ? ' y envío del proveedor' : ''}.</div></div>
      <select class="in" id="periodo" style="flex:0 0 150px"><option value="7">7 días</option><option value="30">30 días</option><option value="90">90 días</option></select>
    </div>
    ${atascados.length ? `<div class="msg err" style="margin-bottom:12px">⚠️ <strong>${atascados.length} pedido${atascados.length > 1 ? 's' : ''} atascado${atascados.length > 1 ? 's' : ''}</strong>: ${atascados.map(p => `<a href="#" data-ped="${p.id}" style="font-weight:700">#${p.numero}</a>`).join(', ')} (más de 24 h sin pedir al proveedor o más de 4 días sin seguimiento).</div>` : ''}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px">
      ${kpi('Hoy', eur(dHoy.ventas), `${dHoy.n} pedido${dHoy.n === 1 ? '' : 's'}`)}
      ${kpi('Este mes', eur(dMes.ventas), `${dMes.n} pedido${dMes.n === 1 ? '' : 's'}`)}
      ${kpi(`Beneficio ${periodoRes} días`, eur(dPer.benef), dPer.incompleto ? 'algún producto sin coste' : `${dPer.n ? Math.round(dPer.benef / (dPer.ventas / (1 + AJ.iva / 100) || 1) * 100) : 0} % de margen`, dPer.benef >= 0 ? 'var(--ok)' : 'var(--err)')}
      ${kpi('Ticket medio', eur(dPer.n ? dPer.ventas / dPer.n : 0), `${nCli} cliente${nCli === 1 ? '' : 's'} en total`)}
    </div>
    <div class="card" style="margin-bottom:12px">
      <div class="row" style="justify-content:space-between"><strong>Ventas por día</strong><span class="small">${eur(dPer.ventas)} en ${periodoRes} días</span></div>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;margin-top:10px" role="img" aria-label="Ventas por día">${barras}</svg>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px">
      <div class="card" style="margin:0">
        <strong>Por hacer</strong>
        <div class="prow" style="cursor:pointer" data-ir="gestionar"><div class="pinfo"><div class="pname">Pedir al proveedor</div><div class="small">Pagados que aún no has pedido</div></div><strong style="font-size:20px;color:${porPedir.length ? 'var(--brand)' : 'inherit'}">${porPedir.length}</strong></div>
        <div class="prow" style="cursor:pointer" data-ir="gestionar"><div class="pinfo"><div class="pname">Poner seguimiento</div><div class="small">Pedidos al proveedor sin enviar aún</div></div><strong style="font-size:20px">${sinSeg.length}</strong></div>
        <div class="prow" style="cursor:pointer" data-ir="ago"><div class="pinfo"><div class="pname">Productos agotados</div><div class="small">Ocultos en la tienda</div></div><strong style="font-size:20px">${PRODS.filter(p => p.publicado && !(p.stock > 0)).length}</strong></div>
      </div>
      <div class="card" style="margin:0">
        <strong>Más vendidos (${periodoRes} días)</strong>
        ${topL.length ? topL.map(t => `<div class="prow">${t.imagen ? `<img class="thumb" src="${esc(t.imagen)}" alt="" style="width:44px;height:44px">` : ''}<div class="pinfo"><div class="pname" style="font-size:14px">${esc(t.nombre)}</div><div class="small">${t.n} ud. · ${eur(t.eur)}</div></div></div>`).join('') : '<div class="empty" style="padding:20px">Aún no hay ventas en este periodo.</div>'}
      </div>
    </div>`;
  $('#periodo').value = String(periodoRes);
  $('#periodo').onchange = e => { periodoRes = Number(e.target.value); pintarResumen(); };
  document.querySelectorAll('[data-ped]').forEach(a => a.onclick = e => { e.preventDefault(); vista = 'pedidos'; pedidoAbierto = a.dataset.ped; pintar(); });
  document.querySelectorAll('[data-ir]').forEach(a => a.onclick = () => { const d = a.dataset.ir; if (d === 'ago') { vista = 'lista'; filtro = 'ago'; } else { vista = 'pedidos'; filtroPed = d; pedidoAbierto = null; } pintar(); });
}

/* ---------- CLIENTES ---------- */
function listaClientes() {
  const m = new Map();
  for (const p of PEDIDOS) {
    if (!VENDIDO.includes(p.estado) || esPrueba(p)) continue;
    const k = String(p.cliente_email || '').toLowerCase(); if (!k) continue;
    const c = m.get(k) || { email: p.cliente_email, nombre: p.cliente_nombre, telefono: p.cliente_telefono, ciudad: (p.direccion || {}).city, pedidos: [], gastado: 0, ultima: null, cuenta: !!p.user_id };
    c.pedidos.push(p); c.gastado += Number(p.total || 0) - Number(p.reembolsado || 0);
    const f = new Date(p.pagado || p.creado); if (!c.ultima || f > c.ultima) { c.ultima = f; c.nombre = p.cliente_nombre || c.nombre; c.telefono = p.cliente_telefono || c.telefono; }
    if (p.user_id) c.cuenta = true;
    m.set(k, c);
  }
  return [...m.values()].sort((a, b) => b.ultima - a.ultima);
}
function pintarClientes() {
  const todos = listaClientes();
  if (cliAbierto) {
    const c = todos.find(x => x.email.toLowerCase() === cliAbierto);
    if (c) {
      $('#app').innerHTML = `
        <div class="row" style="justify-content:space-between;margin-bottom:12px"><button class="btn b-ghost" id="volverCli" style="min-height:44px">← Clientes</button>${c.cuenta ? '<span class="tag t-pub">Tiene cuenta</span>' : ''}</div>
        <div class="card stack">
          <h1 style="font-size:24px">${esc(c.nombre || c.email)}</h1>
          <div class="small"><a href="mailto:${esc(c.email)}">${esc(c.email)}</a>${c.telefono ? ` · <a href="tel:${esc(c.telefono)}">${esc(c.telefono)}</a>` : ''}${c.ciudad ? ' · ' + esc(c.ciudad) : ''}</div>
          <div class="row"><span><strong>${c.pedidos.length}</strong> pedido${c.pedidos.length > 1 ? 's' : ''}</span><span>· <strong>${eur(c.gastado)}</strong> gastado</span></div>
          <button class="btn b-line" id="envCupCli" style="align-self:flex-start;min-height:42px">🎁 Enviar código de descuento</button>
        </div>
        <div class="card">${c.pedidos.map(p => `<div class="prow" style="cursor:pointer" data-ped="${p.id}"><div class="pinfo"><div class="pname">#${p.numero} · ${eur(p.total)}</div><div class="small">${fecha(p.pagado || p.creado)} · ${(p.productos || []).length} art.</div></div>${chipPed(p.estado)}</div>`).join('')}</div>`;
      $('#volverCli').onclick = () => { cliAbierto = null; pintarClientes(); };
      $('#envCupCli').onclick = () => abrirEnviarCupon({ email: c.email, nombre: c.nombre, motivo: 'gracias' });
      document.querySelectorAll('[data-ped]').forEach(a => a.onclick = () => { vista = 'pedidos'; pedidoAbierto = a.dataset.ped; pintar(); });
      return;
    }
    cliAbierto = null;
  }
  const q = busCli.toLowerCase();
  const list = todos.filter(c => !q || [c.nombre, c.email, c.telefono, c.ciudad].some(v => String(v || '').toLowerCase().includes(q)));
  const repiten = todos.filter(c => c.pedidos.length > 1).length;
  $('#app').innerHTML = `
    <div class="row" style="justify-content:space-between;margin-bottom:12px">
      <div><h1 style="font-size:26px">Clientes</h1><div class="small">${todos.length} cliente${todos.length === 1 ? '' : 's'} · ${repiten} han repetido</div></div>
      ${todos.length ? '<button class="btn b-line" id="csvCli">Descargar lista</button>' : ''}
    </div>
    <div class="card" style="padding:12px 18px">
      <input class="in" id="busCli" placeholder="Buscar por nombre, correo, teléfono o ciudad…" value="${esc(busCli)}" style="margin-bottom:6px">
      ${list.length ? list.map(c => `<div class="prow" style="cursor:pointer" data-cli="${esc(c.email.toLowerCase())}">
        <div class="pinfo"><div class="pname">${esc(c.nombre || c.email)}${c.cuenta ? ' <span class="tag t-pub" style="margin-left:4px">cuenta</span>' : ''}</div><div class="small">${esc(c.email)}${c.ciudad ? ' · ' + esc(c.ciudad) : ''}</div><div class="small">Última compra: ${fecha(c.ultima)}</div></div>
        <div style="text-align:right"><strong>${eur(c.gastado)}</strong><div class="small">${c.pedidos.length} pedido${c.pedidos.length > 1 ? 's' : ''}</div></div></div>`).join('') : `<div class="empty">${todos.length ? 'Ningún cliente coincide.' : 'Aquí aparecerán tus clientes cuando tengas ventas.'}</div>`}
    </div>`;
  $('#busCli').oninput = e => { busCli = e.target.value; const pos = e.target.selectionStart; pintarClientes(); const i = $('#busCli'); i.focus(); i.setSelectionRange(pos, pos); };
  document.querySelectorAll('[data-cli]').forEach(a => a.onclick = () => { cliAbierto = a.dataset.cli; pintarClientes(); window.scrollTo(0, 0); });
  if ($('#csvCli')) $('#csvCli').onclick = () => {
    const filas = [['Nombre', 'Correo', 'Teléfono', 'Ciudad', 'Pedidos', 'Gastado', 'Última compra']].concat(todos.map(c => [c.nombre || '', c.email, c.telefono || '', c.ciudad || '', c.pedidos.length, c.gastado.toFixed(2).replace('.', ','), c.ultima.toLocaleDateString('es-ES')]));
    const csv = '\ufeff' + filas.map(f => f.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'clientes-epicoutlet.csv'; a.click();
  };
}

/* ---------- CUPONES ---------- */
function textoCupon(c) {
  return c.tipo === 'envio' ? 'Envío gratis' : c.tipo === 'eur' ? `${eur(c.valor)} de descuento` : `${c.valor} % de descuento`;
}
function pintarCupones() {
  const hoy = new Date().toISOString().slice(0, 10);
  $('#app').innerHTML = `
    <div class="row" style="justify-content:space-between;margin-bottom:12px"><div><h1 style="font-size:26px">Cupones</h1><div class="small">Códigos de descuento que tus clientes escriben en el carrito.</div></div></div>
    <form class="card stack" id="fCup">
      <h2 style="font-size:18px">Nuevo cupón</h2>
      <div class="g2">
        <label class="f">Código<input class="in" name="codigo" required maxlength="30" placeholder="BIENVENIDA10" style="text-transform:uppercase"></label>
        <label class="f">Tipo<select class="in" name="tipo"><option value="pct">% de descuento</option><option value="eur">€ de descuento</option><option value="envio">Envío gratis</option></select></label>
        <label class="f" id="fValor">Valor<input class="in" name="valor" inputmode="decimal" placeholder="10"></label>
        <label class="f">Compra mínima (€) <span class="small">opcional</span><input class="in" name="minimo" inputmode="decimal" placeholder="Sin mínimo"></label>
        <label class="f">Caduca el <span class="small">opcional</span><input class="in" name="caduca" type="date" min="${hoy}"></label>
        <label class="f">Usos máximos <span class="small">opcional</span><input class="in" name="max" inputmode="numeric" placeholder="Sin límite"></label>
      </div>
      <div id="cupMsg"></div>
      <button class="btn b-brand" type="submit" style="align-self:flex-start">Crear cupón</button>
    </form>
    <div class="card" style="margin-top:14px">
      ${CUPONES.length ? CUPONES.map((c, i) => { const cad = c.caduca && c.caduca < hoy, lleno = c.max && Number(c.usos || 0) >= Number(c.max); const on = c.activo !== false && !cad && !lleno; return `
        <div class="prow">
          <div class="pinfo"><div class="pname" style="font-family:ui-monospace,monospace">${esc(c.codigo)}</div>
          <div class="small">${textoCupon(c)}${c.minimo ? ` · desde ${eur(c.minimo)}` : ''}${c.caduca ? ` · hasta el ${new Date(c.caduca).toLocaleDateString('es-ES')}` : ''}</div>
          <div class="small">Usado ${Number(c.usos || 0)}${c.max ? ' de ' + c.max : ''} ${Number(c.usos || 0) === 1 ? 'vez' : 'veces'}${c.enviados && c.enviados.length ? ` · enviado a ${c.enviados.length === 1 ? esc(c.enviados[0].email) : c.enviados.length + ' clientes'}` : c.para ? ' · para ' + esc(c.para) : ''}</div>
          <span class="tag ${on ? 't-pub' : 't-bor'}">${on ? 'Activo' : cad ? 'Caducado' : lleno ? 'Agotado' : 'Pausado'}</span></div>
          ${on ? `<button class="btn b-ghost" data-cenv="${i}" style="min-height:40px;padding:0 12px">Enviar</button>` : ''}
          <button class="btn b-ghost" data-cpaus="${i}" style="min-height:40px;padding:0 12px">${c.activo === false ? 'Activar' : 'Pausar'}</button>
          <button class="btn b-ghost" data-cdel="${i}" style="min-height:40px;padding:0 12px" aria-label="Borrar">✕</button>
        </div>`; }).join('') : '<div class="empty">Todavía no tienes cupones.</div>'}
    </div>
    <p class="small" style="margin-top:10px">El cupón PRUEBA (todo gratis) sigue funcionando solo para ti, con el panel abierto.</p>`;
  const f = $('#fCup');
  f.tipo.onchange = () => { $('#fValor').style.display = f.tipo.value === 'envio' ? 'none' : ''; };
  f.onsubmit = async ev => {
    ev.preventDefault();
    const codigo = f.codigo.value.trim().toUpperCase().replace(/\s+/g, '');
    const valor = nOrNull(f.valor.value);
    const err = t => { $('#cupMsg').innerHTML = `<div class="msg err">${t}</div>`; };
    if (!/^[A-Z0-9_-]{3,30}$/.test(codigo)) return err('El código solo puede llevar letras, números y guiones (de 3 a 30).');
    if (codigo === 'PRUEBA') return err('PRUEBA está reservado para tus pedidos de prueba.');
    if (CUPONES.some(c => c.codigo === codigo)) return err('Ya existe un cupón con ese código.');
    if (f.tipo.value !== 'envio' && !(valor > 0)) return err('Pon el valor del descuento.');
    if (f.tipo.value === 'pct' && valor > 90) return err('Como máximo un 90 %.');
    const c = { codigo, tipo: f.tipo.value, valor: f.tipo.value === 'envio' ? null : valor, minimo: nOrNull(f.minimo.value), caduca: f.caduca.value || null, max: parseInt(f.max.value, 10) || null, usos: 0, activo: true, creado: new Date().toISOString() };
    try { await guardarClave('cupones', { lista: [c, ...CUPONES] }); CUPONES.unshift(c); toast('Cupón creado'); pintarCupones(); }
    catch (e) { err('No se ha podido guardar: ' + esc(e.message)); }
  };
  document.querySelectorAll('[data-cenv]').forEach(b => b.onclick = () => abrirEnviarCupon({ codigo: CUPONES[Number(b.dataset.cenv)].codigo, motivo: 'general' }));
  document.querySelectorAll('[data-cpaus]').forEach(b => b.onclick = async () => {
    const c = CUPONES[Number(b.dataset.cpaus)]; c.activo = c.activo === false;
    try { await guardarClave('cupones', { lista: CUPONES }); pintarCupones(); } catch (e) { toast('No se ha podido guardar'); }
  });
  document.querySelectorAll('[data-cdel]').forEach(b => b.onclick = async () => {
    const i = Number(b.dataset.cdel); if (!confirm(`¿Borrar el cupón ${CUPONES[i].codigo}?`)) return;
    const copia = CUPONES.slice(); copia.splice(i, 1);
    try { await guardarClave('cupones', { lista: copia }); CUPONES = copia; pintarCupones(); } catch (e) { toast('No se ha podido borrar'); }
  });
}

/* ---------- PEDIDO: factura, correos y reembolso ---------- */
function bloqueFacturaCorreos(p) {
  const c = p.correos || {};
  const linea = (k, t) => c[k] ? `<div class="small">✓ ${t} · ${fecha(c[k])}</div>` : '';
  return `<div class="card stack">
    <h2 style="font-size:18px">Factura y correos al cliente</h2>
    <div class="row">
      ${p.factura ? `<button class="btn b-line" data-pdf="factura" style="min-height:42px">Ver factura ${esc(p.factura)}</button>` : `<span class="small">${esPrueba(p) ? 'Los pedidos de prueba no llevan factura.' : 'Sin factura (pedido anterior a las facturas o falta ejecutar el SQL nuevo).'}</span>`}
      ${p.rectificativa ? `<button class="btn b-line" data-pdf="rectificativa" style="min-height:42px">Ver rectificativa ${esc(p.rectificativa)}</button>` : ''}
    </div>
    ${linea('confirmacion', 'Confirmación de pedido enviada')}${linea('enviado', 'Aviso de envío enviado')}${linea('reembolso', 'Aviso de reembolso enviado')}${linea('carrito', 'Recordatorio de carrito enviado')}
    ${p.cliente_email ? `<div class="row"><button class="btn b-ghost" id="reConf" style="min-height:40px;font-size:14px">${c.confirmacion ? 'Reenviar' : 'Enviar'} confirmación${p.factura ? ' con factura' : ''}</button>
      ${['enviado', 'entregado'].includes(p.estado) ? `<button class="btn b-ghost" id="reEnv" style="min-height:40px;font-size:14px">${c.enviado ? 'Reenviar' : 'Enviar'} aviso de envío</button>` : ''}
      <button class="btn b-ghost" id="envCupPed" style="min-height:40px;font-size:14px">🎁 Enviar código de descuento</button></div>` : ''}
  </div>`;
}
function bloqueReembolso(p) {
  if (['cancelado'].includes(p.estado)) return '';
  const pendiente = Math.round((Number(p.total || 0) - Number(p.reembolsado || 0)) * 100) / 100;
  if (p.estado === 'reembolsado' || pendiente <= 0) return Number(p.reembolsado) ? `<div class="card"><div class="small">Reembolsado: <strong>${eur(p.reembolsado)}</strong></div></div>` : '';
  return `<div class="card stack">
    <h2 style="font-size:18px">Reembolsar</h2>
    <p class="small" style="margin:0">Devuelve el dinero en Stripe desde aquí. Se hace la factura rectificativa y, si quieres, se avisa al cliente por correo.${Number(p.reembolsado) ? ` Ya devuelto: ${eur(p.reembolsado)}.` : ''}</p>
    <div class="g2">
      <label class="f">Importe (€)<input class="in" id="rImp" inputmode="decimal" value="${String(pendiente).replace('.', ',')}"></label>
      <label class="f">Motivo<select class="in" id="rMot"><option>Producto agotado</option><option>Devolución del cliente</option><option>Producto dañado o defectuoso</option><option>Cancelado por el cliente</option><option>Otro</option></select></label>
    </div>
    <label class="check"><input type="checkbox" id="rAvi" ${p.cliente_email ? 'checked' : 'disabled'}>Avisar al cliente por correo (con la factura rectificativa)</label>
    <label class="check"><input type="checkbox" id="rRep">Devolver las unidades al stock (solo si te las han devuelto y puedes venderlas)</label>
    <div id="rMsg"></div>
    <div class="row"><button class="btn b-danger" id="rYa">Reembolsar</button>
    <button class="btn b-ghost" data-est="reembolsado" style="min-height:40px;font-size:13px">Ya lo devolví en Stripe: solo marcar</button></div>
  </div>`;
}
function activarBloquesPedido(p) {
  document.querySelectorAll('[data-pdf]').forEach(b => b.onclick = () => abrirPDF(p.id, b.dataset.pdf));
  const envia = async (b, accion, ok) => {
    b.disabled = true; const t = b.textContent; b.textContent = 'Enviando…';
    try { await apiPanel('/api/admin-pedido', { id: p.id, accion }); toast(ok); await cargarPedidos(); pintarPedido(); }
    catch (e) { toast(e.message); b.disabled = false; b.textContent = t; }
  };
  if ($('#reConf')) $('#reConf').onclick = e => envia(e.target, 'reenviar_confirmacion', 'Confirmación enviada');
  if ($('#reEnv')) $('#reEnv').onclick = e => envia(e.target, 'aviso_envio', 'Aviso de envío enviado');
  if ($('#envCupPed')) $('#envCupPed').onclick = () => abrirEnviarCupon({ email: p.cliente_email, nombre: p.cliente_nombre, numero: p.numero, motivo: p.estado === 'reembolsado' ? 'disculpa' : 'gracias' });
  if ($('#rYa')) $('#rYa').onclick = async () => {
    const imp = nOrNull($('#rImp').value);
    if (!(imp > 0)) { $('#rMsg').innerHTML = '<div class="msg err">Pon el importe a devolver.</div>'; return; }
    if (!confirm(`Se devolverán ${eur(imp)} al cliente en Stripe. Esto no se puede deshacer. ¿Seguir?`)) return;
    const b = $('#rYa'); b.disabled = true; b.textContent = 'Reembolsando…';
    try {
      const r = await apiPanel('/api/admin-pedido', { id: p.id, accion: 'reembolsar', importe: imp, motivo: $('#rMot').value, avisar: $('#rAvi').checked, reponer: $('#rRep').checked });
      toast(`Reembolsados ${eur(r.importe)}${r.correo && r.correo.ok ? ' · cliente avisado' : ''}`);
      if ($('#rAvi').checked && r.correo && !r.correo.ok) alert('El reembolso está hecho, pero el correo no se ha enviado: ' + r.correo.motivo);
      await cargarPedidos(); pintarPedido();
    } catch (e) { $('#rMsg').innerHTML = `<div class="msg err">${esc(e.message)}</div>`; b.disabled = false; b.textContent = 'Reembolsar'; }
  };
}
// Tras marcar «enviado» en el panel: correo automático con el seguimiento
async function trasCambioEstado(p, nuevo) {
  if (nuevo !== 'enviado' || !p.cliente_email || !$('#avEnv') || !$('#avEnv').checked) return;
  try { await apiPanel('/api/admin-pedido', { id: p.id, accion: 'aviso_envio' }); toast('Cliente avisado por correo'); }
  catch (e) { alert('Marcado como enviado, pero el correo no ha salido: ' + e.message); }
}

/* ---------- AJUSTES: facturación, beneficio, importación automática ---------- */
function bloqueAjustesV2() {
  const E = { titular: 'EPIC OUTLET SL', nif: 'Y0401739N', direccion: 'Zăvoi, Caraș-Severin, 327435, Rumanía', email: 'contacto@epicoutlet.es', web: 'www.epicoutlet.es', ...EMP };
  return `
    <form class="card stack" id="fEmp" style="margin-top:14px">
      <h2 style="font-size:18px">Datos de facturación</h2>
      <p class="small" style="margin:0">Salen en las facturas que reciben tus clientes. Revisa que el NIF sea el de la empresa: una factura con un NIF incorrecto no es válida.</p>
      <div class="g2">
        <label class="f">Razón social<input class="in" name="titular" value="${esc(E.titular)}"></label>
        <label class="f">NIF / CIF<input class="in" name="nif" value="${esc(E.nif)}"></label>
      </div>
      <label class="f">Dirección fiscal<input class="in" name="direccion" value="${esc(E.direccion)}"></label>
      <div class="g2">
        <label class="f">Correo<input class="in" name="email" value="${esc(E.email)}"></label>
        <label class="f">Web<input class="in" name="web" value="${esc(E.web)}"></label>
      </div>
      <button class="btn b-line" type="submit" style="align-self:flex-start">Guardar datos de facturación</button>
    </form>
    <form class="card stack" id="fNeg" style="margin-top:14px">
      <h2 style="font-size:18px">Para calcular el beneficio real</h2>
      <div class="g2">
        <label class="f">Comisión de Stripe (%)<input class="in" name="comisionPct" inputmode="decimal" value="${esc(NEG.comisionPct)}"></label>
        <label class="f">Comisión fija por pago (€)<input class="in" name="comisionFija" inputmode="decimal" value="${esc(NEG.comisionFija)}"></label>
      </div>
      <label class="f">Lo que te cobra el proveedor por enviar cada pedido (€)<input class="in" name="envioProveedor" inputmode="decimal" value="${esc(NEG.envioProveedor)}" placeholder="0"></label>
      <button class="btn b-line" type="submit" style="align-self:flex-start">Guardar</button>
    </form>
    <div class="card stack" style="margin-top:14px">
      <h2 style="font-size:18px">Importación automática de novedades</h2>
      <p class="small" style="margin:0">Cada mañana, después de revisar el stock, se añaden solos los productos nuevos de estas colecciones del proveedor, ya con tu margen. Para añadir una, impórtala desde «Importar» y marca «Importar novedades cada día».</p>
      ${AUTOIMP.length ? AUTOIMP.map((a, i) => `<div class="prow"><div class="pinfo"><div class="pname" style="font-size:14px">${esc(a.titulo || a.url)}</div><div class="small">→ ${esc(catNombre(a.coleccion))} · ${a.publicar ? 'se publican' : 'como borrador'}${a.ultima ? ` · última: ${fecha(a.ultima)}${a.nuevos != null ? ` (${a.nuevos} nuevos)` : ''}` : ''}</div></div><button class="btn b-ghost" data-adel="${i}" style="min-height:40px">Quitar</button></div>`).join('') : '<div class="small">Ninguna colección todavía.</div>'}
    </div>`;
}
function activarAjustesV2() {
  const fE = $('#fEmp');
  if (fE) fE.onsubmit = async ev => {
    ev.preventDefault();
    const v = Object.fromEntries(new FormData(fE).entries());
    try { await guardarClave('empresa', v); EMP = v; toast('Datos de facturación guardados'); } catch (e) { toast('No se ha podido guardar'); }
  };
  const fN = $('#fNeg');
  if (fN) fN.onsubmit = async ev => {
    ev.preventDefault();
    const f = new FormData(fN);
    const v = { comisionPct: nOrNull(f.get('comisionPct')) ?? 1.5, comisionFija: nOrNull(f.get('comisionFija')) ?? 0.25, envioProveedor: nOrNull(f.get('envioProveedor')) ?? 0 };
    try { await guardarClave('negocio', v); NEG = v; toast('Guardado'); } catch (e) { toast('No se ha podido guardar'); }
  };
  document.querySelectorAll('[data-adel]').forEach(b => b.onclick = async () => {
    const copia = AUTOIMP.slice(); copia.splice(Number(b.dataset.adel), 1);
    try { await guardarClave('autoimport', { lista: copia }); AUTOIMP = copia; pintar(); } catch (e) { toast('No se ha podido guardar'); }
  });
}
// Desde la pantalla de importación por lotes
function bloqueAutoLote() {
  if (!LOTE || !LOTE.url) return '';
  const ya = AUTOIMP.some(a => a.url === LOTE.url);
  return `<label class="check" style="margin-top:6px"><input type="checkbox" id="autoLote" ${ya ? 'checked' : ''}>Importar novedades de esta colección cada día (con estas opciones)</label>`;
}
function activarAutoLote() {
  const c = $('#autoLote'); if (!c) return;
  c.onchange = async () => {
    const L = LOTE, o = L.opt;
    let lista = AUTOIMP.filter(a => a.url !== L.url);
    if (c.checked) {
      let col = o.cat;
      if (col === 'auto') { const n = {}; L.productos.forEach(p => n[p.cat] = (n[p.cat] || 0) + 1); col = Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] || 'hogar'; }
      lista = [{ url: L.url, titulo: L.titulo, coleccion: col, estado: o.estado, stock: o.stock, publicar: !!o.publicar, fotos: o.fotos, creado: new Date().toISOString() }, ...lista];
    }
    try { await guardarClave('autoimport', { lista }); AUTOIMP = lista; toast(c.checked ? 'Se importarán las novedades cada mañana' : 'Importación automática quitada'); }
    catch (e) { c.checked = !c.checked; toast('No se ha podido guardar'); }
  };
}

/* ---------- CAMBIOS EN BLOQUE (lista de productos) ---------- */
function barraSeleccion(lista) {
  if (!SEL.size) return `<div class="row" style="margin:4px 0 2px"><a href="#" id="selTodos" class="small" style="font-weight:600">Seleccionar los ${lista.length} que se ven</a></div>`;
  return `<div class="card" style="position:sticky;top:8px;z-index:5;padding:12px 14px;margin:6px 0;border:2px solid var(--brand)">
    <div class="row" style="justify-content:space-between"><strong>${SEL.size} seleccionado${SEL.size > 1 ? 's' : ''}</strong><a href="#" id="selNada" class="small">Quitar selección</a></div>
    <div class="row" style="margin-top:8px;gap:6px">
      <button class="btn b-line" data-bloque="publicar" style="min-height:38px;font-size:13px">Publicar</button>
      <button class="btn b-line" data-bloque="borrador" style="min-height:38px;font-size:13px">Pasar a borrador</button>
      <button class="btn b-line" data-bloque="coleccion" style="min-height:38px;font-size:13px">Cambiar colección</button>
      <button class="btn b-line" data-bloque="margen" style="min-height:38px;font-size:13px">Aplicar mi margen</button>
      <button class="btn b-line" data-bloque="top" style="min-height:38px;font-size:13px">Marcar Top ventas</button>
      <button class="btn b-line" data-bloque="notop" style="min-height:38px;font-size:13px">Quitar de Top</button>
      <button class="btn b-line" data-bloque="stock" style="min-height:38px;font-size:13px">Poner stock</button>
      <button class="btn b-danger" data-bloque="borrar" style="min-height:38px;font-size:13px">Borrar</button>
    </div></div>`;
}
function activarSeleccion(lista) {
  document.querySelectorAll('[data-sel]').forEach(c => c.onchange = () => { c.checked ? SEL.add(c.dataset.sel) : SEL.delete(c.dataset.sel); const y = window.scrollY; pintarLista(); window.scrollTo(0, y); });
  if ($('#selTodos')) $('#selTodos').onclick = e => { e.preventDefault(); lista.forEach(p => SEL.add(p.id)); pintarLista(); };
  if ($('#selNada')) $('#selNada').onclick = e => { e.preventDefault(); SEL.clear(); pintarLista(); };
  document.querySelectorAll('[data-bloque]').forEach(b => b.onclick = () => accionBloque(b.dataset.bloque, b));
}
async function accionBloque(acc, boton) {
  const ids = [...SEL], prods = PRODS.filter(p => SEL.has(p.id));
  let cambios = null, porProducto = null, txt = '';
  if (acc === 'publicar') { cambios = { publicado: true }; txt = 'publicar'; }
  if (acc === 'borrador') { cambios = { publicado: false }; txt = 'pasar a borrador'; }
  if (acc === 'top') { cambios = { top: true }; txt = 'marcar como Top ventas'; }
  if (acc === 'notop') { cambios = { top: false }; txt = 'quitar de Top ventas'; }
  if (acc === 'stock') { const n = parseInt(prompt('¿Cuántas unidades de stock poner a cada uno?', '1'), 10); if (!(n >= 0)) return; cambios = { stock: n }; txt = `poner stock ${n}`; }
  if (acc === 'coleccion') {
    const opciones = Object.entries(cats());
    const elegido = prompt('Escribe el número de la colección:\n' + opciones.map(([k, n], i) => `${i + 1}. ${n}`).join('\n'));
    const o = opciones[parseInt(elegido, 10) - 1]; if (!o) return;
    cambios = { categoria: o[0] }; txt = `mover a «${o[1]}»`;
  }
  if (acc === 'margen') {
    porProducto = prods.map(p => ({ id: p.id, v: { precio: precioSugerido((PRIV[p.id] || {}).coste, p.categoria) } })).filter(x => x.v.precio);
    if (!porProducto.length) return toast('Ninguno de los seleccionados tiene el coste apuntado');
    txt = `recalcular el precio de ${porProducto.length} (los que tienen coste)`;
  }
  if (acc === 'borrar') txt = 'BORRAR definitivamente';
  if (!confirm(`¿${txt.charAt(0).toUpperCase() + txt.slice(1)} ${acc === 'margen' ? '' : ids.length + ' producto' + (ids.length > 1 ? 's' : '')}?`)) return;
  boton.disabled = true; boton.textContent = 'Un momento…';
  let error = null;
  try {
    if (acc === 'borrar') {
      for (let i = 0; i < ids.length; i += 100) { const r = await sb.from('productos').delete().in('id', ids.slice(i, i + 100)); if (r.error) throw r.error; }
      if (typeof avisarBuscadores === 'function') avisarBuscadores(prods.filter(p => p.publicado).map(p => urlProducto(p.slug)));
    } else if (porProducto) {
      for (const x of porProducto) { const r = await sb.from('productos').update(x.v).eq('id', x.id); if (r.error) throw r.error; }
    } else {
      for (let i = 0; i < ids.length; i += 100) { const r = await sb.from('productos').update(cambios).in('id', ids.slice(i, i + 100)); if (r.error) throw r.error; }
      if (acc === 'publicar' && typeof avisarBuscadores === 'function') avisarBuscadores(prods.map(p => urlProducto(p.slug)));
    }
  } catch (e) { error = e; }
  SEL.clear();
  await cargar(); pintarLista();
  toast(error ? 'Algún cambio no se ha podido hacer: ' + error.message : 'Hecho');
}

/* ---------- ENVIAR UN CÓDIGO DE DESCUENTO POR CORREO ---------- */
let ENVC = null;   // { email, nombre, motivo, numero, volver: {vista, pedidoAbierto, cliAbierto}, codigo? }
const TEXTOS_CUPON = {
  disculpa: n => ({ asunto: 'Te pedimos disculpas · un regalo de EpicOutlet.es', prefijo: 'PERDON', mensaje: `Sentimos mucho no haber podido enviarte tu pedido${n ? ' #' + n : ''}: el producto se agotó justo antes de prepararlo. Ya te hemos devuelto el dinero.\n\nComo disculpa, te regalamos este código para tu próxima compra. Esperamos verte pronto por EpicOutlet.es.` }),
  gracias: n => ({ asunto: 'Gracias por tu compra · un regalo para la próxima', prefijo: 'GRACIAS', mensaje: `Gracias por confiar en EpicOutlet.es${n ? ' con tu pedido #' + n : ''}. Nos alegra mucho tenerte como cliente.\n\nPara tu próxima compra, aquí tienes un código de descuento.` }),
  carrito: n => ({ asunto: 'Te guardamos un descuento · EpicOutlet.es', prefijo: 'VUELVE', mensaje: 'Vimos que no pudiste terminar tu compra en EpicOutlet.es. Si tuviste algún problema con el pago, respóndenos y te ayudamos.\n\nPara animarte, aquí tienes un código de descuento. Las unidades son limitadas.' }),
  general: () => ({ asunto: 'Un código de descuento para ti · EpicOutlet.es', prefijo: 'REGALO', mensaje: 'Tenemos un pequeño regalo para ti: un código de descuento para tu próxima compra en EpicOutlet.es.' })
};
function abrirEnviarCupon(o) {
  ENVC = { motivo: 'general', ...o, volver: { vista, pedidoAbierto, cliAbierto } };
  vista = 'enviarcupon'; window.scrollTo(0, 0); pintar();
}
function pintarEnviarCupon() {
  const E = ENVC || { motivo: 'general' };
  const t = TEXTOS_CUPON[E.motivo] ? TEXTOS_CUPON[E.motivo](E.numero) : TEXTOS_CUPON.general();
  const hoy = new Date(), cad = new Date(hoy.getTime() + 30 * 864e5).toISOString().slice(0, 10);
  const activos = CUPONES.filter(c => c.activo !== false && !(c.caduca && c.caduca < hoy.toISOString().slice(0, 10)) && !(c.max && Number(c.usos || 0) >= Number(c.max)));
  $('#app').innerHTML = `
    <div class="row" style="justify-content:space-between;margin-bottom:12px"><button class="btn b-ghost" id="volverEnvc" style="min-height:44px">← Volver</button></div>
    <form class="card stack" id="fEnvc">
      <h1 style="font-size:24px">Enviar código de descuento</h1>
      <div class="g2">
        <label class="f">Correo del cliente<input class="in" name="email" type="email" required value="${esc(E.email || '')}"></label>
        <label class="f">Nombre<input class="in" name="nombre" value="${esc(E.nombre || '')}"></label>
      </div>
      <label class="f">Motivo<select class="in" name="motivo">
        <option value="disculpa">Disculpa (pedido sin stock, retraso…)</option><option value="gracias">Agradecimiento</option><option value="carrito">No terminó la compra</option><option value="general">Otro</option></select></label>
      <div class="card" style="background:var(--soft);margin:0;padding:12px 14px">
        <label class="check"><input type="radio" name="modo" value="nuevo" ${E.codigo ? '' : 'checked'}>Crear un código solo para este cliente (un solo uso)</label>
        <div class="g2" id="nuevoCup">
          <label class="f">Descuento<select class="in" name="tipo"><option value="pct">% de descuento</option><option value="eur">€ de descuento</option><option value="envio">Envío gratis</option></select></label>
          <label class="f">Valor<input class="in" name="valor" inputmode="decimal" value="10"></label>
          <label class="f">Válido hasta<input class="in" name="caduca" type="date" value="${cad}"></label>
          <label class="f">Compra mínima (€) <span class="small">opcional</span><input class="in" name="minimo" inputmode="decimal"></label>
        </div>
        ${activos.length ? `<label class="check" style="margin-top:8px"><input type="radio" name="modo" value="existente" ${E.codigo ? 'checked' : ''}>Usar uno que ya tengo</label>
        <select class="in" name="existente">${activos.map(c => `<option value="${esc(c.codigo)}" ${E.codigo === c.codigo ? 'selected' : ''}>${esc(c.codigo)} · ${esc(textoCupon(c))}</option>`).join('')}</select>` : ''}
      </div>
      <label class="f">Asunto<input class="in" name="asunto" value="${esc(t.asunto)}"></label>
      <label class="f">Mensaje<textarea class="in" name="mensaje" rows="6" style="min-height:150px">${esc(t.mensaje)}</textarea></label>
      <p class="small" style="margin:0">El correo lleva el código bien grande, las condiciones y un botón a la tienda.</p>
      <div id="envcMsg"></div>
      <button class="btn b-brand" type="submit" style="align-self:flex-start">Enviar correo</button>
    </form>`;
  const f = $('#fEnvc');
  f.motivo.value = E.motivo;
  f.motivo.onchange = () => { const x = TEXTOS_CUPON[f.motivo.value](E.numero); f.asunto.value = x.asunto; f.mensaje.value = x.mensaje; };
  f.tipo.onchange = () => { f.valor.parentElement.style.display = f.tipo.value === 'envio' ? 'none' : ''; if (f.tipo.value === 'eur') f.valor.value = '5'; if (f.tipo.value === 'pct') f.valor.value = '10'; };
  $('#volverEnvc').onclick = () => { const v = ENVC.volver; vista = v.vista; pedidoAbierto = v.pedidoAbierto; cliAbierto = v.cliAbierto; ENVC = null; pintar(); };
  f.onsubmit = async ev => {
    ev.preventDefault();
    const err = m => { $('#envcMsg').innerHTML = `<div class="msg err">${esc(m)}</div>`; };
    const email = f.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err('Escribe el correo del cliente.');
    const b = f.querySelector('button[type=submit]'); b.disabled = true; b.textContent = 'Enviando…';
    try {
      let codigo;
      if ((new FormData(f)).get('modo') === 'existente') codigo = f.existente.value;
      else {
        const valor = nOrNull(f.valor.value);
        if (f.tipo.value !== 'envio' && !(valor > 0)) throw new Error('Pon el valor del descuento.');
        if (f.tipo.value === 'pct' && valor > 90) throw new Error('Como máximo un 90 %.');
        const pref = (TEXTOS_CUPON[f.motivo.value] || TEXTOS_CUPON.general)(E.numero).prefijo;
        const a = new Uint8Array(4); crypto.getRandomValues(a);
        codigo = `${pref}-${Array.from(a, x => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[x % 32]).join('')}`;
        const c = { codigo, tipo: f.tipo.value, valor: f.tipo.value === 'envio' ? null : valor, minimo: nOrNull(f.minimo.value), caduca: f.caduca.value || null, max: 1, usos: 0, activo: true, para: email, nota: f.motivo.value, creado: new Date().toISOString() };
        await guardarClave('cupones', { lista: [c, ...CUPONES] }); CUPONES.unshift(c);
      }
      await apiPanel('/api/admin-pedido', { accion: 'enviar_cupon', email, nombre: f.nombre.value.trim(), codigo, asunto: f.asunto.value.trim(), mensaje: f.mensaje.value });
      await cargarV2();
      toast(`Código ${codigo} enviado a ${email}`);
      const v = ENVC.volver; vista = v.vista; pedidoAbierto = v.pedidoAbierto; cliAbierto = v.cliAbierto; ENVC = null; pintar();
    } catch (e) { err(e.message); b.disabled = false; b.textContent = 'Enviar correo'; }
  };
}
