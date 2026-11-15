#!/usr/bin/env node
/* OLiaMono online server. No npm dependencies: Node 22+ (node:sqlite, node:http, node:crypto).
   Authoritative rules (shared/engine.js), rooms, reconnect, chat, WebRTC signalling, rating, Fair Trade.
   Run: node server/server.js   Env: PORT, DB_PATH, ALLOWED_ORIGINS, TURN_URL, TURN_USER, TURN_PASS, BOT_DELAY_SCALE */
'use strict';
const http = require('node:http'), crypto = require('node:crypto'), path = require('node:path');
const E = require('./engine.js'), F = require('./fair.js');
const PORT = +process.env.PORT || 8787, SCALE = process.env.BOT_DELAY_SCALE != null ? +process.env.BOT_DELAY_SCALE : 1, AFK = (+process.env.AFK_MS || 90000), GONE = (+process.env.GONE_MS || 45000);
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }]; if (process.env.TURN_URL) ICE.push({ urls: process.env.TURN_URL, username: process.env.TURN_USER || '', credential: process.env.TURN_PASS || '' });

/* ---------- database ---------- */
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.env.DB_PATH || path.join(__dirname, 'oliamono.db'));
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT, nick TEXT NOT NULL, nick_lc TEXT NOT NULL, pass TEXT, salt TEXT, token TEXT UNIQUE, guest INTEGER DEFAULT 0, rp INTEGER DEFAULT 1000, games INTEGER DEFAULT 0, wins INTEGER DEFAULT 0, ranked INTEGER DEFAULT 0, figure INTEGER DEFAULT 0, fair REAL DEFAULT 100, created INTEGER, seen INTEGER);
CREATE INDEX IF NOT EXISTS users_nick ON users(nick_lc);
CREATE TABLE IF NOT EXISTS rp_history(uid INTEGER, ts INTEGER, delta INTEGER, rp INTEGER, match INTEGER);
CREATE TABLE IF NOT EXISTS matches(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, room TEXT, ranked INTEGER, rounds INTEGER, players TEXT);
CREATE TABLE IF NOT EXISTS ledger(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, room TEXT, seq INTEGER, kind TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS trades(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, room TEXT, ranked INTEGER, from_uid INTEGER, to_uid INTEGER, giver_uid INTEGER, v_from INTEGER, v_to INTEGER, ratio REAL, score INTEGER, verdict TEXT, reasons TEXT, done INTEGER, deal TEXT);
CREATE TABLE IF NOT EXISTS room_state(id TEXT PRIMARY KEY, ts INTEGER, data TEXT);
CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, from_uid INTEGER, about_uid INTEGER, why TEXT, ctx TEXT);
CREATE TABLE IF NOT EXISTS appeals(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, uid INTEGER, text TEXT, status TEXT DEFAULT 'new');
CREATE TABLE IF NOT EXISTS achievements(uid INTEGER, key TEXT, ts INTEGER, UNIQUE(uid,key));
CREATE TABLE IF NOT EXISTS seasons(id INTEGER PRIMARY KEY, name TEXT, closed INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS season_results(season INTEGER, uid INTEGER, rp INTEGER, place INTEGER);
INSERT OR IGNORE INTO sqlite_sequence(name,seq) SELECT 'users',100000 WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='users');`);
const q = (sql, ...a) => db.prepare(sql).all(...a), q1 = (sql, ...a) => db.prepare(sql).get(...a), run = (sql, ...a) => db.prepare(sql).run(...a);
const now = () => Date.now();
const cleanNick = s => String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
const validNick = s => /^[\p{L}\p{N} _.\-]{2,20}$/u.test(s);
const hash = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString('hex');
const pub = u => ({ id: u.id, nick: u.nick, rp: u.rp, rank: F.rankOf(u.rp), guest: !!u.guest, figure: u.figure });
function newUser(nick, pass, guest) { const salt = crypto.randomBytes(8).toString('hex'), token = crypto.randomBytes(24).toString('hex'); const r = run('INSERT INTO users(nick,nick_lc,pass,salt,token,guest,created,seen) VALUES(?,?,?,?,?,?,?,?)', nick, nick.toLowerCase(), pass ? hash(pass, salt) : null, salt, token, guest ? 1 : 0, now(), now()); return q1('SELECT * FROM users WHERE id=?', Number(r.lastInsertRowid)); }
function checkSeason() { const s = F.season(now()); const cur = q1('SELECT * FROM seasons WHERE id=?', s.id); if (cur) return s; const prev = q1('SELECT * FROM seasons WHERE closed=0 ORDER BY id DESC'); if (prev) { const top = q('SELECT id,rp FROM users WHERE ranked>0 ORDER BY rp DESC'); top.forEach((u, i) => { run('INSERT INTO season_results VALUES(?,?,?,?)', prev.id, u.id, u.rp, i + 1); if (i < 3) run('INSERT OR IGNORE INTO achievements VALUES(?,?,?)', u.id, `Сезон ${prev.name}: ${i + 1} место`, now()); else if (u.rp >= 1400) run('INSERT OR IGNORE INTO achievements VALUES(?,?,?)', u.id, `Сезон ${prev.name}: ${F.rankOf(u.rp)}`, now()); }); run('UPDATE users SET rp=CAST(ROUND(1000+(rp-1000)*0.5) AS INTEGER), ranked=MIN(ranked,5) WHERE ranked>0'); run('UPDATE seasons SET closed=1 WHERE id=?', prev.id); } run('INSERT INTO seasons(id,name) VALUES(?,?)', s.id, s.name); return s; }
let SEASON = checkSeason(); setInterval(() => { SEASON = checkSeason(); }, 3600e3).unref();

/* ---------- minimal RFC 6455 WebSocket ---------- */
const conns = new Set(), byUid = new Map();
function accept(req, sock) {
  const key = req.headers['sec-websocket-key']; if (!key || (ORIGINS.length && !ORIGINS.includes(req.headers.origin))) { sock.destroy(); return null; }
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64') + '\r\n\r\n');
  const c = { sock, buf: Buffer.alloc(0), frag: [], user: null, room: null, alive: true, chatT: [], strikes: 0, mute: 0 };
  c.send = o => { if (sock.destroyed) return; const d = Buffer.from(JSON.stringify(o)); let hd; if (d.length < 126) hd = Buffer.from([0x81, d.length]); else if (d.length < 65536) { hd = Buffer.alloc(4); hd[0] = 0x81; hd[1] = 126; hd.writeUInt16BE(d.length, 2); } else { hd = Buffer.alloc(10); hd[0] = 0x81; hd[1] = 127; hd.writeBigUInt64BE(BigInt(d.length), 2); } sock.write(Buffer.concat([hd, d])); };
  sock.on('data', ch => {
    c.buf = Buffer.concat([c.buf, ch]); if (c.buf.length > 1 << 20) return sock.destroy();
    for (; ;) {
      if (c.buf.length < 2) return; const b0 = c.buf[0], b1 = c.buf[1], op = b0 & 15, masked = b1 & 128; let len = b1 & 127, off = 2;
      if (len === 126) { if (c.buf.length < 4) return; len = c.buf.readUInt16BE(2); off = 4; } else if (len === 127) { if (c.buf.length < 10) return; len = Number(c.buf.readBigUInt64BE(2)); off = 10; }
      if (len > 65536 || !masked) return sock.destroy(); if (c.buf.length < off + 4 + len) return;
      const mk = c.buf.subarray(off, off + 4), pl = Buffer.from(c.buf.subarray(off + 4, off + 4 + len)); for (let i = 0; i < len; i++) pl[i] ^= mk[i & 3]; c.buf = c.buf.subarray(off + 4 + len);
      if (op === 8) { sock.end(Buffer.from([0x88, 0])); return; } if (op === 9) { sock.write(Buffer.concat([Buffer.from([0x8a, pl.length]), pl])); continue; } if (op === 10) { c.alive = true; continue; }
      c.frag.push(pl); if (!(b0 & 128)) continue; const txt = Buffer.concat(c.frag).toString('utf8'); c.frag = [];
      let m; try { m = JSON.parse(txt); } catch (e) { continue; } c.alive = true; try { onMsg(c, m); } catch (e) { console.error('handler', e); c.send({ t: 'err', msg: 'Внутренняя ошибка сервера' }); }
    }
  });
  const bye = () => { if (!conns.delete(c)) return; if (c.user && byUid.get(c.user.id) === c) { byUid.delete(c.user.id); if (c.room) offline(c.room, c.user.id); } };
  sock.on('close', bye); sock.on('error', bye); conns.add(c); return c;
}
setInterval(() => { for (const c of conns) { if (!c.alive) { c.sock.destroy(); continue; } c.alive = false; c.sock.write(Buffer.from([0x89, 0])); } }, 25000).unref();

/* ---------- rooms ---------- */
const rooms = new Map(); let roomSeq = 1;
const NAMES = ['Аврора', 'Бруно', 'Клара', 'Дарио', 'Эмиль', 'Фрида'];
const roomPub = r => ({ id: r.id, name: r.name, lock: !!r.pass, host: r.host, max: r.max, opts: r.opts, started: !!r.S, members: r.members.map(m => ({ uid: m.uid, nick: m.nick, rp: m.rp, ready: m.ready, figure: m.figure, seat: m.seat, bot: m.bot || 0, online: m.bot ? true : !!m.online })) });
const roomList = () => [...rooms.values()].map(r => ({ id: r.id, name: r.name, lock: !!r.pass, n: r.members.length, max: r.max, ranked: !!r.opts.ranked, started: !!r.S }));
const cast = (r, o, except) => { for (const m of r.members) { if (m.bot || m.uid === except) continue; const c = byUid.get(m.uid); if (c && c.room === r) c.send(o); } };
const lobbyCast = () => { const l = { t: 'rooms', list: roomList() }; for (const c of conns) if (c.user && !c.room) c.send(l); };
const sys = (r, text) => { const m = { t: 'chat', sys: 1, text, ts: now() }; r.chat.push(m); cast(r, m); };
function freeSeat(r) { for (let s = 0; s < 4; s++) if (!r.members.some(m => m.seat === s)) return s; return -1; }
function persist(r) { if (r.S) run('INSERT OR REPLACE INTO room_state VALUES(?,?,?)', r.id, now(), JSON.stringify({ id: r.id, name: r.name, pass: r.pass, salt: r.salt, host: r.host, max: r.max, opts: r.opts, members: r.members.map(m => Object.assign({}, m, { online: false })), S: r.S, ranked: r.ranked, mt: r.mt })); }
function drop(r) { clearTimeout(r.tm); rooms.delete(r.id); run('DELETE FROM room_state WHERE id=?', r.id); for (const m of r.members) { const c = byUid.get(m.uid); if (c && c.room === r) { c.room = null; c.send({ t: 'left' }); } } lobbyCast(); }
function leave(c) {
  const r = c.room; if (!r) return; c.room = null; const uid = c.user.id; c.send({ t: 'left' });
  if (r.S && r.S.phase !== 'over') { const i = r.S.players.findIndex(p => p.uid === uid); if (i >= 0 && !r.S.players[i].out && !r.S.auction) apply(r, i, { t: 'resign' }); const m = r.members.find(x => x.uid === uid); if (m) { m.online = false; m.left = true; } }
  else r.members = r.members.filter(m => m.uid !== uid);
  const humans = r.members.filter(m => !m.bot && !m.left); if (!humans.length) return drop(r);
  if (r.host === uid) { r.host = humans[0].uid; sys(r, `Права создателя переходят к ${humans[0].nick}`); }
  sys(r, `${c.user.nick} покидает стол`); cast(r, { t: 'room', room: roomPub(r) }); lobbyCast();
}
function offline(r, uid) { const m = r.members.find(x => x.uid === uid); if (!m) return; m.online = false; m.goneAt = now(); if (!r.S) { r.members = r.members.filter(x => x.uid !== uid); const humans = r.members.filter(x => !x.bot); if (!humans.length) return drop(r); if (r.host === uid) r.host = humans[0].uid; lobbyCast(); } else { if (!r.members.some(x => !x.bot && x.online)) r.emptyAt = now(); schedule(r, 0); } cast(r, { t: 'room', room: roomPub(r) }); }

/* ---------- authoritative game loop ---------- */
const ANIM = { dice: 1700, card: 4200, travel: 10500, arrest: 16000, jailOut: 3200, buy: 2600, build: 950, loan: 900, repay: 800, bankrupt: 1100, quizRes: 1700, auctionEnd: 500 };
const animMs = ev => ev.reduce((s, e) => s + (e.t === 'move' ? 500 + 240 * (((e.to - e.from) * (e.back ? -1 : 1) + 40) % 40) : e.t === 'pay' ? (e.from < 0 && e.amt >= 100 ? 2300 : 750) : ANIM[e.t] || 0), 0);
function apply(r, pidx, a) {
  const S = r.S; const res = E.act(S, pidx, a); if (!res.ok) return res;
  for (const e of res.ev) if (['pay', 'buy', 'loan', 'repay', 'seize', 'auctionEnd', 'tradeEnd', 'bankrupt', 'build', 'sell'].includes(e.t)) run('INSERT INTO ledger(ts,room,seq,kind,data) VALUES(?,?,?,?,?)', now(), r.id, e.id, e.t, JSON.stringify(e));
  cast(r, { t: 'ev', ev: res.ev, state: E.view(S) }); persist(r);
  if (S.phase === 'over') finish(r); else schedule(r, animMs(res.ev));
  return res;
}
function schedule(r, anim) {
  clearTimeout(r.tm); const S = r.S; if (!S || S.phase === 'over') return; const w = E.waitingFor(S); if (w < 0) return; const P = S.players[w], m = r.members.find(x => x.seat === P.color);
  if (!r.members.some(x => !x.bot && x.online) && r.emptyAt && now() - r.emptyAt > 10 * 60e3) return drop(r); // nobody came back for 10 minutes
  let wait; if (P.bot) wait = (anim + 700) * SCALE; else if (!m || m.left) wait = 300 * SCALE; else if (!m.online) wait = Math.max(GONE - (now() - (m.goneAt || 0)), anim * SCALE + 300); else wait = AFK + anim;
  r.tm = setTimeout(() => {
    if (r.S !== S || S.phase === 'over' || E.waitingFor(S) !== w) return; const human = !P.bot; const save = P.bot; if (human) P.bot = 2;
    let a = E.botAction(S, w) || { t: 'end' }; if (human) { P.bot = save; if (a.t === 'trade') a = S.phase === 'end' ? { t: 'end' } : { t: 'roll' }; }
    let res = apply(r, w, a); if (!res.ok) { res = apply(r, w, S.phase === 'auction' ? { t: 'pass' } : S.trade ? { t: 'tradeAns', ok: false } : { t: 'end' }); if (!res.ok) { console.error('stuck', r.id, S.phase, res.err); schedule(r, 2000); } }
  }, Math.max(20, wait));
}
function finish(r) {
  const S = r.S; clearTimeout(r.tm); const humans = S.players.filter(p => p.uid); const users = humans.map(p => q1('SELECT * FROM users WHERE id=?', p.uid)).filter(Boolean);
  const ranked = r.ranked && users.length >= 2; let deltas = {};
  if (ranked) deltas = F.elo(humans.map(p => { const u = users.find(x => x.id === p.uid); return { uid: p.uid, rp: u.rp, ranked: u.ranked, place: p.place }; }));
  const mid = Number(run('INSERT INTO matches(ts,room,ranked,rounds,players) VALUES(?,?,?,?,?)', now(), r.name, ranked ? 1 : 0, S.round, JSON.stringify(S.players.map(p => ({ uid: p.uid, name: p.name, bot: p.bot, place: p.place })))).lastInsertRowid);
  const results = [];
  for (const p of humans) { const u = users.find(x => x.id === p.uid); if (!u) continue; const d = deltas[p.uid] || 0, win = p.place === 1 && users.length >= 2; const rp = Math.max(0, u.rp + d);
    run('UPDATE users SET rp=?, games=games+1, wins=wins+?, ranked=ranked+?, fair=MIN(100,fair+?) WHERE id=?', rp, win ? 1 : 0, ranked ? 1 : 0, ranked ? 1 : 0, u.id); if (ranked) run('INSERT INTO rp_history VALUES(?,?,?,?,?)', u.id, now(), d, rp, mid);
    if (win) run('INSERT OR IGNORE INTO achievements VALUES(?,?,?)', u.id, 'Первая победа', now()); if (rp >= 1400) run('INSERT OR IGNORE INTO achievements VALUES(?,?,?)', u.id, 'Звание «Магнат»', now()); if (u.games + 1 >= 10) run('INSERT OR IGNORE INTO achievements VALUES(?,?,?)', u.id, 'Десять партий', now());
    results.push({ uid: u.id, nick: u.nick, place: p.place, rp, drp: ranked ? d : null }); const c = byUid.get(u.id); if (c) { c.user = q1('SELECT * FROM users WHERE id=?', u.id); c.send({ t: 'user', user: Object.assign(pub(c.user), { token: c.user.token }) }); } }
  cast(r, { t: 'over', results, ranked }); run('DELETE FROM room_state WHERE id=?', r.id); r.overAt = now(); setTimeout(() => { if (rooms.get(r.id) === r) drop(r); }, 10 * 60e3).unref();
}
function sendGame(c, r) { const i = r.S.players.findIndex(p => p.uid === c.user.id); c.send({ t: 'game', state: E.view(r.S), you: i, seq: r.S.seq - 1 }); }

/* ---------- message handlers ---------- */
function auth(c, u) { const old = byUid.get(u.id); if (old && old !== c) { old.send({ t: 'err', msg: 'Вы вошли с другого устройства' }); old.user = null; old.room = null; old.sock.end(); } c.user = u; byUid.set(u.id, c); run('UPDATE users SET seen=? WHERE id=?', now(), u.id);
  for (const r of rooms.values()) { const m = r.members.find(x => x.uid === u.id && !x.left); if (m) { c.room = r; m.online = true; r.emptyAt = 0; c.send({ t: 'room', room: roomPub(r) }); cast(r, { t: 'room', room: roomPub(r) }, u.id); if (r.S) { sendGame(c, r); schedule(r, 0); } for (const ch of r.chat.slice(-40)) c.send(ch); break; } } }
const need = (c, room) => { if (!c.user) { c.send({ t: 'err', msg: 'Сначала войдите' }); return false; } if (room && !c.room) { c.send({ t: 'err', msg: 'Вы не в комнате' }); return false; } return true; };
function onMsg(c, m) {
  const err = msg => c.send({ t: 'err', msg, cid: m.cid });
  switch (m.t) {
    case 'hello': { const u = m.token ? q1('SELECT * FROM users WHERE token=?', String(m.token)) : null; if (u) auth(c, u); c.send({ t: 'hello', user: u ? Object.assign(pub(u), { token: u.token }) : null, ice: ICE, season: SEASON }); if (u && !c.room) c.send({ t: 'rooms', list: roomList() }); return; }
    case 'guest': case 'register': { const nick = cleanNick(m.nick); if (!validNick(nick)) return err('Никнейм: от 2 до 20 букв, цифр, пробелов, точек или дефисов'); if (m.t === 'register' && String(m.pass || '').length < 6) return err('Пароль должен быть не короче 6 символов'); const u = newUser(nick, m.t === 'register' ? m.pass : null, m.t === 'guest'); auth(c, u); c.send({ t: 'user', user: Object.assign(pub(u), { token: u.token }) }); c.send({ t: 'rooms', list: roomList() }); return; }
    case 'login': { const id = String(m.id || '').trim(); const cands = /^\d+$/.test(id) ? q('SELECT * FROM users WHERE id=? AND guest=0', +id) : q('SELECT * FROM users WHERE nick_lc=? AND guest=0', id.toLowerCase()); c.tries = (c.tries || 0) + 1; if (c.tries > 12) return err('Слишком много попыток. Переподключитесь позже'); const u = cands.find(x => x.pass && crypto.timingSafeEqual(Buffer.from(hash(m.pass || '', x.salt)), Buffer.from(x.pass))); if (!u) return err('Неверный ID, никнейм или пароль'); auth(c, u); c.send({ t: 'user', user: Object.assign(pub(u), { token: u.token }) }); if (!c.room) c.send({ t: 'rooms', list: roomList() }); return; }
  }
  if (!need(c)) return; const u = c.user, r = c.room;
  switch (m.t) {
    case 'profile': { if (m.nick != null) { const nick = cleanNick(m.nick); if (!validNick(nick)) return err('Недопустимый никнейм'); run('UPDATE users SET nick=?, nick_lc=? WHERE id=?', nick, nick.toLowerCase(), u.id); } if (m.figure != null) run('UPDATE users SET figure=? WHERE id=?', (m.figure | 0) & 3, u.id); c.user = q1('SELECT * FROM users WHERE id=?', u.id); return c.send({ t: 'user', user: Object.assign(pub(c.user), { token: c.user.token }) }); }
    case 'search': { const s = cleanNick(m.q).toLowerCase(); if (!s) return c.send({ t: 'search', res: [] }); const like = '%' + s.replace(/[\\%_]/g, x => '\\' + x) + '%'; const rows = /^\d+$/.test(s) ? q("SELECT * FROM users WHERE id=? OR nick_lc LIKE ? ESCAPE '\\' LIMIT 20", +s, like) : q("SELECT * FROM users WHERE nick_lc LIKE ? ESCAPE '\\' ORDER BY (nick_lc=?) DESC, seen DESC LIMIT 20", like, s); return c.send({ t: 'search', res: rows.filter(x => x.id !== u.id).map(x => Object.assign(pub(x), { online: byUid.has(x.id) })) }); }
    case 'rooms': return c.send({ t: 'rooms', list: roomList() });
    case 'top': return c.send({ t: 'top', season: SEASON, list: q('SELECT id,nick,rp FROM users WHERE ranked>0 ORDER BY rp DESC LIMIT 50') });
    case 'me': return c.send({ t: 'me', games: u.games, wins: u.wins, ranked: u.ranked, hist: q('SELECT delta d, rp FROM rp_history WHERE uid=? ORDER BY ts DESC LIMIT 20', u.id), ach: q('SELECT key FROM achievements WHERE uid=?', u.id).map(x => x.key) });
    case 'appeal': run('INSERT INTO appeals(ts,uid,text) VALUES(?,?,?)', now(), u.id, String(m.text || '').slice(0, 400)); return;
    case 'report': run('INSERT INTO reports(ts,from_uid,about_uid,why,ctx) VALUES(?,?,?,?,?)', now(), u.id, m.uid | 0, String(m.why || '').slice(0, 40), r ? JSON.stringify(r.chat.filter(x => x.from && x.from.uid === (m.uid | 0)).slice(-10)) : ''); return;
    case 'create': { if (r) return err('Вы уже в комнате'); const name = cleanNick(m.name).slice(0, 30) || 'Стол ' + u.nick; const max = clamp(m.max | 0, 2, 4); const salt = crypto.randomBytes(6).toString('hex'); const pass = m.pass ? hash(m.pass, salt) : null;
      const R = { id: 'r' + (roomSeq++) + crypto.randomBytes(2).toString('hex'), name, pass, salt, max, host: u.id, opts: { cash: [1000, 1500, 2000, 2500].includes(m.cash) ? m.cash : 1500, mode: m.mode === 'fast' ? 'fast' : 'classic', ranked: !!m.ranked, speed: m.speed || 'full' }, members: [], chat: [], S: null };
      R.members.push({ uid: u.id, nick: u.nick, rp: u.rp, figure: u.figure, ready: true, seat: 0, online: true }); for (let i = 0; i < clamp(m.bots | 0, 0, max - 1); i++) R.members.push({ uid: null, nick: NAMES[i], rp: 0, figure: (i + 1) & 3, ready: true, seat: i + 1, bot: 3 });
      rooms.set(R.id, R); c.room = R; c.send({ t: 'room', room: roomPub(R) }); return lobbyCast(); }
    case 'join': { if (r) return err('Вы уже в комнате'); const R = rooms.get(String(m.id)); if (!R) return err('Комната не найдена'); if (R.S) return err('Партия уже идёт'); if (R.members.length >= R.max) return err('Свободных мест нет');
      if (R.pass) { c.pwTries = (c.pwTries || 0) + 1; if (c.pwTries > 10) return err('Слишком много попыток'); if (!m.pass || !crypto.timingSafeEqual(Buffer.from(hash(m.pass, R.salt)), Buffer.from(R.pass))) return err('Неверный пароль'); }
      R.members.push({ uid: u.id, nick: u.nick, rp: u.rp, figure: u.figure, ready: false, seat: freeSeat(R), online: true }); c.room = R; cast(R, { t: 'room', room: roomPub(R) }); for (const ch of R.chat.slice(-40)) c.send(ch); sys(R, `${u.nick} садится за стол`); for (const x of R.members) if (x.voice && x.uid !== u.id) c.send({ t: 'voice', uid: x.uid, on: true }); return lobbyCast(); }
    case 'leave': if (r) { leave(c); c.send({ t: 'rooms', list: roomList() }); } return;
    case 'invite': { if (!r) return err('Сначала создайте комнату'); const t = byUid.get(m.uid | 0); if (!t) return err('Игрок не в сети'); if (now() - (c.invT || 0) < 2000) return; c.invT = now(); return t.send({ t: 'invited', from: u.nick, room: { id: r.id, name: r.name, lock: !!r.pass } }); }
  }
  if (!need(c, true)) return; const me = r.members.find(x => x.uid === u.id);
  switch (m.t) {
    case 'ready': if (!r.S) { me.ready = !!m.v; cast(r, { t: 'room', room: roomPub(r) }); } return;
    case 'figure': if (!r.S) { me.figure = (m.v | 0) & 3; run('UPDATE users SET figure=? WHERE id=?', me.figure, u.id); cast(r, { t: 'room', room: roomPub(r) }); } return;
    case 'host': { if (r.host !== u.id) return err('Только создатель комнаты'); const t = r.members.find(x => x.uid === (m.to | 0) && !x.bot); if (!t) return err('Игрок не найден'); r.host = t.uid; sys(r, `Права создателя переданы ${t.nick}`); return cast(r, { t: 'room', room: roomPub(r) }); }
    case 'bot': { if (r.host !== u.id || r.S) return err('Недоступно'); if (m.add) { if (r.members.length >= r.max) return err('Свободных мест нет'); const s = freeSeat(r); r.members.push({ uid: null, nick: NAMES[s + 1] || 'Бот', rp: 0, figure: s & 3, ready: true, seat: s, bot: clamp(m.add | 0, 1, 5) }); } else if (m.del != null) r.members = r.members.filter(x => !(x.bot && x.seat === (m.del | 0))); cast(r, { t: 'room', room: roomPub(r) }); return lobbyCast(); }
    case 'start': { if (r.host !== u.id) return err('Начать партию может создатель'); if (r.S) return; if (r.members.length < 2) return err('Нужно минимум два участника'); if (r.members.some(x => !x.bot && !x.ready && x.uid !== u.id)) return err('Не все игроки готовы');
      r.members.sort((a, b) => a.seat - b.seat); const hum = r.members.filter(x => !x.bot); r.ranked = !!r.opts.ranked && hum.length >= 2 && hum.every(x => { const U = q1('SELECT guest FROM users WHERE id=?', x.uid); return U && !U.guest; }); if (r.opts.ranked && !r.ranked) sys(r, 'Партия не рейтинговая: нужно минимум два игрока с постоянными аккаунтами');
      r.S = E.newGame({ startCash: r.opts.cash, mode: r.opts.mode, maxRounds: r.opts.mode === 'fast' ? 20 : 0 }, r.members.map(x => ({ name: x.nick, uid: x.uid, bot: x.bot || 0, token: x.figure, color: x.seat })), crypto.randomInt(1, 2 ** 31 - 1)); r.mt = {};
      for (const x of r.members) { if (x.bot) continue; const cc = byUid.get(x.uid); if (cc) sendGame(cc, r); } sys(r, 'Партия началась. Удачи!'); persist(r); schedule(r, 1500); return lobbyCast(); }
    case 'sync': if (r.S) sendGame(c, r); c.send({ t: 'room', room: roomPub(r) }); return;
    case 'act': {
      if (!r.S) return err('Партия ещё не началась'); const i = r.S.players.findIndex(p => p.uid === u.id); if (i < 0) return err('Вы не участник партии'); const cid = m.cid | 0; if (cid && cid <= (me.cid || 0)) return; me.cid = cid; const a = m.a || {};
      if (typeof a.t !== 'string') return err('Неверное действие'); const S = r.S;
      if (a.t === 'trade' || (a.t === 'tradeAns' && a.ok && S.trade)) { // Fair Trade screening
        const T = a.t === 'trade' ? { from: i, to: a.to | 0, give: { props: (a.give && a.give.props || []).map(Number), cash: Math.max(0, (a.give && a.give.cash) | 0) }, take: { props: (a.take && a.take.props || []).map(Number), cash: Math.max(0, (a.take && a.take.cash) | 0) } } : S.trade;
        if (!E.checkTrade(S, T)) { const A = S.players[T.from], B = S.players[T.to]; if (A.uid && B.uid) { const key = A.uid + '>' + B.uid; let j = F.judgeTrade(S, T, { ranked: r.ranked, matchPast: 0, pairPast: 0 }); const gu = S.players[j.giver].uid, ru = gu === A.uid ? B.uid : A.uid; const mk = gu + '>' + ru;
            j = F.judgeTrade(S, T, { ranked: r.ranked, matchPast: r.mt[mk] || 0, pairPast: q1('SELECT COUNT(*) n FROM trades WHERE giver_uid=? AND (from_uid=? OR to_uid=?) AND score>0 AND done=1 AND ts>?', gu, ru, ru, now() - 30 * 864e5).n });
            if (a.t === 'tradeAns' || j.verdict === 'block') run('INSERT INTO trades(ts,room,ranked,from_uid,to_uid,giver_uid,v_from,v_to,ratio,score,verdict,reasons,done,deal) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', now(), r.id, r.ranked ? 1 : 0, A.uid, B.uid, gu, j.vFrom, j.vTo, j.ratio, j.score, j.verdict, j.reasons.join(','), j.verdict === 'block' ? 0 : 1, JSON.stringify(T));
            if (j.verdict === 'block') { run('UPDATE users SET fair=MAX(0,fair-10) WHERE id IN (?,?)', A.uid, B.uid); if (a.t === 'tradeAns') { const T0 = S.trade; S.trade = null; cast(r, { t: 'ev', ev: [{ id: S.seq++, t: 'tradeEnd', tid: T0.id, ok: false, blocked: true, from: T0.from, to: T0.to }], state: E.view(S) }); persist(r); schedule(r, 0); } else err('OLiaMono FAIR TRADE приостановил эту сделку: условия слишком неравные. Измените предложение или подайте обжалование в профиле.'); return; }
            if (a.t === 'tradeAns' && j.score > 0) { r.mt[mk] = (r.mt[mk] || 0) + 1; if (j.verdict === 'review') { run('UPDATE users SET fair=MAX(0,fair-2) WHERE id IN (?,?)', A.uid, B.uid); } }
            if (a.t === 'trade' && (j.verdict === 'warn' || j.verdict === 'review')) c.send({ t: 'err', msg: j.verdict === 'review' ? 'FAIR TRADE: сделка заметно неравная и будет проверена дополнительно.' : 'FAIR TRADE: обратите внимание, условия сделки неравные.' }); } }
      }
      const res = apply(r, i, a); if (!res.ok) err(res.err); return;
    }
    case 'chat': { const t = now(); if (c.mute > t) return err('Вы временно не можете писать в чат'); c.chatT = c.chatT.filter(x => t - x < 8000); if (c.chatT.length >= 5) { if (++c.strikes >= 3) { c.mute = t + 60000; c.strikes = 0; } return err('Слишком часто. Подождите пару секунд'); } c.chatT.push(t); const text = String(m.text || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, 300); if (!text) return; const msg = { t: 'chat', from: { uid: u.id, nick: u.nick }, text, ts: t }; r.chat.push(msg); if (r.chat.length > 100) r.chat.shift(); return cast(r, msg); }
    case 'voice': me.voice = !!m.on; cast(r, { t: 'voice', uid: u.id, on: me.voice }, u.id); if (me.voice) for (const x of r.members) if (x.voice && x.uid !== u.id) c.send({ t: 'voice', uid: x.uid, on: true }); return;
    case 'rtc': { const t = r.members.find(x => x.uid === (m.to | 0)); const tc = t && byUid.get(t.uid); if (!tc || tc.room !== r || JSON.stringify(m.data || {}).length > 16000) return; return tc.send({ t: 'rtc', from: u.id, data: m.data }); }
  }
}
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

/* restore unfinished games after a restart */
for (const row of q('SELECT data FROM room_state')) { try { const d = JSON.parse(row.data); const r = Object.assign({ chat: [] }, d); r.mt = r.mt || {}; r.emptyAt = now(); rooms.set(r.id, r); schedule(r, 3000); } catch (e) { } }
const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ name: 'OLiaMono server', ok: true, rooms: rooms.size, online: byUid.size, season: SEASON.name })); });
server.on('upgrade', (req, sock) => { if ((req.headers.upgrade || '').toLowerCase() !== 'websocket') return sock.destroy(); accept(req, sock); });
server.listen(PORT, () => console.log('OLiaMono server listening on :' + PORT));
process.on('SIGTERM', () => { server.close(); process.exit(0); });
module.exports = { server };
