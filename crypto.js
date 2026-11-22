/* Mi Agenda Familia – cifrado. Todo ocurre en el dispositivo con WebCrypto (AES-GCM 256, ECDH P-256, PBKDF2).
   - Cada usuario tiene una clave maestra (mk) protegida por su contraseña: cifra sus datos privados.
   - Cada usuario tiene un par de claves ECDH: sirve para entregar claves de lo compartido solo a los miembros elegidos.
   - Nada de esto sale del dispositivo sin cifrar. Sin la contraseña, los datos de un usuario no se pueden leer. */
(function () {
  'use strict';
  var subtle = crypto.subtle, enc = new TextEncoder(), dec = new TextDecoder();
  var ITER = 250000;

  function b64(buf) { var b = new Uint8Array(buf), s = ''; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
  function unb64(s) { var bin = atob(s), b = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b; }
  function rnd(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return a; }
  function rid(n) { var a = rnd(n || 12), s = ''; var al = 'abcdefghijkmnpqrstuvwxyz23456789'; for (var i = 0; i < a.length; i++) s += al[a[i] % al.length]; return s; }
  function code() { var al = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', a = rnd(8), s = ''; for (var i = 0; i < 8; i++) s += al[a[i] % al.length]; return s.slice(0, 4) + '-' + s.slice(4); }

  async function pwKey(pw, saltB64, iter) {
    var base = await subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey({ name: 'PBKDF2', salt: unb64(saltB64), iterations: iter || ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encBytes(key, bytes, aad) {
    var iv = rnd(12), p = { name: 'AES-GCM', iv: iv };
    if (aad) p.additionalData = enc.encode(aad);
    return { iv: b64(iv), ct: b64(await subtle.encrypt(p, key, bytes)) };
  }
  async function decBytes(key, box, aad) {
    var p = { name: 'AES-GCM', iv: unb64(box.iv) };
    if (aad) p.additionalData = enc.encode(aad);
    return new Uint8Array(await subtle.decrypt(p, key, unb64(box.ct)));
  }
  async function encJSON(key, obj, aad) { return encBytes(key, enc.encode(JSON.stringify(obj)), aad); }
  async function decJSON(key, box, aad) { return JSON.parse(dec.decode(await decBytes(key, box, aad))); }
  async function newAes() { return subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']); }
  async function rawAes(key) { return new Uint8Array(await subtle.exportKey('raw', key)); }
  async function importAes(raw) { return subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']); }
  async function sha(s) { return b64(await subtle.digest('SHA-256', enc.encode(s))); }

  /* Crea las claves de un usuario nuevo y las protege con su contraseña. */
  async function newIdentity(pw) {
    var salt = b64(rnd(16)), pk = await pwKey(pw, salt, ITER);
    var mk = await newAes();
    var pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
    var pkcs8 = await subtle.exportKey('pkcs8', pair.privateKey);
    var pub = await subtle.exportKey('jwk', pair.publicKey);
    var fields = { salt: salt, iter: ITER, mkEnc: await encBytes(pk, await rawAes(mk)), skEnc: await encBytes(mk, new Uint8Array(pkcs8)), pub: { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y } };
    return { fields: fields, keys: await unlockWithMk(fields, await rawAes(mk)) };
  }
  async function unlockWithMk(f, mkRaw) {
    var mk = await importAes(mkRaw);
    var sk = await subtle.importKey('pkcs8', await decBytes(mk, f.skEnc), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
    return { mk: mk, sk: sk };
  }
  /* Abre las claves con la contraseña; si es incorrecta, lanza error. */
  async function unlock(f, pw) {
    var pk = await pwKey(pw, f.salt, f.iter);
    var mkRaw;
    try { mkRaw = await decBytes(pk, f.mkEnc); } catch (e) { throw new Error('Contraseña incorrecta'); }
    return unlockWithMk(f, mkRaw);
  }
  async function changePassword(f, oldPw, newPw) {
    var pk = await pwKey(oldPw, f.salt, f.iter), mkRaw;
    try { mkRaw = await decBytes(pk, f.mkEnc); } catch (e) { throw new Error('La contraseña actual no es correcta'); }
    var salt = b64(rnd(16)), npk = await pwKey(newPw, salt, ITER);
    return { salt: salt, iter: ITER, mkEnc: await encBytes(npk, mkRaw) };
  }

  var pairCache = {};
  async function pairKey(sk, myId, otherId, otherPub) {
    var k = myId + '|' + otherId;
    if (pairCache[k]) return pairCache[k];
    var pub = await subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: otherPub.x, y: otherPub.y, ext: true }, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    pairCache[k] = await subtle.deriveKey({ name: 'ECDH', public: pub }, sk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    return pairCache[k];
  }
  /* Entrega una clave compartida (raw) a otro usuario: solo él (y quien la envía) puede abrirla. */
  async function wrapFor(sk, myId, user, raw, shareId) { var box = await encBytes(await pairKey(sk, myId, user.id, user.pub), raw, 'share:' + shareId); box.from = myId; return box; }
  async function unwrapFrom(sk, myId, fromUser, box, shareId) { return decBytes(await pairKey(sk, myId, fromUser.id, fromUser.pub), box, 'share:' + shareId); }

  /* Guarda las claves abiertas en este dispositivo (no exportables) para no pedir la contraseña cada vez. */
  function idb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open('miagenda-keys', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('k'); };
      r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
    });
  }
  async function kv(mode, fn) { var db = await idb(); return new Promise(function (res, rej) { var tx = db.transaction('k', mode), st = tx.objectStore('k'), out = fn(st); tx.oncomplete = function () { res(out && out.result); }; tx.onerror = function () { rej(tx.error); }; }); }
  var keyStore = {
    put: function (uid, keys) { return kv('readwrite', function (s) { return s.put(keys, uid); }); },
    get: function (uid) { return kv('readonly', function (s) { return s.get(uid); }); },
    del: function (uid) { return kv('readwrite', function (s) { return s.delete(uid); }); },
    clear: function () { return kv('readwrite', function (s) { return s.clear(); }); }
  };

  /* Copia exportada protegida con una contraseña elegida al exportar. */
  async function encWithPw(pw, obj) { var salt = b64(rnd(16)); return { salt: salt, iter: ITER, box: await encJSON(await pwKey(pw, salt, ITER), obj, 'export') }; }
  async function decWithPw(pw, pack) { try { return await decJSON(await pwKey(pw, pack.salt, pack.iter), pack.box, 'export'); } catch (e) { throw new Error('Contraseña de la copia incorrecta'); } }

  window.Cifra = { encWithPw: encWithPw, decWithPw: decWithPw, rid: rid, code: code, sha: sha, b64: b64, rnd: rnd, newIdentity: newIdentity, unlock: unlock, changePassword: changePassword,
    encJSON: encJSON, decJSON: decJSON, newAes: newAes, rawAes: rawAes, importAes: importAes, wrapFor: wrapFor, unwrapFrom: unwrapFrom, keyStore: keyStore,
    resetCache: function () { pairCache = {}; } };
})();
