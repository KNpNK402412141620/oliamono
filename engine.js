/* OLiaMono rules engine. One deterministic module shared by the offline client and the online server.
   act(S, playerIndex, action) validates, mutates S and returns the ordered list of events to animate. */
(function (root) {
'use strict';
const G = ['#8b5a3c', '#8ecbe8', '#d85a9a', '#f0932b', '#d63a3a', '#f2cf3a', '#2f9e62', '#2b4fa8'];
const st = (n, g, p, r, hc) => ({ k: 'street', n, g, p, r, hc });
const CELLS = [
  { k: 'go', n: 'Старт' }, st('Старая мельница', 0, 60, [2, 10, 30, 90, 160, 250], 50), { k: 'chest', n: 'Казна' }, st('Рыбный переулок', 0, 60, [4, 20, 60, 180, 320, 450], 50),
  { k: 'tax', n: 'Городской налог', amt: 200 }, { k: 'rail', n: 'Северный вокзал', p: 200 }, st('Набережная', 1, 100, [6, 30, 90, 270, 400, 550], 50), { k: 'chance', n: 'Шанс' },
  st('Улица Фонарщиков', 1, 100, [6, 30, 90, 270, 400, 550], 50), st('Цветочный бульвар', 1, 120, [8, 40, 100, 300, 450, 600], 50),
  { k: 'jail', n: 'Тюрьма' }, st('Театральная', 2, 140, [10, 50, 150, 450, 625, 750], 100), { k: 'util', n: 'Электростанция', p: 150 }, st('Улица Часовщиков', 2, 140, [10, 50, 150, 450, 625, 750], 100),
  st('Бульвар Роз', 2, 160, [12, 60, 180, 500, 700, 900], 100), { k: 'rail', n: 'Западный вокзал', p: 200 }, st('Соборная', 3, 180, [14, 70, 200, 550, 750, 950], 100), { k: 'chest', n: 'Казна' },
  st('Улица Мастеров', 3, 180, [14, 70, 200, 550, 750, 950], 100), st('Ратушная площадь', 3, 200, [16, 80, 220, 600, 800, 1000], 100),
  { k: 'park', n: 'Бесплатная стоянка' }, st('Винный проезд', 4, 220, [18, 90, 250, 700, 875, 1050], 150), { k: 'chance', n: 'Шанс' }, st('Оперный проспект', 4, 220, [18, 90, 250, 700, 875, 1050], 150),
  st('Улица Ювелиров', 4, 240, [20, 100, 300, 750, 925, 1100], 150), { k: 'rail', n: 'Южный вокзал', p: 200 }, st('Садовая аллея', 5, 260, [22, 110, 330, 800, 975, 1150], 150),
  st('Музейный квартал', 5, 260, [22, 110, 330, 800, 975, 1150], 150), { k: 'util', n: 'Водоканал', p: 150 }, st('Золотая набережная', 5, 280, [24, 120, 360, 850, 1025, 1200], 150),
  { k: 'gojail', n: 'В тюрьму' }, st('Королевский парк', 6, 300, [26, 130, 390, 900, 1100, 1275], 200), st('Банковская улица', 6, 300, [26, 130, 390, 900, 1100, 1275], 200), { k: 'chest', n: 'Казна' },
  st('Дворцовая', 6, 320, [28, 150, 450, 1000, 1200, 1400], 200), { k: 'rail', n: 'Восточный вокзал', p: 200 }, { k: 'chance', n: 'Шанс' }, st('Бульвар Олии', 7, 350, [35, 175, 500, 1100, 1300, 1500], 200),
  { k: 'tax', n: 'Налог на роскошь', amt: 100 }, st('Площадь OLiaMono', 7, 400, [50, 200, 600, 1400, 1700, 2000], 200)];
CELLS.forEach((c, i) => c.i = i);
const GROUP = {}; CELLS.forEach(c => { if (c.k === 'street') (GROUP[c.g] = GROUP[c.g] || []).push(c.i); });
const RAILS = [5, 15, 25, 35], UTILS = [12, 28];
const isProp = c => c.k === 'street' || c.k === 'rail' || c.k === 'util';

const C = (id, title, text, e, art, pal) => ({ id, title, text, e, art, pal });
const quiz = (id, q, opts, a, amt, pal) => C(id, 'Вопрос городской казны', q, { k: 'quiz', opts, a, amt }, 'quiz', pal);
const CARDS = {
  chance: [
    C('c01', 'Срочная деловая поездка', 'Вас ждут на Площади OLiaMono. Личный автомобиль уже у подъезда.', { k: 'go', to: 39, car: 'business' }, 'car', ['#1c2233', '#d8b25a']),
    C('c02', 'Поездка на вокзал', 'Поезд отходит через четверть часа. Водитель знает короткую дорогу до ближайшего вокзала.', { k: 'near', car: 'station' }, 'train', ['#3a2416', '#f0932b']),
    C('c03', 'Возвращение на старт', 'Круг почёта по городу: автомобиль доставит вас на Старт. Получите 200 €.', { k: 'go', to: 0, car: 'start' }, 'start', ['#17352d', '#f2cf3a']),
    C('c04', 'Приглашение на вечерний приём', 'Организаторы городского приёма вручают гостям по конверту. Получите 40 €.', { k: 'cash', amt: 40 }, 'gala', ['#2a1830', '#e6c26a']),
    C('c05', 'Удачная инвестиция', 'Акции пароходной компании выросли. Получите 50 €.', { k: 'cash', amt: 50 }, 'chart', ['#12352b', '#8fe0a8']),
    C('c06', 'Неожиданное обслуживание автомобиля', 'Механик качает головой: пора менять свечи. Заплатите 40 €.', { k: 'cash', amt: -40 }, 'wrench', ['#33261c', '#c9cdd3']),
    C('c07', 'Городской праздник', 'Салют над ратушей и подарок из городской казны. Получите 30 €.', { k: 'cash', amt: 30 }, 'fireworks', ['#141a3a', '#ff8fb0']),
    C('c08', 'Переезд на Театральную', 'Вам сняли квартиру с видом на театр. Автомобиль отвезёт вас на Театральную.', { k: 'go', to: 11, car: 'move' }, 'keys', ['#4a1d3a', '#f0b6d2']),
    C('c09', 'Вечер в опере', 'Премьера на Оперном проспекте. Водитель подаст автомобиль к подъезду.', { k: 'go', to: 23, car: 'gala' }, 'opera', ['#3a1016', '#e9c46a']),
    C('c10', 'Три шага назад', 'Вы обронили перчатку. Вернитесь на три клетки назад.', { k: 'back', n: 3 }, 'steps', ['#2b3440', '#a9cbe0']),
    C('c11', 'Превышение скорости', 'Постовой был вежлив, но непреклонен. Заплатите 15 €.', { k: 'cash', amt: -15 }, 'speed', ['#3b1c14', '#f2cf3a']),
    C('c12', 'Нарушение порядка', 'Ночной концерт под окнами мэра оценили не все. Отправляйтесь в тюрьму.', { k: 'jail' }, 'police', ['#101a33', '#6f9bff']),
    C('c13', 'Пропуск на свободу', 'Сохраните эту карточку. Она выпустит вас из тюрьмы.', { k: 'free' }, 'key', ['#3a2a10', '#f2cf3a']),
    C('c14', 'Ремонт фасадов', 'Город просит освежить фасады: 25 € за каждый дом и 100 € за каждый отель.', { k: 'repair', h: 25, H: 100 }, 'scaffold', ['#40301f', '#e8d9b8']),
    C('c15', 'Победа на регате', 'Ваша яхта пришла первой. Получите 60 €.', { k: 'cash', amt: 60 }, 'trophy', ['#12304a', '#f2cf3a']),
    C('c16', 'Благодарность соседей', 'Вы починили уличный фонарь. Каждый игрок дарит вам 10 €.', { k: 'each', amt: 10 }, 'lamp', ['#1e2a22', '#ffe2a3']),
    C('c17', 'Званый ужин', 'Вы угощаете всех. Заплатите каждому игроку по 10 €.', { k: 'each', amt: -10 }, 'dinner', ['#3a1a1a', '#f3e2c2']),
    C('c18', 'Ночная поездка под дождём', 'Ювелир ждёт вас до полуночи. Автомобиль везёт вас на Улицу Ювелиров.', { k: 'go', to: 24, car: 'rain' }, 'rain', ['#0f1c2a', '#9fc0c8']),
    C('c19', 'Потерянный зонт', 'Новый зонт обойдётся в 10 €.', { k: 'cash', amt: -10 }, 'umbrella', ['#243044', '#d85a9a']),
    C('c20', 'Экскурсия на Южный вокзал', 'Открытие нового перрона. Автомобиль доставит вас на Южный вокзал.', { k: 'go', to: 25, car: 'station' }, 'clock', ['#2e2416', '#e6dcc2']),
    C('c21', 'Штраф за парковку', 'Автомобиль стоял у самого фонтана. Заплатите 20 €.', { k: 'cash', amt: -20 }, 'parking', ['#1b2a4a', '#ffffff']),
    C('c22', 'Находка на мостовой', 'Между камнями блеснула монета. Получите 10 €.', { k: 'cash', amt: 10 }, 'coin', ['#3a3a3a', '#f2cf3a'])],
  chest: [
    C('t01', 'Городской фотоконкурс', 'Ваш снимок ратуши на рассвете взял приз. Получите 25 €.', { k: 'cash', amt: 25 }, 'camera', ['#2a2420', '#e9c46a']),
    quiz('t02', 'Сколько клеток на игровом поле OLiaMono?', ['36', '40', '44'], 1, 30, ['#17352d', '#d8b25a']),
    quiz('t03', 'Что по правилам даёт дубль на кубиках?', ['Ещё один бросок', 'Штраф 50 €', 'Пропуск хода'], 0, 20, ['#2b1f3d', '#c9b6e0']),
    quiz('t04', 'Какая река протекает через Вену?', ['Рейн', 'Сена', 'Дунай'], 2, 40, ['#12304a', '#a9cbe0']),
    quiz('t05', 'Сколько минут в полутора часах?', ['80', '90', '100'], 1, 20, ['#3a2416', '#f0932b']),
    quiz('t06', 'В какой валюте идут расчёты в OLiaMono?', ['Евро', 'Фунты', 'Франки'], 0, 20, ['#3a1016', '#e9c46a']),
    quiz('t07', 'Сколько вокзалов в городе OLiaMono?', ['Два', 'Три', 'Четыре'], 2, 30, ['#1e2a22', '#8fe0a8']),
    quiz('t24', 'Что нужно собрать, чтобы строить дома?', ['Все улицы одного цвета', 'Четыре вокзала', 'Три карточки «Шанс»'], 0, 30, ['#33261c', '#f2cf3a']),
    C('t08', 'Благотворительный вечер', 'Сбор на новый городской сад. Внесите 30 €.', { k: 'cash', amt: -30 }, 'heart', ['#3a1424', '#f08fb0']),
    C('t09', 'Вознаграждение за хорошую репутацию', 'Городской совет отметил вашу честную игру. Получите 40 €.', { k: 'cash', amt: 40 }, 'medal', ['#1c2233', '#d8b25a']),
    C('t10', 'Временный городской сбор', 'На ремонт мостовой у фонтана. Заплатите 25 €.', { k: 'cash', amt: -25 }, 'scroll', ['#3b2f1c', '#efe6cf']),
    C('t11', 'Возврат налога', 'Казначей нашёл переплату. Получите 20 €.', { k: 'cash', amt: 20 }, 'stamp', ['#16302a', '#b5d8b9']),
    C('t12', 'Наследство двоюродной тёти', 'Шкатулка, письмо и немного наличных. Получите 80 €.', { k: 'cash', amt: 80 }, 'chest', ['#3a2416', '#e2c477']),
    C('t13', 'Счёт от доктора', 'Микстура была горькой, счёт тоже. Заплатите 50 €.', { k: 'cash', amt: -50 }, 'medic', ['#1d3340', '#ffffff']),
    C('t14', 'День рождения', 'Каждый игрок дарит вам по 10 €.', { k: 'each', amt: 10 }, 'cake', ['#40203a', '#f6e3df']),
    C('t15', 'Пропуск на свободу', 'Сохраните эту карточку. Она выпустит вас из тюрьмы.', { k: 'free' }, 'key', ['#10303a', '#8ecbe8']),
    C('t16', 'Вызов в участок', 'Нужно уладить одну формальность. Отправляйтесь в тюрьму.', { k: 'jail' }, 'police', ['#201a14', '#ff6b5a']),
    C('t17', 'Возвращение на старт', 'Вас приглашают открыть новый круг. Автомобиль отвезёт вас на Старт. Получите 200 €.', { k: 'go', to: 0, car: 'start' }, 'start', ['#2a1830', '#f2cf3a']),
    C('t18', 'Продажа акций', 'Вы вовремя продали бумаги трамвайного общества. Получите 45 €.', { k: 'cash', amt: 45 }, 'chart', ['#2e1c12', '#f0932b']),
    C('t19', 'Плата за обучение', 'Курсы бухгалтерии при ратуше. Заплатите 40 €.', { k: 'cash', amt: -40 }, 'book', ['#1b2a4a', '#e6dcc2']),
    C('t20', 'Городской ремонт', 'Заплатите 20 € за каждый дом и 60 € за каждый отель.', { k: 'repair', h: 20, H: 60 }, 'scaffold', ['#2a2f33', '#f2cf3a']),
    C('t21', 'Проценты по вкладу', 'OLiaMono BANK начислил проценты. Получите 25 €.', { k: 'cash', amt: 25 }, 'bank', ['#17352d', '#e2c477']),
    C('t22', 'Конкурс цветников', 'Ваши герани признаны лучшими на улице. Получите 15 €.', { k: 'cash', amt: 15 }, 'flower', ['#20361f', '#f08fb0']),
    C('t23', 'Страховой взнос', 'Спокойствие стоит денег. Заплатите 30 €.', { k: 'cash', amt: -30 }, 'shield', ['#222a3a', '#a9cbe0'])]
};
const CARD = {}; for (const d in CARDS) CARDS[d].forEach(c => { c.deck = d; CARD[c.id] = c; });

const LOAN = { share: 0.5, term: 3, rate: 0.03, grace: 1 };
const GO = 200, JAILFEE = 50, HARDCAP = 300;

function rnd(S) { let t = (S.rs = (S.rs + 0x6D2B79F5) | 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
function shuffle(S, a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd(S) * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; }

function newGame(opts, players, seed) {
  const S = { v: 1, seq: 1, rs: (seed | 0) || 1, opts: Object.assign({ startCash: 1500, mode: 'classic', maxRounds: 0 }, opts || {}), players: [], own: {}, turn: 0, phase: 'roll', dice: [1, 1], dbl: 0, round: 1, auction: null, trade: null, debt: null, quiz: null, seizeQ: [], after: 'end', winner: -1, tt: -1, tid: 1, log: [] };
  players.forEach((p, i) => S.players.push({ id: i, uid: p.uid || null, name: p.name, cash: S.opts.startCash, pos: 0, inJail: false, jt: 0, cards: [], out: false, bot: p.bot || 0, token: p.token || 0, color: p.color != null ? p.color : i, place: 0 }));
  S.decks = { chance: shuffle(S, CARDS.chance.map(c => c.id)), chest: shuffle(S, CARDS.chest.map(c => c.id)) };
  return S;
}
function view(S) { const o = Object.assign({}, S); delete o.rs; delete o.decks; return JSON.parse(JSON.stringify(o)); }

const ownerOf = (S, c) => S.own[c] ? S.own[c].o : -1;
const alive = S => S.players.filter(p => !p.out);
const propsOf = (S, p) => Object.keys(S.own).map(Number).filter(c => S.own[c].o === p);
function hasGroup(S, p, g) { return GROUP[g].every(c => ownerOf(S, c) === p); }
function owed(l) { return l.p + l.i; }
function rentOf(S, c, diceSum) {
  const o = S.own[c], cell = CELLS[c]; if (!o || o.loan) return 0;
  if (cell.k === 'street') { if (o.h > 0) return cell.r[o.h]; return hasGroup(S, o.o, cell.g) ? cell.r[0] * 2 : cell.r[0]; }
  if (cell.k === 'rail') { const n = RAILS.filter(r => ownerOf(S, r) === o.o).length; return 25 * Math.pow(2, n - 1); }
  const n = UTILS.filter(u => ownerOf(S, u) === o.o).length; return (n === 2 ? 10 : 4) * (diceSum || 7);
}
function netWorth(S, p) { let v = S.players[p].cash; for (const c of propsOf(S, p)) { const o = S.own[c], cell = CELLS[c]; v += cell.p - (o.loan ? owed(o.loan) : 0) + (o.h || 0) * (cell.hc || 0) / 2; } return Math.round(v); }
function loanMax(c) { return Math.floor(CELLS[c].p * LOAN.share); }
function canLoan(S, p, c) { const o = S.own[c], cell = CELLS[c]; if (!o || o.o !== p || o.loan) return false; if (cell.k === 'street' && GROUP[cell.g].some(x => S.own[x] && S.own[x].h > 0)) return false; return true; }
function canBuild(S, p, c) { const cell = CELLS[c], o = S.own[c]; if (!o || o.o !== p || cell.k !== 'street' || !hasGroup(S, p, cell.g)) return false; if (GROUP[cell.g].some(x => S.own[x].loan)) return false; if (o.h >= 5) return false; const mn = Math.min(...GROUP[cell.g].map(x => S.own[x].h)); return o.h === mn && S.players[p].cash >= cell.hc; }
function canSell(S, p, c) { const cell = CELLS[c], o = S.own[c]; if (!o || o.o !== p || cell.k !== 'street' || o.h < 1) return false; const mx = Math.max(...GROUP[cell.g].map(x => S.own[x].h)); return o.h === mx; }
function maxRaise(S, p) { let v = S.players[p].cash; for (const c of propsOf(S, p)) { const o = S.own[c]; v += (o.h || 0) * (CELLS[c].hc || 0) / 2; if (!o.loan) v += loanMax(c); } return v; }

function act(S, p, a) {
  const ev = []; const E = (t, d) => { const e = Object.assign({ id: S.seq++, t }, d); ev.push(e); return e; };
  const P = S.players[p]; const fail = m => ({ ok: false, err: m, ev: [] });
  if (!P || P.out) return fail('Игрок не участвует в партии'); if (S.phase === 'over') return fail('Партия завершена');
  const cur = S.turn === p;
  const pay = (from, to, amt, why) => { // returns false when a debt was opened
    const F = S.players[from];
    if (F.cash >= amt) { F.cash -= amt; if (to >= 0) S.players[to].cash += amt; E('pay', { from, to, amt, why }); return true; }
    if (maxRaise(S, from) < amt) { bankrupt(from, to); return false; }
    S.debt = { p: from, to, amt, why }; S.resume = S.after; S.phase = 'debt'; E('debt', { p: from, to, amt, why }); return false;
  };
  const gain = (to, amt, why) => { S.players[to].cash += amt; E('pay', { from: -1, to, amt, why }); };
  function bankrupt(q, to) {
    const Q = S.players[q]; const props = propsOf(S, q); let cash = Q.cash;
    for (const c of props) { const o = S.own[c]; cash += (o.h || 0) * (CELLS[c].hc || 0) / 2; o.h = 0; if (to >= 0 && !S.players[to].out) o.o = to; else delete S.own[c]; }
    if (to >= 0 && !S.players[to].out) S.players[to].cash += Math.round(cash);
    Q.cash = 0; Q.out = true; Q.inJail = false; Q.place = alive(S).length + 1;
    S.decks.chance.push(...Q.cards.filter(x => CARD[x].deck === 'chance')); S.decks.chest.push(...Q.cards.filter(x => CARD[x].deck === 'chest')); Q.cards = [];
    if (S.debt && S.debt.p === q) S.debt = null; if (S.trade && (S.trade.from === q || S.trade.to === q)) S.trade = null;
    E('bankrupt', { p: q, to, props });
    const al = alive(S);
    if (al.length === 1) { S.phase = 'over'; S.winner = al[0].id; al[0].place = 1; E('win', { p: S.winner, why: 'last' }); return; }
    if (S.auction) { S.auction.act = S.auction.act.filter(x => x !== q); return; }
    if (S.turn === q) { S.phase = 'end'; advance(); } else if (S.phase === 'debt') S.phase = S.resume || 'end';
  }
  function finishByWorth(why) { const al = alive(S).sort((a, b) => netWorth(S, b.id) - netWorth(S, a.id)); al.forEach((q, i) => q.place = i + 1); S.phase = 'over'; S.winner = al[0].id; E('win', { p: S.winner, why }); }
  function advance() {
    if (S.phase === 'over') return;
    if (S.seizeQ.length) { const c = S.seizeQ.shift(); const o = S.own[c]; if (o && o.loan) { startAuction(c, 'seize', o.o, owed(o.loan)); return; } return advance(); }
    S.dbl = 0; let n = S.turn; do { n = (n + 1) % S.players.length; if (n === 0) S.round++; } while (S.players[n].out);
    if ((S.opts.maxRounds && S.round > S.opts.maxRounds) || S.round > HARDCAP) return finishByWorth('rounds');
    S.turn = n; S.phase = 'roll'; E('turn', { p: n, round: S.round });
  }
  function startAuction(c, src, debtor, due) {
    const order = []; for (let k = 1; k <= S.players.length; k++) { const q = (S.turn + k) % S.players.length; if (!S.players[q].out && !(src === 'seize' && q === debtor)) order.push(q); }
    S.auction = { cell: c, high: 0, by: -1, act: order, cur: 0, src, debtor: debtor == null ? -1 : debtor, due: due || 0 };
    S.aresume = src === 'seize' ? 'adv' : S.after; S.phase = 'auction'; E('auctionStart', { cell: c, src, debtor: S.auction.debtor });
    if (src === 'seize') E('seize', { p: debtor, cell: c });
    if (!order.length) endAuction();
  }
  function endAuction() {
    const A = S.auction; S.auction = null; const c = A.cell;
    if (A.by >= 0) {
      S.players[A.by].cash -= A.high; E('pay', { from: A.by, to: -1, amt: A.high, why: 'auction' });
      if (A.src === 'seize') { const sur = A.high - A.due; if (sur > 0 && !S.players[A.debtor].out) gain(A.debtor, sur, 'surplus'); }
      S.own[c] = { o: A.by, h: 0, loan: null };
    } else if (A.src === 'seize') delete S.own[c];
    E('auctionEnd', { cell: c, p: A.by, amt: A.high, src: A.src });
    if (S.phase === 'over') return;
    if (S.aresume === 'adv') { S.phase = 'end'; advance(); } else S.phase = S.aresume;
  }
  function jail(q, why) { const Q = S.players[q]; const from = Q.pos; Q.pos = 10; Q.inJail = true; Q.jt = 0; S.dbl = 0; E('arrest', { p: q, from, why }); S.after = 'end'; }
  function moveTo(q, to, opt) {
    const Q = S.players[q], from = Q.pos; const fwd = !(opt && opt.back);
    Q.pos = to; const pass = fwd && (to < from || (opt && opt.lap)) && !(opt && opt.noGo);
    E(opt && opt.car ? 'travel' : 'move', { p: q, from, to, back: !fwd, car: opt && opt.car, card: opt && opt.card });
    if (pass) gain(q, GO, 'go');
    land(q);
  }
  function land(q) {
    const Q = S.players[q], c = Q.pos, cell = CELLS[c];
    if (isProp(cell)) {
      const o = S.own[c];
      if (!o) { S.phase = 'buy'; E('offer', { p: q, cell: c }); return; }
      if (o.o !== q && !o.loan) { const r = rentOf(S, c, S.dice[0] + S.dice[1]); if (!pay(q, o.o, r, 'rent')) return; }
    } else if (cell.k === 'tax') { if (!pay(q, -1, cell.amt, 'tax')) return; }
    else if (cell.k === 'gojail') { jail(q, 'cell'); }
    else if (cell.k === 'chance' || cell.k === 'chest') { return draw(q, cell.k); }
    if (S.phase !== 'over' && S.phase !== 'debt' && S.phase !== 'auction') S.phase = S.after;
  }
  function draw(q, deck) {
    const id = S.decks[deck].shift(); const card = CARD[id], e = card.e, Q = S.players[q];
    if (e.k !== 'free') S.decks[deck].push(id);
    E('card', { p: q, deck, card: id });
    const done = () => { if (S.phase !== 'over' && S.phase !== 'debt' && S.phase !== 'auction' && S.phase !== 'buy' && S.phase !== 'quiz') S.phase = S.after; };
    if (e.k === 'cash') { if (e.amt >= 0) gain(q, e.amt, 'card'); else if (!pay(q, -1, -e.amt, 'card')) return; return done(); }
    if (e.k === 'go') return moveTo(q, e.to, { car: e.car, card: id });
    if (e.k === 'near') { let to = RAILS.find(r => r > Q.pos); if (to == null) to = RAILS[0]; return moveTo(q, to, { car: e.car, card: id }); }
    if (e.k === 'back') return moveTo(q, (Q.pos - e.n + 40) % 40, { back: true });
    if (e.k === 'jail') { jail(q, 'card'); return done(); }
    if (e.k === 'free') { Q.cards.push(id); E('keep', { p: q, card: id }); return done(); }
    if (e.k === 'repair') { let h = 0, H = 0; for (const c of propsOf(S, q)) { const n = S.own[c].h; if (n === 5) H++; else h += n; } const amt = h * e.h + H * e.H; if (amt > 0 && !pay(q, -1, amt, 'card')) return; return done(); }
    if (e.k === 'each') {
      const others = alive(S).filter(o => o.id !== q);
      if (e.amt > 0) { for (const o of others) { const a = Math.min(e.amt, o.cash); if (a > 0) { o.cash -= a; Q.cash += a; E('pay', { from: o.id, to: q, amt: a, why: 'card' }); } } return done(); }
      const tot = -e.amt * others.length; if (Q.cash < tot) { if (!pay(q, -1, tot, 'card')) return; return done(); }
      for (const o of others) pay(q, o.id, -e.amt, 'card'); return done();
    }
    if (e.k === 'quiz') { S.quiz = { p: q, card: id }; S.phase = 'quiz'; E('quiz', { p: q, card: id }); return; }
  }

  // ---- trade answer / auction / quiz can come from non-current players
  if (a.t === 'tradeAns') {
    const T = S.trade; if (!T || T.to !== p) return fail('Нет предложения обмена');
    if (!a.ok) { S.trade = null; E('tradeEnd', { tid: T.id, ok: false, from: T.from, to: T.to }); return { ok: true, ev }; }
    const err = checkTrade(S, T); if (err) { S.trade = null; E('tradeEnd', { tid: T.id, ok: false, from: T.from, to: T.to, err }); return { ok: true, ev }; }
    const A = S.players[T.from], B = S.players[T.to];
    A.cash += T.take.cash - T.give.cash; B.cash += T.give.cash - T.take.cash;
    T.give.props.forEach(c => S.own[c].o = T.to); T.take.props.forEach(c => S.own[c].o = T.from);
    S.trade = null; E('tradeEnd', { tid: T.id, ok: true, from: T.from, to: T.to, give: T.give, take: T.take });
    if (S.debt && S.players[S.debt.p].cash >= S.debt.amt) settle();
    return { ok: true, ev };
  }
  if (a.t === 'tradeCancel') { const T = S.trade; if (!T || T.from !== p) return fail('Нет вашего предложения'); S.trade = null; E('tradeEnd', { tid: T.id, ok: false, from: T.from, to: T.to }); return { ok: true, ev }; }
  if (a.t === 'resign') { if (S.auction) return fail('Дождитесь конца аукциона'); bankrupt(p, S.debt && S.debt.p === p ? S.debt.to : -1); return { ok: true, ev }; }
  if (S.trade) return fail('Сначала нужно ответить на предложение обмена');
  if (S.phase === 'auction') {
    const A = S.auction; if (A.act[A.cur] !== p) return fail('Сейчас ставит другой игрок');
    if (a.t === 'bid') { const amt = Math.floor(a.amt); if (!(amt > A.high) || amt > P.cash) return fail('Недопустимая ставка'); A.high = amt; A.by = p; E('bid', { p, amt }); A.cur = (A.cur + 1) % A.act.length; }
    else if (a.t === 'pass') { A.act.splice(A.cur, 1); E('bid', { p, pass: true }); if (A.cur >= A.act.length) A.cur = 0; }
    else return fail('Идёт аукцион');
    if (A.act.length === 0 || (A.act.length === 1 && A.act[0] === A.by)) endAuction();
    return { ok: true, ev };
  }
  function settle() { const D = S.debt; S.debt = null; S.phase = S.resume || 'end'; S.players[D.p].cash -= D.amt; if (D.to >= 0 && !S.players[D.to].out) S.players[D.to].cash += D.amt; E('pay', { from: D.p, to: D.to, amt: D.amt, why: D.why }); const pm = S.pendMove; S.pendMove = 0; if (pm) moveTo(D.p, (S.players[D.p].pos + pm) % 40); }
  const mgmt = S.phase === 'debt' ? S.debt.p === p : (cur && (S.phase === 'roll' || S.phase === 'end' || S.phase === 'buy'));
  switch (a.t) {
    case 'roll': {
      if (!cur || S.phase !== 'roll') return fail('Сейчас нельзя бросать кубики');
      const d = [1 + Math.floor(rnd(S) * 6), 1 + Math.floor(rnd(S) * 6)]; S.dice = d; const dbl = d[0] === d[1]; E('dice', { p, d });
      if (P.inJail) {
        if (dbl) { P.inJail = false; P.jt = 0; E('jailOut', { p, how: 'double' }); S.after = 'end'; moveTo(p, (P.pos + d[0] + d[1]) % 40); }
        else { P.jt++; if (P.jt >= 3) { S.after = 'end'; P.inJail = false; P.jt = 0; E('jailOut', { p, how: 'fee' }); const paid = pay(p, -1, JAILFEE, 'jail'); if (paid) moveTo(p, (P.pos + d[0] + d[1]) % 40); else if (S.phase === 'debt') S.pendMove = d[0] + d[1]; } else S.phase = 'end'; }
        break;
      }
      if (dbl) { S.dbl++; if (S.dbl >= 3) { jail(p, 'doubles'); S.phase = 'end'; break; } }
      S.after = dbl ? 'roll' : 'end';
      moveTo(p, (P.pos + d[0] + d[1]) % 40);
      break;
    }
    case 'jailPay': { if (!cur || S.phase !== 'roll' || !P.inJail) return fail('Недоступно'); if (P.cash < JAILFEE) return fail('Не хватает денег'); P.cash -= JAILFEE; P.inJail = false; P.jt = 0; E('pay', { from: p, to: -1, amt: JAILFEE, why: 'jail' }); E('jailOut', { p, how: 'pay' }); break; }
    case 'jailCard': { if (!cur || S.phase !== 'roll' || !P.inJail || !P.cards.length) return fail('Недоступно'); const id = P.cards.shift(); S.decks[CARD[id].deck].push(id); P.inJail = false; P.jt = 0; E('jailOut', { p, how: 'card' }); break; }
    case 'buy': { if (!cur || S.phase !== 'buy') return fail('Недоступно'); const c = P.pos, cell = CELLS[c]; if (P.cash < cell.p) return fail('Не хватает денег'); P.cash -= cell.p; S.own[c] = { o: p, h: 0, loan: null }; E('buy', { p, cell: c, price: cell.p }); S.phase = S.after; break; }
    case 'decline': { if (!cur || S.phase !== 'buy') return fail('Недоступно'); startAuction(P.pos, 'decline'); break; }
    case 'answer': { if (S.phase !== 'quiz' || S.quiz.p !== p) return fail('Недоступно'); const card = CARD[S.quiz.card]; const ok = a.i === card.e.a; S.quiz = null; S.phase = S.after; E('quizRes', { p, ok, card: card.id, amt: ok ? card.e.amt : 0 }); if (ok) gain(p, card.e.amt, 'quiz'); break; }
    case 'build': { if (!mgmt || S.phase === 'debt' || !canBuild(S, p, a.cell)) return fail('Строить здесь нельзя'); P.cash -= CELLS[a.cell].hc; S.own[a.cell].h++; E('build', { p, cell: a.cell, h: S.own[a.cell].h }); break; }
    case 'sell': { if (!mgmt || !canSell(S, p, a.cell)) return fail('Продать нельзя'); S.own[a.cell].h--; P.cash += CELLS[a.cell].hc / 2; E('sell', { p, cell: a.cell, h: S.own[a.cell].h }); break; }
    case 'loan': { if (!mgmt || !canLoan(S, p, a.cell)) return fail('Кредит под этот объект недоступен'); const mx = loanMax(a.cell); const amt = Math.max(1, Math.min(mx, Math.floor(a.amt || mx))); S.own[a.cell].loan = { p: amt, i: 0, t: 0 }; P.cash += amt; E('loan', { p, cell: a.cell, amt }); break; }
    case 'repay': { if (!mgmt) return fail('Недоступно'); const o = S.own[a.cell]; if (!o || o.o !== p || !o.loan) return fail('Кредита нет'); const due = owed(o.loan); if (P.cash < due) return fail('Не хватает денег'); P.cash -= due; o.loan = null; E('repay', { p, cell: a.cell, amt: due }); break; }
    case 'settle': { if (S.phase !== 'debt' || S.debt.p !== p) return fail('Долга нет'); if (P.cash < S.debt.amt) return fail('Не хватает денег'); settle(); break; }
    case 'bankrupt': { if (S.phase !== 'debt' || S.debt.p !== p) return fail('Объявить банкротство можно только при долге'); bankrupt(p, S.debt.to); break; }
    case 'resign': { const to = S.debt && S.debt.p === p ? S.debt.to : -1; if (S.auction) return fail('Дождитесь конца аукциона'); bankrupt(p, to); break; }
    case 'trade': {
      if (!mgmt) return fail('Предлагать обмен можно в свой ход');
      const T = { id: S.tid++, from: p, to: a.to, give: { props: (a.give.props || []).slice(), cash: Math.max(0, Math.floor(a.give.cash || 0)) }, take: { props: (a.take.props || []).slice(), cash: Math.max(0, Math.floor(a.take.cash || 0)) } };
      const err = checkTrade(S, T); if (err) return fail(err); S.trade = T; E('tradeOffer', { trade: T }); break;
    }
    case 'end': {
      if (!cur || S.phase !== 'end') return fail('Ход ещё не завершён');
      for (const c of propsOf(S, p)) { const l = S.own[c].loan; if (!l) continue; l.t++; l.i += Math.round(l.p * LOAN.rate); if (l.t === LOAN.term) E('loanWarn', { p, cell: c, due: owed(l) }); else if (l.t >= LOAN.term + LOAN.grace) S.seizeQ.push(c); }
      advance(); break;
    }
    default: return fail('Неизвестное действие');
  }
  if (S.debt && S.phase === 'debt' && S.players[S.debt.p].out) S.debt = null;
  return { ok: true, ev };
}
function checkTrade(S, T) {
  const A = S.players[T.from], B = S.players[T.to];
  if (!A || !B || A.out || B.out || T.from === T.to) return 'Неверный участник обмена';
  if (!T.give.props.length && !T.take.props.length) return 'В обмене нет собственности';
  if (A.cash < T.give.cash || B.cash < T.take.cash) return 'Не хватает денег для обмена';
  const chk = (props, o) => props.every(c => S.own[c] && S.own[c].o === o && !(CELLS[c].k === 'street' && GROUP[CELLS[c].g].some(x => S.own[x] && S.own[x].h > 0)));
  if (new Set(T.give.props.concat(T.take.props)).size !== T.give.props.length + T.take.props.length) return 'Объект указан дважды';
  if (!chk(T.give.props, T.from) || !chk(T.take.props, T.to)) return 'Объект нельзя передать (чужой или с постройками)';
  return null;
}
/* Strategic value of a property for player p if p held it (after hypothetical transfer `extra`). */
function stratValue(S, c, p, extra) {
  const cell = CELLS[c], o = S.own[c]; let v = cell.p; const has = x => x === c || (extra && extra.includes(x)) || ownerOf(S, x) === p;
  if (cell.k === 'street') { const n = GROUP[cell.g].filter(has).length, tot = GROUP[cell.g].length; if (n === tot) v *= 2.1; else if (n === tot - 1 && tot === 3) v *= 1.3; }
  else if (cell.k === 'rail') v *= 1 + .2 * (RAILS.filter(has).length - 1); else v *= UTILS.filter(has).length === 2 ? 1.3 : 1;
  if (o && o.loan) v -= owed(o.loan);
  return Math.round(v);
}
function tradeSides(S, T) { // value each side receives, from the receiver's point of view
  const toGets = T.give.props.reduce((s, c) => s + stratValue(S, c, T.to, T.give.props), 0) + T.give.cash;
  const fromGets = T.take.props.reduce((s, c) => s + stratValue(S, c, T.from, T.take.props), 0) + T.take.cash;
  return { toGets, fromGets };
}

/* ---------- bots: level 1 (Новичок) .. 5 (Эксперт). They only see the public state. ---------- */
function botAction(S, p, R) {
  R = R || Math.random; const P = S.players[p], L = P.bot || 3; const reserve = [0, 0, 60, 120, 160, 200][L];
  if (S.trade) {
    if (S.trade.to !== p) return S.trade.from === p ? null : null;
    const T = S.trade; const get = T.give.props.reduce((s, c) => s + stratValue(S, c, p, T.give.props), 0) + T.give.cash;
    let lose = T.take.props.reduce((s, c) => s + stratValue(S, c, p), 0) + T.take.cash;
    if (L >= 3) for (const c of T.take.props) { const cell = CELLS[c]; if (cell.k === 'street' && GROUP[cell.g].every(x => x === c || T.take.props.includes(x) || ownerOf(S, x) === T.from)) lose += cell.p * (L - 2) * .5; }
    const margin = [0, -.25, -.1, 0, .05, .1][L];
    return { t: 'tradeAns', ok: get - lose >= margin * Math.max(lose, 1) && P.cash - T.take.cash >= 0 };
  }
  if (S.phase === 'auction') {
    const A = S.auction; if (A.act[A.cur] !== p) return null; const cell = CELLS[A.cell];
    let lim = cell.p * (.55 + .1 * L); if (L >= 3 && stratValue(S, A.cell, p) > cell.p * 1.5) lim = cell.p * 1.6;
    lim = Math.min(lim, P.cash - reserve / 2); const next = A.high + (A.high < 50 ? 10 : 20);
    return next <= lim ? { t: 'bid', amt: next } : { t: 'pass' };
  }
  if (S.phase === 'quiz') { if (S.quiz.p !== p) return null; const card = CARD[S.quiz.card]; return { t: 'answer', i: R() < .35 + .13 * L ? card.e.a : (card.e.a + 1) % card.e.opts.length }; }
  if (S.phase === 'debt') {
    if (S.debt.p !== p) return null; if (P.cash >= S.debt.amt) return { t: 'settle' };
    const mine = propsOf(S, p);
    const ln = mine.filter(c => canLoan(S, p, c)).sort((a, b) => stratValue(S, a, p) - stratValue(S, b, p));
    const lone = ln.filter(c => CELLS[c].k !== 'street' || !hasGroup(S, p, CELLS[c].g));
    if (lone.length) return { t: 'loan', cell: lone[0] };
    const sl = mine.filter(c => canSell(S, p, c)).sort((a, b) => CELLS[a].p - CELLS[b].p); if (sl.length) return { t: 'sell', cell: sl[0] };
    if (ln.length) return { t: 'loan', cell: ln[0] };
    return { t: 'bankrupt' };
  }
  if (S.turn !== p) return null;
  if (S.phase === 'buy') {
    const c = P.pos, cell = CELLS[c]; const sv = stratValue(S, c, p);
    if (P.cash >= cell.p) { if (L === 1) return R() < .7 ? { t: 'buy' } : { t: 'decline' }; if (P.cash - cell.p >= reserve || sv > cell.p * 1.5) return { t: 'buy' }; return { t: 'decline' }; }
    if (L >= 4 && sv > cell.p * 1.5) { const ln = propsOf(S, p).filter(x => canLoan(S, p, x) && !(CELLS[x].k === 'street' && hasGroup(S, p, CELLS[x].g))); if (ln.length && P.cash + loanMax(ln[0]) >= cell.p) return { t: 'loan', cell: ln[0] }; }
    return { t: 'decline' };
  }
  if (S.phase === 'roll' || S.phase === 'end') {
    const mine = propsOf(S, p);
    const loans = mine.filter(c => S.own[c].loan).sort((a, b) => S.own[b].loan.t - S.own[a].loan.t);
    for (const c of loans) { const l = S.own[c].loan, due = owed(l); if (P.cash >= due && (l.t >= LOAN.term - (L >= 3 ? 1 : 0) || P.cash - due >= reserve * (L >= 2 ? 2 : 6))) return { t: 'repay', cell: c }; }
    if (L > 1 || R() < .5) { const b = mine.filter(c => canBuild(S, p, c) && P.cash - CELLS[c].hc >= reserve + (L >= 4 ? 80 : 0)).sort((a, b_) => CELLS[b_].p - CELLS[a].p); if (b.length) return { t: 'build', cell: b[0] }; }
    if (L >= 2 && S.tt !== S.round * 8 + p && S.phase === 'roll' && R() < .45) {
      S.tt = S.round * 8 + p;
      for (const g in GROUP) {
        const cs = GROUP[g]; const mineN = cs.filter(c => ownerOf(S, c) === p); if (mineN.length !== cs.length - 1) continue;
        const miss = cs.find(c => ownerOf(S, c) !== p); const o = S.own[miss]; if (!o || o.h > 0) continue;
        const offer = Math.round(CELLS[miss].p * (1.05 + .12 * L + R() * .2) / 10) * 10;
        if (P.cash - offer >= reserve) return { t: 'trade', to: o.o, give: { props: [], cash: offer }, take: { props: [miss], cash: 0 } };
      }
    }
    if (S.phase === 'end') return { t: 'end' };
    if (P.inJail) { if (P.cards.length) return { t: 'jailCard' }; const free = CELLS.filter(c => isProp(c) && !S.own[c.i]).length; if (L >= 3 && free > 8 && P.cash > 300) return { t: 'jailPay' }; }
    return { t: 'roll' };
  }
  return null;
}
/* who must act now (used for server timers and bot scheduling) */
function waitingFor(S) {
  if (S.phase === 'over') return -1; if (S.trade) return S.trade.to; if (S.phase === 'auction') return S.auction.act[S.auction.cur];
  if (S.phase === 'debt') return S.debt.p; if (S.phase === 'quiz') return S.quiz.p; return S.turn;
}
const API = { CELLS, GROUP, GCOL: G, RAILS, UTILS, CARDS, CARD, LOAN, GO, JAILFEE, newGame, act, view, botAction, waitingFor, rentOf, netWorth, loanMax, canLoan, canBuild, canSell, hasGroup, propsOf, ownerOf, owed, isProp, stratValue, tradeSides, checkTrade, maxRaise };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.OME = API;
})(typeof self !== 'undefined' ? self : this);
