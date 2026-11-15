/* OLiaMono RANK (multi-player Elo) and OLiaMono FAIR TRADE (collusion screening). Pure functions, unit-tested. */
'use strict';
const E = require('./engine.js');

/* players: [{uid, rp, ranked, place}] humans only -> {uid: delta} */
function elo(players) {
  const out = {}; const n = players.length; if (n < 2) return out;
  for (const a of players) {
    let s = 0, e = 0;
    for (const b of players) { if (a === b) continue; s += a.place < b.place ? 1 : a.place === b.place ? .5 : 0; e += 1 / (1 + Math.pow(10, (b.rp - a.rp) / 400)); }
    const K = a.ranked < 10 ? 40 : 24; out[a.uid] = Math.round(K * (s - e) / (n - 1));
  }
  return out;
}
const RANKS = [[0, 'Начинающий'], [800, 'Участник'], [1000, 'Стратег'], [1200, 'Предприниматель'], [1400, 'Магнат'], [1600, 'Титан'], [1800, 'Легенда']];
const rankOf = rp => { let r = RANKS[0][1]; for (const [m, n] of RANKS) if (rp >= m) r = n; return r; };
function season(now) { const d = new Date(now), q = Math.floor(d.getUTCMonth() / 3), y = d.getUTCFullYear(); return { id: y * 10 + q + 1, name: `${y} · ${['зима', 'весна', 'лето', 'осень'][q]}`, start: Date.UTC(y, q * 3, 1), end: Date.UTC(y, q * 3 + 3, 1) }; }

/* Fair Trade. S: engine state, T: trade, ctx: {ranked, pairPast: # of earlier lopsided deals in the same direction between
   these two accounts (30 days), matchPast: same within this match}. Returns {verdict, score, reasons, giver, vFrom, vTo}. */
function judgeTrade(S, T, ctx) {
  const { toGets, fromGets } = E.tradeSides(S, T); const hi = Math.max(toGets, fromGets), lo = Math.max(1, Math.min(toGets, fromGets)); const ratio = hi / lo, gap = hi - lo;
  const giver = toGets > fromGets ? T.from : T.to; const reasons = []; let score = 0;
  if (ratio >= 3 && gap >= 300) { score += 2; reasons.push('imbalance-critical'); } else if (ratio >= 1.6 && gap >= 150) { score += 1; reasons.push('imbalance'); }
  if (score > 0) {
    const worth = E.netWorth(S, giver); const givesProps = (giver === T.from ? T.give : T.take).props.reduce((s, c) => s + E.CELLS[c].p, 0); const givesCash = (giver === T.from ? T.give : T.take).cash;
    const inDebt = S.debt && S.debt.p === giver; if (inDebt || (worth > 0 && (givesProps + givesCash) / worth > .6 && E.maxRaise(S, giver) < 400)) { score += 2; reasons.push('pre-bankruptcy-transfer'); }
    if ((ctx.matchPast || 0) >= 1) { score += 1; reasons.push('repeat-in-match'); }
    if ((ctx.pairPast || 0) >= 2) { score += 2; reasons.push('repeat-pair'); }
  }
  let verdict = 'ok';
  if (ctx.ranked) verdict = score >= 4 ? 'block' : score >= 2 ? 'review' : score === 1 ? 'warn' : 'ok'; else verdict = score >= 2 ? 'warn' : 'ok';
  return { verdict, score, reasons, giver, vFrom: fromGets, vTo: toGets, ratio: Math.round(ratio * 100) / 100 };
}
module.exports = { elo, rankOf, RANKS, season, judgeTrade };
