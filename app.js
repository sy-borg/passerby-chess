// app.js - game state, move handling and page rendering (pure functions, no Cloudflare APIs).
import {
  START_FEN, parseFen, toFen, legalMoves, make, inCheck, sanList, findMove, insufficientMaterial,
} from "./chess.js";

export const MAX_PLIES = 300;           // a game without a result after this many half-moves is drawn
export const NO_CONSECUTIVE_IP = true;  // the same visitor (by IP) may not make two moves in a row
const KEEP_FINISHED = 25;               // how many finished games to remember

const keyOf = (fen) => fen.split(" ").slice(0, 4).join(" ");
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pgnOf = (san) => san.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ` : "") + s).join(" ");
const winnerText = (r) => (r === "1-0" ? "White wins" : r === "0-1" ? "Black wins" : "Draw");

// Turn a User-Agent header into a short, readable label. This is only what the visitor reports about itself.
const AGENTS = [
  [/ChatGPT|OAI-SearchBot|GPTBot|OpenAI/i, "ChatGPT / OpenAI"],
  [/Claude|Anthropic/i, "Claude / Anthropic"],
  [/Perplexity/i, "Perplexity"],
  [/Gemini|Google-Extended|GoogleOther/i, "Gemini / Google"],
  [/Googlebot/i, "Googlebot"],
  [/bingbot|BingPreview/i, "Bing"],
  [/DuckAssistBot|DuckDuckBot/i, "DuckDuckGo"],
  [/Mistral/i, "Mistral"],
  [/curl\//i, "curl"],
  [/python-requests|python-httpx|aiohttp|Python-urllib/i, "Python script"],
  [/node-fetch|undici|axios/i, "Node script"],
  [/Edg\//, "Browser (Edge)"],
  [/Firefox\//, "Browser (Firefox)"],
  [/Chrome\//, "Browser (Chrome)"],
  [/Safari\//, "Browser (Safari)"],
];

export function agentLabel(ua) {
  const s = String(ua || "").slice(0, 300);
  if (!s) return "unknown";
  for (const [re, label] of AGENTS) if (re.test(s)) return label;
  // Many agent tools send a generic browser-style header that says nothing about who they are.
  if (/^Mozilla\//.test(s)) return "Browser-like client";
  const clean = s.replace(/[^A-Za-z0-9 ._\/-]/g, "").trim().slice(0, 30);
  return clean || "unknown";
}

// An optional name a visitor gives itself with &who=Name. Only a few harmless characters are kept.
export const WHO_MAX = 24;
export function cleanWho(s) {
  return String(s || "")
    .replace(/[^A-Za-z0-9 ._-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, WHO_MAX)
    .trim();
}

export function newGame(n) {
  return { n, fen: START_FEN, san: [], by: [], named: [], reps: { [keyOf(START_FEN)]: 1 }, lastIp: "", started: Date.now() };
}

export function freshStore() {
  return { game: newGame(1), finished: [] };
}

// Try to play one move. Mutates `store`. Returns { status, message }.
export function tryMove(store, { ply, move, ipHash, agent, who }) {
  const g = store.game;
  if (!Number.isInteger(ply)) {
    return { status: 400, message: "Missing or invalid 'ply' parameter. Please use one of the links below." };
  }
  if (ply !== g.san.length) {
    return {
      status: 409,
      message: `Too late: you looked at the position after ${ply} half-moves, but someone else has moved since (now ${g.san.length}). Here is the current position.`,
    };
  }
  if (NO_CONSECUTIVE_IP && ipHash && g.lastIp === ipHash) {
    return { status: 429, message: "You made the previous move. Please let someone else play the next one." };
  }
  const pos = parseFen(g.fen);
  const hit = findMove(pos, String(move));
  if (!hit) {
    return { status: 400, message: `"${String(move).slice(0, 20)}" is not a legal move in this position. Pick one from the list below.` };
  }

  const white = pos.turn === "w";
  const np = make(pos, hit.m);
  // Games saved before movers were recorded have no `by` list: pad it so it lines up with the moves.
  if (!Array.isArray(g.by)) g.by = [];
  if (!Array.isArray(g.named)) g.named = [];
  while (g.by.length < g.san.length) g.by.push("unknown");
  while (g.named.length < g.san.length) g.named.push(false);
  const name = cleanWho(who);
  g.san.push(hit.san);
  g.by.push(name || agent || "unknown");
  g.named.push(Boolean(name));
  store.stats = store.stats || { moves: 0, named: 0 };
  store.stats.moves++;
  if (name) store.stats.named++;
  g.fen = toFen(np);
  g.last = { from: hit.m.from, to: hit.m.to };
  g.lastIp = ipHash || "";
  const k = keyOf(g.fen);
  g.reps[k] = (g.reps[k] || 0) + 1;

  let result = null;
  let reason = "";
  if (legalMoves(np).length === 0) {
    if (inCheck(np)) { result = white ? "1-0" : "0-1"; reason = "checkmate"; }
    else { result = "1/2-1/2"; reason = "stalemate"; }
  } else if (insufficientMaterial(np)) { result = "1/2-1/2"; reason = "insufficient material"; }
  else if (np.half >= 100) { result = "1/2-1/2"; reason = "fifty-move rule"; }
  else if (g.reps[k] >= 3) { result = "1/2-1/2"; reason = "threefold repetition"; }
  else if (g.san.length >= MAX_PLIES) { result = "1/2-1/2"; reason = "move limit"; }

  let message = `Move accepted: ${hit.san} (${white ? "White" : "Black"}). Thank you!`;
  if (result) {
    store.finished.unshift({
      n: g.n, result, reason, plies: g.san.length, pgn: pgnOf(g.san), by: g.by.slice(), named: g.named.slice(), ended: Date.now(),
    });
    store.finished.length = Math.min(store.finished.length, KEEP_FINISHED);
    store.game = newGame(g.n + 1);
    message += ` Game #${g.n} is over: ${winnerText(result)} by ${reason}. A new game has started.`;
  }
  return { status: 200, message };
}

