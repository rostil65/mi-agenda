/* Mi Agenda Familia – lógica principal.
   Cada usuario ve solo sus datos y lo que otros le comparten. El admin gestiona usuarios pero no puede leer datos ajenos. */
(function () {
  'use strict';
  var DB_KEY = 'miagenda.db.v2', DEV_KEY = 'miagenda.dev.v2';
  var $ = function (s) { return document.querySelector(s); };
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var ymd = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  var parseYmd = function (s) { var p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var C = window.Cifra;
  var newId = function () { return C.rid(14); };
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var COLORES = ['#C2410C', '#1D4ED8', '#0F766E', '#7E22CE', '#BE185D', '#A16207', '#4D7C0F', '#0369A1', '#B91C1C', '#57534E'];
  var TIPOS_ACCESO = ['Comunicación', 'Banco', 'Tarjeta', 'Pago (PayPal, Bizum…)', 'Wallet', 'Tienda', 'Nube y notas', 'Trabajo', 'Otro'];
  var CATS = ['Frutas y verduras', 'Carne y pescado', 'Lácteos', 'Panadería', 'Despensa', 'Congelados', 'Bebidas', 'Limpieza', 'Higiene', 'Farmacia', 'Otros'];
  var ICON = {
    inicio: 'M3 11l9-7 9 7v9H5v-9', calendario: 'M3 6h18M7 3v4M17 3v4M4 5h16v15H4z', tareas: 'M4 12l4 4L20 6M4 20h16',
    contactos: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c1.5-4 5-5 8-5s6.5 1 8 5', notas: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5',
    accesos: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z', compras: 'M3 4h2l2.5 11h11L21 7H6.5M9 20h.01M18 20h.01',
    mensajes: 'M4 5h16v11H9l-5 4z', ajustes: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4',
    admin: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z'
  };
  var svg = function (k) { return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="' + ICON[k] + '"/></svg>'; };

  /* ================= almacenamiento ================= */
  function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  var db = load(DB_KEY) || { v: 2, epoch: null, records: {} };
  var dev = load(DEV_KEY) || {};
  dev.lastRead = dev.lastRead || {}; dev.notified = dev.notified || {}; dev.rama = dev.rama || {};
  if (!dev.clientId && window.MIAGENDA_CLIENT_ID) dev.clientId = window.MIAGENDA_CLIENT_ID;
  function persist() { localStorage.setItem(DB_KEY, JSON.stringify(db)); }
  function saveDev() { localStorage.setItem(DEV_KEY, JSON.stringify(dev)); }
  function save(rec) { rec.upd = Date.now(); db.records[rec.id] = rec; }
  function tomb(id) { if (db.records[id] && !db.records[id].del) db.records[id] = { id: id, del: true, upd: Date.now() }; delete D[id]; }
  function commit(deep) { persist(); scheduleSync(deep); }
  function recs(tipo) { return Object.values(db.records).filter(function (r) { return !r.del && r.tipo === tipo; }); }
  function U(id) { var r = db.records[id]; return r && !r.del && r.tipo === 'user' ? r : null; }
  function usuarios() { return recs('user').sort(function (a, b) { return a.nombre.localeCompare(b.nombre); }); }
  function activos() { return usuarios().filter(function (u) { return u.estado === 'activo'; }); }

  /* ================= sesión ================= */
  var ME = null; /* { id, mk, sk } */
  var D = {}; /* objetos descifrados: id -> { data, rec } */
  var SK = {}; /* claves de compartidos abiertas: shareId -> CryptoKey */
  var S = { view: 'inicio', month: null, sel: null, q: '', lista: null, chat: null, tfiltro: 'pend', loginUser: null };
  var today = new Date(); S.month = new Date(today.getFullYear(), today.getMonth(), 1); S.sel = ymd(today);
  function me() { return ME && U(ME.id); }
  function isAdmin() { var u = me(); return !!(u && u.rol === 'admin'); }
  function rama() { return (ME && dev.rama[ME.id]) || 'personal'; }

  function toast(t) { var el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(function () { el.classList.remove('show'); }, 2800); }

  /* ================= núcleo cifrado ================= */
  function actorKeyFor(actor, shareId) { return shareId ? (actor.SK || SK)[shareId] : actor.mk; }
  async function putObj(actor, id, data, shareId) {
    id = id || newId();
    var key = actorKeyFor(actor, shareId);
    if (!key) throw new Error('Sin clave para guardar');
    var prev = db.records[id], by = prev && !prev.del && prev.by ? prev.by : actor.id; /* el autor es quien lo creó, no quien lo editó */
    var rec = { id: id, tipo: 'obj', owner: shareId ? '' : actor.id, by: by, share: shareId || '', box: await C.encJSON(key, data, id) };
    save(rec);
    if (actor === ME) D[id] = { data: data, rec: rec };
    return id;
  }
  async function createShare(actor, kind, memberIds, extra) {
    var sid = newId(), k = await C.newAes(), raw = await C.rawAes(k), keys = {};
    var ids = Array.from(new Set([actor.id].concat(memberIds)));
    for (var i = 0; i < ids.length; i++) { var u = U(ids[i]); if (u && u.pub) keys[u.id] = await C.wrapFor(actor.sk, actor.id, u, raw, sid); }
    var rec = Object.assign({ id: sid, tipo: 'share', kind: kind, owner: actor.id, members: Object.keys(keys), keys: keys, root: '' }, extra || {});
    save(rec);
    var imp = await C.importAes(raw);
    if (actor === ME) SK[sid] = imp; else { actor.SK = actor.SK || {}; actor.SK[sid] = imp; }
    actor.raw = actor.raw || {}; actor.raw[sid] = raw;
    return sid;
  }
  async function addMembers(sid, ids) {
    var sh = db.records[sid], raw = await shareRaw(sid);
    for (var i = 0; i < ids.length; i++) {
      var u = U(ids[i]); if (!u || !u.pub || sh.keys[u.id]) continue;
      sh.keys[u.id] = await C.wrapFor(ME.sk, ME.id, u, raw, sid);
      if (sh.members.indexOf(u.id) < 0) sh.members.push(u.id);
    }
    save(sh);
  }
  var RAW = {};
  async function shareRaw(sid) {
    if (RAW[sid]) return RAW[sid];
    var sh = db.records[sid], box = sh.keys[ME.id], from = U(box.from);
    RAW[sid] = await C.unwrapFrom(ME.sk, ME.id, from, box, sid);
    return RAW[sid];
  }
  function setAcc(actorId, sid, estado, cal) {
    var id = 'acc_' + sid + '_' + actorId, prev = db.records[id];
    save({ id: id, tipo: 'acc', share: sid, user: actorId, estado: estado, cal: cal != null ? cal : (prev && !prev.del ? prev.cal : '') });
  }
  function acc(sid, uid) { var r = db.records['acc_' + sid + '_' + uid]; return r && !r.del ? r : null; }

  /* Borra todo rastro de un usuario: su ficha, sus datos, lo que creó o escribió en compartidos y sus conversaciones. */
  function purgeUser(uid) {
    Object.values(db.records).forEach(function (r) {
      if (r.del) return;
      if (r.tipo === 'share') {
        if (r.owner === uid || (r.kind === 'chat' && !r.fam && r.members.indexOf(uid) >= 0)) dropShare(r.id);
        else if (r.members.indexOf(uid) >= 0) {
          r.members = r.members.filter(function (m) { return m !== uid; }); delete r.keys[uid];
          Object.keys(r.keys).forEach(function (k) { if (r.keys[k].from === uid) delete r.keys[k]; });
          save(r);
        }
      }
    });
    Object.values(db.records).forEach(function (r) {
      if (r.del) return;
      if ((r.tipo === 'obj' && (r.owner === uid || r.by === uid)) || (r.tipo === 'acc' && r.user === uid)) tomb(r.id);
    });
    var u = U(uid);
    if (u && u.perm) save({ id: newId(), tipo: 'revoke', perm: u.perm });
    tomb(uid);
    Cifra.keyStore.del(uid).catch(function () {});
  }
  function dropShare(sid) {
    Object.values(db.records).forEach(function (r) { if (!r.del && ((r.tipo === 'obj' && r.share === sid) || (r.tipo === 'acc' && r.share === sid))) tomb(r.id); });
    tomb(sid); delete SK[sid]; delete RAW[sid];
  }
  /* Limpia restos huérfanos (por ejemplo, datos de un usuario borrado que llegan de un dispositivo que estaba sin conexión). */
  function cleanup() {
    var ids = {}, changed = false;
    usuarios().forEach(function (u) { ids[u.id] = 1; });
    if (!Object.keys(ids).length) return false;
    Object.values(db.records).forEach(function (r) {
      if (r.del) return;
      var bad = false;
      if (r.tipo === 'obj') bad = (r.owner && !ids[r.owner]) || (r.by && !ids[r.by]) || (r.share && (!db.records[r.share] || db.records[r.share].del));
      if (r.tipo === 'acc') bad = !ids[r.user] || !db.records[r.share] || db.records[r.share].del;
      if (r.tipo === 'share') {
        bad = !ids[r.owner];
        if (!bad) {
          var lost = r.members.filter(function (m) { return !ids[m]; });
          var badWrap = Object.keys(r.keys).filter(function (k) { return !ids[k] || !ids[r.keys[k].from]; });
          if (lost.length || badWrap.length) { r.members = r.members.filter(function (m) { return ids[m]; }); badWrap.forEach(function (k) { delete r.keys[k]; }); save(r); changed = true; }
        }
      }
      if (bad) { if (r.tipo === 'share') dropShare(r.id); else tomb(r.id); changed = true; }
    });
    return changed;
  }

  /* Descifra lo que este usuario puede ver. */
  async function refresh() {
    if (!ME) return;
    if (!U(ME.id)) { await lock(true); toast('Tu usuario ya no existe en esta familia'); return; }
    var mySh = recs('share').filter(function (s) { return s.keys[ME.id]; });
    for (var i = 0; i < mySh.length; i++) {
      var s = mySh[i], sig = s.keys[ME.id].ct;
      if (SK[s.id] && SK[s.id]._sig === sig) continue;
      try { var raw = await shareRaw(s.id); var k = await C.importAes(raw); k._sig = sig; SK[s.id] = k; } catch (e) { delete SK[s.id]; }
    }
    var seen = {};
    var objs = recs('obj');
    for (var j = 0; j < objs.length; j++) {
      var o = objs[j], key = o.share ? SK[o.share] : (o.owner === ME.id ? ME.mk : null);
      if (!key) continue;
      seen[o.id] = 1;
      if (D[o.id] && D[o.id].rec.upd === o.upd) continue;
      try { D[o.id] = { data: await C.decJSON(key, o.box, o.id), rec: o }; } catch (e) { delete D[o.id]; }
    }
    Object.keys(D).forEach(function (id) { if (!seen[id]) delete D[id]; });
    await ensureFamChat();
    avisarNuevos();
    await mantenimiento();
  }
  async function ensureFamChat() {
    var fam = famChat(); if (!fam || !SK[fam.id]) return;
    var falta = activos().filter(function (u) { return u.pub && !fam.keys[u.id]; });
    if (!falta.length) return;
    await addMembers(fam.id, falta.map(function (u) { return u.id; }));
    commit();
  }
  function famChat() { return recs('share').filter(function (s) { return s.kind === 'chat' && s.fam; }).sort(function (a, b) { return a.id.localeCompare(b.id); })[0] || null; }

  /* ================= consultas ================= */
  function item(id) { var x = D[id]; if (!x) return null; var sh = x.rec.share ? db.records[x.rec.share] : null; return { id: id, d: x.data, rec: x.rec, sh: sh && !sh.del ? sh : null }; }
  function privados(k) { return Object.keys(D).map(item).filter(function (it) { return it && !it.sh && it.d.k === k && it.rec.owner === ME.id && !it.d.papelera; }); }
  function aceptado(sh) { if (sh.owner === ME.id) return true; var a = acc(sh.id, ME.id); return !!(a && a.estado === 'aceptado'); }
  function compartidos(kind) {
    return recs('share').filter(function (s) { return s.kind === kind && SK[s.id] && aceptado(s); }).map(function (s) { return item(s.root); }).filter(Boolean);
  }
  function pendientes() {
    return recs('share').filter(function (s) { return ['evento', 'nota', 'lista'].indexOf(s.kind) >= 0 && s.owner !== ME.id && SK[s.id] && !acc(s.id, ME.id); })
      .map(function (s) { return { sh: s, it: item(s.root) }; }).filter(function (x) { return x.it; });
  }
  function porRama(d) { var r = rama(); return r === 'todo' || !d.rama || d.rama === 'ambas' || d.rama === r; }
  function todos(k) { return privados(k).concat(['nota', 'lista', 'evento'].indexOf(k) >= 0 ? compartidos(k) : []); }
  var RANGO_CAL = { normal: 0, importado: 1, 'auto-lab': 2, 'auto-ro': 3, 'auto-ort': 4, cumple: 9 };
  function cals() { return privados('cal').sort(function (a, b) { return (RANGO_CAL[a.d.tipo] || 0) - (RANGO_CAL[b.d.tipo] || 0) || (a.d.orden || 0) - (b.d.orden || 0) || a.d.nombre.localeCompare(b.d.nombre); }); }
  function calVisible(c) { return !!(c && c.d.activo !== false); } /* 3.11: los calendarios son comunes a las dos ramas */
  function calDe(ev) {
    var cid = ev.sh ? ((acc(ev.sh.id, ME.id) || {}).cal) : ev.d.cal;
    var c = cid && item(cid);
    if (!c || c.d.k !== 'cal') c = cals().filter(function (x) { return x.d.tipo !== 'cumple'; })[0];
    return c;
  }
  function nombre(uid) { var u = U(uid); return u ? u.nombre : '—'; }
  function miembrosTxt(sh) {
    return sh.members.filter(function (m) { return m !== sh.owner; }).map(function (m) {
      var a = acc(sh.id, m); return nombre(m) + ' (' + (a ? a.estado : 'pendiente') + ')';
    }).join(', ');
  }
  function etiquetaComp(it) {
    if (!it.sh) return '';
    return it.sh.owner === ME.id ? ' · compartido con ' + esc(miembrosTxt(it.sh)) : ' · de ' + esc(nombre(it.sh.owner));
  }

  /* ================= calendario ================= */
  function ocurre(ev, ds) {
    if (!ev.fecha) return false;
    if (ev.fecha === ds) return true;
    if (ds < ev.fecha || !ev.repetir || ev.repetir === 'no') return false;
    if (ev.hasta && ds > ev.hasta) return false;
    var a = parseYmd(ev.fecha), b = parseYmd(ds);
    if (ev.repetir === 'anual') return a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (ev.repetir === 'mensual') return a.getDate() === b.getDate();
    if (ev.repetir === 'semanal') return a.getDay() === b.getDay();
    return ev.repetir === 'diario';
  }
  function delDia(ds) {
    var out = [];
    if (!S.verPasados && ds < hoyStr()) return out; /* cambio 4: lo pasado se oculta */
    todos('evento').forEach(function (it) { var c = calDe(it); if (calVisible(c) && ocurre(it.d, ds)) out.push({ it: it, c: c }); });
    var cc = cals().filter(function (c) { return c.d.tipo === 'cumple' && calVisible(c); })[0];
    if (cc) {
      var md = ds.slice(8, 10) + '-' + ds.slice(5, 7);
      privados('contacto').forEach(function (k) {
        if (k.d.cumple === md) out.push({ it: { id: k.id, d: { titulo: 'Cumpleaños de ' + nombreC(k.d), aviso: '1440', fecha: ds }, virtual: true }, c: cc });
        var sa = santoDeDatos(k.d); if (santoCae(sa, ds)) out.push({ it: { id: k.id, d: { titulo: 'Santo de ' + nombreC(k.d) + (sa.s !== 'santo' ? ' – ' + sa.s : ''), aviso: '1440', fecha: ds }, virtual: true }, c: cc });
      });
      activos().forEach(function (u) { var su = santoAuto(u.nombre); if (santoCae(su, ds)) out.push({ it: { id: 'u_' + u.id, d: { titulo: 'Santo de ' + u.nombre + ' (familia) – ' + su.s, aviso: '1440', fecha: ds }, virtual: true }, c: cc }); });
    }
    return out.sort(function (x, y) { return (x.it.d.hora || '').localeCompare(y.it.d.hora || ''); });
  }
  function fechaLarga(ds) { var d = parseYmd(ds); return DIAS[d.getDay()] + ' ' + d.getDate() + ' de ' + MESES[d.getMonth()]; }

  /* ================= pantallas ================= */
  var V = {};
  function itemEvento(o, ds) {
    var e = o.it.d;
    var sub = (ds ? fechaLarga(ds) + ' · ' : '') + (e.hora || 'Todo el día') + ' · ' + esc(o.c.d.nombre) + (e.lugar ? ' · ' + esc(e.lugar) : '') + (o.it.sh ? etiquetaComp(o.it) : '');
    return '<div class="item click" data-a="editar" data-id="' + o.it.id + '"><span class="bar" style="background:' + o.c.d.color + '"></span><span class="tx"><b>' + esc(e.titulo) + (o.it.sh ? ' <span class="tag">compartido</span>' : '') + '</b><small>' + sub + '</small></span></div>';
  }
  function bandeja() {
    var p = pendientes();
    if (!p.length) return '';
    return '<h2>Te han enviado</h2><div class="card list">' + p.map(function (x) {
      var k = x.sh.kind, t = x.it.d.titulo || x.it.d.nombre, sub = { evento: 'Evento', nota: 'Nota', lista: 'Lista de compra' }[k] + ' de ' + esc(nombre(x.sh.owner)) + (k === 'evento' ? ' · ' + fechaLarga(x.it.d.fecha) + (x.it.d.hora ? ' ' + x.it.d.hora : '') : '');
      var sel = k === 'evento' ? '<label class="sr" for="cal_' + x.sh.id + '">Calendario</label><select id="cal_' + x.sh.id + '" class="mini">' + cals().filter(function (c) { return c.d.tipo !== 'cumple'; }).map(function (c) { return '<option value="' + c.id + '">' + esc(c.d.nombre) + '</option>'; }).join('') + '</select>' : '';
      return '<div class="item wrap"><span class="tx"><b>' + esc(t) + '</b><small>' + sub + '</small></span>' + sel + '<button class="btn sm pri" data-a="aceptar" data-id="' + x.sh.id + '">Aceptar</button><button class="btn sm" data-a="rechazar" data-id="' + x.sh.id + '">Rechazar</button></div>';
    }).join('') + '</div>';
  }
  V.inicio = function () {
    var h = avisoLaborales() + bandeja();
    var nm = noLeidos();
    if (nm) h += '<div class="note click" data-a="ir" data-v="mensajes">Tienes ' + nm + ' mensaje' + (nm > 1 ? 's' : '') + ' sin leer.</div>';
    h += '<h2>Próximos 14 días</h2><div class="card list">';
    var n = 0;
    for (var i = 0; i < 14 && n < 12; i++) { var ds = ymd(new Date(today.getFullYear(), today.getMonth(), today.getDate() + i)); delDia(ds).forEach(function (o) { if (n < 12) { h += itemEvento(o, ds); n++; } }); }
    if (!n) h += '<div class="empty">Nada en tus calendarios activos. Pulsa + para añadir.</div>';
    h += '</div><h2>Tareas pendientes</h2><div class="card list">';
    var t = privados('tarea').filter(function (x) { return !x.d.hecho && porRama(x.d); }).sort(porVence).slice(0, 5);
    h += (t.length ? t.map(itemTarea).join('') : '<div class="empty">Sin tareas pendientes.</div>') + '</div>';
    return h;
  };
  V.calendario = function () {
    var pc = esPC(), vista = pc ? (dev.calVista || 'mes') : 'mes', sel = parseYmd(S.sel), titulo, h = '';
    if (vista === 'mes') { var m0 = S.month; titulo = MESES[m0.getMonth()][0].toUpperCase() + MESES[m0.getMonth()].slice(1) + ' ' + m0.getFullYear(); }
    else if (vista === 'semana') { var lu = lunesDe(sel), dom = new Date(lu.getFullYear(), lu.getMonth(), lu.getDate() + 6); titulo = lu.getDate() + ' ' + MESES[lu.getMonth()].slice(0, 3) + ' – ' + dom.getDate() + ' ' + MESES[dom.getMonth()].slice(0, 3) + ' ' + dom.getFullYear(); }
    else if (vista === 'dia') titulo = fechaLarga(S.sel).replace(/^./, function (c) { return c.toUpperCase(); }) + ' ' + sel.getFullYear();
    else titulo = String(sel.getFullYear());
    if (pc) h += '<div class="seg vistas" role="group" aria-label="Vista del calendario">' + [['dia', 'Día'], ['semana', 'Semana'], ['mes', 'Mes'], ['anio', 'Año']].map(function (x) { return '<button data-a="calVista" data-v="' + x[0] + '" class="' + (vista === x[0] ? 'on' : '') + '">' + x[1] + '</button>'; }).join('') + '</div>';
    h += '<div class="calhead"><button class="btn" data-a="mes" data-v="-1" aria-label="Anterior">‹</button><b>' + esc(titulo) + '</b><button class="btn" data-a="mes" data-v="1" aria-label="Siguiente">›</button></div>';
    h += '<div class="chips">' + cals().map(function (c) {
      return '<button class="chip' + (c.d.activo === false ? ' off' : '') + '" data-a="calActivo" data-id="' + c.id + '" aria-pressed="' + (c.d.activo !== false) + '"><span class="dot" style="background:' + c.d.color + '"></span>' + esc(c.d.nombre) + '</button>';
    }).join('') + '<button class="chip" data-a="ir" data-v="calendarios">Gestionar calendarios</button><button class="chip" data-a="verPasados" aria-pressed="' + !!S.verPasados + '">' + (S.verPasados ? 'Ocultar eventos pasados' : 'Ver eventos pasados') + '</button></div>' + (S.verPasados ? '<p class="muted">Mostrando también los eventos pasados hasta que salgas del calendario. Para reactivar uno, ábrelo y cámbiale la fecha y la hora.</p>' : '');
    var hoy = ymd(today);
    if (vista === 'mes') {
      var m = S.month, y = m.getFullYear(), mo = m.getMonth();
      h += '<div class="card"><div class="grid mesgrid">';
      ['L', 'M', 'X', 'J', 'V', 'S', 'D'].forEach(function (w) { h += '<span class="wd">' + w + '</span>'; });
      var start = new Date(y, mo, 1 - ((new Date(y, mo, 1).getDay() + 6) % 7));
      for (var i = 0; i < 42; i++) {
        var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i), ds = ymd(d);
        if (i === 35 && d.getMonth() !== mo) break;
        var l = delDia(ds), cls = 'day' + (d.getMonth() !== mo ? ' out' : '') + (ds === hoy ? ' today' : '') + (ds === S.sel ? ' sel' : '');
        h += '<button class="' + cls + '" data-a="dia" data-v="' + ds + '"><span>' + d.getDate() + '</span><span class="dots">' + l.slice(0, 3).map(function (o) { return '<i style="background:' + o.c.d.color + '"></i>'; }).join('') + '</span>' +
          (pc ? '<span class="ttl">' + l.slice(0, 3).map(function (o) { return '<i style="border-left-color:' + o.c.d.color + '">' + esc(o.it.d.titulo) + '</i>'; }).join('') + (l.length > 3 ? '<i class="mas">+' + (l.length - 3) + '</i>' : '') + '</span>' : '') + '</button>';
      }
      h += '</div></div>';
    } else if (vista === 'semana') {
      var lu2 = lunesDe(sel);
      h += '<div class="card semana">';
      for (var k = 0; k < 7; k++) {
        var dd = new Date(lu2.getFullYear(), lu2.getMonth(), lu2.getDate() + k), ds2 = ymd(dd), l2 = delDia(ds2);
        h += '<div class="scol' + (ds2 === S.sel ? ' sel' : '') + (ds2 === hoy ? ' today' : '') + '"><button class="shead" data-a="dia" data-v="' + ds2 + '"><small>' + DIAS[dd.getDay()].slice(0, 3) + '</small><b>' + dd.getDate() + '</b></button>' +
          l2.map(function (o) { return '<button class="sev" data-a="editar" data-id="' + o.it.id + '" style="border-left-color:' + o.c.d.color + '"><small>' + (o.it.d.hora || 'Todo el día') + '</small>' + esc(o.it.d.titulo) + '</button>'; }).join('') + '</div>';
      }
      h += '</div>';
    } else if (vista === 'dia') {
      var ld = delDia(S.sel), todoDia = ld.filter(function (o) { return !o.it.d.hora; }), conHora = ld.filter(function (o) { return o.it.d.hora; });
      var hIni = Math.min.apply(null, [7].concat(conHora.map(function (o) { return +o.it.d.hora.slice(0, 2); })));
      h += '<div class="card diav">' + (todoDia.length ? '<div class="hrow todo"><span class="hl">Todo el día</span><div class="hev">' + todoDia.map(function (o) { return '<button class="sev" data-a="editar" data-id="' + o.it.id + '" style="border-left-color:' + o.c.d.color + '">' + esc(o.it.d.titulo) + '</button>'; }).join('') + '</div></div>' : '');
      for (var hh = hIni; hh <= 23; hh++) {
        var en = conHora.filter(function (o) { return +o.it.d.hora.slice(0, 2) === hh; });
        h += '<div class="hrow"><span class="hl">' + pad(hh) + ':00</span><div class="hev">' + en.map(function (o) { return '<button class="sev" data-a="editar" data-id="' + o.it.id + '" style="border-left-color:' + o.c.d.color + '"><small>' + o.it.d.hora + '</small>' + esc(o.it.d.titulo) + '</button>'; }).join('') + '</div></div>';
      }
      h += '</div>';
    } else {
      var ya = sel.getFullYear();
      h += '<div class="meses anio">';
      for (var mm = 0; mm < 12; mm++) {
        h += '<div class="mmes"><b>' + MESES[mm][0].toUpperCase() + MESES[mm].slice(1) + '</b><div class="mgrid">' + ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(function (w) { return '<span class="wd">' + w + '</span>'; }).join('');
        var off = (new Date(ya, mm, 1).getDay() + 6) % 7, nd = new Date(ya, mm + 1, 0).getDate();
        for (var b = 0; b < off; b++) h += '<span></span>';
        for (var dn = 1; dn <= nd; dn++) {
          var ds3 = ya + '-' + pad(mm + 1) + '-' + pad(dn), l3 = delDia(ds3), col = l3.length ? l3[0].c.d.color : '';
          h += '<button class="md' + (ds3 === hoy ? ' hoy' : '') + (ds3 === S.sel ? ' sel' : '') + (l3.length ? ' con' : '') + '" data-a="diaVista" data-v="' + ds3 + '"' + (col ? ' style="--c:' + col + '"' : '') + ' aria-label="' + dn + ' de ' + MESES[mm] + (l3.length ? ', ' + l3.length + ' eventos' : '') + '">' + dn + '</button>';
        }
        h += '</div></div>';
      }
      h += '</div>';
    }
    var sl = delDia(S.sel);
    return h + '<div class="cal-diaslist"><h2>' + fechaLarga(S.sel).replace(/^./, function (c) { return c.toUpperCase(); }) + '</h2><div class="card list">' + (sl.length ? sl.map(function (o) { return itemEvento(o); }).join('') : '<div class="empty">Sin eventos este día.</div>') + '</div></div>';
  };
  function esPC() { return !!(window.matchMedia && window.matchMedia('(min-width: 900px)').matches); }
  function lunesDe(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)); }
  /* Columna derecha del PC: Eventos | Tareas */
  function lateralHTML() {
    var t = dev.latSel || 'eventos', h = '<div class="seg" role="group" aria-label="Mostrar">' + [['eventos', 'Eventos'], ['tareas', 'Tareas']].map(function (x) { return '<button data-a="latSel" data-v="' + x[0] + '" class="' + (t === x[0] ? 'on' : '') + '">' + x[1] + '</button>'; }).join('') + '</div>';
    var s0 = parseYmd(S.sel);
    if (t === 'eventos') {
      var l = delDia(S.sel);
      h += '<h3>' + fechaLarga(S.sel).replace(/^./, function (c) { return c.toUpperCase(); }) + '</h3>' + (l.length ? l.map(function (o) { return latEvento(o); }).join('') : '<p class="muted">Sin eventos este día.</p>');
      var prox = [];
      for (var i = 1; i <= 7; i++) { var ds = ymd(new Date(s0.getFullYear(), s0.getMonth(), s0.getDate() + i)); delDia(ds).forEach(function (o) { prox.push({ o: o, ds: ds }); }); }
      h += '<h3>Próximos 7 días</h3>' + (prox.length ? prox.map(function (x) { return latEvento(x.o, x.ds); }).join('') : '<p class="muted">Nada en los próximos 7 días.</p>');
    } else {
      var fin = ymd(new Date(s0.getFullYear(), s0.getMonth(), s0.getDate() + 7));
      var ts = privados('tarea').filter(function (x) { return !x.d.hecho && porRama(x.d) && x.d.vence && x.d.vence <= fin; }).sort(porVence);
      var deDia = ts.filter(function (x) { return x.d.vence === S.sel; }), venc = ts.filter(function (x) { return x.d.vence < S.sel; }), luego = ts.filter(function (x) { return x.d.vence > S.sel; });
      h += (venc.length ? '<h3>Vencidas</h3>' + venc.map(function (x) { return latTarea(x); }).join('') : '') + '<h3>' + fechaLarga(S.sel).replace(/^./, function (c) { return c.toUpperCase(); }) + '</h3>' + (deDia.length ? deDia.map(function (x) { return latTarea(x); }).join('') : '<p class="muted">Sin tareas este día.</p>') +
        '<h3>Próximos 7 días</h3>' + (luego.length ? luego.map(function (x) { return latTarea(x); }).join('') : '<p class="muted">Sin tareas en los próximos 7 días.</p>');
    }
    return h;
  }
  function latEvento(o, ds) {
    return '<button class="lev" data-a="editar" data-id="' + o.it.id + '" style="border-left-color:' + o.c.d.color + '"><b>' + esc(o.it.d.titulo) + '</b><small>' + (ds ? fechaLarga(ds) + ' · ' : '') + (o.it.d.hora || 'Todo el día') + ' · ' + esc(o.c.d.nombre) + '</small></button>';
  }
  function latTarea(t) {
    return '<div class="ltar"><input type="checkbox" class="chk" data-a="hecho" data-id="' + t.id + '" aria-label="Hecha"><button class="lev" data-a="editar" data-id="' + t.id + '"><b>' + esc(t.d.titulo) + '</b><small>' + fechaLarga(t.d.vence) + ' · ' + (t.d.prioridad || 'media') + '</small></button></div>';
  }

  V.calendarios = function () {
    var h = '<div class="btns"><button class="btn" data-a="ir" data-v="calendario">‹ Calendario</button><button class="btn pri" data-a="nuevoCal">Nuevo calendario</button></div><h2>Mis calendarios</h2><p class="muted">Son los mismos en las ramas Personal y Trabajo. Toca uno para cambiarle el nombre o el color. Marca varios para moverlos, juntarlos, vaciarlos, borrarlos, mostrarlos u ocultarlos.</p>';
    var sel = S.calSel || (S.calSel = {}), selIds = calSelIds(), marcables = cals().filter(function (c) { return c.d.tipo !== 'cumple'; });
    h += '<label class="f inline"><input type="checkbox" id="calTodos"' + (selIds.length && selIds.length === marcables.length ? ' checked' : '') + '>Seleccionar todos</label><div class="card list">';
    h += cals().map(function (c) {
      var n = eventosDeCal(c.id).length;
      return '<div class="item">' + (c.d.tipo === 'cumple' ? '<span class="chkpad"></span>' : '<input type="checkbox" class="chk calchk" data-cid="' + c.id + '"' + (sel[c.id] ? ' checked' : '') + ' aria-label="Marcar ' + esc(c.d.nombre) + '">') + '<span class="dot" style="background:' + c.d.color + '"></span><span class="tx click" data-a="editar" data-id="' + c.id + '"><b>' + esc(c.d.nombre) + '</b><small>' + (c.d.tipo === 'cumple' ? 'Cumpleaños y santos de tus contactos' + (n ? ' · ' + n + ' eventos' : '') : n + ' eventos') + (/^auto-/.test(c.d.tipo || '') ? (((pref().autoOff || {})[c.d.tipo]) ? ' · sin actualización automática' : ' · se actualiza cada diciembre') : '') + '</small></span><button class="btn sm" data-a="calActivo" data-id="' + c.id + '">' + (c.d.activo === false ? 'Mostrar' : 'Ocultar') + '</button></div>';
    }).join('') + '</div>';
    if (selIds.length) h += '<div class="stickybar wrap"><span>' + selIds.length + ' marcado' + (selIds.length > 1 ? 's' : '') + '</span><div class="btns"><button class="btn sm" data-a="calMover">Mover a</button><button class="btn sm" data-a="calJuntar">Juntar</button><button class="btn sm" data-a="calVaciar">Vaciar todo</button><button class="btn sm del" data-a="calBorrar">Borrar</button><button class="btn sm" data-a="calMostrar">Mostrar</button><button class="btn sm" data-a="calOcultar">Ocultar</button></div></div>';
    var auto = pref().festivosAuto, y = today.getFullYear(), offs = Object.keys(pref().autoOff || {}).filter(function (k) { return (pref().autoOff || {})[k]; });
    h += '<h2>Festivos automáticos</h2><div class="card pad col">' + (auto
      ? '<p class="muted">Activados: FIESTAS LABORALES (España + Comunidad de Madrid), Festivos Rumanía y Fiestas ortodoxas. Cada diciembre se añade el año siguiente; lo que añadas o corrijas a mano nunca se cambia.</p><div class="row2"><label class="f">Año<select id="festYear"><option>' + y + '</option><option' + (today.getMonth() === 11 ? ' selected' : '') + '>' + (y + 1) + '</option></select></label><div class="btns" style="align-self:end"><button class="btn" data-a="actualizarFestivosYa">Actualizar ahora</button></div></div>' + (offs.length ? '<p class="muted">Hay ' + offs.length + ' calendario' + (offs.length > 1 ? 's' : '') + ' automático' + (offs.length > 1 ? 's' : '') + ' desactivado' + (offs.length > 1 ? 's' : '') + '.</p><div class="btns"><button class="btn" data-a="activarFestivos">Volver a activarlos</button></div>' : '')
      : '<p class="muted">Crea tres calendarios que se rellenan solos: FIESTAS LABORALES (nacionales de España y Comunidad de Madrid), Festivos Rumanía y Fiestas ortodoxas.</p><div class="btns"><button class="btn pri" data-a="activarFestivos">Activar festivos automáticos</button></div>') +
      '<p class="muted">Festivos de Alcalá de Henares y puentes de tu empresa:</p><div class="btns"><button class="btn" data-a="marcarAnio" data-v="' + (today.getMonth() === 11 ? y + 1 : y) + '">Opción A: añadir festivos del año</button><button class="btn" data-a="opcionB">Opción B: importar el .ics que te haga Claude</button></div></div>';
    h += '<h2>Importar</h2><div class="card pad col"><span class="muted">Archivos .ics de Google Calendar (Configuración › Importar y exportar › Exportar) u otros. Solo se importan los eventos de hoy en adelante (y los que se repiten). Antes te pregunto en qué calendario guardarlos y qué hacer con los duplicados.</span><div class="btns"><button class="btn" data-a="importar" data-v="ics">Importar archivos .ics</button></div>' +
      '<label class="f">O la dirección pública de un calendario (.ics)<input id="icsUrl" type="url" placeholder="https://…/basic.ics"></label><div class="btns"><button class="btn" data-a="icsUrl">Importar desde dirección</button></div><span class="hint">Muchos servidores (Google incluido) no dejan leerlos desde una web; si falla, descarga el archivo y usa el botón de arriba.</span></div>';
    return h;
  };
  function porVence(a, b) { return (a.d.vence || '9999').localeCompare(b.d.vence || '9999'); }
  function itemTarea(t) {
    var pr = { alta: '#B91C1C', media: '#B45309', baja: '#475569' }[t.d.prioridad || 'media'];
    return '<div class="item' + (t.d.hecho ? ' done' : '') + '"><input type="checkbox" class="chk" data-a="hecho" data-id="' + t.id + '"' + (t.d.hecho ? ' checked' : '') + ' aria-label="Hecha"><span class="tx click" data-a="editar" data-id="' + t.id + '"><b>' + esc(t.d.titulo) + '</b><small>' + (t.d.vence ? 'Vence ' + fechaLarga(t.d.vence) + ' · ' : '') + (t.d.proyecto ? esc(t.d.proyecto) + ' · ' : '') + '<span style="color:' + pr + '">' + (t.d.prioridad || 'media') + '</span></small></span></div>';
  }
  V.tareas = function () {
    var f = S.tfiltro, l = privados('tarea').filter(function (t) { return porRama(t.d) && (f === 'todas' || (f === 'pend' ? !t.d.hecho : t.d.hecho)); }).sort(porVence);
    return '<div class="chips">' + [['pend', 'Pendientes'], ['hechas', 'Hechas (ocultas)'], ['todas', 'Todas']].map(function (x) { return '<button class="chip' + (f === x[0] ? '' : ' off') + '" data-a="tfiltro" data-v="' + x[0] + '">' + x[1] + '</button>'; }).join('') +
      '</div><div class="card list">' + (l.length ? l.map(itemTarea).join('') : '<div class="empty">No hay tareas aquí.</div>') + '</div>';
  };
  function tel(t) { return String(t || '').replace(/[^\d+]/g, ''); }
  V.notas = function () {
    var l = todos('nota').filter(function (n) { return porRama(n.d); }).sort(function (a, b) { return b.rec.upd - a.rec.upd; });
    return bandeja() + '<div class="btns"><a class="btn" href="https://www.onenote.com/notebooks" target="_blank" rel="noopener">Abrir OneNote</a><a class="btn" href="https://drive.google.com" target="_blank" rel="noopener">Abrir Google Drive</a></div><div class="card list">' +
      (l.length ? l.map(function (n) {
        return '<div class="item"><span class="tx click" data-a="editar" data-id="' + n.id + '"><b>' + esc(n.d.titulo) + (n.sh ? ' <span class="tag">compartida</span>' : '') + '</b><small>' + esc((n.d.texto || '').slice(0, 80)) + etiquetaComp(n) + '</small></span>' + (n.d.enlace ? '<a class="btn sm" href="' + esc(n.d.enlace) + '" target="_blank" rel="noopener">Abrir</a>' : '') + '</div>';
      }).join('') : '<div class="empty">Sin notas. Pulsa + para crear una.</div>') + '</div>';
  };
  V.accesos = function () {
    var l = privados('acceso').filter(function (a) { return porRama(a.d); });
    var h = '<div class="safe">Atajos a apps y webs, no contraseñas. Las claves van en tu gestor de contraseñas; de las tarjetas, solo los 4 últimos dígitos. Nadie más de la familia ve tus accesos.</div>';
    if (!l.length) h += '<div class="btns"><button class="btn" data-a="accesosEjemplo">Añadir accesos de ejemplo</button></div>';
    TIPOS_ACCESO.forEach(function (t) {
      var g = l.filter(function (a) { return (a.d.cat || 'Otro') === t; });
      if (!g.length) return;
      h += '<div class="grp">' + esc(t) + '</div><div class="card list">' + g.map(function (a) {
        return '<div class="item"><span class="tx click" data-a="editar" data-id="' + a.id + '"><b>' + esc(a.d.nombre) + '</b><small>' + esc([a.d.usuario, a.d.ultimos4 ? '•••• ' + a.d.ultimos4 : ''].filter(Boolean).join(' · ')) + '</small></span>' + (a.d.enlace ? '<a class="btn sm pri" href="' + esc(a.d.enlace) + '" target="_blank" rel="noopener">Abrir</a>' : '') + '</div>';
      }).join('') + '</div>';
    });
    return h;
  };
  function itemsDe(listaId) { return Object.keys(D).map(item).filter(function (it) { return it && it.d.k === 'item' && it.d.lista === listaId && !it.d.papelera; }); }
  /* --- mensajes --- */
  function chatCon(uid) { return recs('share').filter(function (s) { return s.kind === 'chat' && !s.fam && s.members.length === 2 && s.members.indexOf(uid) >= 0 && s.members.indexOf(ME.id) >= 0; }).sort(function (a, b) { return a.id.localeCompare(b.id); })[0] || null; }
  function msgs(sid) { return Object.keys(D).map(item).filter(function (it) { return it && it.d.k === 'msg' && it.rec.share === sid; }).sort(function (a, b) { return a.d.at - b.d.at; }); }
  function lastRead(sid) { var lr = dev.lastRead[ME.id] || {}; return lr[sid] || 0; }
  function sinLeer(sid) { return msgs(sid).filter(function (m) { return m.rec.by !== ME.id && m.d.at > lastRead(sid); }).length; }
  function noLeidos() { return recs('share').filter(function (s) { return s.kind === 'chat' && SK[s.id]; }).reduce(function (n, s) { return n + sinLeer(s.id); }, 0); }
  V.mensajes = function () {
    if (S.chat) {
      var c = S.chat, sid = c === 'fam' ? (famChat() || {}).id : (chatCon(c) || {}).id;
      var titulo = c === 'fam' ? 'Familia (todos)' : nombre(c);
      if (sid) { dev.lastRead[ME.id] = dev.lastRead[ME.id] || {}; dev.lastRead[ME.id][sid] = Date.now(); saveDev(); }
      var l = sid && SK[sid] ? msgs(sid) : [];
      return '<div class="btns"><button class="btn" data-a="cerrarChat">‹ Conversaciones</button></div><h2>' + esc(titulo) + '</h2><div class="chat">' +
        (l.length ? l.map(function (m) {
          var mio = m.rec.by === ME.id, d = new Date(m.d.at);
          return '<div class="bub' + (mio ? ' mio' : '') + '">' + (c === 'fam' && !mio ? '<b>' + esc(nombre(m.rec.by)) + '</b>' : '') + '<span>' + esc(m.d.t) + '</span><small>' + d.getDate() + '/' + (d.getMonth() + 1) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + '</small></div>';
        }).join('') : '<div class="empty">Aún no hay mensajes.</div>') +
        '</div><form class="card addrow" data-msg="1"><label class="sr" for="msgT">Mensaje</label><input id="msgT" placeholder="Escribe un mensaje…" autocomplete="off"><button class="btn pri" type="submit">Enviar</button></form>';
    }
    var h = bandeja() + '<div class="btns"><a class="btn" href="mailto:">Abrir mi correo</a><a class="btn" href="https://wa.me/" target="_blank" rel="noopener">WhatsApp</a><a class="btn" href="weixin://">WeChat</a><a class="btn" href="tel:">Teléfono</a></div><p class="muted">Los mensajes de aquí solo se ven dentro de la app; no se envía nada a correos ni teléfonos.</p><div class="card list">';
    var fc = famChat(), nf = fc && SK[fc.id] ? sinLeer(fc.id) : 0;
    h += '<div class="item click" data-a="abrirChat" data-v="fam"><span class="avatar" style="background:#15171C">F</span><span class="tx"><b>Familia (todos)</b><small>Grupo con todos los usuarios</small></span>' + (nf ? '<span class="badge">' + nf + '</span>' : '') + '</div>';
    activos().filter(function (u) { return u.id !== ME.id; }).forEach(function (u) {
      var ch = chatCon(u.id), n = ch && SK[ch.id] ? sinLeer(ch.id) : 0, ult = ch && SK[ch.id] ? msgs(ch.id).slice(-1)[0] : null;
      h += '<div class="item click" data-a="abrirChat" data-v="' + u.id + '"><span class="avatar" style="background:' + u.color + '">' + esc(u.nombre[0]) + '</span><span class="tx"><b>' + esc(u.nombre) + '</b><small>' + (ult ? esc(ult.d.t.slice(0, 60)) : 'Sin mensajes') + '</small></span>' + (n ? '<span class="badge">' + n + '</span>' : '') + '</div>';
    });
    if (activos().length < 2) h += '<div class="empty">Cuando el admin cree más usuarios y entren, podrás escribirles aquí.</div>';
    return h + '</div>';
  };
  /* --- ajustes --- */
  function conexionHTML() {
    var con = window.Sync.connected();
    return '<div class="card pad"><label class="f">ID de aplicación (Client ID)<input id="cid" value="' + esc(dev.clientId || '') + '" placeholder="00000000-0000-0000-0000-000000000000"><span class="hint">Dirección de retorno registrada en Azure: <code>' + esc(window.Sync.redirectUri()) + '</code></span></label>' +
      '<p class="muted"><b>Admin:</b> conecta con tu cuenta Microsoft personal; la carpeta común <code>MiAgendaFamilia</code> se crea en tu OneDrive. <b>Miembros:</b> conecta con tu propia cuenta Microsoft, después de abrir el enlace de invitación del admin. Nadie ve el correo ni la contraseña de otros.</p>' + estadoCarpeta() + '<div class="btns">' +
      (con ? '<button class="btn pri" data-a="syncNow">Sincronizar ahora</button><button class="btn" data-a="logoutMS">Desconectar OneDrive</button>' : '<button class="btn pri" data-a="loginMS">Conectar con OneDrive</button>') + '</div></div>';
  }
  function estadoCarpeta() {
    var t = window.Sync.target();
    if (!window.Sync.connected()) return '';
    if (!t) return '<p class="note">Conectado, pero aún sin carpeta común. Si eres miembro, abre el enlace de invitación que te mandó el admin.</p>';
    return '<p class="muted">Carpeta común: ' + (t.own ? 'en tu OneDrive (eres quien la guarda)' : 'compartida por el administrador') + '.</p>';
  }
  V.ajustes = function () {
    var u = me();
    var h = '<h2>Mi cuenta</h2><div class="card pad"><div class="row"><span class="avatar lg" style="background:' + u.color + '">' + esc(u.nombre[0]) + '</span><span class="tx"><b>' + esc(u.nombre) + '</b><small>' + (u.rol === 'admin' ? 'Administrador' : 'Miembro') + (u.ficticio ? ' · usuario de prueba' : '') + '</small></span></div>' +
      '<div class="btns"><button class="btn" data-a="miColor">Cambiar mi color</button><button class="btn" data-a="cambiarPw">Cambiar contraseña</button><button class="btn" data-a="cambiarUsuario">Cambiar de usuario</button></div></div>';
    h += '<h2>Sincronización</h2>' + conexionHTML();
    h += '<h2>Mis calendarios</h2><div class="card pad"><div class="btns"><button class="btn" data-a="ir" data-v="calendarios">Crear, editar, importar o borrar calendarios</button></div></div>';
    h += apariencia();
    h += googleHTML();
    var np = enPapelera().length, pl = pref().plazoPapelera || 90;
    h += '<h2>Papelera</h2><div class="card pad col"><div class="btns"><button class="btn" data-a="ir" data-v="papelera">Abrir papelera (' + np + ')</button></div><label class="f">Eliminar definitivamente lo que lleve en la papelera más de<select id="plazoSel">' + [[30, '1 mes'], [90, '3 meses'], [365, '1 año']].map(function (o) { return '<option value="' + o[0] + '"' + (pl === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label></div>';
    h += '<h2>Importar contactos</h2><div class="card pad"><div class="btns"><button class="btn" data-a="importar" data-v="contactos">Importar de Google (CSV o vCard)</button></div></div>';
    h += '<h2>Sugerencias y solicitudes</h2><div class="card pad"><p class="muted">Pide cambios o mejoras de la app. Le llegan al administrador.</p><form data-sug="1" class="col"><label class="f">Tu sugerencia<textarea id="sugT" placeholder="Me gustaría que…"></textarea></label><button class="btn pri" type="submit">Enviar sugerencia</button></form>' + misSugerencias() + '</div>';
    h += '<h2>Avisos</h2><div class="card pad"><span class="muted">La app avisa mientras está abierta. Para alarmas seguras, abre un evento y pulsa "Añadir al calendario del móvil".</span><div class="btns"><button class="btn" data-a="permisoAvisos">Permitir notificaciones</button></div></div>';
    h += '<h2>Mis datos</h2><div class="card pad"><p class="muted">Exporta tus datos (cifrados con una contraseña que elijas) para guardarlos o llevarlos a otra familia.</p><div class="btns"><button class="btn" data-a="exportarMios">Exportar mis datos</button><button class="btn" data-a="importar" data-v="mios">Importar mis datos</button></div>' +
      '<div class="danger"><b>Salir de la familia</b><p class="muted">Borra tu usuario y todos tus datos de la base de datos, sin dejar rastro. Antes podrás exportarlos.</p><button class="btn del" data-a="borrarme">Salir y borrar mis datos</button></div></div>';
    return h;
  };
  function sugs() { return recs('share').filter(function (s) { return s.kind === 'sug' && SK[s.id]; }).map(function (s) { return item(s.root); }).filter(Boolean).sort(function (a, b) { return b.d.at - a.d.at; }); }
  function misSugerencias() {
    var l = sugs().filter(function (s) { return s.rec.by === ME.id; });
    if (!l.length) return '';
    return '<div class="grp">Mis sugerencias</div><div class="card list">' + l.map(function (s) {
      return '<div class="item"><span class="tx"><b>' + esc(s.d.texto.slice(0, 120)) + '</b><small>' + esc(s.d.estado || 'pendiente') + (s.d.respuesta ? ' · Respuesta: ' + esc(s.d.respuesta) : '') + '</small></span></div>';
    }).join('') + '</div>';
  }
  /* --- admin --- */
  V.admin = function () {
    if (!isAdmin()) return '<div class="empty">Solo para administradores.</div>';
    var h = '<div class="safe">Como administrador gestionas usuarios y sugerencias. No puedes ver los datos de nadie: están cifrados con la contraseña de cada uno.</div>';
    h += '<h2>Usuarios</h2><div class="card list">' + usuarios().map(function (u) {
      var acts = '';
      if (u.estado === 'invitado') acts += '<button class="btn sm" data-a="codigo" data-id="' + u.id + '">Nuevo código y enlace</button>';
      if (u.id !== ME.id && !u.ficticio) acts += '<button class="btn sm" data-a="darAcceso" data-id="' + u.id + '">' + (u.perm ? 'Acceso OneDrive ✓' : 'Dar acceso OneDrive') + '</button>';
      if (u.id !== ME.id) acts += '<button class="btn sm" data-a="rol" data-id="' + u.id + '">' + (u.rol === 'admin' ? 'Quitar admin' : 'Hacer admin') + '</button><button class="btn sm del" data-a="borrarUsuario" data-id="' + u.id + '">Borrar</button>';
      return '<div class="item wrap"><span class="avatar" style="background:' + u.color + '">' + esc(u.nombre[0]) + '</span><span class="tx"><b>' + esc(u.nombre) + (u.ficticio ? ' <span class="tag">prueba</span>' : '') + '</b><small>' + (u.rol === 'admin' ? 'Admin' : 'Miembro') + ' · ' + (u.estado === 'invitado' ? 'pendiente de entrar' : 'activo') + '</small></span>' + acts + '</div>';
    }).join('') + '</div>';
    h += '<h2>Nuevo usuario</h2><form class="card pad col" data-nuevousuario="1"><label class="f">Nombre<input id="nuNombre" required maxlength="40"></label><label class="f">Color<input id="nuColor" type="color" value="' + COLORES[usuarios().length % COLORES.length] + '"></label><label class="f">Rol<select id="nuRol"><option value="miembro">Miembro</option><option value="admin">Administrador</option></select></label><label class="f">Correo de su cuenta Microsoft (opcional)<input id="nuEmail" type="email" autocomplete="off"><span class="hint">Solo para dar acceso a la carpeta común en tu OneDrive, y así pueda usar la app en sus dispositivos. No se guarda en la app ni lo ven los demás. Déjalo vacío para usuarios de prueba.</span></label><label class="f inline"><input id="nuFict" type="checkbox">Usuario de prueba (ficticio)</label><button class="btn pri" type="submit">Crear y obtener código de invitación</button></form>';
    h += '<h2>Modo prueba</h2><div class="card pad"><p class="muted">Crea usuarios ficticios con datos de ejemplo para probar: Ana, Luis y Abuela (contraseña de todos: <code>prueba1</code>). Cuando quieras, bórralos o resetea todo.</p><div class="btns"><button class="btn" data-a="crearFicticios">Crear usuarios ficticios</button><button class="btn del" data-a="borrarFicticios">Borrar todos los ficticios</button></div></div>';
    var l = sugs();
    h += '<h2>Sugerencias recibidas</h2><div class="card list">' + (l.length ? l.map(function (s) {
      return '<div class="item wrap"><span class="tx"><b>' + esc(s.d.texto) + '</b><small>De ' + esc(nombre(s.rec.by)) + ' · ' + new Date(s.d.at).toLocaleDateString('es-ES') + ' · ' + esc(s.d.estado || 'pendiente') + (s.d.respuesta ? ' · ' + esc(s.d.respuesta) : '') + '</small></span><button class="btn sm" data-a="responderSug" data-id="' + s.id + '">Responder</button></div>';
    }).join('') : '<div class="empty">No hay sugerencias.</div>') + '</div><div class="btns"><button class="btn" data-a="exportarSugs">Descargar sugerencias (.txt) para pedir los cambios</button></div>';
    h += '<h2>Zona peligrosa</h2><div class="card pad danger"><p class="muted">Resetear a cero borra TODOS los usuarios y datos de la familia, también en OneDrive. Úsalo al terminar la prueba para empezar con los usuarios reales.</p><button class="btn del" data-a="resetear">Resetear todo a cero</button></div>';
    return h;
  };
  /* --- búsqueda --- */
  function buscar(q) {
    q = q.toLowerCase();
    var tipos = { evento: 'Calendario', tarea: 'Tareas', contacto: 'Contactos', nota: 'Notas', acceso: 'Accesos', lista: 'Compras', item: 'Artículos de listas', msg: 'Mensajes' };
    var h = '', total = 0;
    Object.keys(tipos).forEach(function (k) {
      var l = Object.keys(D).map(item).filter(function (it) { return it && it.d.k === k && !it.d.papelera && (k !== 'evento' && k !== 'nota' && k !== 'lista' || !it.sh || aceptado(it.sh)) && JSON.stringify(it.d).toLowerCase().indexOf(q) >= 0; });
      if (!l.length) return;
      total += l.length;
      h += '<div class="grp">' + tipos[k] + ' · ' + l.length + '</div><div class="card list">' + l.slice(0, 30).map(function (it) {
        var t = k === 'contacto' ? nombreC(it.d) : (it.d.titulo || it.d.nombre || it.d.t || ''), pasado = k === 'evento' && it.d.fecha < hoyStr() && (!it.d.repetir || it.d.repetir === 'no'), sub = it.d.fecha ? fechaLarga(it.d.fecha) + (pasado ? ' · pasado' : '') : (k === 'contacto' ? [telsDe(it.d)[0] && telsDe(it.d)[0].v, mailsDe(it.d)[0] && mailsDe(it.d)[0].v].filter(Boolean).join(' · ') : '');
        var act = k === 'item' ? 'data-a="abrirLista" data-id="' + it.d.lista + '"' : k === 'lista' ? 'data-a="abrirLista" data-id="' + it.id + '"' : k === 'msg' ? '' : 'data-a="editar" data-id="' + it.id + '"';
        return '<div class="item click" ' + act + '><span class="tx"><b>' + esc(t.slice(0, 80)) + '</b><small>' + esc(sub) + '</small></span></div>';
      }).join('') + '</div>';
    });
    return '<p class="muted">' + total + ' resultados para "' + esc(q) + '"</p>' + (h || '<div class="card empty">No se ha encontrado nada.</div>');
  }

  /* --- entrada: bienvenida y elegir usuario --- */
  function pantallaEntrada() {
    var us = usuarios();
    if (dev.join && !us.length) {
      return '<div class="welcome"><h2>Te han invitado a una familia</h2><div class="note">Paso 1: conecta con <b>tu</b> cuenta Microsoft (la que diste al administrador). Paso 2: aparecerán los usuarios; toca tu nombre y escribe tu código.</div>' + conexionHTML() + '<div class="btns"><button class="btn" data-a="cancelarUnirse">No es para mí</button></div></div>';
    }
    if (!us.length) {
      return '<div class="welcome"><h2>Bienvenido a Mi Agenda Familia</h2>' +
        '<form class="card pad col" data-pegarenlace="1"><label class="f">¿Te han enviado un enlace de invitación? Pégalo aquí<input id="pegaLink" placeholder="https://…#unirse=…"></label><button class="btn" type="submit">Usar enlace</button></form>' +
        '<div class="note">¿Eres el administrador y ya usas la app en otro dispositivo? Conecta OneDrive con tu cuenta y aparecerán los usuarios.</div>' + conexionHTML() +
        '<h2>Empezar desde cero</h2><form class="card pad col" data-crearfamilia="1"><p class="muted">Crearás el usuario <b>administrador</b>. El admin crea y borra usuarios, pero no puede ver sus datos.</p><label class="f">Tu nombre<input id="cfNombre" required maxlength="40"></label><label class="f">Contraseña (mínimo 6 caracteres)<input id="cfPw" type="password" required minlength="6" autocomplete="new-password"></label><label class="f">Repite la contraseña<input id="cfPw2" type="password" required minlength="6" autocomplete="new-password"></label><button class="btn pri" type="submit">Crear familia</button></form>' +
        '<h2>Solo quiero probar</h2><div class="card pad"><p class="muted">Crea una familia ficticia: Admin (contraseña <code>admin123</code>), Ana, Luis y Abuela (contraseña <code>prueba1</code>), con datos de ejemplo. Luego podrás borrarla y empezar de verdad.</p><button class="btn" data-a="familiaPrueba">Crear familia de prueba</button></div></div>';
    }
    if (dev.join && !S.loginUser && U(dev.join.uid)) S.loginUser = dev.join.uid;
    var u = S.loginUser && U(S.loginUser);
    if (u) {
      var inv = u.estado === 'invitado';
      return '<div class="welcome"><button class="btn" data-a="loginAtras">‹ Usuarios</button><div class="loginbox"><span class="avatar xl" style="background:' + u.color + '">' + esc(u.nombre[0]) + '</span><h2>' + esc(u.nombre) + '</h2>' +
        (inv ? '<form class="col" data-activar="1"><p class="muted">Primera vez: escribe el código que te dio el admin y elige tu contraseña. Nadie más la sabrá; si la olvidas, tus datos no se pueden recuperar.</p><label class="f">Código de invitación<input id="acCode" required autocomplete="off" placeholder="ABCD-1234"></label><label class="f">Nueva contraseña (mínimo 6)<input id="acPw" type="password" required minlength="6" autocomplete="new-password"></label><label class="f">Repite la contraseña<input id="acPw2" type="password" required minlength="6" autocomplete="new-password"></label><label class="f inline"><input id="acRec" type="checkbox" checked>Recordar en este dispositivo</label><button class="btn pri" type="submit">Entrar</button></form>'
          : '<form class="col" data-login="1"><label class="f">Contraseña<input id="lgPw" type="password" required autocomplete="current-password"></label><label class="f inline"><input id="lgRec" type="checkbox">Recordar en este dispositivo</label><button class="btn pri" type="submit">Entrar</button></form>') + '</div></div>';
    }
    return '<div class="welcome"><h2>¿Quién eres?</h2><div class="users">' + us.map(function (x) {
      return '<button class="ubtn" data-a="loginUser" data-id="' + x.id + '"><span class="avatar xl" style="background:' + x.color + '">' + esc(x.nombre[0]) + '</span><span>' + esc(x.nombre) + '</span>' + (x.estado === 'invitado' ? '<small>nuevo</small>' : '') + '</button>';
    }).join('') + '</div><h2>Conexión</h2>' + conexionHTML() + '</div>';
  }

  /* ================= render ================= */
  var MODS = [['inicio', 'Inicio'], ['calendario', 'Calendario'], ['tareas', 'Tareas'], ['contactos', 'Contactos'], ['notas', 'Notas'], ['accesos', 'Accesos'], ['compras', 'Compras'], ['mensajes', 'Mensajes'], ['ajustes', 'Ajustes']];
  function render() {
    aplicarTema();
    var logged = !!(ME && me());
    document.body.classList.toggle('out', !logged);
    if (!logged) { $('#main').innerHTML = pantallaEntrada(); $('#nav').innerHTML = ''; $('#who').innerHTML = ''; $('#lateral').innerHTML = ''; document.body.classList.remove('conlateral'); tick(); return; }
    if (!V[S.view] || (S.view === 'admin' && !isAdmin())) S.view = 'inicio';
    var u = me();
    document.body.classList.toggle('trabajo', rama() === 'trabajo');
    $('#who').innerHTML = '<span class="avatar" style="background:' + u.color + '">' + esc(u.nombre[0]) + '</span><span>' + esc(u.nombre) + '</span>';
    document.querySelectorAll('.seg button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === rama()); });
    var mods = MODS.slice(); if (isAdmin()) mods.push(['admin', 'Admin']);
    var nm = noLeidos(), np = pendientes().length;
    $('#nav').innerHTML = mods.map(function (m) {
      var n = m[0] === 'mensajes' ? nm : m[0] === 'inicio' ? np : 0;
      var on = (S.view === m[0] || ((S.view === 'calendarios' || S.view === 'marcar') && m[0] === 'calendario') || ((S.view === 'duplicados' || S.view === 'revisarNombres' || S.view === 'gestionar') && m[0] === 'contactos') || (S.view === 'papelera' && m[0] === 'ajustes')) && !S.q;
      return '<a href="#' + m[0] + '" class="' + (on ? 'on' : '') + '">' + svg(m[0]) + '<span>' + m[1] + '</span>' + (n ? '<i class="nb">' + n + '</i>' : '') + '</a>';
    }).join('') + '<div class="reloj-nav" data-a="irHoy" role="button" tabindex="0" aria-label="Ir a hoy">' + relojHTML() + '</div>';
    tick();
    $('#main').innerHTML = S.q ? buscar(S.q) : V[S.view]();
    var conLat = S.view === 'calendario' && !S.q; document.body.classList.toggle('conlateral', conLat);
    $('#lateral').innerHTML = conLat ? lateralHTML() : '';
    $('#fab').hidden = ['ajustes', 'admin', 'mensajes', 'calendarios', 'papelera', 'duplicados', 'marcar', 'revisarNombres', 'gestionar'].indexOf(S.view) >= 0 && !S.q;
    if (S.view === 'mensajes' && S.chat) { var ch = document.querySelector('.chat'); if (ch) ch.scrollTop = ch.scrollHeight; }
  }

  /* ================= formularios ================= */
  var RAMAS = [['personal', 'Personal'], ['trabajo', 'Trabajo'], ['ambas', 'Ambas']];
  function calOpts() { return cals().filter(function (c) { return c.d.tipo !== 'cumple'; }).map(function (c) { return [c.id, c.d.nombre]; }); }
  var FORMS = {
    evento: ['Evento', [['titulo', 'Título', 'text', 1], ['fecha', 'Fecha', 'date', 1], ['hora', 'Hora (vacío = todo el día)', 'time'], ['cal', 'Calendario', calOpts],
      ['repetir', 'Repetir', [['no', 'No'], ['anual', 'Cada año'], ['mensual', 'Cada mes'], ['semanal', 'Cada semana'], ['diario', 'Cada día']]], ['hasta', 'Repetir hasta (opcional)', 'date'],
      ['aviso', 'Aviso', [['', 'Sin aviso'], ['0', 'A la hora'], ['10', '10 min antes'], ['30', '30 min antes'], ['60', '1 hora antes'], ['720', '12 horas antes'], ['1440', '1 día antes'], ['4320', '3 días antes']]],
      ['lugar', 'Lugar', 'text'], ['notas', 'Notas', 'textarea']]],
    tarea: ['Tarea', [['titulo', 'Tarea', 'text', 1], ['vence', 'Fecha límite', 'date'], ['prioridad', 'Prioridad', [['media', 'Media'], ['alta', 'Alta'], ['baja', 'Baja']]], ['rama', 'Rama', RAMAS], ['proyecto', 'Proyecto o categoría', 'text'], ['notas', 'Notas', 'textarea'], ['hecho', 'Hecha', 'checkbox']]],
    nota: ['Nota', [['titulo', 'Título', 'text', 1], ['texto', 'Texto', 'textarea'], ['enlace', 'Enlace (OneNote, Drive…)', 'url'], ['etiquetas', 'Etiquetas', 'text'], ['rama', 'Rama', RAMAS]]],
    acceso: ['Acceso', [['nombre', 'Nombre (ej. Mi banco)', 'text', 1], ['cat', 'Tipo', TIPOS_ACCESO.map(function (t) { return [t, t]; })], ['enlace', 'Enlace o app (https://…, tel:…)', 'text'], ['usuario', 'Usuario (nunca la contraseña)', 'text'], ['ultimos4', 'Tarjeta: solo 4 últimos dígitos', 'text'], ['rama', 'Rama', RAMAS], ['notas', 'Notas', 'textarea']]],
    lista: ['Lista de compra (una por tienda)', [['nombre', 'Nombre de la lista', 'text', 1], ['tienda', 'Tienda', 'text'], ['tipoTienda', 'Tipo de tienda', [['fisica', 'Tienda física'], ['online', 'Tienda online (Amazon…)']]], ['rama', 'Rama', RAMAS]]],
    cal: ['Calendario', [['nombre', 'Nombre', 'text', 1], ['color', 'Color', 'color'], ['activo', 'Visible', 'checkbox']]]
  };
  var NUEVO = { inicio: 'evento', calendario: 'evento', tareas: 'tarea', contactos: 'contacto', notas: 'nota', accesos: 'acceso', compras: 'lista' };

  function abrirForm(k, it, opts) {
    opts = opts || {};
    var def = FORMS[k], nuevo = !it;
    var d = it ? Object.assign({}, it.d) : { k: k, rama: rama() === 'todo' ? 'personal' : rama(), fecha: S.sel, vence: k === 'tarea' && opts.switchET ? S.sel : '', prioridad: 'media', repetir: 'no', activo: true, color: COLORES[cals().length % COLORES.length] };
    if (k === 'evento' && !d.cal) { var c0 = calOpts().filter(function (o) { var c = item(o[0]); return c && porRama(c.d); })[0] || calOpts()[0]; d.cal = c0 ? c0[0] : ''; }
    if (k === 'evento' && it && it.sh) d.cal = (acc(it.sh.id, ME.id) || {}).cal || d.cal;
    var esMio = !it || !it.sh || it.sh.owner === ME.id;
    $('#frm').onclick = null; $('#frm').onchange = null;
    var h = (opts.switchET && nuevo ? '<div class="seg" role="group" aria-label="Tipo de registro"><button type="button" data-et="evento" class="' + (k === 'evento' ? 'on' : '') + '">Evento</button><button type="button" data-et="tarea" class="' + (k === 'tarea' ? 'on' : '') + '">Tarea</button></div>' : '') + '<h3>' + (nuevo ? 'Nuevo: ' : '') + def[0] + '</h3>';
    if (k === 'evento' && it && it.d.fecha < hoyStr() && (!it.d.repetir || it.d.repetir === 'no')) h += '<p class="note">Evento pasado (oculto). Para reactivarlo, cámbiale la fecha y la hora y guarda.</p>';
    if (k === 'tarea' && it && it.d.hecho) h += '<p class="note">Tarea hecha (oculta). Para reactivarla, desmarca «Hecha» y ponle un nuevo plazo.</p>';
    if (it && it.sh) h += '<p class="note">' + (it.sh.owner === ME.id ? 'Compartido con: ' + esc(miembrosTxt(it.sh)) : 'Compartido por ' + esc(nombre(it.sh.owner)) + '. Los cambios se ven en todos los miembros.') + '</p>';
    def[1].forEach(function (f) {
      var key = f[0], v = d[key] == null ? '' : d[key], t = typeof f[2] === 'function' ? f[2]() : f[2];
      if (Array.isArray(t)) h += '<label class="f">' + f[1] + '<select name="' + key + '">' + t.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(v) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>';
      else if (t === 'textarea') h += '<label class="f">' + f[1] + '<textarea name="' + key + '">' + esc(v) + '</textarea></label>';
      else if (t === 'checkbox') h += '<label class="f inline"><input type="checkbox" name="' + key + '"' + (v ? ' checked' : '') + '>' + f[1] + '</label>';
      else h += '<label class="f">' + f[1] + '<input type="' + t + '" name="' + key + '" value="' + esc(v) + '"' + (f[3] ? ' required' : '') + (key === 'cumple' ? ' placeholder="15-12" pattern="\\d{2}-\\d{2}"' : '') + (key === 'ultimos4' ? ' inputmode="numeric" maxlength="4" pattern="\\d{4}"' : '') + '></label>';
    });
    var b = '<button class="btn pri" value="ok">Guardar</button><button class="btn" value="cancel" formnovalidate>Cancelar</button>';
    if (it && k === 'evento') b += '<button class="btn" type="button" data-a="ics" data-id="' + it.id + '">Añadir al calendario del móvil</button>';
    if (it && ['evento', 'nota', 'lista'].indexOf(k) >= 0 && esMio && activos().length > 1) b += '<button class="btn" type="button" data-a="compartir" data-id="' + it.id + '">' + (k === 'evento' ? 'Enviar a…' : 'Compartir con…') + '</button>';
    if (it && it.sh && esMio) b += '<button class="btn" type="button" data-a="dejarCompartir" data-id="' + it.id + '">Dejar de compartir</button>';
    if (it && it.sh && !esMio) b += '<button class="btn del" type="button" data-a="salirCompartido" data-id="' + it.id + '">Quitar de mi agenda</button>';
    if (it && esMio && !(k === 'cal' && d.tipo === 'cumple')) b += '<button class="btn del" type="button" data-a="borrar" data-id="' + it.id + '">Borrar</button>';
    h += '<div class="btns">' + b + '</div>';
    var frm = $('#frm');
    frm.innerHTML = h;
    if (opts.switchET && nuevo) frm.onclick = function (e) { var b = e.target.closest('[data-et]'); if (b && b.dataset.et !== k) { var tt = (frm.querySelector('[name=titulo]') || {}).value || ''; abrirForm(b.dataset.et, null, opts); var ni = $('#frm [name=titulo]'); if (ni) { ni.value = tt; ni.focus(); } } };
    frm.onsubmit = async function (e) {
      if (e.submitter && e.submitter.value === 'cancel') return;
      e.preventDefault();
      var fd = new FormData(frm), nd = Object.assign({}, d);
      def[1].forEach(function (f) { var t = typeof f[2] === 'function' ? f[2]() : f[2]; nd[f[0]] = t === 'checkbox' ? fd.has(f[0]) : (fd.get(f[0]) || '').trim(); });
      var texto = def[1].map(function (f) { return f[0] === 'telefono' ? '' : String(nd[f[0]] || ''); }).join(' ').replace(/\d{4}-\d{2}-\d{2}/g, '');
      if (/\d[\d -]{11,}\d/.test(texto)) { alert('Por seguridad no guardes números de tarjeta o de cuenta completos. Usa solo los 4 últimos dígitos.'); return; }
      if (it && it.sh && k === 'evento') { setAcc(ME.id, it.sh.id, 'aceptado', nd.cal); nd.cal = d.cal || ''; }
      if (it && it.sh) await putObj(ME, it.id, nd, it.sh.id); else await putObj(ME, it ? it.id : null, nd, '');
      $('#dlg').close(); commit(); render(); toast('Guardado');
    };
    if (!$('#dlg').open) $('#dlg').showModal();
  }
  /* Elegir miembros de la familia */
  function elegirUsuarios(titulo, yaIds, cb) {
    var otros = activos().filter(function (u) { return u.id !== ME.id; });
    var frm = $('#frm');
    frm.innerHTML = '<h3>' + esc(titulo) + '</h3><label class="f inline"><input type="checkbox" id="todosU">Toda la familia</label>' + otros.map(function (u) {
      var ya = yaIds.indexOf(u.id) >= 0;
      return '<label class="f inline"><input type="checkbox" class="uchk" value="' + u.id + '"' + (ya ? ' checked disabled' : '') + '><span class="dot" style="background:' + u.color + '"></span>' + esc(u.nombre) + (ya ? ' (ya incluido)' : '') + '</label>';
    }).join('') + '<p class="muted">Cada persona tendrá que aceptarlo. Después, los cambios se sincronizan entre todos.</p><div class="btns"><button class="btn pri" value="ok">Enviar</button><button class="btn" value="cancel" formnovalidate>Cancelar</button></div>';
    $('#todosU').onchange = function (e) { frm.querySelectorAll('.uchk:not(:disabled)').forEach(function (c) { c.checked = e.target.checked; }); };
    frm.onsubmit = async function (e) {
      if (e.submitter && e.submitter.value === 'cancel') return;
      e.preventDefault();
      var ids = Array.from(frm.querySelectorAll('.uchk:checked:not(:disabled)')).map(function (c) { return c.value; });
      if (!ids.length) { alert('Elige al menos una persona.'); return; }
      $('#dlg').close(); await cb(ids);
    };
    $('#dlg').showModal();
  }
  /* Convierte algo privado en compartido (o añade miembros si ya lo es). */
  async function compartir(it, ids) {
    if (it.sh) { await addMembers(it.sh.id, ids); commit(); render(); toast('Enviado'); return; }
    var kind = it.d.k;
    var sid = await createShare(ME, kind, ids);
    var rootId = newId(), data = Object.assign({}, it.d);
    await putObj(ME, rootId, data, sid);
    var sh = db.records[sid]; sh.root = rootId; save(sh);
    setAcc(ME.id, sid, 'aceptado', kind === 'evento' ? it.d.cal : '');
    if (kind === 'lista') {
      var its = itemsDe(it.id);
      for (var i = 0; i < its.length; i++) { await putObj(ME, null, Object.assign({}, its[i].d, { lista: rootId }), sid); tomb(its[i].id); }
      if (S.lista === it.id) S.lista = rootId;
    }
    tomb(it.id);
    await refresh(); commit(); render(); toast(kind === 'evento' ? 'Evento enviado' : 'Compartido');
  }
  async function dejarCompartir(it) {
    var data = Object.assign({}, it.d);
    if (data.k === 'evento') data.cal = (acc(it.sh.id, ME.id) || {}).cal || data.cal;
    var nid = await putObj(ME, null, data, '');
    if (data.k === 'lista') { var its = itemsDe(it.id); for (var i = 0; i < its.length; i++) await putObj(ME, null, Object.assign({}, its[i].d, { lista: nid }), ''); if (S.lista === it.id) S.lista = nid; }
    dropShare(it.sh.id);
    commit(); render(); toast('Ya no está compartido; te queda una copia');
  }

  /* ================= utilidades (cambios 1-4) ================= */
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
  function telKey(t) { var d = String(t || '').replace(/\D/g, ''); return d.length >= 6 ? d.slice(-9) : ''; }
  var STOP = ['de', 'del', 'la', 'el', 'los', 'las', 'y', 'a', 'en', 'dia', 'cita', 'fiesta', 'the', 'of', 'day', 'con'];
  function parecido(a, b) {
    var x = norm(a), y = norm(b); if (!x || !y) return false;
    if (x === y) return true;
    if ((x.length >= 4 && y.indexOf(x) >= 0) || (y.length >= 4 && x.indexOf(y) >= 0)) return true;
    var tx = x.split(' ').filter(function (w) { return STOP.indexOf(w) < 0; }), ty = y.split(' ').filter(function (w) { return STOP.indexOf(w) < 0; });
    if (!tx.length || !ty.length) return false;
    var com = tx.filter(function (w) { return ty.indexOf(w) >= 0; }).length;
    return com / Math.min(tx.length, ty.length) >= 0.6;
  }
  function hoyStr() { return ymd(new Date()); }
  /* Preferencias del usuario (privadas y sincronizadas) */
  function prefIt() { return privados('pref')[0] || null; }
  function pref() { var p = prefIt(); return p ? p.d : {}; }
  async function setPref(patch) { var p = prefIt(); await putObj(ME, p ? p.id : null, Object.assign({ k: 'pref' }, p ? p.d : {}, patch), ''); commit(); }
  /* Ventana de diálogo que devuelve lo elegido (o null si se cancela) */
  function dialogo(html, alAbrir) {
    return new Promise(function (res) {
      var frm = $('#frm'), dlg = $('#dlg'), hecho = false;
      frm.onclick = null; frm.onchange = null; frm.innerHTML = html;
      function fin(v) { if (hecho) return; hecho = true; dlg.onclose = null; res(v); }
      frm.onsubmit = function (e) { e.preventDefault(); var b = e.submitter ? e.submitter.value : 'ok'; var fd = new FormData(frm); fd.set('_btn', b || 'ok'); dlg.close(); fin(b === 'cancel' ? null : fd); };
      dlg.onclose = function () { if (!dlg.open) fin(null); }; /* ignora el cierre de la ventana anterior */
      if (alAbrir) alAbrir(frm);
      if (!dlg.open) dlg.showModal();
    });
  }
  function leerTodos(accept, multiple) {
    return new Promise(function (res) {
      var inp = $('#fileIn'); inp.value = ''; inp.accept = accept; inp.multiple = multiple;
      inp.onchange = async function () { var out = [], fs = Array.from(inp.files); for (var i = 0; i < fs.length; i++) out.push({ txt: await fs[i].text(), name: fs[i].name }); res(out); };
      inp.click();
    });
  }

  /* ================= papelera (cambio 4) ================= */
  function enPapelera() { return Object.keys(D).map(item).filter(function (it) { return it && !it.sh && it.rec.owner === ME.id && it.d.papelera; }); }
  async function aPapelera(its, etiqueta) {
    var g = C.rid(8), at = Date.now();
    for (var i = 0; i < its.length; i++) { if (!its[i] || its[i].sh) continue; await putObj(ME, its[i].id, Object.assign({}, its[i].d, { papelera: { at: at, g: g, et: etiqueta || '' } }), ''); }
  }
  async function copiaPrivada(it) {
    var data = Object.assign({}, it.d); if (data.k === 'evento') data.cal = (acc(it.sh.id, ME.id) || {}).cal || data.cal;
    var nid = await putObj(ME, null, data, ''), out = [item(nid)];
    if (data.k === 'lista') { var its = itemsDe(it.id); for (var i = 0; i < its.length; i++) out.push(item(await putObj(ME, null, Object.assign({}, its[i].d, { lista: nid }), ''))); }
    return out;
  }
  var TIPO_TXT = { evento: 'Evento', tarea: 'Tarea', contacto: 'Contacto', nota: 'Nota', acceso: 'Acceso', lista: 'Lista de compra', cal: 'Calendario', item: 'Artículo' };
  function tituloDe(d) { return d.k === 'contacto' ? nombreC(d) : (d.titulo || d.nombre || d.t || '—'); }
  function plazoTxt(p) { return { 30: '1 mes', 90: '3 meses', 365: '1 año' }[p] || (p + ' días'); }
  V.papelera = function () {
    var l = enPapelera(), grupos = {};
    l.forEach(function (it) { var g = it.d.papelera.g; (grupos[g] = grupos[g] || []).push(it); });
    var plazo = pref().plazoPapelera || 90;
    var h = '<div class="btns"><button class="btn" data-a="ir" data-v="ajustes">‹ Ajustes</button>' + (l.length ? '<button class="btn del" data-a="vaciarPapelera">Vaciar papelera</button>' : '') + '</div><h2>Papelera</h2><p class="muted">Lo que borras se guarda aquí ' + plazoTxt(plazo) + ' y después se elimina solo. Puedes cambiar el plazo en Ajustes.</p><div class="card list">';
    var keys = Object.keys(grupos).sort(function (a, b) { return grupos[b][0].d.papelera.at - grupos[a][0].d.papelera.at; });
    if (!keys.length) return h + '<div class="empty">La papelera está vacía.</div></div>';
    keys.forEach(function (g) {
      var its = grupos[g], main = its.filter(function (x) { return x.d.k === 'cal'; })[0] || its.filter(function (x) { return x.d.k === 'lista'; })[0] || its[0], extra = its.length - 1;
      h += '<div class="item wrap"><span class="tx"><b>' + esc(tituloDe(main.d)) + '</b><small>' + (TIPO_TXT[main.d.k] || '') + (extra ? ' + ' + extra + ' elementos' : '') + (main.d.papelera.et ? ' · ' + esc(main.d.papelera.et) : '') + ' · borrado el ' + new Date(main.d.papelera.at).toLocaleDateString('es-ES') + '</small></span><button class="btn sm" data-a="restaurar" data-v="' + g + '">Restaurar</button><button class="btn sm del" data-a="eliminarDef" data-v="' + g + '">Eliminar</button></div>';
    });
    return h + '</div>';
  };

  /* ================= contactos (cambios 1 y 2) ================= */
  var ETQ = ['Móvil', 'Casa', 'Fijo', 'Otro'];
  function nombreC(d) { return [d.nombre, d.apellidos].filter(Boolean).join(' ') || '(sin nombre)'; }
  function telsDe(d) { return (d.tels || []).concat((d.trabajo && d.trabajo.tels) || []).filter(function (x) { return x && x.v; }); }
  function mailsDe(d) { return (d.emails || []).concat((d.trabajo && d.trabajo.emails) || []).filter(function (x) { return x && x.v; }); }
  function migrarContacto(d) {
    var parts = String(d.nombre || '').trim().split(/\s+/).filter(Boolean);
    var nd = Object.assign({}, d, { nombre: parts[0] || '', apellidos: parts.slice(1).join(' '), tels: d.telefono ? [{ l: 'Móvil', v: d.telefono }] : [], emails: d.email ? [{ l: 'Casa', v: d.email }] : [], dirs: [], trabajo: { empresa: '', cargo: '', tels: [], emails: [], dirs: [] }, revisarNombre: parts.length >= 3 });
    delete nd.telefono; delete nd.email;
    return nd;
  }
  function unirArr(arrs, keyf) {
    var out = [], seen = {};
    arrs.forEach(function (a) { (a || []).forEach(function (f) { if (!f || !f.v) return; var k = keyf(f.v); if (seen[k]) return; seen[k] = 1; out.push({ l: f.l, v: f.v }); }); });
    return out;
  }
  function primero(arr) { return arr.filter(Boolean)[0] || ''; }
  var kTel = function (v) { return telKey(v) || norm(v); }, kMail = function (v) { return String(v).trim().toLowerCase(); };
  function mergeData(ds, nombreElegido) {
    var full = nombreElegido || ds.map(nombreC).sort(function (a, b) { return b.length - a.length; })[0];
    var best = ds.filter(function (d) { return nombreC(d) === full; })[0];
    var nom = best ? { nombre: best.nombre, apellidos: best.apellidos } : { nombre: full.split(' ')[0], apellidos: full.split(' ').slice(1).join(' ') };
    var tr = function (f) { return ds.map(function (d) { return d.trabajo && d.trabajo[f]; }); };
    var ramas = Array.from(new Set(ds.map(function (d) { return d.rama || 'personal'; })));
    var notas = Array.from(new Set(ds.map(function (d) { return (d.notas || '').trim(); }).filter(Boolean))).join('\n—\n');
    return { k: 'contacto', nombre: nom.nombre, apellidos: nom.apellidos, tels: unirArr(ds.map(function (d) { return d.tels; }), kTel), emails: unirArr(ds.map(function (d) { return d.emails; }), kMail), dirs: unirArr(ds.map(function (d) { return d.dirs; }), norm),
      cumple: primero(ds.map(function (d) { return d.cumple; })), grupo: primero(ds.map(function (d) { return d.grupo; })), rama: ramas.length === 1 ? ramas[0] : 'ambas', notas: notas,
      trabajo: { empresa: primero(tr('empresa')), cargo: primero(tr('cargo')), tels: unirArr(tr('tels'), kTel), emails: unirArr(tr('emails'), kMail), dirs: unirArr(tr('dirs'), norm) } };
  }
  /* Busca un contacto que ya tenga alguno de estos teléfonos o correos */
  function contactoCoincide(d, excluirId) {
    var tk = telsDe(d).map(function (t) { return telKey(t.v); }).filter(Boolean), mk = mailsDe(d).map(function (m) { return kMail(m.v); });
    return privados('contacto').filter(function (k) {
      if (k.id === excluirId) return false;
      return telsDe(k.d).some(function (t) { return tk.indexOf(telKey(t.v)) >= 0 && telKey(t.v); }) || mailsDe(k.d).some(function (m) { return mk.indexOf(kMail(m.v)) >= 0; });
    })[0] || null;
  }
  V.contactos = function () {
    var l = privados('contacto').filter(function (k) { return porRama(k.d); }).sort(function (a, b) { return nombreC(a.d).localeCompare(nombreC(b.d)); });
    var rev = privados('contacto').filter(function (k) { return k.d.revisarNombre; }).length;
    var h = '<div class="btns"><button class="btn" data-a="importar" data-v="contactos">Importar de Google (CSV o vCard)</button><button class="btn" data-a="ir" data-v="duplicados">Buscar duplicados</button><button class="btn" data-a="ir" data-v="gestionar">Gestionar grupos y campos</button></div>';
    if (rev) h += '<div class="note click" data-a="ir" data-v="revisarNombres">Hay ' + rev + ' nombre' + (rev > 1 ? 's' : '') + ' para revisar (Nombre y Apellidos). Tócame.</div>';
    var g = {};
    l.forEach(function (k) { var n = k.d.grupo || 'Sin grupo'; (g[n] = g[n] || []).push(k); });
    var gk = Object.keys(g).sort();
    if (!gk.length) return h + '<div class="card empty">Aún no tienes contactos. Pulsa + o importa tu archivo de Google Contactos.</div>';
    gk.forEach(function (n) {
      h += '<div class="grp">' + esc(n) + ' · ' + g[n].length + '</div><div class="card list">' + g[n].map(function (k) {
        var ts = telsDe(k.d), ms = mailsDe(k.d), sub = [ts[0] && ts[0].v, ms[0] && ms[0].v, k.d.trabajo && k.d.trabajo.empresa].filter(Boolean).join(' · ');
        return '<div class="item wrap"><span class="tx click" data-a="editar" data-id="' + k.id + '"><b>' + esc(nombreC(k.d)) + (k.d.google ? ' <span class="tag">Google</span>' : '') + '</b><small>' + esc(sub) + '</small></span>' +
          (ts.length ? '<button class="btn sm" data-a="contactar" data-id="' + k.id + '" data-v="tel">Llamar</button><button class="btn sm" data-a="contactar" data-id="' + k.id + '" data-v="wa">WhatsApp</button>' : '') + (ms.length ? '<button class="btn sm" data-a="contactar" data-id="' + k.id + '" data-v="mail">Correo</button>' : '') + '</div>';
      }).join('') + '</div>';
    });
    return h;
  };
  V.revisarNombres = function () {
    var l = privados('contacto').filter(function (k) { return k.d.revisarNombre; });
    var h = '<div class="btns"><button class="btn" data-a="ir" data-v="contactos">‹ Contactos</button></div><h2>Revisar nombres</h2>';
    if (!l.length) return h + '<div class="card empty">No hay nombres pendientes de revisar.</div>';
    h += '<p class="muted">Separé el nombre completo en Nombre y Apellidos. Corrige los que estén mal (por ejemplo, nombres compuestos) y pulsa Guardar.</p><form data-revnombres="1" class="col">';
    l.forEach(function (k) { h += '<div class="card pad row2"><label class="f">Nombre<input name="n_' + k.id + '" value="' + esc(k.d.nombre) + '"></label><label class="f">Apellidos<input name="a_' + k.id + '" value="' + esc(k.d.apellidos) + '"></label></div>'; });
    return h + '<button class="btn pri" type="submit">Guardar todos</button></form>';
  };
  /* --- duplicados --- */
  function firma(x) { return x.map(function (k) { return k.id; }).sort().join('|'); }
  function gruposDuplicados() {
    var l = privados('contacto'), parent = {}, idx = {};
    function f(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    function u(a, b) { parent[f(a)] = f(b); }
    l.forEach(function (k) { parent[k.id] = k.id; });
    l.forEach(function (k) {
      telsDe(k.d).forEach(function (t) { var key = telKey(t.v); if (!key) return; key = 't' + key; if (idx[key]) u(k.id, idx[key]); else idx[key] = k.id; });
      mailsDe(k.d).forEach(function (m) { var key = 'm' + kMail(m.v); if (idx[key]) u(k.id, idx[key]); else idx[key] = k.id; });
    });
    var ign = pref().ignorarDup || [], g = {};
    l.forEach(function (k) { var r = f(k.id); (g[r] = g[r] || []).push(k); });
    var fuertes = Object.values(g).filter(function (x) { return x.length > 1 && ign.indexOf(firma(x)) < 0; }), enF = {};
    Object.values(g).filter(function (x) { return x.length > 1; }).forEach(function (x) { x.forEach(function (k) { enF[k.id] = 1; }); });
    var pn = {};
    l.forEach(function (k) { if (enF[k.id]) return; var n = norm(nombreC(k.d)); if (!n) return; (pn[n] = pn[n] || []).push(k); });
    var debiles = Object.values(pn).filter(function (x) { return x.length > 1 && ign.indexOf(firma(x)) < 0; });
    return { fuertes: fuertes, debiles: debiles };
  }
  V.duplicados = function () {
    var r = gruposDuplicados(), h = '<div class="btns"><button class="btn" data-a="ir" data-v="contactos">‹ Contactos</button></div><h2>Buscar duplicados</h2><p class="muted">Busca en tus contactos de las dos ramas. Elige qué hacer con cada uno: <b>Quedar</b> (no se toca), <b>Juntar</b> (los marcados se unen en un solo contacto con todos sus datos) o <b>Borrar</b> (va a la papelera).</p>';
    if (!r.fuertes.length && !r.debiles.length) return h + '<div class="card empty">No hay duplicados. Todo en orden.</div>';
    function grupoHTML(x, debil) {
      return '<form class="card pad col" data-dupgrupo="' + firma(x) + '"><p class="muted">' + (debil ? 'Solo coincide el nombre: pueden ser personas distintas.' : 'Coinciden en teléfono o correo.') + '</p>' + x.map(function (k) {
        var info = telsDe(k.d).map(function (t) { return t.v; }).concat(mailsDe(k.d).map(function (m) { return m.v; })).concat([k.d.trabajo && k.d.trabajo.empresa]).filter(Boolean).join(' · ');
        return '<div class="duprow"><span class="tx"><b>' + esc(nombreC(k.d)) + '</b> <span class="tag">' + esc({ personal: 'Personal', trabajo: 'Trabajo', ambas: 'Ambas' }[k.d.rama] || 'Personal') + '</span><small class="muted"> ' + esc(info) + '</small></span><select name="' + k.id + '" class="mini" aria-label="Qué hacer con ' + esc(nombreC(k.d)) + '"><option value="quedar"' + (debil ? ' selected' : '') + '>Quedar</option><option value="juntar"' + (debil ? '' : ' selected') + '>Juntar</option><option value="borrar">Borrar</option></select></div>';
      }).join('') + '<div class="btns"><button class="btn pri" type="submit" value="aplicar">Aplicar</button><button class="btn" type="submit" value="distintos">' + (debil ? 'Son personas distintas' : 'No son duplicados') + '</button></div></form>';
    }
    if (r.fuertes.length) h += '<h2>Duplicados (' + r.fuertes.length + ')</h2>' + r.fuertes.map(function (x) { return grupoHTML(x, false); }).join('');
    if (r.debiles.length) h += '<h2>Posibles duplicados: solo el nombre (' + r.debiles.length + ')</h2>' + r.debiles.map(function (x) { return grupoHTML(x, true); }).join('');
    return h;
  };
  async function aplicarDuplicados(form, boton) {
    var ids = form.dataset.dupgrupo.split('|');
    if (boton === 'distintos') { var ign = (pref().ignorarDup || []).concat([form.dataset.dupgrupo]); await setPref({ ignorarDup: ign }); render(); toast('Anotado: no volverán a salir'); return; }
    var fd = new FormData(form), jun = [], bor = [];
    ids.forEach(function (id) { var v = fd.get(id); if (v === 'juntar') jun.push(item(id)); if (v === 'borrar') bor.push(item(id)); });
    if (jun.length >= 2) {
      var sugerido = jun.map(function (x) { return nombreC(x.d); }).sort(function (a, b) { return b.length - a.length; })[0];
      var nom = prompt('Nombre del contacto unido (puedes cambiarlo):', sugerido); if (nom === null) return;
      var merged = mergeData(jun.map(function (x) { return x.d; }), nom.trim() || sugerido);
      if (!jun.some(function (x) { return nombreC(x.d) === nom.trim(); })) { var p = nom.trim().split(/\s+/); merged.nombre = p[0] || ''; merged.apellidos = p.slice(1).join(' '); }
      await putObj(ME, jun[0].id, merged, '');
      await aPapelera(jun.slice(1), 'unido en «' + nombreC(merged) + '»');
    }
    if (bor.length) await aPapelera(bor, 'duplicado');
    commit(); render(); toast((jun.length >= 2 ? jun.length + ' contactos unidos. ' : '') + (bor.length ? bor.length + ' a la papelera.' : ''));
  }
  /* --- formulario de contacto --- */
  function filaMulti(campo, f, tipo) {
    var ops = ETQ.concat(Object.keys(etiquetasPropias(KIND_DE[campo])).sort()), std = ops.indexOf(f.l) >= 0, sel = std ? f.l : (f.l ? 'Personalizado' : 'Otro');
    return '<div class="mrow"><select class="mlab" aria-label="Etiqueta">' + ops.concat(['Personalizado']).map(function (o) { return '<option' + (o === sel ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>' +
      '<input class="mcus" placeholder="Nombre del campo" value="' + (std ? '' : esc(f.l || '')) + '"' + (sel === 'Personalizado' ? '' : ' hidden') + ' aria-label="Etiqueta personalizada">' +
      '<input class="mval" type="' + tipo + '" value="' + esc(f.v || '') + '" aria-label="Valor"><button type="button" class="btn sm" data-addrow="' + campo + '" data-tipo="' + tipo + '" aria-label="Añadir otro">+</button><button type="button" class="btn sm del" data-delrow="1" aria-label="Quitar">✕</button></div>';
  }
  function bloqueMulti(campo, titulo, arr, tipo, defL) {
    var a = (arr && arr.length) ? arr : [{ l: defL, v: '' }];
    return '<div class="f">' + titulo + '<div class="mlist" data-lista="' + campo + '" data-def="' + defL + '">' + a.map(function (f) { return filaMulti(campo, f, tipo); }).join('') + '</div></div>';
  }
  function leerMulti(frm, campo) {
    return Array.from(frm.querySelectorAll('.mlist[data-lista="' + campo + '"] .mrow')).map(function (r) {
      var sel = r.querySelector('.mlab').value, cus = r.querySelector('.mcus').value.trim(), v = r.querySelector('.mval').value.trim();
      return { l: sel === 'Personalizado' ? (cus || 'Otro') : sel, v: v };
    }).filter(function (x) { return x.v; });
  }
  function abrirContacto(it) {
    var d = it ? Object.assign({}, it.d) : { k: 'contacto', rama: rama() === 'todo' ? 'personal' : rama(), tels: [], emails: [], dirs: [], trabajo: {} };
    var t = d.trabajo || {};
    var personal = '<h4>Datos personales</h4><div class="row2"><label class="f">Nombre<input name="nombre" value="' + esc(d.nombre || '') + '" required></label><label class="f">Apellidos<input name="apellidos" value="' + esc(d.apellidos || '') + '"></label></div>' +
      bloqueMulti('tels', 'Teléfonos', d.tels, 'tel', 'Móvil') + bloqueMulti('emails', 'Correos', d.emails, 'email', 'Casa') + bloqueMulti('dirs', 'Direcciones', d.dirs, 'text', 'Casa') +
      '<div class="row2"><label class="f">Cumpleaños (DD-MM)<input name="cumple" value="' + esc(d.cumple || '') + '" placeholder="15-12" pattern="\\d{2}-\\d{2}"></label><label class="f">Grupo<select name="grupoSel" class="gsel"><option value="">Sin grupo</option>' + Object.keys(gruposUsados()).sort().map(function (g) { return '<option value="' + esc(g) + '"' + (g === d.grupo ? ' selected' : '') + '>' + esc(g) + '</option>'; }).join('') + '<option value="__p">Personalizado</option></select><input name="grupoNuevo" class="gnew" placeholder="Nombre del grupo nuevo" hidden></label></div>' +
      (function () { var sa = d.santo || { modo: 'auto' }, au = santoAuto(d.nombre); return '<div class="row2"><label class="f">Santo (onomástica)<select name="santoModo" class="ssel"><option value="auto"' + (sa.modo === 'auto' ? ' selected' : '') + '>Automático' + (au ? ' (' + dmTxt(au.dm) + ')' : ' (nombre no reconocido)') + '</option><option value="fecha"' + (sa.modo === 'fecha' ? ' selected' : '') + '>Elegir fecha</option><option value="ninguno"' + (sa.modo === 'ninguno' ? ' selected' : '') + '>Ninguno</option></select></label><label class="f sfecha"' + (sa.modo === 'fecha' ? '' : ' hidden') + '>Fecha del santo (DD-MM)<input name="santoFecha" value="' + esc(sa.fecha || '') + '" placeholder="08-11" pattern="\\d{2}-\\d{2}"></label></div>'; })() +
      '<label class="f">Rama<select name="rama">' + RAMAS.map(function (o) { return '<option value="' + o[0] + '"' + (d.rama === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>';
    var trabajo = '<h4>Datos de trabajo</h4><div class="row2"><label class="f">Empresa<input name="empresa" value="' + esc(t.empresa || '') + '"></label><label class="f">Cargo<input name="cargo" value="' + esc(t.cargo || '') + '"></label></div>' +
      bloqueMulti('ttels', 'Teléfonos de trabajo', t.tels, 'tel', 'Fijo') + bloqueMulti('temails', 'Correos de trabajo', t.emails, 'email', 'Otro') + bloqueMulti('tdirs', 'Direcciones de trabajo', t.dirs, 'text', 'Otro');
    var h = '<h3>' + (it ? 'Contacto' : 'Nuevo contacto') + (d.google ? ' <span class="tag">Google</span>' : '') + '</h3>' + (d.google ? '<p class="note">Nombre, teléfonos y correos se cambian en el móvil o en Google. Aquí puedes añadir notas, datos de trabajo y el santo.</p>' : '') + (rama() === 'trabajo' ? trabajo + personal : personal + trabajo) +
      '<h4>Notas</h4><label class="f"><span class="sr">Notas</span><textarea name="notas">' + esc(d.notas || '') + '</textarea></label>' +
      '<div class="btns"><button class="btn pri" value="ok">Guardar</button><button class="btn" value="cancel" formnovalidate>Cancelar</button>' + (it ? '<button class="btn del" type="button" data-a="borrar" data-id="' + it.id + '">Borrar</button>' : '') + '</div>';
    var frm = $('#frm');
    frm.innerHTML = h;
    frm.onclick = function (e) {
      var add = e.target.closest('[data-addrow]'), del = e.target.closest('[data-delrow]');
      if (add) { var lst = add.closest('.mlist'); add.closest('.mrow').insertAdjacentHTML('afterend', filaMulti(add.dataset.addrow, { l: lst.dataset.def, v: '' }, add.dataset.tipo)); }
      if (del) { var row = del.closest('.mrow'), l2 = row.closest('.mlist'); if (l2.querySelectorAll('.mrow').length > 1) row.remove(); else row.querySelector('.mval').value = ''; }
    };
    frm.onchange = function (e) {
      if (e.target.classList.contains('mlab')) { var c = e.target.parentNode.querySelector('.mcus'); c.hidden = e.target.value !== 'Personalizado'; if (!c.hidden) c.focus(); }
      if (e.target.classList.contains('gsel')) { var g = frm.querySelector('.gnew'); g.hidden = e.target.value !== '__p'; if (!g.hidden) g.focus(); }
      if (e.target.classList.contains('ssel')) frm.querySelector('.sfecha').hidden = e.target.value !== 'fecha';
    };
    frm.onsubmit = async function (e) {
      if (e.submitter && e.submitter.value === 'cancel') return;
      e.preventDefault();
      var fd = new FormData(frm);
      var nd = Object.assign({}, d, { k: 'contacto', nombre: (fd.get('nombre') || '').trim(), apellidos: (fd.get('apellidos') || '').trim(), tels: leerMulti(frm, 'tels'), emails: leerMulti(frm, 'emails'), dirs: leerMulti(frm, 'dirs'),
        cumple: (fd.get('cumple') || '').trim(), grupo: fd.get('grupoSel') === '__p' ? (fd.get('grupoNuevo') || '').trim() : (fd.get('grupoSel') || ''), rama: fd.get('rama'), notas: (fd.get('notas') || '').trim(), revisarNombre: false,
        santo: { modo: fd.get('santoModo') || 'auto', fecha: (fd.get('santoFecha') || '').trim() },
        trabajo: { empresa: (fd.get('empresa') || '').trim(), cargo: (fd.get('cargo') || '').trim(), tels: leerMulti(frm, 'ttels'), emails: leerMulti(frm, 'temails'), dirs: leerMulti(frm, 'tdirs') } });
      var texto = [nd.notas, nd.trabajo.empresa, nd.trabajo.cargo].concat(nd.dirs.map(function (x) { return x.v; })).join(' ');
      if (/\d[\d -]{11,}\d/.test(texto)) { alert('Por seguridad no guardes números de tarjeta o de cuenta completos.'); return; }
      if (!it) {
        var ya = contactoCoincide(nd);
        if (ya && confirm('Ya existe «' + nombreC(ya.d) + '» con este teléfono o correo.\n\nAceptar = juntar con él\nCancelar = crear igualmente')) {
          await putObj(ME, ya.id, mergeData([ya.d, nd]), ''); frm.onclick = null; frm.onchange = null; $('#dlg').close(); commit(); render(); toast('Juntado con «' + nombreC(ya.d) + '»'); return;
        }
      }
      await putObj(ME, it ? it.id : null, nd, '');
      frm.onclick = null; frm.onchange = null; $('#dlg').close(); commit(); render(); toast('Guardado');
    };
    $('#dlg').showModal();
  }
  async function contactar(id, modo) {
    var k = item(id); if (!k) return;
    var ops = modo === 'mail' ? mailsDe(k.d) : telsDe(k.d);
    var trab = (k.d.trabajo && (modo === 'mail' ? k.d.trabajo.emails : k.d.trabajo.tels)) || [];
    function abrir(v) {
      if (modo === 'mail') location.href = 'mailto:' + v;
      else if (modo === 'tel') location.href = 'tel:' + String(v).replace(/[^\d+]/g, '');
      else window.open('https://wa.me/' + String(v).replace(/\D/g, '').replace(/^00/, ''), '_blank', 'noopener');
    }
    if (ops.length === 1) return abrir(ops[0].v);
    var r = await dialogo('<h3>' + ({ tel: 'Llamar a', wa: 'WhatsApp a', mail: 'Escribir a' }[modo]) + ' ' + esc(nombreC(k.d)) + '</h3><div class="col">' + ops.map(function (o, i) {
      return '<button class="btn" value="' + i + '">' + esc(o.l) + (trab.indexOf(o) >= 0 ? ' (trabajo)' : '') + ': ' + esc(o.v) + '</button>';
    }).join('') + '<button class="btn" value="cancel" formnovalidate>Cancelar</button></div>');
    if (r) abrir(ops[+r.get('_btn')].v);
  }
  /* --- importar contactos (Google CSV, Outlook CSV, vCard) con todos sus campos --- */
  function etqDe(label) {
    var l = norm(String(label || '').replace(/^\*\s*/, ''));
    if (!l) return { l: 'Otro', t: false };
    var work = /work|trabajo|business|empresa|oficina/.test(l);
    var e = /mobile|movil|cell|celular/.test(l) ? 'Móvil' : /home|casa|personal|particular/.test(l) ? 'Casa' : /main|fijo|landline|principal/.test(l) ? 'Fijo' : /other|otro/.test(l) ? 'Otro' : work ? (/fax/.test(l) ? 'Otro' : 'Fijo') : String(label).replace(/^\*\s*/, '').trim();
    return { l: e, t: work };
  }
  function nuevoContactoVacio(r0) { return { k: 'contacto', nombre: '', apellidos: '', tels: [], emails: [], dirs: [], cumple: '', grupo: '', rama: r0, notas: '', trabajo: { empresa: '', cargo: '', tels: [], emails: [], dirs: [] } }; }
  function pon(c, tipo, label, valor) {
    String(valor || '').split(':::').map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (v) {
      var e = etqDe(label), dst = e.t ? c.trabajo[tipo] : c[tipo];
      if (e.t && tipo === 'tels' && /mobile|movil|cell/.test(norm(label))) e.l = 'Móvil';
      if (e.t && tipo !== 'tels' && e.l === 'Fijo') e.l = 'Otro';
      dst.push({ l: e.l, v: v });
    });
  }
  function parseCSVContactos(txt, r0) {
    var rows = csvParse(txt), hd = (rows.shift() || []).map(function (h) { return h.trim(); }), lo = hd.map(function (h) { return h.toLowerCase(); });
    var col = function (re) { for (var i = 0; i < lo.length; i++) if (re.test(lo[i])) return i; return -1; };
    var cF = col(/^(first name|given name|nombre)$/), cM = col(/^(middle name|additional name|segundo nombre)$/), cL = col(/^(last name|family name|apellidos?)$/), cN = col(/^(name|display name|nombre completo)$/);
    var cB = col(/^(birthday|cumpleaños)$/), cG = col(/^(labels|group membership|etiquetas|categorías|categories)$/), cNo = col(/^(notes|notas)$/);
    var cOrg = col(/^(organization( 1)? - name|organization name|company|organización|compañía|empresa)$/), cTit = col(/^(organization( 1)? - title|organization title|job title|puesto|cargo)$/);
    var multi = [];
    lo.forEach(function (h, i) {
      var m = /^(phone|e-mail|address) (\d+) - (value|formatted)$/.exec(h);
      if (m) { var lab = col(new RegExp('^' + m[1] + ' ' + m[2] + ' - (label|type)$')); multi.push({ i: i, tipo: { phone: 'tels', 'e-mail': 'emails', address: 'dirs' }[m[1]], lab: lab, fijo: null }); return; }
      if (/ - /.test(h)) return;
      if (/phone|teléfono|telefono|móvil|movil/.test(h) && !/fax/.test(h)) multi.push({ i: i, tipo: 'tels', lab: -1, fijo: hd[i] });
      else if (/e-?mail|correo/.test(h)) multi.push({ i: i, tipo: 'emails', lab: -1, fijo: /business|trabajo/.test(h) ? 'Trabajo' : 'Otro' });
    });
    return rows.map(function (r) {
      var g = function (i) { return i >= 0 ? (r[i] || '').trim() : ''; };
      var c = nuevoContactoVacio(r0);
      c.nombre = [g(cF), g(cM)].filter(Boolean).join(' '); c.apellidos = g(cL);
      if (!c.nombre && !c.apellidos && g(cN)) { var p = g(cN).split(/\s+/); c.nombre = p[0]; c.apellidos = p.slice(1).join(' '); c.revisarNombre = p.length >= 3; }
      multi.forEach(function (m) { if (g(m.i)) pon(c, m.tipo, m.fijo || (m.lab >= 0 ? g(m.lab) : 'Otro'), g(m.i)); });
      c.cumple = cumpleDe(g(cB)); c.notas = g(cNo);
      c.grupo = g(cG).split(':::').map(function (s) { return s.trim().replace(/^\*\s*/, ''); }).filter(function (s) { return s && !/^(mycontacts|starred)$/i.test(s); })[0] || '';
      c.trabajo.empresa = g(cOrg); c.trabajo.cargo = g(cTit);
      return c;
    }).filter(function (c) { return c.nombre || c.apellidos; });
  }
  function parseVCard(txt, r0) {
    return txt.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/BEGIN:VCARD/i).slice(1).map(function (card) {
      var c = nuevoContactoVacio(r0), fn = '';
      card.split(/\r?\n/).forEach(function (l) {
        var i = l.indexOf(':'); if (i < 0) return;
        var head = l.slice(0, i).replace(/^item\d+\./i, ''), parts = head.split(';'), key = parts[0].toUpperCase(), v = l.slice(i + 1).trim().replace(/\\,/g, ',').replace(/\;/g, ';');
        var tipos = parts.slice(1).join(' ').replace(/TYPE=/gi, '').replace(/,/g, ' ');
        if (key === 'FN') fn = v;
        else if (key === 'N') { var n = l.slice(i + 1).split(';'); c.apellidos = (n[0] || '').trim(); c.nombre = [n[1], n[2]].filter(function (x) { return x && x.trim(); }).join(' ').trim(); }
        else if (key === 'TEL') pon(c, 'tels', /cell/i.test(tipos) ? (/work/i.test(tipos) ? 'work mobile' : 'mobile') : tipos || 'Otro', v);
        else if (key === 'EMAIL') pon(c, 'emails', tipos.replace(/internet|pref/gi, '').trim() || 'Otro', v);
        else if (key === 'ADR') pon(c, 'dirs', tipos.replace(/pref/gi, '').trim() || 'Otro', v.split(';').map(function (s) { return s.trim(); }).filter(Boolean).join(', '));
        else if (key === 'ORG') c.trabajo.empresa = v.split(';').filter(Boolean).join(' · ');
        else if (key === 'TITLE') c.trabajo.cargo = v;
        else if (key === 'BDAY') c.cumple = cumpleDe(v);
        else if (key === 'NOTE') c.notas = v.replace(/\\n/gi, '\n');
        else if (key === 'CATEGORIES') c.grupo = v.split(',').filter(function (s) { return !/^mycontacts$/i.test(s); })[0] || '';
      });
      if (!c.nombre && !c.apellidos && fn) { var p = fn.split(/\s+/); c.nombre = p[0]; c.apellidos = p.slice(1).join(' '); c.revisarNombre = p.length >= 3; }
      return c;
    }).filter(function (c) { return c.nombre || c.apellidos; });
  }
  async function importarContactos(files) {
    var r0 = rama() === 'todo' ? 'personal' : rama(), lista = [];
    files.forEach(function (f) { lista = lista.concat(/BEGIN:VCARD/i.test(f.txt) ? parseVCard(f.txt, r0) : parseCSVContactos(f.txt, r0)); });
    if (!lista.length) return alert('No se encontraron contactos en el archivo.');
    var pares = lista.map(function (c) { return { c: c, ya: contactoCoincide(c) }; }), nd = pares.filter(function (p) { return p.ya; }).length, juntar = false;
    if (nd) juntar = confirm(nd + ' de los ' + lista.length + ' contactos ya existen (mismo teléfono o correo).\n\nAceptar = juntarlos con los existentes\nCancelar = crearlos igualmente');
    var n = 0, j = 0;
    for (var i = 0; i < pares.length; i++) {
      var p = pares[i];
      if (p.ya && juntar) { var actual = item(p.ya.id); await putObj(ME, p.ya.id, mergeData([actual.d, p.c]), ''); j++; }
      else { await putObj(ME, null, p.c, ''); n++; }
    }
    commit(); render();
    await dialogo('<h3>Contactos importados</h3><ul><li>' + n + ' contactos nuevos</li>' + (j ? '<li>' + j + ' juntados con contactos que ya tenías</li>' : '') + '</ul><p class="muted">Si algún contacto tiene muchos datos repetidos, usa «Buscar duplicados».</p><div class="btns"><button class="btn pri" value="ok">Aceptar</button></div>');
  }

  /* ================= importar calendarios (cambio 3) ================= */
  function parseICS(txt, nombreArchivo) {
    var lines = txt.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/), calName = '', ev = null, evs = [], pas = 0, hoy = hoyStr();
    lines.forEach(function (l) { if (/^X-WR-CALNAME/i.test(l)) calName = l.slice(l.indexOf(':') + 1).trim(); });
    calName = calName || nombreArchivo.replace(/\.ics$/i, '').replace(/_/g, ' ');
    var unesc = function (s) { return s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1'); };
    lines.forEach(function (l) {
      if (l === 'BEGIN:VEVENT') { ev = {}; return; }
      if (!ev) return;
      if (l === 'END:VEVENT') {
        if (ev.dt && ev.sum) {
          var rr = ev.rr || '', until = /UNTIL=(\d{8})/.exec(rr), rep = /YEARLY/.test(rr) ? 'anual' : /MONTHLY/.test(rr) ? 'mensual' : /WEEKLY/.test(rr) ? 'semanal' : /DAILY/.test(rr) ? 'diario' : 'no';
          var hasta = until ? icsDate(until[1]).f : '';
          if (ev.dt.f >= hoy || (rep !== 'no' && (!hasta || hasta >= hoy))) evs.push({ k: 'evento', titulo: ev.sum, fecha: ev.dt.f, hora: ev.dt.h, repetir: rep, hasta: hasta, lugar: ev.loc || '', notas: ev.desc || '', aviso: '' });
          else pas++;
        }
        ev = null; return;
      }
      var i = l.indexOf(':'); if (i < 0) return;
      var key = l.slice(0, i).split(';')[0].toUpperCase(), val = l.slice(i + 1);
      if (key === 'SUMMARY') ev.sum = unesc(val); else if (key === 'DTSTART') ev.dt = icsDate(val); else if (key === 'RRULE') ev.rr = val;
      else if (key === 'LOCATION') ev.loc = unesc(val); else if (key === 'DESCRIPTION') ev.desc = unesc(val).slice(0, 500);
    });
    return { nombre: calName, evs: evs, pasados: pas };
  }
  function opcionesCal(prefijo, texto, sel) { return cals().filter(function (c) { return c.d.tipo !== 'cumple'; }).map(function (c) { return '<option value="' + prefijo + c.id + '"' + (sel === c.id ? ' selected' : '') + '>' + texto + esc(c.d.nombre) + '</option>'; }).join(''); }
  /* Guarda eventos en un calendario, preguntando por los duplicados. R acumula el resumen. */
  async function procesarEventos(evs, destId, R, opt) {
    opt = opt || {};
    var existentes = todos('evento'), dups = [], limpios = [];
    evs.forEach(function (e) {
      var m = existentes.filter(function (x) { return (ocurre(x.d, e.fecha) || ocurre(e, x.d.fecha)) && parecido(x.d.titulo, e.titulo); })[0];
      if (!m) { limpios.push(e); return; }
      var cx = calDe(m);
      if (opt.mismoCalSilencio && cx && cx.id === destId) { R.ya = (R.ya || 0) + 1; return; }
      if (opt.mismoCalSilencio && cx && /^auto-/.test(cx.d.tipo || '')) { limpios.push(e); return; } /* entre calendarios automáticos (p. ej. Rumanía y ortodoxos) no es duplicado */
      dups.push({ e: e, x: m });
    });
    for (var i = 0; i < limpios.length; i++) { await putObj(ME, null, Object.assign({}, limpios[i], { cal: destId }), ''); R.imp++; }
    if (!dups.length) return;
    var r = await dialogo('<h3>' + dups.length + ' posible' + (dups.length > 1 ? 's' : '') + ' duplicado' + (dups.length > 1 ? 's' : '') + '</h3><p class="muted">Estos eventos coinciden en fecha y tienen un nombre parecido a otros que ya tienes.</p>' +
      '<label class="f">Aplicar a todos<select id="dupTodos"><option value="">— elegir —</option><option value="borrar">Borrar (no importar)</option>' + opcionesCal('cal:', 'Importar en ') + '<option value="sust">Sustituir el existente</option></select></label><div class="card list">' +
      dups.map(function (p, i) {
        var cx = calDe(p.x);
        return '<div class="item wrap"><span class="tx"><b>' + esc(p.e.titulo) + '</b><small>' + fechaLarga(p.e.fecha) + ' · ya tienes «' + esc(p.x.d.titulo) + '»' + (cx ? ' en ' + esc(cx.d.nombre) : '') + '</small></span><select name="d' + i + '" class="mini dupsel" aria-label="Qué hacer"><option value="borrar">Borrar (no importar)</option>' + opcionesCal('cal:', 'Importar en ', destId) + '<option value="sust">Sustituir el existente</option></select></div>';
      }).join('') + '</div><div class="btns"><button class="btn pri" value="ok">Continuar</button></div>',
      function (frm) { frm.querySelectorAll('.dupsel').forEach(function (s) { s.value = 'borrar'; }); frm.onchange = function (e) { if (e.target.id === 'dupTodos' && e.target.value) frm.querySelectorAll('.dupsel').forEach(function (s) { s.value = e.target.value; }); }; });
    for (var j = 0; j < dups.length; j++) {
      var v = r ? r.get('d' + j) : 'borrar', p = dups[j];
      if (v === 'borrar' || !v) { R.dup++; if (opt.onBorrar) opt.onBorrar(p.e); }
      else if (v === 'sust') { var nd = Object.assign({}, p.x.d, { titulo: p.e.titulo, fecha: p.e.fecha, hora: p.e.hora, repetir: p.e.repetir, hasta: p.e.hasta, lugar: p.e.lugar || p.x.d.lugar, notas: p.e.notas || p.x.d.notas }, p.e.gev ? { gev: p.e.gev, gcal: p.e.gcal } : {}); await putObj(ME, p.x.id, nd, p.x.sh ? p.x.sh.id : ''); R.sust++; }
      else { await putObj(ME, null, Object.assign({}, p.e, { cal: v.slice(4) }), ''); R.imp++; }
    }
  }
  function resumenHTML(R, titulo, extra) {
    return '<h3>' + titulo + '</h3><ul><li>' + R.imp + ' eventos importados</li><li>' + R.dup + ' duplicados borrados</li>' + (R.sust ? '<li>' + R.sust + ' sustituidos</li>' : '') + (R.ya ? '<li>' + R.ya + ' ya estaban</li>' : '') + '<li>' + R.pas + ' pasados ignorados</li></ul>' + (extra || '') + '<div class="btns"><button class="btn pri" value="ok">Aceptar</button></div>';
  }
  async function importarCalendarios(files, opt) {
    opt = opt || {};
    var R = { imp: 0, dup: 0, sust: 0, pas: 0, ya: 0 };
    for (var i = 0; i < files.length; i++) {
      var p = parseICS(files[i].txt, files[i].name);
      R.pas += p.pasados;
      if (!p.evs.length) { await dialogo('<h3>«' + esc(p.nombre) + '»</h3><p>No tiene eventos futuros (' + p.pasados + ' pasados ignorados).</p><div class="btns"><button class="btn pri" value="ok">Seguir</button></div>'); continue; }
      var dest = opt.dest;
      if (!dest) {
        var r = await dialogo('<h3>Importar «' + esc(p.nombre) + '»</h3><p>' + p.evs.length + ' eventos futuros. ' + p.pasados + ' pasados se ignoran.</p>' +
          '<label class="f">¿Dónde los guardo?<select name="dest"><option value="__nuevo">Crear un calendario nuevo con este nombre</option>' + opcionesCal('', 'Añadir a: ') + '</select></label>' +
          '<label class="f">Nombre del calendario nuevo<input name="nombre" value="' + esc(p.nombre) + '"></label><div class="btns"><button class="btn pri" value="ok">Continuar</button><button class="btn" value="cancel" formnovalidate>Saltar este calendario</button></div>');
        if (!r) continue;
        dest = r.get('dest');
        if (dest === '__nuevo') dest = await putObj(ME, null, { k: 'cal', nombre: (r.get('nombre') || p.nombre).trim(), color: COLORES[cals().length % COLORES.length], rama: 'ambas', activo: true, tipo: 'importado' }, '');
      }
      await procesarEventos(p.evs, dest, R);
    }
    commit(); render();
    await dialogo(resumenHTML(R, 'Importación terminada'));
  }

  /* ================= festivos automáticos (cambio 3.7) ================= */
  var AUTO = { lab: { tipo: 'auto-lab', nombre: 'FIESTAS LABORALES', color: '#B91C1C' }, ro: { tipo: 'auto-ro', nombre: 'Festivos Rumanía', color: '#A16207' }, ort: { tipo: 'auto-ort', nombre: 'Fiestas ortodoxas', color: '#57534E' } };
  function calAuto(tipo) { return cals().filter(function (c) { return c.d.tipo === tipo; })[0] || null; }
  async function asegurarCalAuto(key) { var a = AUTO[key], c = calAuto(a.tipo); return c ? c.id : putObj(ME, null, { k: 'cal', nombre: a.nombre, color: a.color, rama: 'ambas', activo: true, tipo: a.tipo }, ''); }
  function dmas(dt, n) { var x = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + n); return ymd(x); }
  function pascuaOrtodoxa(y) { var a = y % 4, b = y % 7, c = y % 19, d = (19 * c + 15) % 30, e = (2 * a + 4 * b - d + 34) % 7, s = d + e + 114; return new Date(y, Math.floor(s / 31) - 1, (s % 31) + 1 + 13); }
  function pascuaOccidental(y) { var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1; return new Date(y, mes - 1, dia); }
  var ES_FIJOS = { '01-01': 'Año Nuevo', '01-06': 'Epifanía del Señor (Reyes)', '03-19': 'San José', '05-01': 'Fiesta del Trabajo', '05-02': 'Fiesta de la Comunidad de Madrid', '07-25': 'Santiago Apóstol', '08-15': 'Asunción de la Virgen', '10-12': 'Fiesta Nacional de España', '11-01': 'Todos los Santos', '12-06': 'Día de la Constitución', '12-08': 'Inmaculada Concepción', '12-25': 'Navidad' };
  var RO_FIJOS = { '01-01': 'Anul Nou', '01-02': 'Anul Nou (a doua zi)', '01-06': 'Boboteaza', '01-07': 'Sfântul Ioan Botezătorul', '01-24': 'Ziua Unirii Principatelor Române', '05-01': 'Ziua Muncii', '06-01': 'Ziua Copilului', '08-15': 'Adormirea Maicii Domnului', '11-30': 'Sfântul Andrei', '12-01': 'Ziua Națională a României', '12-25': 'Crăciunul', '12-26': 'A doua zi de Crăciun' };
  function texto(v) { if (!v) return ''; if (typeof v === 'string') return v; if (Array.isArray(v)) { var x = v.filter(function (t) { return /^(es|ro)$/i.test(t.language || t.lang || ''); })[0] || v[0]; return x ? (x.text || x.name || '') : ''; } return v.es || v.ro || v.en || Object.values(v)[0] || ''; }
  async function nager(cc, y) {
    var urls = ['https://nagerholidays.com/api/v4/Holidays/' + cc + '/' + y, 'https://date.nager.at/api/v3/PublicHolidays/' + y + '/' + cc];
    for (var i = 0; i < urls.length; i++) {
      try {
        var r = await fetch(urls[i]); if (!r.ok) continue;
        var j = await r.json(), arr = Array.isArray(j) ? j : (j.holidays || j.items || j.value || j.data || []);
        if (!arr.length) continue;
        return arr.map(function (h) { return { fecha: String(h.date || h.startDate || '').slice(0, 10), local: texto(h.localName), en: texto(h.name), nacional: h.nationalHoliday != null ? h.nationalHoliday : (h.global != null ? h.global : true), regiones: h.subdivisionCodes || h.counties || [], tipos: h.holidayTypes || h.types || ['Public'] }; }).filter(function (h) { return /^\d{4}-\d{2}-\d{2}$/.test(h.fecha); });
      } catch (e) {}
    }
    return null;
  }
  function esPublico(h) { var t = [].concat(h.tipos || []).join(','); return !t || /public/i.test(t); }
  function nombreES(h, y) {
    var md = h.fecha.slice(5), en = norm(h.en), pw = pascuaOccidental(y);
    if (/maundy|holy thursday/.test(en) || h.fecha === dmas(pw, -3)) return 'Jueves Santo';
    if (/good friday/.test(en) || h.fecha === dmas(pw, -2)) return 'Viernes Santo';
    if (/easter monday/.test(en) || h.fecha === dmas(pw, 1)) return 'Lunes de Pascua';
    return ES_FIJOS[md] || h.local || h.en;
  }
  function nombreRO(h, y) {
    var po = pascuaOrtodoxa(y), md = h.fecha.slice(5), mov = {}; mov[dmas(po, -2)] = 'Vinerea Mare'; mov[dmas(po, 0)] = 'Paștele'; mov[dmas(po, 1)] = 'A doua zi de Paște'; mov[dmas(po, 49)] = 'Rusaliile'; mov[dmas(po, 50)] = 'A doua zi de Rusalii';
    return mov[h.fecha] || RO_FIJOS[md] || h.local || h.en;
  }
  function basicoES(y) { var pw = pascuaOccidental(y), l = Object.keys(ES_FIJOS).filter(function (md) { return ['03-19', '07-25'].indexOf(md) < 0; }).map(function (md) { return { titulo: ES_FIJOS[md], fecha: y + '-' + md }; }); l.push({ titulo: 'Jueves Santo', fecha: dmas(pw, -3) }, { titulo: 'Viernes Santo', fecha: dmas(pw, -2) }); return l; }
  function basicoRO(y) { var po = pascuaOrtodoxa(y), l = Object.keys(RO_FIJOS).map(function (md) { return { titulo: RO_FIJOS[md], fecha: y + '-' + md }; }); [[-2, 'Vinerea Mare'], [0, 'Paștele'], [1, 'A doua zi de Paște'], [49, 'Rusaliile'], [50, 'A doua zi de Rusalii']].forEach(function (x) { l.push({ titulo: x[1], fecha: dmas(po, x[0]) }); }); return l; }
  function ortodoxas(y) {
    var po = pascuaOrtodoxa(y);
    var fijas = { '01-06': 'Boboteaza (Epifanía)', '01-07': 'Sfântul Ioan Botezătorul', '01-30': 'Sfinții Trei Ierarhi', '02-02': 'Întâmpinarea Domnului', '03-25': 'Buna Vestire', '04-23': 'Sfântul Gheorghe', '05-21': 'Sfinții Constantin și Elena', '06-24': 'Nașterea Sf. Ioan Botezătorul', '06-29': 'Sfinții Petru și Pavel', '07-20': 'Sfântul Ilie', '08-06': 'Schimbarea la Față', '08-15': 'Adormirea Maicii Domnului', '08-29': 'Tăierea capului Sf. Ioan', '09-08': 'Nașterea Maicii Domnului', '09-14': 'Înălțarea Sfintei Cruci', '10-14': 'Sfânta Parascheva', '10-26': 'Sfântul Dumitru', '11-08': 'Sfinții Mihail și Gavriil', '11-30': 'Sfântul Andrei', '12-06': 'Sfântul Nicolae', '12-25': 'Crăciunul', '12-26': 'A doua zi de Crăciun' };
    var l = Object.keys(fijas).map(function (md) { return { titulo: fijas[md], fecha: y + '-' + md }; });
    [[-7, 'Floriile (Domingo de Ramos)'], [-2, 'Vinerea Mare (Viernes Santo)'], [0, 'Paștele (Pascua ortodoxa)'], [1, 'A doua zi de Paște'], [39, 'Înălțarea Domnului'], [49, 'Rusaliile (Pentecostés)'], [50, 'A doua zi de Rusalii']].forEach(function (x) { l.push({ titulo: x[1], fecha: dmas(po, x[0]) }); });
    return l;
  }
  /* 3.8: si un festivo de la fuente está en otra fecha que la tuya, pregunta; nunca cambia lo tuyo */
  function filtrarConflictos(evs, cid) {
    var mios = privados('evento').filter(function (e) { return e.d.cal === cid; });
    return evs.filter(function (e) {
      var y = e.fecha.slice(0, 4);
      if (mios.some(function (m) { return m.d.fecha === e.fecha && parecido(m.d.titulo, e.titulo); })) return true;
      var otro = mios.filter(function (m) { return m.d.fecha.slice(0, 4) === y && m.d.fecha !== e.fecha && (m.d.repetir || 'no') === 'no' && parecido(m.d.titulo, e.titulo); })[0];
      if (!otro) return true;
      return confirm('«' + e.titulo + '»: en tu calendario está el ' + fechaLarga(otro.d.fecha) + ', pero la fuente oficial dice ' + fechaLarga(e.fecha) + '.\n\n¿Añado también el ' + fechaLarga(e.fecha) + '? (Tu fecha no se cambia.)');
    });
  }
  async function actualizarFestivos(y) {
    var R = { imp: 0, dup: 0, sust: 0, pas: 0, ya: 0 }, avisos = [], hoy = hoyStr();
    var es = await nager('ES', y), ro = await nager('RO', y);
    var lab = es ? es.filter(function (h) { return esPublico(h) && (h.nacional || (h.regiones || []).indexOf('ES-MD') >= 0); }).map(function (h) { return { titulo: nombreES(h, y), fecha: h.fecha }; }) : basicoES(y);
    if (!es) avisos.push('No se pudo conectar con el servicio de festivos de España: se usó la lista básica (nacionales y Madrid). Revísala.');
    var rol = ro ? ro.filter(function (h) { return esPublico(h) && h.nacional !== false; }).map(function (h) { return { titulo: nombreRO(h, y), fecha: h.fecha }; }) : basicoRO(y);
    if (!ro) avisos.push('Rumanía: se usó la lista calculada.');
    var off = pref().autoOff || {};
    var sets = [['lab', lab], ['ro', rol], ['ort', ortodoxas(y)]].filter(function (x) { return !off[AUTO[x[0]].tipo]; });
    for (var i = 0; i < sets.length; i++) {
      var cid = await asegurarCalAuto(sets[i][0]);
      var evs = sets[i][1].filter(function (e) { return e.fecha >= hoy; }).map(function (e) { return { k: 'evento', titulo: e.titulo, fecha: e.fecha, hora: '', repetir: 'no', hasta: '', aviso: '', lugar: '', notas: '', origen: 'auto' }; });
      R.pas += sets[i][1].length - evs.length;
      await procesarEventos(filtrarConflictos(evs, cid), cid, R, { mismoCalSilencio: true });
    }
    commit(); render();
    return { R: R, avisos: avisos };
  }
  /* Aviso de diciembre para añadir los festivos de la empresa (3.12/3.13) */
  function avisoLaborales() {
    if (today.getMonth() !== 11 || !calAuto('auto-lab')) return '';
    var y = today.getFullYear() + 1, p = pref();
    if (p.labHecho === y || (p.labSnooze && p.labSnooze > Date.now())) return '';
    return '<div class="note"><b>Festivos laborales de ' + y + '</b>: añade los de tu empresa (Alcalá de Henares y puentes) al calendario FIESTAS LABORALES.<div class="btns"><button class="btn sm pri" data-a="marcarAnio" data-v="' + y + '">Opción A: marcar en la app</button><button class="btn sm" data-a="opcionB">Opción B: PDF a Claude</button><button class="btn sm" data-a="labSnooze">Recordar en 3 días</button><button class="btn sm" data-a="labHecho" data-v="' + y + '">Ya está hecho</button></div></div>';
  }
  V.marcar = function () {
    var y = S.marcarY || today.getFullYear(), lab = calAuto('auto-lab');
    var h = '<div class="btns"><button class="btn" data-a="ir" data-v="calendarios">‹ Calendarios</button></div><h2>Añadir festivos del año a FIESTAS LABORALES</h2>';
    if (!lab) return h + '<div class="card pad"><p>Primero activa los festivos automáticos.</p><button class="btn pri" data-a="activarFestivos">Activar festivos automáticos</button></div>';
    var ya = {}; privados('evento').filter(function (e) { return e.d.cal === lab.id; }).forEach(function (e) { ya[e.d.fecha] = e.d.titulo; });
    var n = Object.keys(S.marcados || {}).length;
    h += '<div class="calhead"><button class="btn" data-a="marcarY" data-v="-1" aria-label="Año anterior">‹</button><b>' + y + '</b><button class="btn" data-a="marcarY" data-v="1" aria-label="Año siguiente">›</button></div>' +
      '<p class="muted">Toca los días que ves en el calendario de tu empresa. En rojo, los que ya están en FIESTAS LABORALES.</p>' +
      '<div class="card pad row2"><label class="f">Nombre<input id="mkNombre" value="Festivo local"></label><label class="f">Tipo<select id="mkTipo"><option>Festivo</option><option>Puente</option></select></label></div><div class="meses">';
    for (var m = 0; m < 12; m++) {
      h += '<div class="mmes"><b>' + MESES[m][0].toUpperCase() + MESES[m].slice(1) + '</b><div class="mgrid">' + ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(function (w) { return '<span class="wd">' + w + '</span>'; }).join('');
      var off = (new Date(y, m, 1).getDay() + 6) % 7, dias = new Date(y, m + 1, 0).getDate();
      for (var b = 0; b < off; b++) h += '<span></span>';
      for (var d = 1; d <= dias; d++) {
        var ds = y + '-' + pad(m + 1) + '-' + pad(d), cls = 'md' + (ya[ds] ? ' ya' : '') + (S.marcados && S.marcados[ds] ? ' sel' : '');
        h += '<button class="' + cls + '" data-a="marcarDia" data-v="' + ds + '" title="' + esc(ya[ds] || '') + '" aria-label="' + d + ' de ' + MESES[m] + (ya[ds] ? ': ' + esc(ya[ds]) : '') + '"' + (ya[ds] ? ' disabled' : '') + '>' + d + '</button>';
      }
      h += '</div></div>';
    }
    return h + '</div><div class="stickybar"><span>' + n + ' día' + (n === 1 ? '' : 's') + ' marcado' + (n === 1 ? '' : 's') + '</span><button class="btn pri" data-a="guardarMarcados"' + (n ? '' : ' disabled') + '>Guardar en FIESTAS LABORALES</button></div>';
  };

  /* ================= mantenimiento al abrir ================= */
  var mantOcupado = false;
  async function mantenimiento() {
    if (mantOcupado || !ME) return;
    mantOcupado = true; var cambio = false;
    try {
      var cs = privados('contacto').filter(function (k) { return !Array.isArray(k.d.tels); });
      for (var i = 0; i < cs.length; i++) { await putObj(ME, cs[i].id, migrarContacto(cs[i].d), ''); cambio = true; }
      var lim = Date.now() - (pref().plazoPapelera || 90) * 864e5;
      enPapelera().forEach(function (it) { if (it.d.papelera.at < lim) { tomb(it.id); cambio = true; } });
    } finally { mantOcupado = false; }
    if (cambio) commit();
    var p = pref(), y = today.getFullYear();
    var gConf = (p.gContactos || Object.keys(p.gmap || {}).some(function (k) { return p.gmap[k] && p.gmap[k] !== 'no'; })) && gClientId();
    if (gConf && !gOcupado && (!p.gLast || Date.now() - p.gLast > 30 * 60000)) {
      if (gValido()) setTimeout(function () { gSync(false); }, 2000);
      else if (gTok() && dev.recordado && dev.recordado[ME.id] && !sessionStorage.getItem('miagenda.gSilent') && (!p.gLast || Date.now() - p.gLast > 6 * 3600000)) { sessionStorage.setItem('miagenda.gSilent', '1'); setTimeout(function () { gLogin(true); }, 2500); }
    }
    if (p.festivosAuto && today.getMonth() === 11 && (p.festivosYear || 0) < y + 1 && !S.festEnCurso) {
      S.festEnCurso = true;
      setTimeout(async function () {
        try { await setPref({ festivosYear: y + 1 }); var r = await actualizarFestivos(y + 1); toast('Festivos de ' + (y + 1) + ' actualizados: ' + r.R.imp + ' nuevos'); } catch (e) { console.log(e); }
        S.festEnCurso = false;
      }, 1500);
    }
  }

  /* ================= cambio 5: desplegables con «Personalizado» y Gestionar ================= */
  var KIND_DE = { tels: 'tel', ttels: 'tel', emails: 'mail', temails: 'mail', dirs: 'dir', tdirs: 'dir' };
  function camposDe(d, kind) { var t = d.trabajo || {}; return kind === 'tel' ? (d.tels || []).concat(t.tels || []) : kind === 'mail' ? (d.emails || []).concat(t.emails || []) : (d.dirs || []).concat(t.dirs || []); }
  function etiquetasPropias(kind) { var c = {}; privados('contacto').forEach(function (k) { camposDe(k.d, kind).forEach(function (f) { if (f && f.l && ETQ.indexOf(f.l) < 0) c[f.l] = (c[f.l] || 0) + 1; }); }); return c; }
  function gruposUsados() { var c = {}; privados('contacto').forEach(function (k) { if (k.d.grupo) c[k.d.grupo] = (c[k.d.grupo] || 0) + 1; }); return c; }
  function itemsEditables() { return Object.keys(D).map(item).filter(function (it) { return it && it.d.k === 'item' && !it.d.papelera && (!it.sh || aceptado(it.sh)); }); }
  function catsPropias() { var c = {}; itemsEditables().forEach(function (i) { var x = i.d.cat; if (x && CATS.indexOf(x) < 0) c[x] = (c[x] || 0) + 1; }); return c; }
  V.gestionar = function () {
    function seccion(titulo, tipo, obj, nota) {
      var ks = Object.keys(obj).sort();
      return '<h2>' + titulo + '</h2>' + (nota ? '<p class="muted">' + nota + '</p>' : '') + '<div class="card list">' + (ks.length ? ks.map(function (k) {
        return '<div class="item wrap"><span class="tx"><b>' + esc(k) + '</b><small>' + obj[k] + ' en uso</small></span><button class="btn sm" data-a="gesRen" data-t="' + tipo + '" data-v="' + esc(k) + '">Renombrar</button><button class="btn sm del" data-a="gesDel" data-t="' + tipo + '" data-v="' + esc(k) + '">Borrar</button></div>';
      }).join('') : '<div class="empty">Ninguno todavía.</div>') + '</div>';
    }
    return '<div class="btns"><button class="btn" data-a="ir" data-v="contactos">‹ Contactos</button><button class="btn" data-a="ir" data-v="compras">‹ Compras</button></div><h2>Gestionar grupos, campos y categorías</h2><p class="muted">Aquí salen los que has creado tú (con «Personalizado» u «Otra…»). Los que ya no usa nadie desaparecen solos.</p>' +
      seccion('Grupos de contactos', 'grupo', gruposUsados(), 'Si borras un grupo, sus contactos quedan «Sin grupo».') +
      seccion('Nombres de campo · teléfonos', 'tel', etiquetasPropias('tel'), 'Si borras uno, esos campos pasan a llamarse «Otro».') +
      seccion('Nombres de campo · correos', 'mail', etiquetasPropias('mail')) +
      seccion('Nombres de campo · direcciones', 'dir', etiquetasPropias('dir')) +
      seccion('Categorías de compras', 'cat', catsPropias(), 'Las fijas (Lácteos, Limpieza…) no se cambian. Si borras una, sus artículos pasan a «Otros».');
  };
  async function renombrarEn(tipo, viejo, nuevo) {
    var n = 0;
    if (tipo === 'cat') {
      var its = itemsEditables().filter(function (i) { return i.d.cat === viejo; });
      for (var i = 0; i < its.length; i++) { await putObj(ME, its[i].id, Object.assign({}, its[i].d, { cat: nuevo || 'Otros' }), its[i].rec.share); n++; }
      return n;
    }
    var cs = privados('contacto');
    for (var j = 0; j < cs.length; j++) {
      var nd = JSON.parse(JSON.stringify(cs[j].d)), cambio = false;
      if (tipo === 'grupo') { if (nd.grupo === viejo) { nd.grupo = nuevo; cambio = true; } }
      else {
        var ks = { tel: ['tels'], mail: ['emails'], dir: ['dirs'] }[tipo][0];
        [nd[ks] || [], (nd.trabajo || {})[ks] || []].forEach(function (arr) { arr.forEach(function (f) { if (f.l === viejo) { f.l = nuevo || 'Otro'; cambio = true; } }); });
      }
      if (cambio) { await putObj(ME, cs[j].id, nd, ''); n++; }
    }
    return n;
  }

  /* ================= cambio 7: santos (onomásticas) del calendario ortodoxo rumano ================= */
  var SANTOS = [
    [['mihai', 'mihaela', 'mihail', 'mihaita', 'gabriel', 'gabriela', 'gavril'], '11-08', 'Sf. Arhangheli Mihail și Gavriil'],
    [['andrei', 'andreea'], '11-30', 'Sf. Andrei'],
    [['nicolae', 'nicoleta', 'nicu', 'niculina', 'nicusor'], '12-06', 'Sf. Nicolae'],
    [['ion', 'ioan', 'ioana', 'ionut', 'ionela', 'ionel', 'ionica', 'iona'], '01-07', 'Sf. Ioan Botezătorul'],
    [['gheorghe', 'george', 'georgiana', 'georgeta', 'gigel', 'georgel'], '04-23', 'Sf. Mare Mucenic Gheorghe'],
    [['constantin', 'costel', 'costin', 'costica', 'elena', 'ileana', 'elenuta'], '05-21', 'Sf. Împărați Constantin și Elena'],
    [['petru', 'petrica', 'petronela', 'pavel', 'paul', 'paula', 'pavelina'], '06-29', 'Sf. Apostoli Petru și Pavel'],
    [['ilie', 'ilinca'], '07-20', 'Sf. Proroc Ilie'],
    [['ana', 'anca', 'anuta'], '07-25', 'Adormirea Sf. Ana'],
    [['maria', 'marian', 'mariana', 'marioara', 'maricica', 'mariuca'], '08-15', 'Adormirea Maicii Domnului (Sfânta Maria Mare)'],
    [['alexandru', 'alexandra', 'alex', 'sandu'], '08-30', 'Sf. Alexandru, Ioan și Pavel cei Noi'],
    [['parascheva', 'paraschiva', 'paraschiv'], '10-14', 'Sf. Cuvioasă Parascheva'],
    [['dumitru', 'dumitrita', 'dimitrie', 'dumitra', 'mitica', 'dan'], '10-26', 'Sf. Mare Mucenic Dimitrie'],
    [['ecaterina', 'catalina', 'catalin', 'cati'], '11-25', 'Sf. Mare Muceniță Ecaterina'],
    [['vasile', 'vasilica', 'vasilisa'], '01-01', 'Sf. Vasile cel Mare'],
    [['grigore', 'grigorie'], '01-25', 'Sf. Grigorie Teologul'],
    [['stefan', 'stefania', 'stefana', 'stefanita'], '12-27', 'Sf. Arhidiacon Ștefan'],
    [['florin', 'florina', 'florentina', 'florica', 'floarea', 'florian', 'florinel', 'flori'], 'florii', 'Floriile (domingo de Ramos ortodoxo)']
  ];
  function santoAuto(nombreStr) {
    var n = norm(String(nombreStr || '').split(/[\s-]+/)[0]).replace(/ /g, '');
    for (var i = 0; i < SANTOS.length; i++) if (SANTOS[i][0].indexOf(n) >= 0) return { dm: SANTOS[i][1], s: SANTOS[i][2] };
    return null;
  }
  function santoDeDatos(d) {
    var sa = d.santo || { modo: 'auto' };
    if (sa.modo === 'ninguno') return null;
    if (sa.modo === 'fecha') { var m = /^(\d{2})-(\d{2})$/.exec(sa.fecha || ''); return m ? { dm: m[2] + '-' + m[1], s: 'santo' } : null; }
    return santoAuto(d.nombre);
  }
  function santoCae(s, ds) { if (!s) return false; if (s.dm === 'florii') return ds === dmas(pascuaOrtodoxa(+ds.slice(0, 4)), -7); return ds.slice(5) === s.dm; }
  function dmTxt(dm) { if (dm === 'florii') return 'domingo de Ramos ortodoxo'; var p = dm.split('-'); return (+p[1]) + ' de ' + MESES[+p[0] - 1]; }

  /* ================= cambio 6: varios calendarios a la vez ================= */
  function eventosDeCal(cid) { return todos('evento').filter(function (e) { var c = calDe(e); return c && c.id === cid; }); }
  function futuros(evs) { var hoy = hoyStr(); return evs.filter(function (e) { return e.d.fecha >= hoy || ((e.d.repetir || 'no') !== 'no' && (!e.d.hasta || e.d.hasta >= hoy)); }); }
  async function moverEventos(srcIds, destId, anual) {
    var moving = [];
    srcIds.forEach(function (id) { if (id !== destId) moving = moving.concat(eventosDeCal(id)); });
    var destEvs = eventosDeCal(destId), pares = [];
    moving.forEach(function (e, i) {
      var sim = function (y) { return (ocurre(y.d, e.d.fecha) || ocurre(e.d, y.d.fecha)) && parecido(y.d.titulo, e.d.titulo); };
      var x = destEvs.filter(sim)[0] || moving.slice(0, i).filter(function (y) { return (calDe(y) || {}).id !== (calDe(e) || {}).id && sim(y); })[0];
      if (x) pares.push({ e: e, x: x });
    });
    var borrar = {};
    if (pares.length) {
      var r = await dialogo('<h3>' + pares.length + ' posible' + (pares.length > 1 ? 's' : '') + ' duplicado' + (pares.length > 1 ? 's' : '') + '</h3><p class="muted">Antes de mover, estos eventos coinciden en fecha y tienen un nombre parecido a otro.</p>' +
        '<label class="f">Aplicar a todos<select id="dupTodos"><option value="">— elegir —</option><option value="mantener">Mantener los dos</option><option value="borrar">Borrar el que se mueve</option></select></label><div class="card list">' +
        pares.map(function (p, i) { return '<div class="item wrap"><span class="tx"><b>' + esc(p.e.d.titulo) + '</b><small>' + fechaLarga(p.e.d.fecha) + ' · de «' + esc((calDe(p.e) || { d: {} }).d.nombre || '') + '» · ya hay «' + esc(p.x.d.titulo) + '»</small></span><select name="p' + i + '" class="mini dupsel" aria-label="Qué hacer"><option value="mantener">Mantener los dos</option><option value="borrar">Borrar el que se mueve</option></select></div>'; }).join('') +
        '</div><div class="btns"><button class="btn pri" value="ok">Continuar</button><button class="btn" value="cancel" formnovalidate>Cancelar</button></div>',
        function (frm) { frm.onchange = function (e) { if (e.target.id === 'dupTodos' && e.target.value) frm.querySelectorAll('.dupsel').forEach(function (s) { s.value = e.target.value; }); }; });
      if (!r) return null;
      pares.forEach(function (p, i) { if (r.get('p' + i) === 'borrar') borrar[p.e.id] = 1; });
    }
    var R = { mov: 0, del: 0 }, aBorrar = [];
    for (var i = 0; i < moving.length; i++) {
      var e = moving[i];
      if (borrar[e.id]) { if (e.sh) setAcc(ME.id, e.sh.id, 'salido'); else aBorrar.push(e); R.del++; continue; }
      if (e.sh) setAcc(ME.id, e.sh.id, 'aceptado', destId);
      else await putObj(ME, e.id, Object.assign({}, e.d, { cal: destId }, anual && (!e.d.repetir || e.d.repetir === 'no') ? { repetir: 'anual' } : {}), '');
      R.mov++;
    }
    if (aBorrar.length) await aPapelera(aBorrar, 'duplicado al mover');
    return R;
  }
  async function borrarCals(ids) {
    var restantes = cals().filter(function (c) { return c.d.tipo !== 'cumple' && ids.indexOf(c.id) < 0; });
    if (!restantes.length) { alert('Necesitas al menos un calendario.'); return false; }
    var off = Object.assign({}, pref().autoOff || {}), cambiaOff = false;
    for (var i = 0; i < ids.length; i++) {
      var c = item(ids[i]); if (!c || c.d.tipo === 'cumple') continue;
      recs('acc').filter(function (a) { return a.user === ME.id && a.cal === c.id; }).forEach(function (a) { a.cal = restantes[0].id; save(a); });
      await aPapelera([c].concat(privados('evento').filter(function (e) { return e.d.cal === c.id; })), '');
      if (/^auto-/.test(c.d.tipo || '')) { off[c.d.tipo] = true; cambiaOff = true; }
    }
    if (cambiaOff) await setPref({ autoOff: off });
    return true;
  }
  async function preguntarVacios(ids) {
    for (var i = 0; i < ids.length; i++) {
      var c = item(ids[i]); if (!c || c.d.papelera || c.d.tipo === 'cumple') continue;
      if (futuros(eventosDeCal(c.id)).length) continue;
      if (confirm('El calendario «' + c.d.nombre + '» se ha quedado sin eventos futuros. ¿Borrarlo?' + (/^auto-/.test(c.d.tipo || '') ? '\n\nSi lo borras, también se desactiva su actualización de diciembre.' : ''))) await borrarCals([c.id]);
    }
  }
  function calSelIds() { return Object.keys(S.calSel || {}).filter(function (id) { var c = item(id); return c && !c.d.papelera; }); }

  /* ================= cambio 7: sincronización con Google (de Google hacia la agenda) ================= */
  var GSCOPES = 'openid email https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/contacts.readonly';
  function gClientId() { return window.MIAGENDA_GOOGLE_CLIENT_ID || dev.gClientId || ''; }
  function gTokDe(uid) { try { return JSON.parse(localStorage.getItem('miagenda.gtok.' + uid)) || null; } catch (e) { return null; } }
  function gTok() { return ME ? gTokDe(ME.id) : null; }
  function gValido() { var t = gTok(); return !!(t && t.access && Date.now() < t.exp); }
  function gLogin(silent) {
    if (!gClientId()) { alert('Falta el ID de cliente de Google (ver guía).'); return; }
    var st = 'g' + C.rid(14), t = gTok();
    sessionStorage.setItem('miagenda.gstate', JSON.stringify({ s: st, uid: ME.id, silent: !!silent }));
    var p = new URLSearchParams({ client_id: gClientId(), redirect_uri: window.Sync.redirectUri(), response_type: 'token', scope: GSCOPES, state: st, include_granted_scopes: 'true', prompt: silent ? 'none' : 'select_account' });
    if (t && t.hint) p.set('login_hint', t.hint);
    location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + p.toString());
  }
  function gRetorno() {
    var h = location.hash || '';
    if (!/(access_token|error)=/.test(h) || !/state=g/.test(h)) return null;
    var q = new URLSearchParams(h.slice(1)), saved = null;
    try { saved = JSON.parse(sessionStorage.getItem('miagenda.gstate')); } catch (e) {}
    history.replaceState(null, '', window.Sync.redirectUri()); sessionStorage.removeItem('miagenda.gstate');
    if (!saved || saved.s !== q.get('state')) return { error: 'La respuesta de Google no coincide.' };
    if (q.get('error')) return { error: q.get('error'), silent: saved.silent, uid: saved.uid };
    var prev = gTokDe(saved.uid) || {};
    localStorage.setItem('miagenda.gtok.' + saved.uid, JSON.stringify({ access: q.get('access_token'), exp: Date.now() + ((+q.get('expires_in') || 3600) - 60) * 1000, hint: prev.hint || '' }));
    return { ok: true, uid: saved.uid };
  }
  async function gApi(url) {
    var t = gTok(); if (!t || !t.access) throw new Error('auth');
    var r = await fetch(url, { headers: { Authorization: 'Bearer ' + t.access } });
    if (r.status === 401) { var x = gTok(); if (x) { x.access = ''; localStorage.setItem('miagenda.gtok.' + ME.id, JSON.stringify(x)); } throw new Error('auth'); }
    if (!r.ok) throw new Error('Google respondió ' + r.status);
    return r.json();
  }
  async function gCalendarios() { var j = await gApi('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250'); return (j.items || []).map(function (c) { return { id: c.id, nombre: c.summaryOverride || c.summary || c.id, color: c.backgroundColor || '#0369A1' }; }); }
  async function gEventos(calId) {
    var out = [], tok = '', hoy = hoyStr();
    do {
      var j = await gApi('https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(calId) + '/events?maxResults=2500&singleEvents=false' + (tok ? '&pageToken=' + encodeURIComponent(tok) : ''));
      (j.items || []).forEach(function (e) {
        if (e.status === 'cancelled' || !e.start) return;
        var dt = e.start.dateTime ? new Date(e.start.dateTime) : null, f = e.start.date || (dt ? ymd(dt) : ''), h = dt ? pad(dt.getHours()) + ':' + pad(dt.getMinutes()) : '';
        var rr = (e.recurrence || []).filter(function (x) { return /^RRULE/.test(x); })[0] || '', until = /UNTIL=(\d{8})/.exec(rr);
        var rep = /YEARLY/.test(rr) ? 'anual' : /MONTHLY/.test(rr) ? 'mensual' : /WEEKLY/.test(rr) ? 'semanal' : /DAILY/.test(rr) ? 'diario' : 'no', hasta = until ? icsDate(until[1]).f : '';
        if (!(f >= hoy || (rep !== 'no' && (!hasta || hasta >= hoy)))) return;
        out.push({ k: 'evento', titulo: e.summary || '(sin título)', fecha: f, hora: h, repetir: rep, hasta: hasta, lugar: e.location || '', notas: String(e.description || '').slice(0, 500), aviso: '', gev: e.id, gcal: calId });
      });
      tok = j.nextPageToken;
    } while (tok);
    return out;
  }
  function mapPersona(p, grupos) {
    var c = nuevoContactoVacio(pref().gRama || 'personal'), n = (p.names || [])[0] || {};
    c.nombre = [n.givenName, n.middleName].filter(Boolean).join(' '); c.apellidos = n.familyName || '';
    if (!c.nombre && !c.apellidos && n.displayName) { var sp = n.displayName.split(/\s+/); c.nombre = sp[0]; c.apellidos = sp.slice(1).join(' '); }
    (p.phoneNumbers || []).forEach(function (x) { pon(c, 'tels', x.formattedType || x.type || 'Otro', x.value); });
    (p.emailAddresses || []).forEach(function (x) { pon(c, 'emails', x.formattedType || x.type || 'Otro', x.value); });
    (p.addresses || []).forEach(function (x) { pon(c, 'dirs', x.formattedType || x.type || 'Otro', String(x.formattedValue || '').replace(/\n/g, ', ')); });
    var o = (p.organizations || [])[0]; if (o) { c.trabajo.empresa = o.name || ''; c.trabajo.cargo = o.title || ''; }
    var b = (p.birthdays || []).map(function (x) { return x.date; }).filter(function (x) { return x && x.month && x.day; })[0]; if (b) c.cumple = pad(b.day) + '-' + pad(b.month);
    c.grupo = (p.memberships || []).map(function (m) { return m.contactGroupMembership && grupos[m.contactGroupMembership.contactGroupResourceName]; }).filter(Boolean)[0] || '';
    c.gid = p.resourceName; c.google = true;
    return c;
  }
  async function gContactos() {
    var grupos = {};
    try { var gj = await gApi('https://people.googleapis.com/v1/contactGroups?pageSize=200'); (gj.contactGroups || []).forEach(function (g) { if (g.groupType === 'USER_CONTACT_GROUP') grupos[g.resourceName] = g.formattedName || g.name; }); } catch (e) { if (e.message === 'auth') throw e; }
    var out = [], tok = '';
    do {
      var j = await gApi('https://people.googleapis.com/v1/people/me/connections?pageSize=1000&personFields=names,phoneNumbers,emailAddresses,addresses,organizations,birthdays,memberships' + (tok ? '&pageToken=' + encodeURIComponent(tok) : ''));
      (j.connections || []).forEach(function (p) { out.push(mapPersona(p, grupos)); });
      tok = j.nextPageToken;
    } while (tok);
    return out.filter(function (c) { return c.nombre || c.apellidos; });
  }
  /* 7.2: manda Google en lo que viene de allí; se conserva lo añadido solo en la agenda */
  function aplicarGoogle(local, g) {
    var prev = local.gsnap || {}, key = function (v) { return telKey(v) || norm(v); };
    function arr(campo, sub) {
      var get = function (o) { return (sub ? ((o.trabajo || {})[campo]) : o[campo]) || []; };
      var gv = get(g), pk = get(prev).map(function (f) { return key(f.v); });
      var extra = get(local).filter(function (f) { return pk.indexOf(key(f.v)) < 0 && !gv.some(function (x) { return key(x.v) === key(f.v); }); });
      return gv.concat(extra);
    }
    var lt = local.trabajo || {};
    var nd = Object.assign({}, local, { nombre: g.nombre || local.nombre, apellidos: g.apellidos || local.apellidos, tels: arr('tels'), emails: arr('emails'), dirs: arr('dirs'), cumple: g.cumple || local.cumple || '', grupo: g.grupo || local.grupo || '', google: true, gid: g.gid, revisarNombre: false });
    nd.trabajo = Object.assign({}, lt, { empresa: g.trabajo.empresa || lt.empresa || '', cargo: g.trabajo.cargo || lt.cargo || '', tels: arr('tels', 1), emails: arr('emails', 1), dirs: arr('dirs', 1) });
    nd.gsnap = { tels: g.tels, emails: g.emails, dirs: g.dirs, trabajo: { tels: g.trabajo.tels, emails: g.trabajo.emails, dirs: g.trabajo.dirs } };
    return nd;
  }
  var gOcupado = false;
  async function gSync(manual) {
    if (!ME || gOcupado) return null;
    if (!gValido()) { if (manual) gLogin(false); return null; }
    gOcupado = true;
    var p = pref(), R = { ev: 0, evDel: 0, con: 0, conNew: 0, conDel: 0, pas: 0, dup: 0, imp: 0, sust: 0, ya: 0 };
    try {
      var gmap = Object.assign({}, p.gmap || {}), ign = (p.gIgnorar || []).slice();
      var gids = Object.keys(gmap);
      for (var i = 0; i < gids.length; i++) {
        var gid = gids[i], dest = gmap[gid];
        if (!dest || dest === 'no') continue;
        if (dest === '__nuevo' || !item(dest) || item(dest).d.papelera) { dest = await putObj(ME, null, { k: 'cal', nombre: ((p.gnombres || {})[gid] || 'Google'), color: ((p.gcolores || {})[gid] || '#0369A1'), rama: 'ambas', activo: true, tipo: 'importado' }, ''); gmap[gid] = dest; }
        var evs = await gEventos(gid), byG = {};
        privados('evento').filter(function (e) { return e.d.gcal === gid; }).forEach(function (e) { byG[e.d.gev] = e; });
        var nuevos = [];
        for (var j = 0; j < evs.length; j++) {
          var ev = evs[j], x = byG[ev.gev];
          if (x) { delete byG[ev.gev]; var nd = Object.assign({}, x.d, ev, { cal: x.d.cal, aviso: x.d.aviso }); if (JSON.stringify(nd) !== JSON.stringify(x.d)) { await putObj(ME, x.id, nd, ''); R.ev++; } }
          else if (ign.indexOf(ev.gev) < 0) nuevos.push(ev);
        }
        if (nuevos.length) await procesarEventos(nuevos, dest, R, { onBorrar: function (e) { ign.push(e.gev); } });
        var quitados = Object.values(byG);
        if (quitados.length) { await aPapelera(quitados, 'borrado en Google'); R.evDel += quitados.length; }
      }
      if (p.gContactos) {
        var gc = await gContactos(), locales = privados('contacto'), porGid = {};
        locales.forEach(function (k) { if (k.d.gid) porGid[k.d.gid] = k; });
        for (var c = 0; c < gc.length; c++) {
          var g = gc[c], loc = porGid[g.gid];
          if (loc) delete porGid[g.gid]; else { loc = contactoCoincide(g); if (loc && loc.d.gid) loc = null; }
          if (loc) { var nd2 = aplicarGoogle(loc.d, g); if (JSON.stringify(nd2) !== JSON.stringify(loc.d)) { await putObj(ME, loc.id, nd2, ''); R.con++; } }
          else { g.gsnap = { tels: g.tels, emails: g.emails, dirs: g.dirs, trabajo: { tels: g.trabajo.tels, emails: g.trabajo.emails, dirs: g.trabajo.dirs } }; await putObj(ME, null, g, ''); R.conNew++; }
        }
        var borrados = Object.values(porGid).filter(function (k) { return k.d.google; });
        if (borrados.length) { await aPapelera(borrados, 'borrado en Google'); R.conDel = borrados.length; }
      }
      await setPref({ gmap: gmap, gIgnorar: ign.slice(-2000), gLast: Date.now() });
    } catch (e) {
      if (e.message === 'auth') { toast('Google: hay que volver a conectar'); if (manual) { gOcupado = false; gLogin(false); return null; } }
      else toast('Google: ' + e.message);
    }
    gOcupado = false;
    commit(); render();
    return R;
  }
  function googleHTML() {
    var cid = gClientId(), p = pref(), con = gValido(), t = gTok();
    var h = '<h2>Google (calendarios y contactos)</h2><div class="card pad col"><p class="muted">Trae a tu agenda, solo para ti, los calendarios y contactos de tu cuenta de Google. Va en un sentido: lo que cambies en Google llega aquí; lo que cambies aquí no se escribe en Google.</p>';
    if (!window.MIAGENDA_GOOGLE_CLIENT_ID) h += '<label class="f">ID de cliente de Google<input id="gcid" value="' + esc(dev.gClientId || '') + '" placeholder="xxxx.apps.googleusercontent.com"><span class="hint">Lo obtienes en Google Cloud (ver guía). También se puede poner en config.js.</span></label>';
    h += '<div class="btns">' + (con ? '<button class="btn pri" data-a="gSyncYa">Sincronizar ahora</button><button class="btn" data-a="gCargarCals">Elegir calendarios</button><button class="btn" data-a="gDesconectar">Desconectar</button>' : '<button class="btn pri" data-a="gConectar"' + (cid || !window.MIAGENDA_GOOGLE_CLIENT_ID ? '' : ' disabled') + '>' + (t ? 'Volver a conectar con Google' : 'Conectar con Google') + '</button>') + '</div>';
    var gm = p.gmap || {}, n = Object.keys(gm).filter(function (k) { return gm[k] && gm[k] !== 'no'; }).length;
    h += '<p class="muted">' + n + ' calendario' + (n === 1 ? '' : 's') + ' de Google sincronizado' + (n === 1 ? '' : 's') + (p.gLast ? ' · última vez: ' + new Date(p.gLast).toLocaleString('es-ES') : '') + '</p>';
    h += '<label class="f inline"><input type="checkbox" id="gCon"' + (p.gContactos ? ' checked' : '') + '>Sincronizar también mis contactos de Google</label>';
    h += '<label class="f">Rama para los contactos nuevos de Google<select id="gRama">' + RAMAS.map(function (o) { return '<option value="' + o[0] + '"' + ((p.gRama || 'personal') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label></div>';
    return h;
  }

  /* ================= cambio 8: compras ================= */
  function prioDe(i, L) { return i.d.prio || ((L && L.d.tipoTienda === 'online') ? 'deseado' : 'urgente'); }
  function precioNum(v) { return parseFloat(String(v || '').replace(/[^\d,.-]/g, '').replace(',', '.')) || 0; }
  function nombreDeEnlace(u) {
    try {
      var url = new URL(u), parts = url.pathname.split('/').filter(Boolean), i = parts.indexOf('dp');
      if (i < 0) i = parts.indexOf('gp');
      var slug = i > 0 ? parts[i - 1] : '';
      if (!slug || /^(dp|gp|product|-)$/i.test(slug)) return '';
      return decodeURIComponent(slug).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    } catch (e) { return ''; }
  }
  function selectorCompras() {
    var f = S.cfiltro || 'todos';
    return '<div class="seg" role="group" aria-label="Filtrar artículos">' + [['urgente', 'Urgente'], ['deseado', 'Deseados'], ['todos', 'Todos']].map(function (x) { return '<button data-a="cfiltro" data-v="' + x[0] + '" class="' + (f === x[0] ? 'on' : '') + '">' + x[1] + '</button>'; }).join('') + '</div>';
  }
  V.compras = function () {
    var f = S.cfiltro || 'todos', L = S.lista && item(S.lista);
    if (L && !L.d.papelera) {
      var online = L.d.tipoTienda === 'online', todosIts = itemsDe(L.id), items = todosIts.filter(function (i) { return f === 'todos' || prioDe(i, L) === f; });
      var cats = CATS.concat(Object.keys(catsPropias()).sort()), pend = todosIts.filter(function (i) { return !i.d.ok; });
      var total = pend.reduce(function (s, i) { return s + precioNum(i.d.precio); }, 0);
      var h = '<div class="btns"><button class="btn" data-a="cerrarLista">‹ Listas</button><button class="btn" data-a="editar" data-id="' + L.id + '">' + (L.sh && L.sh.owner !== ME.id ? 'Detalles' : 'Editar / compartir') + '</button><button class="btn" data-a="limpiarLista">Quitar comprados</button></div><h2>' + esc(L.d.nombre) + (L.d.tienda ? ' · ' + esc(L.d.tienda) : '') + ' <span class="tag">' + (online ? 'online' : 'tienda física') + '</span></h2>' + (L.sh ? '<p class="muted">Lista compartida' + etiquetaComp(L) + '. Todos los miembros pueden añadir y marcar.</p>' : '') + selectorCompras();
      h += '<form class="card addrow" data-additem="1"><label class="sr" for="itT">Artículo</label><input id="itT" placeholder="Artículo">' +
        (online ? '<label class="sr" for="itL">Enlace</label><input id="itL" type="url" class="full" placeholder="Enlace al artículo (pega aquí el de Amazon…)">' : '') +
        '<label class="sr" for="itC">Categoría</label><select id="itC">' + cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') + '<option value="__otra">Otra…</option></select><label class="sr" for="itCn">Nueva categoría</label><input id="itCn" placeholder="Nombre de la categoría nueva" hidden>' +
        '<label class="sr" for="itQ">Cantidad</label><input id="itQ" placeholder="Cant." class="qty"><label class="sr" for="itP">Precio</label><input id="itP" placeholder="Precio €" class="qty" inputmode="decimal">' +
        '<label class="sr" for="itU">Prioridad</label><select id="itU" class="qty2"><option value="urgente"' + (online ? '' : ' selected') + '>Urgente</option><option value="deseado"' + (online ? ' selected' : '') + '>Deseado</option></select><button class="btn pri" type="submit">Añadir</button></form>';
      if (total) h += '<p class="muted">Total pendiente: <b>' + total.toFixed(2).replace('.', ',') + ' €</b></p>';
      var orden = cats.concat(['Otros']); items.forEach(function (i) { if (orden.indexOf(i.d.cat || 'Otros') < 0) orden.push(i.d.cat); });
      orden.filter(function (c, k) { return orden.indexOf(c) === k; }).forEach(function (c) {
        var g = items.filter(function (i) { return (i.d.cat || 'Otros') === c; });
        if (!g.length) return;
        h += '<div class="grp">' + esc(c) + '</div><div class="card list">' + g.map(function (i) {
          var urg = prioDe(i, L) === 'urgente';
          var sub = [i.d.cant, i.d.precio ? precioNum(i.d.precio).toFixed(2).replace('.', ',') + ' €' : '', L.sh ? 'añadido por ' + nombre(i.rec.by) : ''].filter(Boolean).join(' · ');
          return '<div class="item wrap' + (i.d.ok ? ' done' : '') + '"><input type="checkbox" class="chk" data-a="itemOk" data-id="' + i.id + '"' + (i.d.ok ? ' checked' : '') + ' aria-label="Comprado"><span class="tx click" data-a="itemEdit" data-id="' + i.id + '"><b>' + esc(i.d.t) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>' +
            '<button class="btn sm' + (urg ? ' urg' : '') + '" data-a="itemPrio" data-id="' + i.id + '" aria-label="Cambiar prioridad">' + (urg ? 'Urgente' : 'Deseado') + '</button>' +
            (i.d.link ? '<a class="btn sm" href="' + esc(i.d.link) + '" target="_blank" rel="noopener">Abrir</a>' : '') + '<button class="btn sm del" data-a="itemDel" data-id="' + i.id + '" aria-label="Quitar">✕</button></div>';
        }).join('') + '</div>';
      });
      if (!items.length) h += '<div class="card empty">' + (f === 'todos' ? 'Lista vacía. Añade el primer artículo.' : 'No hay artículos ' + (f === 'urgente' ? 'urgentes' : 'deseados') + '.') + '</div>';
      return h;
    }
    var listas = todos('lista').filter(function (x) { return porRama(x.d); });
    var datos = listas.map(function (x) { var its = itemsDe(x.id).filter(function (i) { return !i.d.ok; }); return { x: x, n: its.length, u: its.filter(function (i) { return prioDe(i, x) === 'urgente'; }).length, de: its.filter(function (i) { return prioDe(i, x) === 'deseado'; }).length }; })
      .filter(function (o) { return f === 'todos' || (f === 'urgente' ? o.u : o.de); });
    return bandeja() + selectorCompras() + '<div class="btns"><button class="btn" data-a="ir" data-v="gestionar">Gestionar categorías</button></div><div class="card list">' + (datos.length ? datos.map(function (o) {
      var x = o.x;
      return '<div class="item click" data-a="abrirLista" data-id="' + x.id + '"><span class="tx"><b>' + esc(x.d.nombre) + (x.sh ? ' <span class="tag">compartida</span>' : '') + (x.d.tipoTienda === 'online' ? ' <span class="tag">online</span>' : '') + '</b><small>' + (x.d.tienda ? esc(x.d.tienda) + ' · ' : '') + o.n + ' pendientes' + (o.u ? ' · ' + o.u + ' urgente' + (o.u > 1 ? 's' : '') : '') + etiquetaComp(x) + '</small></span>›</div>';
    }).join('') : '<div class="empty">' + (f === 'todos' ? 'Sin listas. Pulsa + para crear una (una por tienda) y compártela con la familia.' : 'Ninguna lista con artículos ' + (f === 'urgente' ? 'urgentes' : 'deseados') + '.') + '</div>') + '</div>';
  };

  /* ================= cambios 10 y 11: temas, tamaño de letra y reloj ================= */
  var TEMAS = [['claro', 'Claro'], ['oscuro', 'Oscuro'], ['oscuro-ac', 'Oscuro alto contraste'], ['claro-ac', 'Claro alto contraste'], ['auto', 'Automático (como el móvil o el PC)']];
  var LETRAS = [['normal', 'Normal'], ['grande', 'Grande'], ['muygrande', 'Muy grande']];
  var mqOscuro = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function aplicarTema() {
    var p = (ME && me()) ? pref() : {}, t = p.tema || dev.temaUltimo || 'claro', l = p.letra || dev.letraUltima || 'normal';
    if (ME && me() && (dev.temaUltimo !== t || dev.letraUltima !== l)) { dev.temaUltimo = t; dev.letraUltima = l; saveDev(); }
    var ef = t === 'auto' ? (mqOscuro && mqOscuro.matches ? 'oscuro' : 'claro') : t, h = document.documentElement;
    if (ef === 'claro') h.removeAttribute('data-t'); else h.setAttribute('data-t', ef);
    if (l === 'normal') h.removeAttribute('data-letra'); else h.setAttribute('data-letra', l);
    var mt = document.querySelector('meta[name="theme-color"]'); if (mt) mt.setAttribute('content', { oscuro: '#121417', 'oscuro-ac': '#000000', 'claro-ac': '#9A3412' }[ef] || '#C2410C');
  }
  if (mqOscuro && mqOscuro.addEventListener) mqOscuro.addEventListener('change', function () { aplicarTema(); });
  function relojHTML(corto) {
    var d = new Date(), hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (corto) return '<b>' + hm + '</b><small>' + DIAS[d.getDay()] + ' ' + d.getDate() + ' ' + MESES[d.getMonth()].slice(0, 3) + '</small>';
    return '<b class="rh">' + hm + '</b><span class="rl"><span>' + DIAS[d.getDay()] + '</span><span>' + d.getDate() + ' de ' + MESES[d.getMonth()] + '</span></span>';
  }
  /* PC: el día de la semana y la fecha ocupan el 80 % del ancho del menú, las dos con la misma letra */
  function ajustarReloj() {
    var n = document.querySelector('.reloj-nav'); if (!n || !n.offsetWidth) return;
    var rl = n.querySelector('.rl'); if (!rl) return;
    rl.style.fontSize = '100px';
    var w = Math.max.apply(null, Array.from(rl.children).map(function (x) { return x.scrollWidth; }));
    if (w) rl.style.fontSize = Math.max(10, Math.floor(100 * n.clientWidth * 0.8 / w)) + 'px';
  }
  var eraPC = esPC();
  window.addEventListener('resize', function () { ajustarReloj(); var p = esPC(); if (eraPC !== null && p !== eraPC && ME) render(); eraPC = p; });
  function tick() {
    var r = $('#reloj'), logged = !!(ME && me());
    if (r) { r.hidden = !logged; if (logged) r.innerHTML = relojHTML(true); }
    var n = document.querySelector('.reloj-nav'); if (n) { n.innerHTML = relojHTML(); ajustarReloj(); }
  }
  function apariencia() {
    var p = pref();
    return '<h2>Apariencia</h2><div class="card pad col"><label class="f">Tema<select id="temaSel">' + TEMAS.map(function (o) { return '<option value="' + o[0] + '"' + ((p.tema || 'claro') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
      '<label class="f">Tamaño de letra<select id="letraSel">' + LETRAS.map(function (o) { return '<option value="' + o[0] + '"' + ((p.letra || 'normal') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label><span class="hint">Se guarda para ti y se aplica en todos tus dispositivos.</span></div>';
  }

  /* ================= alta de usuarios y sesiones ================= */
  async function defaultCals(actor) {
    await putObj(actor, null, { k: 'cal', nombre: 'Personal', color: '#C2410C', rama: 'personal', activo: true, tipo: 'normal', orden: 1 }, '');
    await putObj(actor, null, { k: 'cal', nombre: 'Trabajo', color: '#1D4ED8', rama: 'trabajo', activo: true, tipo: 'normal', orden: 2 }, '');
    await putObj(actor, null, { k: 'cal', nombre: 'Cumpleaños', color: '#EC4899', rama: 'ambas', activo: true, tipo: 'cumple', orden: 9 }, '');
  }
  async function crearIdentidad(nombreU, color, rol, pw, ficticio) {
    var idn = await C.newIdentity(pw), id = newId();
    save(Object.assign({ id: id, tipo: 'user', nombre: nombreU, color: color, rol: rol, estado: 'activo', ficticio: !!ficticio }, idn.fields));
    var actor = { id: id, mk: idn.keys.mk, sk: idn.keys.sk };
    await defaultCals(actor);
    return actor;
  }
  async function entrar(actor, recordar) {
    ME = { id: actor.id, mk: actor.mk, sk: actor.sk }; D = {}; SK = {}; RAW = {}; C.resetCache(); dev.join = null;
    dev.session = actor.id; saveDev();
    dev.recordado = dev.recordado || {}; dev.recordado[actor.id] = !!recordar; saveDev();
    if (recordar) await C.keyStore.put(actor.id, { mk: actor.mk, sk: actor.sk }); else await C.keyStore.del(actor.id).catch(function () {});
    S.view = 'inicio'; S.q = ''; S.lista = null; S.chat = null; S.loginUser = null; location.hash = 'inicio';
    await refresh(); render();
  }
  async function lock(olvidar) {
    if (ME && olvidar) await C.keyStore.del(ME.id).catch(function () {});
    ME = null; D = {}; SK = {}; RAW = {}; C.resetCache(); dev.session = ''; saveDev(); S.loginUser = null; render();
  }
  async function nuevoCodigo(u) {
    var code = C.code(), salt = C.b64(C.rnd(16));
    u.invSalt = salt; u.invHash = await C.sha(code.replace(/[^A-Z0-9]/gi, '').toUpperCase() + salt); save(u); commit();
    mostrarCodigo(u, code);
  }
  function enlaceUnirse(u) {
    var t = window.Sync.target();
    return t ? window.Sync.redirectUri() + '#unirse=' + [t.d, t.i, u.id].map(encodeURIComponent).join('~') : '';
  }
  function mostrarCodigo(u, code) {
    var link = enlaceUnirse(u);
    var txt = 'Hola ' + u.nombre + ', te he dado de alta en Mi Agenda Familia. ' + (link ? '1) Abre este enlace: ' + link + ' 2) Conecta con tu cuenta Microsoft. 3) ' : 'Abre la app, ') + 'toca tu nombre y escribe este código: ' + code;
    $('#frm').innerHTML = '<h3>Código de invitación</h3><p>Dáselo a <b>' + esc(u.nombre) + '</b>. Sirve una sola vez, para que elija su propia contraseña.</p><p class="bigcode">' + code + '</p>' + (link ? '<p class="muted">Enlace de invitación (para sus dispositivos):</p><p><code>' + esc(link) + '</code></p>' : '<p class="note">Para generar el enlace de invitación, conecta antes OneDrive con tu cuenta de admin.</p>') + '<div class="btns"><a class="btn" href="https://wa.me/?text=' + encodeURIComponent(txt) + '" target="_blank" rel="noopener">Enviar por WhatsApp</a><button class="btn pri" value="ok">Hecho</button></div>';
    $('#frm').onsubmit = null;
    $('#dlg').showModal();
  }
  /* Familia y usuarios ficticios para probar */
  async function sembrarFicticios(adminActor) {
    var ana = await crearIdentidad('Ana', '#BE185D', 'miembro', 'prueba1', true);
    var luis = await crearIdentidad('Luis', '#0F766E', 'miembro', 'prueba1', true);
    var abu = await crearIdentidad('Abuela', '#7E22CE', 'miembro', 'prueba1', true);
    var gente = [ana, luis, abu].concat(adminActor ? [adminActor] : []);
    var hoy = new Date(), f = function (n) { return ymd(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + n)); };
    var calDeA = function (a, nombreCal) { return Object.values(db.records).filter(function (r) { return r.tipo === 'obj' && r.owner === a.id; }).map(function (r) { return r.id; }); };
    void calDeA;
    await putObj(ana, null, { k: 'evento', titulo: 'Dentista', fecha: f(3), hora: '17:00', cal: '', repetir: 'no', aviso: '60' }, '');
    await putObj(ana, null, { k: 'tarea', titulo: 'Renovar DNI', vence: f(10), prioridad: 'alta', rama: 'personal' }, '');
    var sl = await createShare(ana, 'lista', gente.filter(function (g) { return g !== ana; }).map(function (g) { return g.id; }));
    var root = newId(); await putObj(ana, root, { k: 'lista', nombre: 'Compra semanal', tienda: 'Supermercado', rama: 'personal' }, sl);
    db.records[sl].root = root; save(db.records[sl]); setAcc(ana.id, sl, 'aceptado', '');
    for (var i = 0; i < 3; i++) await putObj(ana, null, { k: 'item', lista: root, t: ['Leche', 'Pan', 'Tomates'][i], cat: ['Lácteos', 'Panadería', 'Frutas y verduras'][i], cant: '', ok: false }, sl);
    luis.SK = luis.SK || {}; luis.SK[sl] = ana.SK[sl]; setAcc(luis.id, sl, 'aceptado', ''); await putObj(luis, null, { k: 'item', lista: root, t: 'Café', cat: 'Despensa', cant: '1', ok: false }, sl);
    var se = await createShare(luis, 'evento', [ana.id].concat(adminActor ? [adminActor.id] : []));
    var r2 = newId(); await putObj(luis, r2, { k: 'evento', titulo: 'Cena familiar', fecha: f(5), hora: '21:00', repetir: 'no', aviso: '60', lugar: 'Casa de la abuela' }, se);
    db.records[se].root = r2; save(db.records[se]); setAcc(luis.id, se, 'aceptado', '');
    var ch = await createShare(abu, 'chat', [ana.id]);
    await putObj(abu, null, { k: 'msg', t: '¿Venís el domingo a comer?', at: Date.now() - 3600e3 }, ch);
    if (adminActor) { var ch2 = await createShare(abu, 'chat', [adminActor.id]); await putObj(abu, null, { k: 'msg', t: 'Hola, soy la abuela. ¡Ya sé usar la agenda!', at: Date.now() - 600e3 }, ch2); }
  }

  /* ================= importar ================= */
  function leerArchivos(accept, multiple, cb) {
    var inp = $('#fileIn'); inp.value = ''; inp.accept = accept; inp.multiple = multiple;
    inp.onchange = function () { Array.from(inp.files).forEach(function (f) { var r = new FileReader(); r.onload = function () { cb(r.result, f.name); }; r.readAsText(f); }); };
    inp.click();
  }
  function icsDate(v) {
    var m = /(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{0,2}(Z?))?/.exec(v || '');
    if (!m) return null;
    if (m[4] && m[6]) { var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])); return { f: ymd(d), h: pad(d.getHours()) + ':' + pad(d.getMinutes()) }; }
    return { f: m[1] + '-' + m[2] + '-' + m[3], h: m[4] ? m[4] + ':' + m[5] : '' };
  }
  function csvParse(t) {
    var rows = [], row = [], f = '', q = false;
    for (var i = 0; i < t.length; i++) {
      var c = t[i];
      if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; } else f += c;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return x.trim(); }); });
  }
  function cumpleDe(v) { var m = /(\d{4}|-{2})-?(\d{2})-?(\d{2})/.exec(v || ''); if (m) return m[3] + '-' + m[2]; m = /^(\d{1,2})\/(\d{1,2})\/\d{2,4}$/.exec(v || ''); return m ? pad(m[2]) + '-' + pad(m[1]) : ''; }
  /* Exportar / importar mis datos (para guardarlos o llevarlos a otra familia) */
  async function exportarMios() {
    var pw = prompt('Elige una contraseña para proteger la copia (mínimo 6 caracteres). La necesitarás para importarla:');
    if (pw === null) return; if (pw.length < 6) return alert('Mínimo 6 caracteres.');
    var objetos = Object.keys(D).map(item).filter(function (it) { return it && it.d.k !== 'msg' && it.d.k !== 'sug' && it.d.k !== 'pref' && !it.d.papelera && (!it.sh || aceptado(it.sh)); }).map(function (it) {
      var d = Object.assign({}, it.d); if (it.sh && d.k === 'evento') d.cal = (acc(it.sh.id, ME.id) || {}).cal || d.cal; return { id: it.id, data: d };
    });
    var pack = await C.encWithPw(pw, { formato: 'miagenda-usuario', v: 1, nombre: me().nombre, exportado: new Date().toISOString(), objetos: objetos });
    pack.formato = 'miagenda-usuario-cifrado';
    descargar('mis-datos-' + me().nombre.replace(/\W+/g, '') + '-' + ymd(new Date()) + '.miagenda', 'application/json', JSON.stringify(pack));
    toast('Copia descargada (' + objetos.length + ' elementos)');
    return true;
  }
  async function importarMios(txt) {
    var pack; try { pack = JSON.parse(txt); } catch (e) { return alert('Archivo no válido.'); }
    if (pack.formato !== 'miagenda-usuario-cifrado') return alert('Este archivo no es una copia de "Mis datos".');
    var pw = prompt('Contraseña de la copia:'); if (pw === null) return;
    var data; try { data = await C.decWithPw(pw, pack); } catch (e) { return alert(e.message); }
    var map = {}, objs = data.objetos || [];
    objs.forEach(function (o) { map[o.id] = newId(); });
    for (var i = 0; i < objs.length; i++) {
      var d = Object.assign({}, objs[i].data);
      if (d.cal && map[d.cal]) d.cal = map[d.cal]; if (d.lista && map[d.lista]) d.lista = map[d.lista];
      if (d.k === 'cal' && d.tipo === 'cumple' && cals().some(function (c) { return c.d.tipo === 'cumple'; })) { map[objs[i].id] = cals().filter(function (c) { return c.d.tipo === 'cumple'; })[0].id; continue; }
      await putObj(ME, map[objs[i].id], d, '');
    }
    commit(); render(); toast(objs.length + ' elementos importados');
  }
  function descargar(nombreF, tipo, txt) { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: tipo })); a.download = nombreF; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
  function exportarICS(e) {
    var d = e.fecha.replace(/-/g, ''), q = function (s) { return String(s).replace(/([,;\\])/g, '\\$1'); };
    var L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mi Agenda Familia//ES', 'BEGIN:VEVENT', 'UID:' + C.rid(16) + '@miagenda', 'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z', 'SUMMARY:' + q(e.titulo)];
    if (e.hora) L.push('DTSTART:' + d + 'T' + e.hora.replace(':', '') + '00', 'DURATION:PT1H'); else { var n = parseYmd(e.fecha); n.setDate(n.getDate() + 1); L.push('DTSTART;VALUE=DATE:' + d, 'DTEND;VALUE=DATE:' + ymd(n).replace(/-/g, '')); }
    var rr = { anual: 'YEARLY', mensual: 'MONTHLY', semanal: 'WEEKLY', diario: 'DAILY' }[e.repetir]; if (rr) L.push('RRULE:FREQ=' + rr);
    if (e.lugar) L.push('LOCATION:' + q(e.lugar));
    if (e.aviso !== '' && e.aviso != null) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + q(e.titulo), 'TRIGGER:-PT' + (+e.aviso) + 'M', 'END:VALARM');
    L.push('END:VEVENT', 'END:VCALENDAR');
    descargar(e.titulo.replace(/[^\wáéíóúñ ]/gi, '').slice(0, 40) + '.ics', 'text/calendar', L.join('\r\n'));
  }

  /* ================= avisos ================= */
  function avisarNuevos() {
    if (!ME) return;
    var nuevos = [];
    pendientes().forEach(function (p) { var key = ME.id + ':inv:' + p.sh.id; if (!dev.notified[key]) { dev.notified[key] = Date.now(); nuevos.push(nombre(p.sh.owner) + ' te ha enviado: ' + (p.it.d.titulo || p.it.d.nombre)); } });
    recs('share').filter(function (s) { return s.kind === 'chat' && SK[s.id]; }).forEach(function (s) {
      msgs(s.id).forEach(function (m) { var key = ME.id + ':m:' + m.id; if (m.rec.by !== ME.id && m.d.at > lastRead(s.id) && !dev.notified[key]) { dev.notified[key] = Date.now(); nuevos.push(nombre(m.rec.by) + ': ' + m.d.t); } });
    });
    if (!nuevos.length) return;
    saveDev();
    if (!avisarNuevos.ready) return; /* no avisar de lo que ya había al entrar */
    toast(nuevos[0]);
    notificar('Mi Agenda', nuevos.slice(0, 3).join('\n'), 'nuevos');
  }
  function notificar(t, body, tag) { if (window.Notification && Notification.permission === 'granted' && navigator.serviceWorker) navigator.serviceWorker.ready.then(function (r) { r.showNotification(t, { body: body, icon: 'icon-192.png', tag: tag }); }); }
  function revisarAvisos() {
    if (!ME) return;
    var now = new Date();
    [0, 1, 3].forEach(function (n) {
      var ds = ymd(new Date(now.getTime() + n * 864e5));
      delDia(ds).forEach(function (o) {
        var e = o.it.d; if (e.aviso === '' || e.aviso == null) return;
        var hh = (e.hora || '09:00').split(':'), when = parseYmd(ds); when.setHours(+hh[0], +hh[1]);
        var key = ME.id + ':' + o.it.id + '@' + ds, at = when.getTime() - (+e.aviso) * 60000;
        if (now >= at && now < when.getTime() + 36e5 && !dev.notified[key]) { dev.notified[key] = Date.now(); saveDev(); toast('Aviso: ' + e.titulo); notificar(e.titulo, fechaLarga(ds) + (e.hora ? ' · ' + e.hora : ''), key); }
      });
    });
  }

  /* ================= sincronización ================= */
  var syncTimer = null, syncing = false, deepPending = false;
  function syncState(st, txt) { var b = $('#syncBtn'); b.className = 'sync ' + (st || ''); $('#syncTxt').textContent = txt; }
  function scheduleSync(deep) { if (deep) deepPending = true; clearTimeout(syncTimer); syncTimer = setTimeout(doSync, deep ? 300 : 2000); }
  async function doSync() {
    if (syncing) { scheduleSync(); return; }
    if (!window.Sync.connected()) {
      if (window.Sync.expired() && dev.clientId && !sessionStorage.getItem('miagenda.silentTried')) { sessionStorage.setItem('miagenda.silentTried', '1'); window.Sync.login(dev.clientId, true); return; }
      syncState(window.Sync.expired() ? 'err' : '', window.Sync.expired() ? 'Reconectar OneDrive' : 'Solo en este dispositivo'); return;
    }
    syncing = true; syncState('', 'Sincronizando…');
    var deep = deepPending; deepPending = false;
    try {
      var r = await window.Sync.sync(db, { fresh: !dev.synced, rewrite: deep, canCreate: isAdmin() });
      if (r.state === 'ok') {
        db = r.data; dev.synced = true; saveDev();
        if (cleanup()) { persist(); deepPending = true; }
        persist(); await refresh(); render();
        syncState('ok', 'OneDrive ✓ ' + pad(new Date().getHours()) + ':' + pad(new Date().getMinutes()));
        if (deepPending) scheduleSync(true);
        await quitarAccesos();
      } else if (r.state === 'notarget') syncState('err', 'Falta la carpeta común');
      else if (r.state === 'forbidden') syncState('err', 'Sin permiso a la carpeta');
      else syncState('err', 'Reconectar OneDrive');
    } catch (e) { syncState('err', 'Sin conexión, reintentará'); console.log(e); }
    syncing = false;
  }

  /* El admin retira el acceso a la carpeta de los usuarios borrados (solo se guarda un identificador, nunca el correo). */
  async function quitarAccesos() {
    var t = window.Sync.target(); if (!t || !t.own) return;
    var l = recs('revoke'), cambio = false;
    for (var i = 0; i < l.length; i++) { try { if (await window.Sync.revoke(l[i].perm)) { tomb(l[i].id); cambio = true; } } catch (e) {} }
    if (cambio) commit();
  }

  /* ================= acciones ================= */
  async function pedirPw(texto) { var p = prompt(texto); return p; }
  var A = {
    ir: function (d) { location.hash = d.v; },
    rama: function (d) { dev.rama[ME.id] = d.v; saveDev(); render(); },
    mes: function (d) {
      var v = esPC() ? (dev.calVista || 'mes') : 'mes', n = +d.v, s0 = parseYmd(S.sel);
      if (v === 'mes') { S.month = new Date(S.month.getFullYear(), S.month.getMonth() + n, 1); render(); return; }
      var nd = v === 'semana' ? new Date(s0.getFullYear(), s0.getMonth(), s0.getDate() + 7 * n) : v === 'dia' ? new Date(s0.getFullYear(), s0.getMonth(), s0.getDate() + n) : new Date(s0.getFullYear() + n, s0.getMonth(), Math.min(s0.getDate(), 28));
      S.sel = ymd(nd); S.month = new Date(nd.getFullYear(), nd.getMonth(), 1); render();
    },
    calVista: function (d) { dev.calVista = d.v; saveDev(); var s0 = parseYmd(S.sel); S.month = new Date(s0.getFullYear(), s0.getMonth(), 1); render(); },
    diaVista: function (d) { S.sel = d.v; var p = parseYmd(d.v); S.month = new Date(p.getFullYear(), p.getMonth(), 1); dev.calVista = 'dia'; saveDev(); render(); },
    latSel: function (d) { dev.latSel = d.v; saveDev(); render(); },
    dia: function (d) { S.sel = d.v; var p = parseYmd(d.v); if (p.getMonth() !== S.month.getMonth()) S.month = new Date(p.getFullYear(), p.getMonth(), 1); render(); },
    tfiltro: function (d) { S.tfiltro = d.v; render(); },
    nuevo: function () { var k = NUEVO[S.view] || 'evento'; if (k === 'contacto') return abrirContacto(); if (S.view === 'calendario' || S.view === 'inicio') return abrirForm(S.view === 'calendario' && esPC() && dev.latSel === 'tareas' ? 'tarea' : 'evento', null, { switchET: true }); abrirForm(k); },
    nuevoCal: function () { abrirForm('cal'); },
    editar: function (d) { var it = item(d.id); if (!it) return; if (it.d.k === 'contacto') abrirContacto(it); else abrirForm(it.d.k, it); },
    contactar: function (d) { return contactar(d.id, d.v); },
    irHoy: function () { today = new Date(); S.sel = ymd(today); S.month = new Date(today.getFullYear(), today.getMonth(), 1); S.q = ''; $('#q').value = ''; if (location.hash !== '#calendario') location.hash = 'calendario'; else render(); },
    gesRen: async function (d) {
      var nuevo = prompt('Nuevo nombre para «' + d.v + '»:', d.v); if (!nuevo || !nuevo.trim() || nuevo.trim() === d.v) return;
      var n = await renombrarEn(d.t, d.v, nuevo.trim()); commit(); render(); toast('Cambiado en ' + n + ' elemento' + (n === 1 ? '' : 's'));
    },
    gesDel: async function (d) {
      if (!confirm('¿Borrar «' + d.v + '»? ' + ({ grupo: 'Sus contactos quedarán sin grupo.', cat: 'Sus artículos pasarán a «Otros».' }[d.t] || 'Esos campos pasarán a llamarse «Otro».'))) return;
      var n = await renombrarEn(d.t, d.v, ''); commit(); render(); toast('Quitado de ' + n + ' elemento' + (n === 1 ? '' : 's'));
    },
    calMostrar: async function () { var ids = calSelIds(); for (var i = 0; i < ids.length; i++) { var c = item(ids[i]); await putObj(ME, c.id, Object.assign({}, c.d, { activo: true }), ''); } commit(); render(); },
    calOcultar: async function () { var ids = calSelIds(); for (var i = 0; i < ids.length; i++) { var c = item(ids[i]); await putObj(ME, c.id, Object.assign({}, c.d, { activo: false }), ''); } commit(); render(); },
    calMover: async function () {
      var ids = calSelIds(); if (!ids.length) return;
      var dests = cals().filter(function (c) { return ids.indexOf(c.id) < 0; });
      if (!dests.length) return alert('Deja sin marcar el calendario de destino.');
      var r = await dialogo('<h3>Mover eventos</h3><p>Los eventos de ' + ids.map(function (id) { return '«' + esc(item(id).d.nombre) + '»'; }).join(', ') + ' pasan al calendario que elijas. Los calendarios de origen se quedan.</p>' +
        '<label class="f">Mover a<select name="dest" id="movDest">' + dests.map(function (c) { return '<option value="' + c.id + '" data-cumple="' + (c.d.tipo === 'cumple' ? 1 : 0) + '">' + esc(c.d.nombre) + '</option>'; }).join('') + '</select></label>' +
        '<label class="f inline"><input type="checkbox" name="anual" id="movAnual">Ponerlos como «se repite cada año» (cumpleaños, santos)</label><div class="btns"><button class="btn pri" value="ok">Mover</button><button class="btn" value="cancel" formnovalidate>Cancelar</button></div>',
        function (frm) { var sel = frm.querySelector('#movDest'), chk = frm.querySelector('#movAnual'), upd = function () { chk.checked = sel.selectedOptions[0].dataset.cumple === '1'; }; upd(); frm.onchange = function (e) { if (e.target === sel) upd(); }; });
      if (!r) return;
      var R = await moverEventos(ids, r.get('dest'), !!r.get('anual')); if (!R) return;
      commit(); render(); toast(R.mov + ' eventos movidos' + (R.del ? ', ' + R.del + ' duplicados borrados' : ''));
      await preguntarVacios(ids); S.calSel = {}; commit(); render();
    },
    calJuntar: async function () {
      var ids = calSelIds(); if (ids.length < 2) return alert('Marca al menos dos calendarios para juntarlos.');
      var autos = ids.filter(function (id) { return /^auto-/.test(item(id).d.tipo || ''); });
      var r = await dialogo('<h3>Juntar ' + ids.length + ' calendarios</h3><label class="f">Quedan todos los eventos en<select name="dest" id="junDest">' + ids.map(function (id) { return '<option value="' + id + '">' + esc(item(id).d.nombre) + '</option>'; }).join('') + '<option value="__nuevo">Calendario nuevo</option></select></label>' +
        '<div class="row2" id="junNuevo" hidden><label class="f">Nombre<input name="nombre" placeholder="Nombre del calendario"></label><label class="f">Color<input name="color" type="color" value="' + COLORES[cals().length % COLORES.length] + '"></label></div>' +
        '<p class="muted">Los demás calendarios se vacían y van a la papelera.' + (autos.length ? ' Los automáticos que se borren dejan de actualizarse en diciembre.' : '') + '</p><div class="btns"><button class="btn pri" value="ok">Juntar</button><button class="btn" value="cancel" formnovalidate>Cancelar</button></div>',
        function (frm) { frm.onchange = function (e) { if (e.target.id === 'junDest') frm.querySelector('#junNuevo').hidden = e.target.value !== '__nuevo'; }; });
      if (!r) return;
      var dest = r.get('dest');
      if (dest === '__nuevo') dest = await putObj(ME, null, { k: 'cal', nombre: (r.get('nombre') || 'Calendario').trim(), color: r.get('color') || COLORES[0], rama: 'ambas', activo: true, tipo: 'normal' }, '');
      var otros = ids.filter(function (id) { return id !== dest; });
      var R = await moverEventos(otros, dest, false); if (!R) return;
      await borrarCals(otros); S.calSel = {}; commit(); render(); toast('Juntados: ' + R.mov + ' eventos' + (R.del ? ', ' + R.del + ' duplicados borrados' : ''));
    },
    calVaciar: async function () {
      var ids = calSelIds(); if (!ids.length) return;
      var n = 0; ids.forEach(function (id) { n += privados('evento').filter(function (e) { return e.d.cal === id; }).length; });
      if (!confirm('¿Vaciar ' + ids.length + ' calendario' + (ids.length > 1 ? 's' : '') + '? Sus ' + n + ' eventos van a la papelera; los calendarios se quedan.')) return;
      for (var i = 0; i < ids.length; i++) { var evs = privados('evento').filter(function (e) { return e.d.cal === ids[i]; }); if (evs.length) await aPapelera(evs, 'vaciado de «' + item(ids[i]).d.nombre + '»'); }
      commit(); render(); toast('Calendarios vaciados');
      await preguntarVacios(ids); S.calSel = {}; commit(); render();
    },
    calBorrar: async function () {
      var ids = calSelIds(); if (!ids.length) return;
      if (!confirm('¿Mover a la papelera ' + ids.length + ' calendario' + (ids.length > 1 ? 's' : '') + ' con todos sus eventos?')) return;
      if (await borrarCals(ids)) { S.calSel = {}; commit(); render(); toast('Movidos a la papelera'); }
    },
    gConectar: function () { var i = $('#gcid'); if (i) { dev.gClientId = i.value.trim(); saveDev(); } gLogin(false); },
    gDesconectar: function () { localStorage.removeItem('miagenda.gtok.' + ME.id); render(); toast('Google desconectado en este dispositivo'); },
    gSyncYa: async function () { toast('Sincronizando con Google…'); var R = await gSync(true); if (R) await dialogo('<h3>Google sincronizado</h3><ul><li>' + (R.imp) + ' eventos nuevos, ' + R.ev + ' actualizados, ' + R.evDel + ' quitados</li><li>' + R.conNew + ' contactos nuevos, ' + R.con + ' actualizados, ' + R.conDel + ' quitados</li>' + (R.dup ? '<li>' + R.dup + ' duplicados no importados</li>' : '') + '</ul><div class="btns"><button class="btn pri" value="ok">Aceptar</button></div>'); },
    gCargarCals: async function () {
      var lista;
      try { lista = await gCalendarios(); } catch (e) { if (e.message === 'auth') return gLogin(false); return alert('Google: ' + e.message); }
      var p = pref(), gm = p.gmap || {};
      var r = await dialogo('<h3>Calendarios de Google</h3><p class="muted">Elige, para cada uno, en qué calendario de tu agenda caen sus eventos.</p><div class="card list">' + lista.map(function (g, i) {
        var v = gm[g.id] || 'no';
        return '<div class="item wrap"><span class="dot" style="background:' + esc(g.color) + '"></span><span class="tx"><b>' + esc(g.nombre) + '</b></span><select name="g' + i + '" class="mini" aria-label="Destino"><option value="no"' + (v === 'no' ? ' selected' : '') + '>No sincronizar</option><option value="__nuevo"' + (v === '__nuevo' ? ' selected' : '') + '>Calendario nuevo «' + esc(g.nombre) + '»</option>' + cals().map(function (c) { return '<option value="' + c.id + '"' + (v === c.id ? ' selected' : '') + '>En ' + esc(c.d.nombre) + '</option>'; }).join('') + '</select></div>';
      }).join('') + '</div><div class="btns"><button class="btn pri" value="ok">Guardar y sincronizar</button><button class="btn" value="cancel" formnovalidate>Cancelar</button></div>');
      if (!r) return;
      var nm = Object.assign({}, p.gnombres || {}), col = Object.assign({}, p.gcolores || {});
      lista.forEach(function (g, i) { gm[g.id] = r.get('g' + i); nm[g.id] = g.nombre; col[g.id] = g.color; });
      await setPref({ gmap: gm, gnombres: nm, gcolores: col });
      A.gSyncYa();
    },
    cfiltro: function (d) { S.cfiltro = d.v; render(); },
    itemPrio: async function (d) { var i = item(d.id), L = item(i.d.lista); await putObj(ME, i.id, Object.assign({}, i.d, { prio: prioDe(i, L) === 'urgente' ? 'deseado' : 'urgente' }), i.rec.share); commit(); render(); },
    itemEdit: async function (d) {
      var i = item(d.id), L = item(i.d.lista), online = L && L.d.tipoTienda === 'online', cats = CATS.concat(Object.keys(catsPropias()).sort());
      var r = await dialogo('<h3>Artículo</h3><label class="f">Nombre<input name="t" value="' + esc(i.d.t) + '" required></label>' + (online || i.d.link ? '<label class="f">Enlace<input name="link" type="url" value="' + esc(i.d.link || '') + '"></label>' : '') +
        '<label class="f">Categoría<select name="cat" id="ieCat">' + cats.map(function (c) { return '<option' + (c === (i.d.cat || 'Otros') ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '<option value="__otra">Otra…</option></select></label><label class="f" id="ieCatN" hidden>Categoría nueva<input name="catN"></label>' +
        '<div class="row2"><label class="f">Cantidad<input name="cant" value="' + esc(i.d.cant || '') + '"></label><label class="f">Precio €<input name="precio" inputmode="decimal" value="' + esc(i.d.precio || '') + '"></label></div>' +
        '<label class="f">Prioridad<select name="prio"><option value="urgente"' + (prioDe(i, L) === 'urgente' ? ' selected' : '') + '>Urgente</option><option value="deseado"' + (prioDe(i, L) === 'deseado' ? ' selected' : '') + '>Deseado</option></select></label><div class="btns"><button class="btn pri" value="ok">Guardar</button><button class="btn" value="cancel" formnovalidate>Cancelar</button></div>',
        function (frm) { frm.onchange = function (e) { if (e.target.id === 'ieCat') frm.querySelector('#ieCatN').hidden = e.target.value !== '__otra'; }; });
      if (!r) return;
      var cat = r.get('cat') === '__otra' ? ((r.get('catN') || '').trim() || 'Otros') : r.get('cat');
      await putObj(ME, i.id, Object.assign({}, i.d, { t: (r.get('t') || '').trim() || i.d.t, link: r.get('link') != null ? (r.get('link') || '').trim() : i.d.link, cat: cat, cant: (r.get('cant') || '').trim(), precio: (r.get('precio') || '').trim(), prio: r.get('prio') }), i.rec.share);
      commit(); render();
    },

    verPasados: function () { S.verPasados = !S.verPasados; render(); },
    restaurar: async function (d) { var l = enPapelera().filter(function (it) { return it.d.papelera.g === d.v; }); for (var i = 0; i < l.length; i++) { var nd = Object.assign({}, l[i].d); delete nd.papelera; await putObj(ME, l[i].id, nd, ''); } commit(); render(); toast('Restaurado'); },
    eliminarDef: function (d) { if (!confirm('¿Eliminar definitivamente? No se podrá recuperar.')) return; enPapelera().filter(function (it) { return it.d.papelera.g === d.v; }).forEach(function (it) { tomb(it.id); }); commit(); render(); toast('Eliminado'); },
    vaciarPapelera: function () { var l = enPapelera(); if (!confirm('¿Vaciar la papelera? Se eliminan definitivamente ' + l.length + ' elementos.')) return; l.forEach(function (it) { tomb(it.id); }); commit(); render(); toast('Papelera vaciada'); },
    activarFestivos: async function () {
      var y = today.getFullYear();
      await setPref({ festivosAuto: true, festivosYear: y + 1, autoOff: {} });
      toast('Descargando festivos…');
      var r1 = await actualizarFestivos(y), r2 = await actualizarFestivos(y + 1);
      var R = { imp: r1.R.imp + r2.R.imp, dup: r1.R.dup + r2.R.dup, sust: r1.R.sust + r2.R.sust, pas: r1.R.pas + r2.R.pas, ya: r1.R.ya + r2.R.ya };
      await dialogo(resumenHTML(R, 'Festivos automáticos activados', '<p class="muted">Se crearon FIESTAS LABORALES (España + Comunidad de Madrid), Festivos Rumanía y Fiestas ortodoxas, para ' + y + ' y ' + (y + 1) + '. Cada diciembre se añadirá el año siguiente. Los festivos de Alcalá y los puentes los añades con «Añadir festivos del año».</p>' + r1.avisos.concat(r2.avisos).filter(function (v, i, a) { return a.indexOf(v) === i; }).map(function (a) { return '<p class="note">' + esc(a) + '</p>'; }).join('')));
    },
    actualizarFestivosYa: async function () {
      var y = +(($('#festYear') || {}).value || today.getFullYear()); toast('Actualizando ' + y + '…');
      var r = await actualizarFestivos(y);
      await dialogo(resumenHTML(r.R, 'Festivos de ' + y, r.avisos.map(function (a) { return '<p class="note">' + esc(a) + '</p>'; }).join('')));
    },
    marcarAnio: function (d) { S.marcarY = +d.v || today.getFullYear(); S.marcados = {}; location.hash = 'marcar'; },
    marcarY: function (d) { S.marcarY = (S.marcarY || today.getFullYear()) + (+d.v); S.marcados = {}; render(); },
    marcarDia: function (d) { S.marcados = S.marcados || {}; if (S.marcados[d.v]) delete S.marcados[d.v]; else S.marcados[d.v] = 1; var y = window.scrollY; render(); window.scrollTo(0, y); },
    guardarMarcados: async function () {
      var lab = calAuto('auto-lab'), dias = Object.keys(S.marcados || {}).sort(); if (!lab || !dias.length) return;
      var nom = ($('#mkNombre').value || '').trim() || 'Festivo local', tipo = $('#mkTipo').value, titulo = tipo === 'Puente' ? 'Puente' + (nom && nom !== 'Festivo local' ? ' · ' + nom : '') : nom;
      for (var i = 0; i < dias.length; i++) await putObj(ME, null, { k: 'evento', titulo: titulo, fecha: dias[i], hora: '', cal: lab.id, repetir: 'no', hasta: '', aviso: '', lugar: '', notas: '', origen: 'manual' }, '');
      var y = S.marcarY; S.marcados = {};
      if (today.getMonth() === 11 && y === today.getFullYear() + 1) await setPref({ labHecho: y });
      commit(); render(); toast(dias.length + ' días guardados en FIESTAS LABORALES');
    },
    opcionB: async function () {
      var y = today.getFullYear() + 1;
      var r = await dialogo('<h3>Opción B: el PDF de tu empresa</h3><ol><li>Abre tu chat con Claude (el del proyecto de la agenda).</li><li>Adjunta el PDF y escribe: «Hazme el archivo .ics con los festivos laborales de ' + y + ' de este PDF».</li><li>Descarga el archivo .ics que te devuelva.</li><li>Vuelve aquí y pulsa <b>Importar .ics ahora</b>.</li></ol><div class="btns"><button class="btn pri" value="importar">Importar .ics ahora</button><button class="btn" value="cancel" formnovalidate>Más tarde</button></div>');
      if (!r) return;
      var lab = await asegurarCalAuto('lab');
      var files = await leerTodos('.ics,text/calendar', true);
      await importarCalendarios(files, { dest: lab });
      await setPref({ labHecho: y });
    },
    labSnooze: function () { setPref({ labSnooze: Date.now() + 3 * 864e5 }).then(render); },
    labHecho: function (d) { setPref({ labHecho: +d.v }).then(render); },

    calActivo: async function (d) { var c = item(d.id); c.d.activo = c.d.activo === false; await putObj(ME, c.id, c.d, ''); commit(); render(); },
    icsUrl: async function () {
      var u = ($('#icsUrl').value || '').trim().replace(/^webcal:/i, 'https:'); if (!u) return;
      var txt;
      try { var r = await fetch(u); if (!r.ok) throw 0; txt = await r.text(); }
      catch (e) { return alert('Ese servidor no deja leer el calendario desde la app. Descarga el archivo .ics (abre la dirección en el navegador) e impórtalo con "Importar archivos .ics".'); }
      await importarCalendarios([{ txt: txt, name: u.split('/').pop().split('?')[0] }]);
    },
    borrar: async function (d) {
      var it = item(d.id); if (!it) return;
      if (it.d.k === 'cal') {
        var otros = cals().filter(function (c) { return c.id !== it.id && c.d.tipo !== 'cumple'; });
        if (!otros.length) return alert('Necesitas al menos un calendario.');
        var evs = privados('evento').filter(function (e) { return e.d.cal === it.id; });
        if (!confirm('¿Mover a la papelera el calendario «' + it.d.nombre + '» y sus ' + evs.length + ' eventos?')) return;
        recs('acc').filter(function (a) { return a.user === ME.id && a.cal === it.id; }).forEach(function (a) { a.cal = otros[0].id; save(a); });
        await aPapelera([it].concat(evs), '');
      } else if (it.sh) {
        if (!confirm('Se borra para todas las personas con las que lo compartes. Tú lo tendrás en la papelera. ¿Seguir?')) return;
        var copias = await copiaPrivada(it); dropShare(it.sh.id); await aPapelera(copias, 'era compartido');
      } else {
        if (!confirm('¿Mover a la papelera?')) return;
        await aPapelera(it.d.k === 'lista' ? [it].concat(itemsDe(it.id)) : [it], '');
      }
      $('#frm').onclick = null; $('#frm').onchange = null; $('#dlg').close(); if (S.lista === d.id) S.lista = null; commit(); render(); toast('Movido a la papelera');
    },
    hecho: async function (d) { var it = item(d.id); it.d.hecho = !it.d.hecho; await putObj(ME, it.id, it.d, ''); commit(); render(); },
    ics: function (d) { var it = item(d.id); exportarICS(it.d); },
    compartir: function (d) {
      var it = item(d.id); $('#dlg').close();
      elegirUsuarios(it.d.k === 'evento' ? 'Enviar evento a…' : 'Compartir con…', it.sh ? it.sh.members : [], function (ids) { return compartir(it, ids); });
    },
    dejarCompartir: function (d) { var it = item(d.id); if (confirm('Los demás dejarán de verlo. Tú conservas una copia. ¿Seguir?')) { $('#dlg').close(); dejarCompartir(it); } },
    salirCompartido: function (d) { var it = item(d.id); if (!confirm('Dejarás de verlo en tu agenda. ¿Seguir?')) return; setAcc(ME.id, it.sh.id, 'salido'); $('#dlg').close(); if (S.lista === d.id) S.lista = null; commit(); render(); },
    aceptar: function (d) { var s = $('#cal_' + d.id); setAcc(ME.id, d.id, 'aceptado', s ? s.value : ''); commit(); render(); toast('Aceptado: ya está en tu agenda'); },
    rechazar: function (d) { setAcc(ME.id, d.id, 'rechazado'); commit(); render(); toast('Rechazado'); },
    abrirLista: function (d) { S.lista = d.id; S.q = ''; $('#q').value = ''; if (location.hash !== '#compras') location.hash = 'compras'; else render(); },
    cerrarLista: function () { S.lista = null; render(); },
    itemOk: async function (d) { var i = item(d.id); i.d.ok = !i.d.ok; await putObj(ME, i.id, i.d, i.rec.share); commit(); render(); },
    itemDel: function (d) { tomb(d.id); commit(); render(); },
    limpiarLista: function () { itemsDe(S.lista).filter(function (i) { return i.d.ok; }).forEach(function (i) { tomb(i.id); }); commit(); render(); },
    abrirChat: function (d) { S.chat = d.v; render(); var i = $('#msgT'); if (i) i.focus(); },
    cerrarChat: function () { S.chat = null; render(); },
    accesosEjemplo: async function () {
      var l = [['Teléfono', 'Comunicación', 'tel:'], ['WhatsApp', 'Comunicación', 'https://wa.me/'], ['WeChat', 'Comunicación', 'weixin://'], ['PayPal', 'Pago (PayPal, Bizum…)', 'https://www.paypal.com'], ['Bizum (desde la app de tu banco)', 'Pago (PayPal, Bizum…)', ''], ['Mi banco', 'Banco', ''], ['OneDrive', 'Nube y notas', 'https://onedrive.live.com'], ['OneNote', 'Nube y notas', 'https://www.onenote.com/notebooks']];
      for (var i = 0; i < l.length; i++) await putObj(ME, null, { k: 'acceso', nombre: l[i][0], cat: l[i][1], enlace: l[i][2], rama: 'personal' }, '');
      commit(); render();
    },
    importar: function (d) {
      if (d.v === 'ics') leerTodos('.ics,text/calendar', true).then(importarCalendarios);
      else if (d.v === 'contactos') leerTodos('.csv,.vcf,text/vcard,text/csv', true).then(importarContactos);
      else if (d.v === 'mios') leerArchivos('.miagenda,.json', false, importarMios);
    },
    exportarMios: exportarMios,
    permisoAvisos: function () { if (!window.Notification) return alert('Este navegador no permite notificaciones. En iPhone, instala primero la app en la pantalla de inicio.'); Notification.requestPermission().then(function (p) { toast(p === 'granted' ? 'Notificaciones activadas' : 'No permitidas'); }); },
    loginMS: function () { var c = ($('#cid').value || '').trim(); dev.clientId = c; saveDev(); sessionStorage.removeItem('miagenda.silentTried'); window.Sync.login(c).catch(function (e) { alert(e.message); }); },
    logoutMS: function () { window.Sync.logout(); render(); syncState('', 'Solo en este dispositivo'); },
    syncNow: function () { if (window.Sync.connected()) doSync(); else if (window.Sync.expired() && dev.clientId) window.Sync.login(dev.clientId); else { if (ME) location.hash = 'ajustes'; toast('Conecta OneDrive primero'); } },
    loginUser: function (d) { S.loginUser = d.id; render(); var i = $('#lgPw') || $('#acCode'); if (i) i.focus(); },
    loginAtras: function () { S.loginUser = null; render(); },
    cambiarUsuario: function () { lock(true); },
    miColor: async function () {
      var u = me(), c = prompt('Escribe un color (ej. #C2410C) o uno de: ' + COLORES.join(' '), u.color);
      if (c && /^#[0-9a-f]{6}$/i.test(c)) { u.color = c; save(u); commit(); render(); }
    },
    cambiarPw: async function () {
      var a = await pedirPw('Contraseña actual:'); if (a === null) return;
      var b = await pedirPw('Nueva contraseña (mínimo 6):'); if (b === null) return; if (b.length < 6) return alert('Mínimo 6 caracteres.');
      try { var u = me(); Object.assign(u, await C.changePassword(u, a, b)); save(u); commit(); toast('Contraseña cambiada'); } catch (e) { alert(e.message); }
    },
    borrarme: async function () {
      var u = me();
      var admins = activos().filter(function (x) { return x.rol === 'admin'; });
      if (u.rol === 'admin' && admins.length === 1 && usuarios().length > 1) return alert('Eres el único administrador. Antes nombra a otro admin (pestaña Admin › Hacer admin).');
      if (confirm('Antes de salir, ¿quieres exportar tus datos para guardarlos o llevarlos a otra familia?')) { var ok = await exportarMios(); if (!ok) return; }
      var pw = await pedirPw('Para confirmar, escribe tu contraseña. Se borrarán tu usuario y TODOS tus datos, sin rastro:'); if (pw === null) return;
      try { await C.unlock(u, pw); } catch (e) { return alert('Contraseña incorrecta.'); }
      if (usuarios().length === 1) { await resetear(); return; }
      purgeUser(u.id); commit(true); await lock(true); toast('Tu usuario y tus datos se han borrado');
    },
    codigo: function (d) { nuevoCodigo(U(d.id)); },
    darAcceso: async function (d) {
      var u = U(d.id), em = prompt('Correo de la cuenta Microsoft de ' + u.nombre + ' (no se guarda en la app):'); if (!em) return;
      try { if (u.perm) await window.Sync.revoke(u.perm); u.perm = await window.Sync.invite(em.trim()); save(u); commit(); render(); toast('Acceso dado'); } catch (e) { alert(e.message); }
    },
    rol: function (d) {
      var u = U(d.id);
      if (u.rol === 'admin' && activos().concat(usuarios()).filter(function (x) { return x.rol === 'admin'; }).length <= 1) return alert('Debe quedar al menos un admin.');
      u.rol = u.rol === 'admin' ? 'miembro' : 'admin'; save(u); commit(); render();
    },
    borrarUsuario: function (d) {
      var u = U(d.id);
      if (!confirm('¿Borrar a ' + u.nombre + '? Se eliminan su usuario, todos sus datos, sus mensajes y lo que haya escrito en listas o notas compartidas. No se puede deshacer.')) return;
      purgeUser(u.id); commit(true); render(); toast(u.nombre + ' borrado sin rastro');
    },
    crearFicticios: async function () {
      if (usuarios().some(function (u) { return u.ficticio && u.nombre === 'Ana'; })) return alert('Ya existen los usuarios ficticios.');
      toast('Creando usuarios de prueba…'); await sembrarFicticios(ME); await refresh(); commit(); render(); toast('Creados Ana, Luis y Abuela (contraseña prueba1)');
    },
    borrarFicticios: function () {
      var f = usuarios().filter(function (u) { return u.ficticio && u.id !== ME.id; });
      if (!f.length) return toast('No hay usuarios ficticios');
      if (!confirm('¿Borrar ' + f.map(function (u) { return u.nombre; }).join(', ') + ' y todos sus datos?')) return;
      f.forEach(function (u) { purgeUser(u.id); }); commit(true); render(); toast('Usuarios ficticios borrados');
    },
    responderSug: async function (d) {
      var it = item(d.id), est = prompt('Estado (pendiente, en estudio, hecho, descartado):', it.d.estado || 'pendiente'); if (est === null) return;
      var resp = prompt('Respuesta (opcional):', it.d.respuesta || ''); if (resp === null) return;
      it.d.estado = est; it.d.respuesta = resp; await putObj(ME, it.id, it.d, it.rec.share); commit(); render();
    },
    exportarSugs: function () {
      var l = sugs(); if (!l.length) return toast('No hay sugerencias');
      descargar('sugerencias-mi-agenda-' + ymd(new Date()) + '.txt', 'text/plain', 'Sugerencias para Mi Agenda Familia (' + ymd(new Date()) + ')\n\n' + l.map(function (s, i) { return (i + 1) + '. [' + (s.d.estado || 'pendiente') + '] ' + s.d.texto + (s.d.respuesta ? '\n   Respuesta: ' + s.d.respuesta : ''); }).join('\n\n'));
    },
    resetear: async function () {
      var t = prompt('Esto borra TODOS los usuarios y datos de la familia, también en OneDrive. Escribe BORRAR para confirmar:');
      if (t !== 'BORRAR') return; await resetear();
    },
    cancelarUnirse: function () { dev.join = null; saveDev(); render(); },
    familiaPrueba: async function () {
      toast('Creando familia de prueba…');
      db = { v: 2, epoch: { id: 'e' + Date.now().toString(36), at: Date.now() }, records: {} };
      var admin = await crearIdentidad('Admin (prueba)', '#15171C', 'admin', 'admin123', true);
      await sembrarFicticios(admin); commit(); await entrar(admin, false); toast('Familia de prueba creada');
    }
  };
  /* Enlace de invitación: #unirse=driveId~carpetaId~usuarioId */
  function usarEnlace(txt) {
    var m = /#unirse=([^\s]+)/.exec(txt || ''); if (!m) return false;
    var p = m[1].split('~').map(decodeURIComponent); if (p.length < 3) return false;
    dev.join = { d: p[0], i: p[1], uid: p[2] }; saveDev();
    var t = window.Sync.target();
    if (!t || t.d !== p[0] || t.i !== p[1]) { window.Sync.setTarget(p[0], p[1], false); dev.synced = false; saveDev(); }
    return true;
  }
  async function resetear() {
    db = { v: 2, epoch: { id: 'e' + Date.now().toString(36), at: Date.now() }, records: {} };
    dev.notified = {}; dev.lastRead = {}; saveDev();
    await C.keyStore.clear().catch(function () {});
    commit(true); await lock(false); toast('Todo borrado. Crea la familia de nuevo.');
  }

  /* ================= eventos de la página ================= */
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-a]'); if (!el) return;
    var f = A[el.dataset.a]; if (!f) return;
    if (el.tagName !== 'INPUT') e.preventDefault();
    Promise.resolve(f(el.dataset, el)).catch(function (err) { console.error(err); alert('Error: ' + err.message); });
  });
  document.addEventListener('submit', async function (e) {
    var t = e.target; if (t.id === 'frm') return;
    e.preventDefault();
    try {
      if (t.dataset.dupgrupo) { await aplicarDuplicados(t, e.submitter ? e.submitter.value : 'aplicar'); return; }
      if (t.dataset.revnombres) {
        var fdn = new FormData(t), lr = privados('contacto').filter(function (k) { return k.d.revisarNombre; });
        for (var q = 0; q < lr.length; q++) { var nd2 = Object.assign({}, lr[q].d, { nombre: (fdn.get('n_' + lr[q].id) || '').trim(), apellidos: (fdn.get('a_' + lr[q].id) || '').trim(), revisarNombre: false }); await putObj(ME, lr[q].id, nd2, ''); }
        commit(); location.hash = 'contactos'; toast('Nombres guardados'); return;
      }
      if (t.dataset.pegarenlace) { if (!usarEnlace($('#pegaLink').value)) alert('Ese enlace no es una invitación válida.'); render(); }
      if (t.dataset.crearfamilia) {
        if ($('#cfPw').value !== $('#cfPw2').value) return alert('Las contraseñas no coinciden.');
        db = { v: 2, epoch: { id: 'e' + Date.now().toString(36), at: Date.now() }, records: {} };
        var a = await crearIdentidad($('#cfNombre').value.trim(), '#C2410C', 'admin', $('#cfPw').value, false);
        commit(); await entrar(a, true); toast('Familia creada. Ve a Admin para crear usuarios.');
      }
      if (t.dataset.login) {
        var u = U(S.loginUser), keys = await C.unlock(u, $('#lgPw').value);
        await entrar({ id: u.id, mk: keys.mk, sk: keys.sk }, $('#lgRec').checked);
      }
      if (t.dataset.activar) {
        var v = U(S.loginUser), code = $('#acCode').value.replace(/[^A-Z0-9]/gi, '').toUpperCase();
        if ($('#acPw').value !== $('#acPw2').value) return alert('Las contraseñas no coinciden.');
        if (!v.invHash || await C.sha(code + v.invSalt) !== v.invHash) return alert('Código incorrecto. Pide uno nuevo al admin.');
        var idn = await C.newIdentity($('#acPw').value);
        delete v.invHash; delete v.invSalt; Object.assign(v, idn.fields, { estado: 'activo' }); save(v);
        var act = { id: v.id, mk: idn.keys.mk, sk: idn.keys.sk };
        await defaultCals(act); commit(); await entrar(act, $('#acRec').checked); toast('¡Bienvenido/a, ' + v.nombre + '!');
      }
      if (t.dataset.additem) {
        var L = item(S.lista), lk = $('#itL') ? $('#itL').value.trim() : '', tx = $('#itT').value.trim() || nombreDeEnlace(lk); if (!tx) { if (lk) alert('Escribe el nombre del artículo.'); return; }
        var cat = $('#itC').value === '__otra' ? ($('#itCn').value.trim() || 'Otros') : $('#itC').value;
        await putObj(ME, null, { k: 'item', lista: L.id, t: tx, cat: cat, cant: $('#itQ').value.trim(), precio: $('#itP').value.trim(), prio: $('#itU').value, link: lk, ok: false }, L.sh ? L.sh.id : '');
        commit(); render(); $('#itT').focus();
      }
      if (t.dataset.msg) {
        var txt = $('#msgT').value.trim(); if (!txt) return;
        var sid;
        if (S.chat === 'fam') { var fc = famChat(); sid = fc && SK[fc.id] ? fc.id : await createShare(ME, 'chat', activos().map(function (x) { return x.id; }), { fam: true }); }
        else { var ch = chatCon(S.chat); sid = ch && SK[ch.id] ? ch.id : await createShare(ME, 'chat', [S.chat]); }
        await putObj(ME, null, { k: 'msg', t: txt, at: Date.now() }, sid);
        commit(); render(); var mi = $('#msgT'); if (mi) mi.focus();
      }
      if (t.dataset.sug) {
        var st = $('#sugT').value.trim(); if (!st) return;
        var admins = activos().filter(function (x) { return x.rol === 'admin'; }).map(function (x) { return x.id; });
        var ss = await createShare(ME, 'sug', admins);
        var rid = newId(); await putObj(ME, rid, { k: 'sug', texto: st, estado: 'pendiente', at: Date.now() }, ss);
        db.records[ss].root = rid; save(db.records[ss]); commit(); render(); toast('Sugerencia enviada al administrador');
      }
      if (t.dataset.nuevousuario) {
        var nu = { id: newId(), tipo: 'user', nombre: $('#nuNombre').value.trim(), color: $('#nuColor').value, rol: $('#nuRol').value, estado: 'invitado', ficticio: $('#nuFict').checked };
        var em = $('#nuEmail').value.trim();
        if (em) { try { nu.perm = await window.Sync.invite(em); toast('Acceso a la carpeta dado a su cuenta'); } catch (er) { alert('El usuario se crea, pero no se pudo compartir la carpeta: ' + er.message + '\nPuedes compartirla a mano desde OneDrive (ver guía).'); } }
        save(nu); await nuevoCodigo(nu); render();
      }
    } catch (err) { console.error(err); alert(err.message); }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.classList && t.classList.contains('calchk')) { S.calSel = S.calSel || {}; if (t.checked) S.calSel[t.dataset.cid] = 1; else delete S.calSel[t.dataset.cid]; var y = window.scrollY; render(); window.scrollTo(0, y); }
    if (t.id === 'calTodos') { S.calSel = {}; if (t.checked) cals().forEach(function (c) { if (c.d.tipo !== 'cumple') S.calSel[c.id] = 1; }); render(); }
    if (t.id === 'gCon') setPref({ gContactos: t.checked }).then(function () { toast(t.checked ? 'Se sincronizarán tus contactos de Google' : 'Contactos de Google: desactivado'); });
    if (t.id === 'gRama') setPref({ gRama: t.value });
    if (t.id === 'temaSel') setPref({ tema: t.value }).then(function () { render(); toast('Tema cambiado'); });
    if (t.id === 'letraSel') setPref({ letra: t.value }).then(function () { render(); });
    if (t.id === 'itC') { var n = $('#itCn'); if (n) { n.hidden = t.value !== '__otra'; if (!n.hidden) n.focus(); } }
  });
  document.addEventListener('input', function (e) { if (e.target.id === 'itL') { var tt = $('#itT'); if (tt && !tt.value.trim()) tt.value = nombreDeEnlace(e.target.value); } });
  document.addEventListener('change', function (e) { if (e.target.id === 'plazoSel') setPref({ plazoPapelera: +e.target.value }).then(function () { render(); toast('Plazo de la papelera: ' + plazoTxt(+e.target.value)); }); });
  $('#q').addEventListener('input', function (e) { S.q = e.target.value.trim(); render(); });
  window.addEventListener('hashchange', function () { S.view = location.hash.slice(1) || 'inicio'; S.q = ''; $('#q').value = ''; if (S.view !== 'compras') S.lista = null; if (S.view !== 'mensajes') S.chat = null; if (S.view !== 'calendario' && S.view !== 'calendarios') S.verPasados = false; if (S.view !== 'calendarios') S.calSel = {}; render(); window.scrollTo(0, 0); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { doSync(); revisarAvisos(); } });

  /* ================= arranque ================= */
  (async function () {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
    if (cleanup()) persist();
    var gRet = gRetorno();
    if (/^#unirse=/.test(location.hash)) { usarEnlace(location.hash); history.replaceState(null, '', window.Sync.redirectUri()); }
    var v = location.hash.slice(1); if (v) S.view = v;
    if (dev.session && U(dev.session)) {
      try { var k = await C.keyStore.get(dev.session); if (k && k.mk) { ME = { id: dev.session, mk: k.mk, sk: k.sk }; await refresh(); } } catch (e) {}
    }
    render();
    if (gRet) {
      if (gRet.ok && ME && ME.id === gRet.uid) { toast('Google conectado'); setTimeout(function () { A.gSyncYa(); }, 800); }
      else if (gRet.error && !gRet.silent) alert('Google: ' + gRet.error);
      else if (gRet.error) toast('Google: vuelve a conectar en Ajustes');
    }
    avisarNuevos.ready = true;
    try {
      var r = await window.Sync.handleRedirect();
      if (r === 'ok') { sessionStorage.removeItem('miagenda.silentTried'); toast('OneDrive conectado'); }
    } catch (e) { alert('No se pudo conectar: ' + e.message); }
    doSync();
    setInterval(revisarAvisos, 30000); revisarAvisos();
    setInterval(tick, 15000);
    setInterval(function () { if (!document.hidden) doSync(); }, 60000);
  })();
})();
