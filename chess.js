// chess.js - a small, dependency-free chess rules engine.
// Squares are 0..63: index = rank * 8 + file, a1 = 0, h1 = 7, a8 = 56, h8 = 63.
// Pieces: uppercase = White (PNBRQK), lowercase = Black, "" = empty square.

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const KN = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KG = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const RD = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BD = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

const isW = (p) => p >= "A" && p <= "Z";
const sqName = (s) => "abcdefgh"[s & 7] + ((s >> 3) + 1);

export function parseFen(fen) {
  const [placement, turn, castle, ep, half, full] = fen.split(" ");
  const b = new Array(64).fill("");
  placement.split("/").forEach((row, i) => {
    let f = 0;
    for (const ch of row) {
      if (ch >= "1" && ch <= "8") f += +ch;
      else b[(7 - i) * 8 + f++] = ch;
    }
  });
  return {
    b,
    turn,
    castle: castle === "-" ? "" : castle,
    ep: ep === "-" ? -1 : ep.charCodeAt(0) - 97 + (ep[1] - 1) * 8,
    half: +half,
    full: +full,
  };
}

export function toFen(p) {
  const rows = [];
  for (let r = 7; r >= 0; r--) {
    let s = "";
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const c = p.b[r * 8 + f];
      if (!c) empty++;
      else {
        if (empty) { s += empty; empty = 0; }
        s += c;
      }
    }
    if (empty) s += empty;
    rows.push(s);
  }
  return `${rows.join("/")} ${p.turn} ${p.castle || "-"} ${p.ep < 0 ? "-" : sqName(p.ep)} ${p.half} ${p.full}`;
}

// Is square `sq` attacked by the given colour?
function attacked(p, sq, byWhite) {
  const f = sq & 7;
  const r = sq >> 3;
  const b = p.b;
  const at = (x, y) => (x >= 0 && x < 8 && y >= 0 && y < 8 ? b[y * 8 + x] : "");
  const pawn = byWhite ? "P" : "p";
  const py = byWhite ? -1 : 1;
  if (at(f - 1, r + py) === pawn || at(f + 1, r + py) === pawn) return true;
  const knight = byWhite ? "N" : "n";
  const king = byWhite ? "K" : "k";
  for (const [dx, dy] of KN) if (at(f + dx, r + dy) === knight) return true;
  for (const [dx, dy] of KG) if (at(f + dx, r + dy) === king) return true;
  const straight = byWhite ? "RQ" : "rq";
  const diagonal = byWhite ? "BQ" : "bq";
  const ray = (dirs, set) => {
    for (const [dx, dy] of dirs) {
      let x = f + dx;
      let y = r + dy;
      while (x >= 0 && x < 8 && y >= 0 && y < 8) {
        const c = b[y * 8 + x];
        if (c) {
          if (set.includes(c)) return true;
          break;
        }
        x += dx;
        y += dy;
      }
    }
    return false;
  };
  return ray(RD, straight) || ray(BD, diagonal);
}

function pseudo(p) {
  const out = [];
  const white = p.turn === "w";
  const b = p.b;
  const add = (from, to, extra) => out.push({ from, to, ...extra });
  for (let s = 0; s < 64; s++) {
    const c = b[s];
    if (!c || isW(c) !== white) continue;
    const f = s & 7;
    const r = s >> 3;
    const t = c.toUpperCase();
    if (t === "P") {
      const dir = white ? 1 : -1;
      const start = white ? 1 : 6;
      const last = white ? 7 : 0;
      const one = s + dir * 8;
      const push = (to) => {
        if (to >> 3 === last) for (const pr of "QRBN") add(s, to, { promo: pr });
        else add(s, to);
      };
      if (!b[one]) {
        push(one);
        if (r === start && !b[one + dir * 8]) add(s, one + dir * 8, { dbl: true });
      }
      for (const dx of [-1, 1]) {
        const x = f + dx;
        if (x < 0 || x > 7) continue;
        const to = one + dx;
        const tc = b[to];
        if (tc && isW(tc) !== white) push(to);
        else if (!tc && to === p.ep) add(s, to, { ep: true });
      }
    } else if (t === "N" || t === "K") {
      for (const [dx, dy] of t === "N" ? KN : KG) {
        const x = f + dx;
        const y = r + dy;
        if (x < 0 || x > 7 || y < 0 || y > 7) continue;
        const to = y * 8 + x;
        const tc = b[to];
        if (!tc || isW(tc) !== white) add(s, to);
      }
      if (t === "K") {
        const base = white ? 0 : 56;
        const rook = white ? "R" : "r";
        if (s === base + 4 && !attacked(p, s, !white)) {
          if (
            p.castle.includes(white ? "K" : "k") &&
            !b[base + 5] && !b[base + 6] && b[base + 7] === rook &&
            !attacked(p, base + 5, !white) && !attacked(p, base + 6, !white)
          ) add(s, base + 6, { castle: "K" });
          if (
            p.castle.includes(white ? "Q" : "q") &&
            !b[base + 1] && !b[base + 2] && !b[base + 3] && b[base] === rook &&
            !attacked(p, base + 3, !white) && !attacked(p, base + 2, !white)
          ) add(s, base + 2, { castle: "Q" });
        }
      }
    } else {
      const dirs = t === "R" ? RD : t === "B" ? BD : [...RD, ...BD];
      for (const [dx, dy] of dirs) {
        let x = f + dx;
        let y = r + dy;
        while (x >= 0 && x < 8 && y >= 0 && y < 8) {
          const to = y * 8 + x;
          const tc = b[to];
          if (!tc) add(s, to);
          else {
            if (isW(tc) !== white) add(s, to);
            break;
          }
          x += dx;
          y += dy;
        }
      }
    }
  }
  return out;
}