function boardText(pos) {
  const rows = [];
  for (let r = 7; r >= 0; r--) {
    rows.push(`${r + 1}  ` + [...Array(8).keys()].map((f) => pos.b[r * 8 + f] || ".").join(" "));
  }
  rows.push("   a b c d e f g h");
  return rows.join("\n");
}

// A picture of the current position as a standalone SVG (works as an <img>, in READMEs, in chats...).
const GLYPH = { K: "\u265A", Q: "\u265B", R: "\u265C", B: "\u265D", N: "\u265E", P: "\u265F" };
const PIECE_FONTS = "'Segoe UI Symbol','Apple Symbols','Noto Sans Symbols 2','DejaVu Sans','Arial Unicode MS',sans-serif";

export function renderBoardSvg(store) {
  const g = store.game;
  const pos = parseFen(g.fen);
  const S = 56; // square size
  const M = 30; // margin for the coordinates
  const bottom = M + 8 * S;
  const W = S * 8 + M * 2;
  const H = bottom + 84;
  const whiteToMove = pos.turn === "w";
  const side = whiteToMove ? "White" : "Black";
  const check = inCheck(pos);
  const kingAt = pos.b.indexOf(whiteToMove ? "K" : "k");
  const px = (sq) => M + (sq & 7) * S;
  const py = (sq) => M + (7 - (sq >> 3)) * S;
  const square = (sq, fill, extra = "") =>
    `<rect x="${px(sq)}" y="${py(sq)}" width="${S}" height="${S}" fill="${fill}"${extra}/>`;

  let body = "";
  for (let sq = 0; sq < 64; sq++) body += square(sq, ((sq & 7) + (sq >> 3)) % 2 === 1 ? "#f0d9b5" : "#b58863");
  if (g.last) for (const sq of [g.last.from, g.last.to]) body += square(sq, "#ffe24a", ' fill-opacity=".5"');
  if (check) body += square(kingAt, "url(#chk)");
  body += `<rect x="${M}" y="${M}" width="${S * 8}" height="${S * 8}" fill="none" stroke="#6b4a2f" stroke-width="2"/>`;

  for (let i = 0; i < 8; i++) {
    body += `<text x="${M + i * S + S / 2}" y="${bottom + 18}" text-anchor="middle" font-size="14" fill="#a8a29a">${"abcdefgh"[i]}</text>`;
    body += `<text x="${M / 2}" y="${M + (7 - i) * S + S / 2 + 5}" text-anchor="middle" font-size="14" fill="#a8a29a">${i + 1}</text>`;
  }

  for (let sq = 0; sq < 64; sq++) {
    const c = pos.b[sq];
    if (!c) continue;
    const isWhite = c === c.toUpperCase();
    body +=
      `<text class="p" x="${px(sq) + S / 2}" y="${py(sq) + S * 0.77}" text-anchor="middle" font-size="${Math.round(S * 0.84)}" ` +
      `font-family="${PIECE_FONTS}" fill="${isWhite ? "#ffffff" : "#1b1b1b"}" stroke="${isWhite ? "#1b1b1b" : "#e9e9e9"}" ` +
      `stroke-width="${isWhite ? 1.6 : 0.7}" paint-order="stroke">${GLYPH[c.toUpperCase()]}\uFE0E</text>`;
  }

  const n = g.san.length;
  let line2;
  if (n) {
    const i = n - 1;
    const who = (g.by || [])[i];
    line2 = `Last move: ${Math.floor(i / 2) + 1}${i % 2 === 0 ? "." : "..."} ${g.san[i]}${who && who !== "unknown" ? " by " + who : ""}`;
  } else if (store.finished.length) {
    const f = store.finished[0];
    line2 = `Previous game: ${winnerText(f.result)} by ${f.reason}`;
  } else {
    line2 = "A new game - be the first to move";
  }
  const line1 = `Game #${g.n} \u00B7 ${side} to move${check ? " \u00B7 check!" : ""}`;
  const title = `Passer-By Chess, game ${g.n}, ${side} to move`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">
<title id="t">${esc(title)}</title>
<desc id="d">${esc(`Position (FEN): ${g.fen}. ${line2}`)}</desc>
<defs><radialGradient id="chk"><stop offset="0" stop-color="#ff2a2a" stop-opacity=".95"/><stop offset=".6" stop-color="#e03030" stop-opacity=".55"/><stop offset="1" stop-color="#e03030" stop-opacity="0"/></radialGradient></defs>
<rect width="${W}" height="${H}" rx="14" fill="#262421"/>
${body}
<text x="${W / 2}" y="${bottom + 50}" text-anchor="middle" font-family="system-ui,'Segoe UI',Helvetica,Arial,sans-serif" font-size="18" font-weight="600" fill="#f2efe9">${esc(line1)}</text>
<text x="${W / 2}" y="${bottom + 72}" text-anchor="middle" font-family="system-ui,'Segoe UI',Helvetica,Arial,sans-serif" font-size="14" fill="#b9b3a8">${esc(line2)}</text>
</svg>`;
}

export function stateJson(store) {
  const g = store.game;
  const pos = parseFen(g.fen);
  return {
    game: g.n,
    fen: g.fen,
    turn: pos.turn === "w" ? "white" : "black",
    ply: g.san.length,
    moves: g.san,
    move_log: g.san.map((move, i) => ({
      ply: i + 1,
      side: i % 2 === 0 ? "white" : "black",
      move,
      by: (g.by || [])[i] || "unknown",
      self_reported: Boolean((g.named || [])[i]),
    })),
    moves_counted: store.stats?.moves ?? 0,
    moves_with_self_reported_name: store.stats?.named ?? 0,
    legal_moves: sanList(pos).map((x) => x.san),
    in_check: inCheck(pos),
    play_a_move: "GET /move?ply={ply}&m={move}  (move in SAN like Nf3, or UCI like g1f3)",
    finished_games: store.finished,
  };
}

export function renderPage(store, res) {
  const g = store.game;
  const pos = parseFen(g.fen);
  const ply = g.san.length;
  const side = pos.turn === "w" ? "White" : "Black";
  const moves = sanList(pos).map((x) => x.san);
  const links = moves
    .map((s) => `<li><a rel="nofollow" href="/move?ply=${ply}&amp;m=${encodeURIComponent(s)}">${esc(s)}</a></li>`)
    .join("");
  const results = store.finished
    .slice(0, 10)
    .map((f) => {
      const players = [...new Set(f.by || [])].filter((x) => x !== "unknown").join(", ");
      return `<li>Game #${f.n}: ${winnerText(f.result)} by ${esc(f.reason)} after ${f.plies} half-moves (${f.result})${
        players ? ` &ndash; players: ${esc(players)}` : ""
      }</li>`;
    })
    .join("");
  const by = g.by || [];
  const named = g.named || [];
  const recent = g.san
    .map((s, i) => ({ s, i, who: by[i] || "unknown", self: Boolean(named[i]) }))
    .slice(-10)
    .reverse()
    .map(
      ({ s, i, who, self }) =>
        `<li>Move ${Math.floor(i / 2) + 1}, ${i % 2 === 0 ? "White" : "Black"}: <strong>${esc(s)}</strong> <span class="muted">by ${esc(who)}${self ? " (self-reported)" : ""}</span></li>`
    )
    .join("");
  const counted = store.stats?.moves ?? 0;
  const counter = counted
    ? ` Since counting began, ${store.stats.named} of ${counted} moves came with a self-reported name.`
    : "";
  const msg = res
    ? `<p class="msg ${res.status === 200 ? "ok" : "err"}">${esc(res.message)}</p>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Passer-By Chess - game #${g.n}, ${side} to move</title>
