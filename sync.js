/* Mi Agenda Familia – conexión con Microsoft y sincronización.
   El archivo común vive en el OneDrive PERSONAL del administrador: carpeta "MiAgendaFamilia/agenda.json".
   El admin comparte esa carpeta (solo esa) con la cuenta Microsoft de cada miembro; cada uno entra con SU cuenta.
   Nadie más conoce la contraseña del admin. Todo el contenido privado va cifrado. */
(function () {
  'use strict';
  var AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0';
  var G = 'https://graph.microsoft.com/v1.0';
  var SCOPES = 'Files.ReadWrite.All offline_access User.Read';
  var FOLDER = 'MiAgendaFamilia';
  var TOK_KEY = 'miagenda.tokens.v2', TGT_KEY = 'miagenda.target.v2';

  function redirectUri() { return location.origin + location.pathname.replace(/index\.html$/, ''); }
  function b64url(bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function randomStr(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return b64url(a); }
  async function sha256(str) { return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))); }
  function getJ(k) { try { return JSON.parse(localStorage.getItem(k)) || null; } catch (e) { return null; } }
  function setJ(k, v) { if (v) localStorage.setItem(k, JSON.stringify(v)); else localStorage.removeItem(k); }
  function hint() { return localStorage.getItem('miagenda.hint') || ''; }

  async function login(clientId, silent) {
    if (!clientId) throw new Error('Falta el ID de aplicación (Client ID). Revisa config.js o Ajustes.');
    var verifier = randomStr(48), state = randomStr(16);
    sessionStorage.setItem('miagenda.pkce', JSON.stringify({ v: verifier, s: state, c: clientId, silent: !!silent }));
    var p = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: redirectUri(), scope: SCOPES, response_mode: 'query',
      state: state, code_challenge: b64url(await sha256(verifier)), code_challenge_method: 'S256', prompt: silent ? 'none' : 'select_account' });
    if (silent && hint()) p.set('login_hint', hint());
    location.assign(AUTH + '/authorize?' + p.toString());
  }
  async function tokenRequest(clientId, params) {
    params.client_id = clientId; params.scope = SCOPES;
    var r = await fetch(AUTH + '/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() });
    var j = await r.json();
    if (!r.ok) throw new Error(j.error_description || j.error || 'Error al iniciar sesión');
    var t = { access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in - 120) * 1000, clientId: clientId };
    setJ(TOK_KEY, t);
    return t;
  }
  async function handleRedirect() {
    var q = new URLSearchParams(location.search);
    if (!q.get('code') && !q.get('error')) return false;
    var saved = null;
    try { saved = JSON.parse(sessionStorage.getItem('miagenda.pkce')); } catch (e) {}
    history.replaceState(null, '', redirectUri());
    sessionStorage.removeItem('miagenda.pkce');
    if (q.get('error')) { if (saved && saved.silent) return 'silent-failed'; throw new Error(q.get('error_description') || q.get('error')); }
    if (!saved || saved.s !== q.get('state')) throw new Error('La respuesta de inicio de sesión no coincide. Vuelve a intentarlo.');
    await tokenRequest(saved.c, { grant_type: 'authorization_code', code: q.get('code'), redirect_uri: redirectUri(), code_verifier: saved.v });
    try { var me = await api('GET', '/me'); if (me.ok) { var j = await me.json(); localStorage.setItem('miagenda.hint', j.userPrincipalName || ''); } } catch (e) {}
    return 'ok';
  }
  async function getAccess() {
    var t = getJ(TOK_KEY);
    if (!t) return null;
    if (t.access && Date.now() < t.exp) return t.access;
    if (!t.refresh) return null;
    try { return (await tokenRequest(t.clientId, { grant_type: 'refresh_token', refresh_token: t.refresh })).access; }
    catch (e) { t.expired = true; t.access = null; t.refresh = null; setJ(TOK_KEY, t); return null; }
  }
  async function api(method, path, body, extra) {
    var tok = await getAccess(); if (!tok) throw new Error('Sin conexión con Microsoft');
    var h = Object.assign({ Authorization: 'Bearer ' + tok }, extra || {});
    if (body && typeof body !== 'string' && !(body instanceof ArrayBuffer) && !ArrayBuffer.isView(body) && !(body instanceof Blob)) { h['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    return fetch(path.indexOf('http') === 0 ? path : G + path, { method: method, headers: h, body: body, cache: 'no-store' });
  }

  /* ---- dónde está el archivo común ---- */
  function target() { return getJ(TGT_KEY); }
  function setTarget(d, i, own) { setJ(TGT_KEY, d ? { d: d, i: i, own: !!own } : null); }
  function fileUrl(t) { return '/drives/' + t.d + '/items/' + t.i + ':/agenda.json'; }
  /* El admin: busca (o crea) la carpeta en SU OneDrive. */
  async function findOwnFolder(create) {
    var r = await api('GET', '/me/drive/root:/' + FOLDER);
    if (r.status === 404 && create) r = await api('POST', '/me/drive/root/children', { name: FOLDER, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' });
    if (!r.ok) return null;
    var it = await r.json();
    setTarget(it.parentReference.driveId, it.id, true);
    return target();
  }

  function merge(a, b) {
    a = a || {}; b = b || {};
    var ea = a.epoch, eb = b.epoch;
    if (ea && eb && ea.id !== eb.id) return JSON.parse(JSON.stringify(ea.at >= eb.at ? a : b));
    var out = { v: 2, epoch: ea || eb || null, records: {} };
    var ra = a.records || {}, rb = b.records || {}, limit = Date.now() - 90 * 864e5;
    Object.keys(ra).concat(Object.keys(rb)).forEach(function (id) {
      var x = ra[id], y = rb[id], w;
      if (!x) w = y; else if (!y) w = x; else w = (x.upd || 0) >= (y.upd || 0) ? x : y;
      if (w && w.del && (w.upd || 0) < limit) return;
      if (w) out.records[id] = w;
    });
    return out;
  }
  function differs(m, r) {
    if (!r || !r.epoch || !m.epoch || r.epoch.id !== m.epoch.id) return true;
    var rr = r.records || {}, km = Object.keys(m.records);
    if (km.length !== Object.keys(rr).length) return true;
    return km.some(function (k) { return !rr[k] || rr[k].upd !== m.records[k].upd; });
  }
  async function download(t) {
    var r = await api('GET', fileUrl(t));
    if (r.status === 404) return { data: null, etag: null };
    if (r.status === 401) return { unauthorized: true };
    if (r.status === 403) return { forbidden: true };
    if (!r.ok) throw new Error('OneDrive respondió ' + r.status);
    var meta = await r.json();
    var c = await fetch(meta['@microsoft.graph.downloadUrl'], { cache: 'no-store' });
    if (!c.ok) c = await api('GET', fileUrl(t) + ':/content');
    return { data: await c.json(), etag: meta.eTag };
  }
  function upload(t, data, etag) {
    var h = { 'Content-Type': 'application/json' }; if (etag) h['If-Match'] = etag; else h['If-None-Match'] = '*';
    return api('PUT', fileUrl(t) + ':/content', JSON.stringify(data), h);
  }

  /* opts: fresh (primera vez: adopta lo de OneDrive), rewrite (borrado profundo), canCreate (admin: crear la carpeta si no existe) */
  async function sync(local, opts) {
    opts = opts || {};
    if (!(await getAccess())) return { state: 'off', data: local };
    var t = target();
    if (!t) t = await findOwnFolder(!!opts.canCreate);
    if (!t) return { state: 'notarget', data: local };
    for (var i = 0; i < 4; i++) {
      var d = await download(t);
      if (d.unauthorized) { setJ(TOK_KEY, null); return { state: 'off', data: local }; }
      if (d.forbidden) return { state: 'forbidden', data: local };
      var remote = d.data, base = local;
      if (opts.fresh && remote) base = { v: 2, epoch: null, records: {} };
      var merged = merge(base, remote);
      if (!merged.epoch) merged.epoch = { id: 'e' + Date.now().toString(36), at: Date.now() };
      if (opts.rewrite) {
        /* Borrado profundo: se elimina el archivo (con sus versiones antiguas) y se crea de nuevo. */
        if (d.etag) await api('DELETE', fileUrl(t));
        var up0 = await upload(t, merged, null);
        if (up0.ok) return { state: 'ok', data: merged };
        if (up0.status === 412 || up0.status === 409) { local = merged; continue; }
        throw new Error('No se pudo rehacer el archivo (' + up0.status + ')');
      }
      if (!differs(merged, remote)) return { state: 'ok', data: merged };
      var up = await upload(t, merged, d.etag);
      if (up.ok) return { state: 'ok', data: merged };
      if (up.status === 412 || up.status === 409) { local = merged; continue; }
      throw new Error('No se pudo guardar en OneDrive (' + up.status + ')');
    }
    throw new Error('Demasiados cambios a la vez; se reintentará.');
  }

  /* Admin: da acceso de edición a la carpeta común a la cuenta Microsoft de un miembro. El correo no se guarda en la app. */
  async function invite(email) {
    var t = target(); if (!t || !t.own) throw new Error('Conecta primero OneDrive con la cuenta del administrador.');
    var r = await api('POST', '/drives/' + t.d + '/items/' + t.i + '/invite', { recipients: [{ email: email }], roles: ['write'], requireSignIn: true, sendInvitation: false });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error((j.error && j.error.message) || ('No se pudo compartir (' + r.status + ')'));
    return (j.value && j.value[0] && j.value[0].id) || '';
  }
  /* Admin: quita el acceso a la carpeta a un usuario borrado. */
  async function revoke(permId) {
    var t = target(); if (!t || !t.own || !permId) return false;
    var r = await api('DELETE', '/drives/' + t.d + '/items/' + t.i + '/permissions/' + encodeURIComponent(permId));
    return r.ok || r.status === 404;
  }

  /* Fotos (cambio 19): archivos cifrados aparte, en la subcarpeta "fotos" de la carpeta común. */
  function blobPath(t, name) { return '/drives/' + t.d + '/items/' + t.i + ':/' + name; }
  async function putBlob(name, bytes) {
    var t = target(); if (!t || !(await getAccess())) return false;
    var r = await api('PUT', blobPath(t, name) + ':/content', bytes, { 'Content-Type': 'application/octet-stream' });
    return r.ok;
  }
  async function getBlob(name) {
    var t = target(); if (!t || !(await getAccess())) return null;
    var r = await api('GET', blobPath(t, name) + ':/content');
    if (!r.ok) return null;
    return new Uint8Array(await r.arrayBuffer());
  }

  window.Sync = {
    putBlob: putBlob, getBlob: getBlob,
    login: login, handleRedirect: handleRedirect, sync: sync, merge: merge, redirectUri: redirectUri,
    invite: invite, revoke: revoke, target: target, setTarget: setTarget,
    connected: function () { var t = getJ(TOK_KEY); return !!(t && !t.expired); },
    expired: function () { var t = getJ(TOK_KEY); return !!(t && t.expired); },
    logout: function () { setJ(TOK_KEY, null); setJ(TGT_KEY, null); localStorage.removeItem('miagenda.hint'); }
  };
})();