export function make(p, m) {
  const b = p.b.slice();
  const white = p.turn === "w";
  const piece = b[m.from];
  const captured = b[m.to];
  b[m.from] = "";
  if (m.ep) b[m.to + (white ? -8 : 8)] = "";
  b[m.to] = m.promo ? (white ? m.promo : m.promo.toLowerCase()) : piece;
  if (m.castle) {
    const base = white ? 0 : 56;
    if (m.castle === "K") { b[base + 5] = b[base + 7]; b[base + 7] = ""; }
    else { b[base + 3] = b[base]; b[base] = ""; }
  }
  let castle = p.castle;
  const strip = (chars) => { for (const ch of chars) castle = castle.replace(ch, ""); };
  if (piece === "K") strip("KQ");
  if (piece === "k") strip("kq");
  for (const s of [m.from, m.to]) {
    if (s === 0) strip("Q");
    if (s === 7) strip("K");
    if (s === 56) strip("q");
    if (s === 63) strip("k");
  }
  // Record an en-passant square only if an enemy pawn is actually next to the pushed pawn.
  let ep = -1;
  if (m.dbl) {
    const x = m.to & 7;
    const enemy = white ? "p" : "P";
    if ((x > 0 && b[m.to - 1] === enemy) || (x < 7 && b[m.to + 1] === enemy)) ep = (m.from + m.to) / 2;
  }
  const reset = piece.toUpperCase() === "P" || captured || m.ep;
  return { b, turn: white ? "b" : "w", castle, ep, half: reset ? 0 : p.half + 1, full: p.full + (white ? 0 : 1) };
}

const kingSq = (p, white) => p.b.indexOf(white ? "K" : "k");

export function inCheck(p) {
  const white = p.turn === "w";
  return attacked(p, kingSq(p, white), !white);
}

export function legalMoves(p) {
  const white = p.turn === "w";
  return pseudo(p).filter((m) => {
    const n = make(p, m);
    return !attacked(n, kingSq(n, white), !white);
  });
}

export function perft(p, depth) {
  if (depth === 0) return 1;
  const ms = legalMoves(p);
  if (depth === 1) return ms.length;
  let n = 0;
  for (const m of ms) n += perft(make(p, m), depth - 1);
  return n;
}

const uci = (m) => sqName(m.from) + sqName(m.to) + (m.promo ? m.promo.toLowerCase() : "");

function sanFor(p, m, moves) {
  const piece = p.b[m.from].toUpperCase();
  const capture = p.b[m.to] || m.ep;
  let s;
  if (m.castle) s = m.castle === "K" ? "O-O" : "O-O-O";
  else {
    const dest = sqName(m.to);
    if (piece === "P") {
      s = (capture ? "abcdefgh"[m.from & 7] + "x" : "") + dest + (m.promo ? "=" + m.promo : "");
    } else {
      const others = moves.filter((o) => o !== m && p.b[o.from] === p.b[m.from] && o.to === m.to);
      let dis = "";
      if (others.length) {
        const sameFile = others.some((o) => (o.from & 7) === (m.from & 7));
        const sameRank = others.some((o) => o.from >> 3 === m.from >> 3);
        if (!sameFile) dis = "abcdefgh"[m.from & 7];
        else if (!sameRank) dis = String((m.from >> 3) + 1);
        else dis = sqName(m.from);
      }
      s = piece + dis + (capture ? "x" : "") + dest;
    }
  }
  const after = make(p, m);
  if (inCheck(after)) s += legalMoves(after).length ? "+" : "#";
  return s;
}

// All legal moves of the position as [{ m, san }].
export function sanList(p) {
  const moves = legalMoves(p);
  return moves.map((m) => ({ m, san: sanFor(p, m, moves) }));
}

// Find a legal move from user text: SAN ("Nf3", "exd5", "O-O", "e8=Q") or UCI ("g1f3", "e7e8q").
export function findMove(p, text) {
  const list = sanList(p);
  const raw = String(text).trim();
  const clean = (s) => s.replace(/[+#!?=\s]/g, "").replace(/0/g, "O");
  const t = clean(raw);
  let hit = list.filter((x) => clean(x.san) === t);
  if (hit.length === 1) return hit[0];
  hit = list.filter((x) => uci(x.m) === raw.toLowerCase());
  if (hit.length === 1) return hit[0];
  hit = list.filter((x) => clean(x.san).toLowerCase() === t.toLowerCase());
  if (hit.length === 1) return hit[0];
  return null;
}

export function insufficientMaterial(p) {
  const rest = [];
  for (let s = 0; s < 64; s++) {
    const c = p.b[s];
    if (c && c.toUpperCase() !== "K") rest.push([c.toUpperCase(), s]);
  }
  if (rest.length === 0) return true;
  if (rest.length === 1 && (rest[0][0] === "B" || rest[0][0] === "N")) return true;
  if (rest.every(([t]) => t === "B")) {
    const colour = (s) => ((s & 7) + (s >> 3)) & 1;
    return rest.every(([, s]) => colour(s) === colour(rest[0][1]));
  }
  return false;
}