<meta name="description" content="A chess game played one move at a time by whoever stops by: people and AI agents.">
<meta property="og:title" content="Passer-By Chess">
<meta property="og:description" content="One chess game, one move per visitor. People and AI agents take turns.">
<meta property="og:type" content="website">
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; max-width: 42rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
  pre { background: rgba(127,127,127,.15); padding: .75rem 1rem; border-radius: .5rem; overflow-x: auto; }
  pre.board { font-size: 1.35rem; line-height: 1.3; }
  .msg { padding: .6rem .9rem; border-left: 4px solid; border-radius: .25rem; background: rgba(127,127,127,.12); }
  .ok { border-color: #2a9d4b; } .err { border-color: #d64545; }
  ul.moves { display: flex; flex-wrap: wrap; gap: .4rem 1rem; padding: 0; list-style: none; }
  ul.moves a { font-family: ui-monospace, monospace; font-size: 1.05rem; }
  small, .muted { opacity: .7; }
</style>
</head>
<body>
<h1>Passer-By Chess</h1>
<p>One chess game, shared by everyone who stops by &ndash; people and AI agents alike.
If you like, play <strong>one move</strong> for the side to move: pick a legal move from the list below and open its link.
Then carry on with whatever you were doing; there is no need to play more than one move.
The server checks every move, so only legal moves are accepted.</p>
<p class="muted"><small>Optional: if you would like to be named in the move log, add <code>&amp;who=YourName</code> to the end of the move link (up to ${WHO_MAX} letters, digits, spaces, dots, dashes or underscores). It is shown as self-reported.</small></p>
${msg}
<h2>Game #${g.n} &ndash; ${side} to move${inCheck(pos) ? " (in check)" : ""}</h2>
<p><img src="/board.svg?v=${g.n}-${ply}" width="508" height="562" alt="Picture of the current position; the same position is shown as text below." style="max-width:100%;height:auto"></p>
<pre class="board">${esc(boardText(pos))}</pre>
<p class="muted">Uppercase = White, lowercase = Black, "." = empty. FEN: <code>${esc(g.fen)}</code></p>
<p>Moves so far: ${g.san.length ? esc(pgnOf(g.san)) : "none yet"}</p>
${recent ? `<h3>Recent moves, newest first</h3><ul>${recent}</ul><p class="muted"><small>"By" is whatever the visitor's browser or agent reports about itself, so treat it as a hint.${counter}</small></p>` : ""}
<h2>Legal moves for ${side} (${moves.length})</h2>
<ul class="moves">${links}</ul>
${results ? `<h2>Finished games</h2><ul>${results}</ul>` : ""}
<p><small>Machine-readable state: <a href="/api/state">/api/state</a> &middot; Board picture for embedding: <a href="/board.svg">/board.svg</a> &middot; Source code: <a href="https://github.com/sy-borg/passerby-chess">https://github.com/sy-borg/passerby-chess</a></small></p>
</body>
</html>`;
}
