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
  function privados(k) { return Object.keys(D).map(item).filter(function (it) { return it && !it.sh && it.d.k === k && it.rec.owner === ME.id; }); }
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
  function cals() { return privados('cal').sort(function (a, b) { return (a.d.orden || 0) - (b.d.orden || 0) || a.d.nombre.localeCompare(b.d.nombre); }); }
  function calVisible(c) { return c && c.d.activo !== false && porRama(c.d); }
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
    todos('evento').forEach(function (it) { var c = calDe(it); if (calVisible(c) && ocurre(it.d, ds)) out.push({ it: it, c: c }); });
    var cc = cals().filter(function (c) { return c.d.tipo === 'cumple' && calVisible(c); })[0];
    if (cc) {
      var md = ds.slice(8, 10) + '-' + ds.slice(5, 7);
      privados('contacto').forEach(function (k) { if (k.d.cumple === md) out.push({ it: { id: k.id, d: { titulo: 'Cumpleaños de ' + k.d.nombre, aviso: '1440', fecha: ds }, virtual: true }, c: cc }); });
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
    var h = bandeja();
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
    var m = S.month, y = m.getFullYear(), mo = m.getMonth();
    var h = '<div class="calhead"><button class="btn" data-a="mes" data-v="-1" aria-label="Mes anterior">‹</button><b>' + MESES[mo][0].toUpperCase() + MESES[mo].slice(1) + ' ' + y + '</b><button class="btn" data-a="mes" data-v="1" aria-label="Mes siguiente">›</button></div>';
    h += '<div class="chips">' + cals().filter(function (c) { return porRama(c.d); }).map(function (c) {
      return '<button class="chip' + (c.d.activo === false ? ' off' : '') + '" data-a="calActivo" data-id="' + c.id + '" aria-pressed="' + (c.d.activo !== false) + '"><span class="dot" style="background:' + c.d.color + '"></span>' + esc(c.d.nombre) + '</button>';
    }).join('') + '<button class="chip" data-a="ir" data-v="calendarios">Gestionar calendarios</button></div><div class="card"><div class="grid">';
    ['L', 'M', 'X', 'J', 'V', 'S', 'D'].forEach(function (w) { h += '<span class="wd">' + w + '</span>'; });
    var start = new Date(y, mo, 1 - ((new Date(y, mo, 1).getDay() + 6) % 7));
    for (var i = 0; i < 42; i++) {
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i), ds = ymd(d);
      if (i === 35 && d.getMonth() !== mo) break;
      var l = delDia(ds), cls = 'day' + (d.getMonth() !== mo ? ' out' : '') + (ds === ymd(today) ? ' today' : '') + (ds === S.sel ? ' sel' : '');
      h += '<button class="' + cls + '" data-a="dia" data-v="' + ds + '"><span>' + d.getDate() + '</span><span class="dots">' + l.slice(0, 3).map(function (o) { return '<i style="background:' + o.c.d.color + '"></i>'; }).join('') + '</span></button>';
    }
    var sl = delDia(S.sel);
    return h + '</div></div><h2>' + fechaLarga(S.sel).replace(/^./, function (c) { return c.toUpperCase(); }) + '</h2><div class="card list">' + (sl.length ? sl.map(function (o) { return itemEvento(o); }).join('') : '<div class="empty">Sin eventos este día.</div>') + '</div>';
  };
  V.calendarios = function () {
    var h = '<div class="btns"><button class="btn" data-a="ir" data-v="calendario">‹ Calendario</button><button class="btn pri" data-a="nuevoCal">Nuevo calendario</button></div><h2>Mis calendarios</h2><div class="card list">';
    h += cals().map(function (c) {
      var n = privados('evento').filter(function (e) { return e.d.cal === c.id; }).length;
      return '<div class="item"><span class="dot" style="background:' + c.d.color + '"></span><span class="tx click" data-a="editar" data-id="' + c.id + '"><b>' + esc(c.d.nombre) + '</b><small>' + ({ personal: 'Personal', trabajo: 'Trabajo', ambas: 'Ambas ramas' }[c.d.rama] || '') + (c.d.tipo === 'cumple' ? ' · cumpleaños de tus contactos' : ' · ' + n + ' eventos') + '</small></span><button class="btn sm" data-a="calActivo" data-id="' + c.id + '">' + (c.d.activo === false ? 'Activar' : 'Desactivar') + '</button></div>';
    }).join('') + '</div>';
    h += '<h2>Añadir un calendario público</h2><div class="card" style="padding:14px"><p class="muted">Se copia como calendario tuyo; luego puedes cambiarle nombre y color o borrarlo. Comprueba las fechas oficiales.</p><div class="btns">' +
      window.CAL_PUBLICOS.map(function (p) { return '<button class="btn" data-a="calPublico" data-v="' + p.id + '"><span class="dot" style="background:' + p.color + '"></span>' + esc(p.nombre) + '</button>'; }).join('') + '</div></div>';
    h += '<h2>Importar</h2><div class="card" style="padding:14px;display:flex;flex-direction:column;gap:10px"><span class="muted">Archivos .ics de Google Calendar (Configuración › Importar y exportar › Exportar) u otros. Puedes elegir varios: cada uno será un calendario.</span><div class="btns"><button class="btn" data-a="importar" data-v="ics">Importar archivos .ics</button></div>' +
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
    return '<div class="chips">' + [['pend', 'Pendientes'], ['hechas', 'Hechas'], ['todas', 'Todas']].map(function (x) { return '<button class="chip' + (f === x[0] ? '' : ' off') + '" data-a="tfiltro" data-v="' + x[0] + '">' + x[1] + '</button>'; }).join('') +
      '</div><div class="card list">' + (l.length ? l.map(itemTarea).join('') : '<div class="empty">No hay tareas aquí.</div>') + '</div>';
  };
  function tel(t) { return String(t || '').replace(/[^\d+]/g, ''); }
  V.contactos = function () {
    var l = privados('contacto').filter(function (k) { return porRama(k.d); }).sort(function (a, b) { return a.d.nombre.localeCompare(b.d.nombre); });
    var h = '<div class="btns"><button class="btn" data-a="importar" data-v="contactos">Importar de Google (CSV o vCard)</button></div>', g = {};
    l.forEach(function (k) { var n = k.d.grupo || 'Sin grupo'; (g[n] = g[n] || []).push(k); });
    var gk = Object.keys(g).sort();
    if (!gk.length) return h + '<div class="card empty">Aún no tienes contactos. Pulsa + o importa tu archivo de Google Contactos.</div>';
    gk.forEach(function (n) {
      h += '<div class="grp">' + esc(n) + ' · ' + g[n].length + '</div><div class="card list">' + g[n].map(function (k) {
        var tl = tel(k.d.telefono), wa = tl.replace(/^\+/, '').replace(/^00/, '');
        return '<div class="item wrap"><span class="tx click" data-a="editar" data-id="' + k.id + '"><b>' + esc(k.d.nombre) + '</b><small>' + esc([k.d.telefono, k.d.email].filter(Boolean).join(' · ')) + '</small></span>' +
          (tl ? '<a class="btn sm" href="tel:' + tl + '">Llamar</a>' + (wa.length > 8 ? '<a class="btn sm" href="https://wa.me/' + wa + '" target="_blank" rel="noopener">WhatsApp</a>' : '') : '') + (k.d.email ? '<a class="btn sm" href="mailto:' + esc(k.d.email) + '">Correo</a>' : '') + '</div>';
      }).join('') + '</div>';
    });
    return h;
  };
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
  function itemsDe(listaId) { return Object.keys(D).map(item).filter(function (it) { return it && it.d.k === 'item' && it.d.lista === listaId; }); }
  V.compras = function () {
    var L = S.lista && item(S.lista);
    if (L) {
      var items = itemsDe(L.id);
      var h = '<div class="btns"><button class="btn" data-a="cerrarLista">‹ Listas</button><button class="btn" data-a="editar" data-id="' + L.id + '">' + (L.sh && L.sh.owner !== ME.id ? 'Detalles' : 'Editar / compartir') + '</button><button class="btn" data-a="limpiarLista">Quitar comprados</button></div><h2>' + esc(L.d.nombre) + (L.d.tienda ? ' · ' + esc(L.d.tienda) : '') + '</h2>' + (L.sh ? '<p class="muted">Lista compartida' + etiquetaComp(L) + '. Todos los miembros pueden añadir y marcar.</p>' : '');
      h += '<form class="card addrow" data-additem="1"><label class="sr" for="itT">Artículo</label><input id="itT" placeholder="Artículo"><label class="sr" for="itC">Categoría</label><select id="itC">' + CATS.map(function (c) { return '<option>' + c + '</option>'; }).join('') + '</select><label class="sr" for="itQ">Cantidad</label><input id="itQ" placeholder="Cant." class="qty"><button class="btn pri" type="submit">Añadir</button></form>';
      CATS.forEach(function (c) {
        var g = items.filter(function (i) { return (i.d.cat || 'Otros') === c; });
        if (!g.length) return;
        h += '<div class="grp">' + c + '</div><div class="card list">' + g.map(function (i) {
          return '<div class="item' + (i.d.ok ? ' done' : '') + '"><input type="checkbox" class="chk" data-a="itemOk" data-id="' + i.id + '"' + (i.d.ok ? ' checked' : '') + ' aria-label="Comprado"><span class="tx"><b>' + esc(i.d.t) + '</b><small>' + esc([i.d.cant, L.sh ? 'añadido por ' + nombre(i.rec.by) : ''].filter(Boolean).join(' · ')) + '</small></span><button class="btn sm del" data-a="itemDel" data-id="' + i.id + '" aria-label="Quitar">✕</button></div>';
        }).join('') + '</div>';
      });
      return h;
    }
    var listas = todos('lista').filter(function (x) { return porRama(x.d); });
    return bandeja() + '<div class="card list">' + (listas.length ? listas.map(function (x) {
      var n = itemsDe(x.id).filter(function (i) { return !i.d.ok; }).length;
      return '<div class="item click" data-a="abrirLista" data-id="' + x.id + '"><span class="tx"><b>' + esc(x.d.nombre) + (x.sh ? ' <span class="tag">compartida</span>' : '') + '</b><small>' + (x.d.tienda ? esc(x.d.tienda) + ' · ' : '') + n + ' pendientes' + etiquetaComp(x) + '</small></span>›</div>';
    }).join('') : '<div class="empty">Sin listas. Pulsa + para crear una (por ejemplo "Compra semanal") y compártela con la familia.</div>') + '</div>';
  };
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
      var l = Object.keys(D).map(item).filter(function (it) { return it && it.d.k === k && (k !== 'evento' && k !== 'nota' && k !== 'lista' || !it.sh || aceptado(it.sh)) && JSON.stringify(it.d).toLowerCase().indexOf(q) >= 0; });
      if (!l.length) return;
      total += l.length;
      h += '<div class="grp">' + tipos[k] + ' · ' + l.length + '</div><div class="card list">' + l.slice(0, 30).map(function (it) {
        var t = it.d.titulo || it.d.nombre || it.d.t || '', sub = it.d.fecha ? fechaLarga(it.d.fecha) : (it.d.telefono || it.d.email || '');
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
    var logged = !!(ME && me());
    document.body.classList.toggle('out', !logged);
    if (!logged) { $('#main').innerHTML = pantallaEntrada(); $('#nav').innerHTML = ''; $('#who').innerHTML = ''; return; }
    if (!V[S.view] || (S.view === 'admin' && !isAdmin())) S.view = 'inicio';
    var u = me();
    document.body.classList.toggle('trabajo', rama() === 'trabajo');
    $('#who').innerHTML = '<span class="avatar" style="background:' + u.color + '">' + esc(u.nombre[0]) + '</span><span>' + esc(u.nombre) + '</span>';
    document.querySelectorAll('.seg button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === rama()); });
    var mods = MODS.slice(); if (isAdmin()) mods.push(['admin', 'Admin']);
    var nm = noLeidos(), np = pendientes().length;
    $('#nav').innerHTML = mods.map(function (m) {
      var n = m[0] === 'mensajes' ? nm : m[0] === 'inicio' ? np : 0;
      var on = (S.view === m[0] || (S.view === 'calendarios' && m[0] === 'calendario')) && !S.q;
      return '<a href="#' + m[0] + '" class="' + (on ? 'on' : '') + '">' + svg(m[0]) + '<span>' + m[1] + '</span>' + (n ? '<i class="nb">' + n + '</i>' : '') + '</a>';
    }).join('');
    $('#main').innerHTML = S.q ? buscar(S.q) : V[S.view]();
    $('#fab').hidden = ['ajustes', 'admin', 'mensajes', 'calendarios'].indexOf(S.view) >= 0 && !S.q;
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
    contacto: ['Contacto', [['nombre', 'Nombre', 'text', 1], ['telefono', 'Teléfono (con prefijo, ej. +34)', 'tel'], ['email', 'Correo', 'email'], ['grupo', 'Grupo (Familia, Médicos…)', 'text'], ['cumple', 'Cumpleaños (DD-MM)', 'text'], ['rama', 'Rama', RAMAS], ['notas', 'Notas', 'textarea']]],
    nota: ['Nota', [['titulo', 'Título', 'text', 1], ['texto', 'Texto', 'textarea'], ['enlace', 'Enlace (OneNote, Drive…)', 'url'], ['etiquetas', 'Etiquetas', 'text'], ['rama', 'Rama', RAMAS]]],
    acceso: ['Acceso', [['nombre', 'Nombre (ej. Mi banco)', 'text', 1], ['cat', 'Tipo', TIPOS_ACCESO.map(function (t) { return [t, t]; })], ['enlace', 'Enlace o app (https://…, tel:…)', 'text'], ['usuario', 'Usuario (nunca la contraseña)', 'text'], ['ultimos4', 'Tarjeta: solo 4 últimos dígitos', 'text'], ['rama', 'Rama', RAMAS], ['notas', 'Notas', 'textarea']]],
    lista: ['Lista de compra', [['nombre', 'Nombre de la lista', 'text', 1], ['tienda', 'Tienda', 'text'], ['rama', 'Rama', RAMAS]]],
    cal: ['Calendario', [['nombre', 'Nombre', 'text', 1], ['color', 'Color', 'color'], ['rama', 'Rama', RAMAS], ['activo', 'Activo (se muestra)', 'checkbox']]]
  };
  var NUEVO = { inicio: 'evento', calendario: 'evento', tareas: 'tarea', contactos: 'contacto', notas: 'nota', accesos: 'acceso', compras: 'lista' };

  function abrirForm(k, it) {
    var def = FORMS[k], nuevo = !it;
    var d = it ? Object.assign({}, it.d) : { k: k, rama: rama() === 'todo' ? 'personal' : rama(), fecha: S.sel, prioridad: 'media', repetir: 'no', activo: true, color: COLORES[cals().length % COLORES.length] };
    if (k === 'evento' && !d.cal) { var c0 = calOpts().filter(function (o) { var c = item(o[0]); return c && porRama(c.d); })[0] || calOpts()[0]; d.cal = c0 ? c0[0] : ''; }
    if (k === 'evento' && it && it.sh) d.cal = (acc(it.sh.id, ME.id) || {}).cal || d.cal;
    var esMio = !it || !it.sh || it.sh.owner === ME.id;
    var h = '<h3>' + (nuevo ? 'Nuevo: ' : '') + def[0] + '</h3>';
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
    $('#dlg').showModal();
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
  async function importarICS(txt, nombreArchivo) {
    var lines = txt.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/), calName = '', ev = null, evs = [];
    lines.forEach(function (l) { if (/^X-WR-CALNAME/i.test(l)) calName = l.slice(l.indexOf(':') + 1).trim(); });
    calName = calName || nombreArchivo.replace(/\.ics$/i, '').replace(/_/g, ' ');
    var unesc = function (s) { return s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1'); };
    lines.forEach(function (l) {
      if (l === 'BEGIN:VEVENT') { ev = {}; return; }
      if (!ev) return;
      if (l === 'END:VEVENT') { if (ev.dt && ev.sum) evs.push(ev); ev = null; return; }
      var i = l.indexOf(':'); if (i < 0) return;
      var key = l.slice(0, i).split(';')[0].toUpperCase(), val = l.slice(i + 1);
      if (key === 'SUMMARY') ev.sum = unesc(val); else if (key === 'DTSTART') ev.dt = icsDate(val); else if (key === 'RRULE') ev.rr = val;
      else if (key === 'LOCATION') ev.loc = unesc(val); else if (key === 'DESCRIPTION') ev.desc = unesc(val).slice(0, 500);
    });
    var existente = cals().filter(function (c) { return c.d.nombre === calName && c.d.tipo === 'importado'; })[0];
    var calId = existente ? existente.id : await putObj(ME, null, { k: 'cal', nombre: calName, color: COLORES[cals().length % COLORES.length], rama: rama() === 'todo' ? 'personal' : rama(), activo: true, tipo: 'importado' }, '');
    if (existente) privados('evento').filter(function (e) { return e.d.cal === calId; }).forEach(function (e) { tomb(e.id); });
    for (var j = 0; j < evs.length; j++) {
      var e = evs[j], rr = e.rr || '', until = /UNTIL=(\d{8})/.exec(rr);
      await putObj(ME, null, { k: 'evento', titulo: e.sum, fecha: e.dt.f, hora: e.dt.h, cal: calId, repetir: /YEARLY/.test(rr) ? 'anual' : /MONTHLY/.test(rr) ? 'mensual' : /WEEKLY/.test(rr) ? 'semanal' : /DAILY/.test(rr) ? 'diario' : 'no', hasta: until ? icsDate(until[1]).f : '', lugar: e.loc || '', notas: e.desc || '', aviso: '' }, '');
    }
    commit(); render(); toast(evs.length + ' eventos en el calendario "' + calName + '"');
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
  async function importarContactos(txt, nombreArchivo) {
    var lista = [], r0 = rama() === 'todo' ? 'personal' : rama();
    if (/BEGIN:VCARD/i.test(txt)) {
      txt.replace(/\r\n[ \t]/g, '').split(/BEGIN:VCARD/i).slice(1).forEach(function (card) {
        var k = { nombre: '', telefono: '', email: '', cumple: '', grupo: '' };
        card.split(/\r?\n/).forEach(function (l) {
          var i = l.indexOf(':'); if (i < 0) return;
          var key = l.slice(0, i).split(';')[0].replace(/^item\d+\./i, '').toUpperCase(), v = l.slice(i + 1).trim();
          if (key === 'FN') k.nombre = v.replace(/\\,/g, ','); else if (key === 'TEL' && !k.telefono) k.telefono = v; else if (key === 'EMAIL' && !k.email) k.email = v;
          else if (key === 'BDAY') k.cumple = cumpleDe(v); else if (key === 'CATEGORIES') k.grupo = v.split(',')[0].replace(/^myContacts$/i, '');
        });
        lista.push(k);
      });
    } else {
      var rows = csvParse(txt), hd = (rows.shift() || []).map(function (h) { return h.trim().toLowerCase(); });
      var col = function (re) { for (var i = 0; i < hd.length; i++) if (re.test(hd[i])) return i; return -1; };
      var cN = col(/^(name|display name|nombre completo)$/), cF = col(/^(first name|given name|nombre)$/), cM = col(/^(middle name|segundo nombre)$/), cL = col(/^(last name|family name|apellidos?)$/);
      var cE = col(/e-?mail.*(value|address)|^e-?mail$|correo/), cB = col(/birthday|cumpleaños/), cG = col(/group membership|labels|etiquetas|grupo/), cP = [];
      hd.forEach(function (h, i) { if (/phone.*value|teléfono|telefono|mobile phone|^phone$|móvil/.test(h)) cP.push(i); });
      rows.forEach(function (r) {
        var g = function (i) { return i >= 0 ? (r[i] || '').trim() : ''; };
        var ph = ''; cP.some(function (i) { ph = g(i).split(':::')[0].trim(); return ph; });
        var grp = g(cG).split(':::').map(function (s) { return s.trim().replace(/^\* /, ''); }).filter(function (s) { return s && !/^(myContacts|starred)$/i.test(s); })[0] || '';
        lista.push({ nombre: g(cN) || [g(cF), g(cM), g(cL)].filter(Boolean).join(' '), telefono: ph, email: g(cE).split(':::')[0].trim(), cumple: cumpleDe(g(cB)), grupo: grp });
      });
    }
    var ya = {}; privados('contacto').forEach(function (c) { ya[(c.d.nombre || '').toLowerCase() + tel(c.d.telefono)] = c; });
    var n = 0;
    for (var i = 0; i < lista.length; i++) {
      var k = lista[i]; if (!k.nombre) continue;
      var prev = ya[k.nombre.toLowerCase() + tel(k.telefono)];
      await putObj(ME, prev ? prev.id : null, Object.assign({ k: 'contacto', rama: r0 }, prev ? prev.d : {}, k, { grupo: k.grupo || (prev && prev.d.grupo) || '' }), ''); n++;
    }
    commit(); render(); toast(n + ' contactos importados de ' + nombreArchivo);
  }
  /* Exportar / importar mis datos (para guardarlos o llevarlos a otra familia) */
  async function exportarMios() {
    var pw = prompt('Elige una contraseña para proteger la copia (mínimo 6 caracteres). La necesitarás para importarla:');
    if (pw === null) return; if (pw.length < 6) return alert('Mínimo 6 caracteres.');
    var objetos = Object.keys(D).map(item).filter(function (it) { return it && it.d.k !== 'msg' && it.d.k !== 'sug' && (!it.sh || aceptado(it.sh)); }).map(function (it) {
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
    mes: function (d) { S.month = new Date(S.month.getFullYear(), S.month.getMonth() + (+d.v), 1); render(); },
    dia: function (d) { S.sel = d.v; var p = parseYmd(d.v); if (p.getMonth() !== S.month.getMonth()) S.month = new Date(p.getFullYear(), p.getMonth(), 1); render(); },
    tfiltro: function (d) { S.tfiltro = d.v; render(); },
    nuevo: function () { abrirForm(NUEVO[S.view] || 'evento'); },
    nuevoCal: function () { abrirForm('cal'); },
    editar: function (d) { var it = item(d.id); if (!it) { var c = privados('contacto').filter(function (x) { return x.id === d.id; })[0]; if (c) abrirForm('contacto', c); return; } abrirForm(it.d.k, it); },
    calActivo: async function (d) { var c = item(d.id); c.d.activo = c.d.activo === false; await putObj(ME, c.id, c.d, ''); commit(); render(); },
    calPublico: async function (d) {
      var p = window.CAL_PUBLICOS.filter(function (x) { return x.id === d.v; })[0];
      var cid = await putObj(ME, null, { k: 'cal', nombre: p.nombre, color: p.color, rama: 'ambas', activo: true, tipo: 'publico', pub: p.id }, '');
      for (var i = 0; i < p.eventos.length; i++) await putObj(ME, null, { k: 'evento', titulo: p.eventos[i][1], fecha: p.eventos[i][0], cal: cid, repetir: 'no', aviso: '' }, '');
      commit(); render(); toast('Calendario "' + p.nombre + '" añadido' + (p.eventos.length ? '' : ': añade tú sus festivos'));
    },
    icsUrl: async function () {
      var u = ($('#icsUrl').value || '').trim().replace(/^webcal:/i, 'https:'); if (!u) return;
      try { var r = await fetch(u); if (!r.ok) throw 0; await importarICS(await r.text(), u.split('/').pop()); }
      catch (e) { alert('Ese servidor no deja leer el calendario desde la app. Descarga el archivo .ics (abre la dirección en el navegador) e impórtalo con "Importar archivos .ics".'); }
    },
    borrar: async function (d) {
      var it = item(d.id); if (!it) return;
      if (it.d.k === 'cal') {
        var otros = cals().filter(function (c) { return c.id !== it.id && c.d.tipo !== 'cumple'; });
        if (!otros.length) return alert('Necesitas al menos un calendario.');
        var evs = privados('evento').filter(function (e) { return e.d.cal === it.id; });
        if (!confirm('¿Borrar el calendario "' + it.d.nombre + '" y sus ' + evs.length + ' eventos?')) return;
        evs.forEach(function (e) { tomb(e.id); });
        recs('acc').filter(function (a) { return a.user === ME.id && a.cal === it.id; }).forEach(function (a) { a.cal = otros[0].id; save(a); });
        tomb(it.id);
      } else if (it.sh) {
        if (!confirm('Esto lo borra para todas las personas con las que lo compartes. ¿Seguro?')) return;
        dropShare(it.sh.id);
      } else {
        if (!confirm('¿Borrar?')) return;
        if (it.d.k === 'lista') itemsDe(it.id).forEach(function (i) { tomb(i.id); });
        tomb(it.id);
      }
      $('#dlg').close(); if (S.lista === d.id) S.lista = null; commit(); render(); toast('Borrado');
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
      if (d.v === 'ics') leerArchivos('.ics,text/calendar', true, importarICS);
      else if (d.v === 'contactos') leerArchivos('.csv,.vcf,text/vcard,text/csv', true, importarContactos);
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
        var L = item(S.lista), tx = $('#itT').value.trim(); if (!tx) return;
        await putObj(ME, null, { k: 'item', lista: L.id, t: tx, cat: $('#itC').value, cant: $('#itQ').value.trim(), ok: false }, L.sh ? L.sh.id : '');
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
  $('#q').addEventListener('input', function (e) { S.q = e.target.value.trim(); render(); });
  window.addEventListener('hashchange', function () { S.view = location.hash.slice(1) || 'inicio'; S.q = ''; $('#q').value = ''; if (S.view !== 'compras') S.lista = null; if (S.view !== 'mensajes') S.chat = null; render(); window.scrollTo(0, 0); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { doSync(); revisarAvisos(); } });

  /* ================= arranque ================= */
  (async function () {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
    if (cleanup()) persist();
    if (/^#unirse=/.test(location.hash)) { usarEnlace(location.hash); history.replaceState(null, '', window.Sync.redirectUri()); }
    var v = location.hash.slice(1); if (v) S.view = v;
    if (dev.session && U(dev.session)) {
      try { var k = await C.keyStore.get(dev.session); if (k && k.mk) { ME = { id: dev.session, mk: k.mk, sk: k.sk }; await refresh(); } } catch (e) {}
    }
    render();
    avisarNuevos.ready = true;
    try {
      var r = await window.Sync.handleRedirect();
      if (r === 'ok') { sessionStorage.removeItem('miagenda.silentTried'); toast('OneDrive conectado'); }
    } catch (e) { alert('No se pudo conectar: ' + e.message); }
    doSync();
    setInterval(revisarAvisos, 30000); revisarAvisos();
    setInterval(function () { if (!document.hidden) doSync(); }, 60000);
  })();
})();
