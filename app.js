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
<pre class="board">${esc(boardText(pos))}</pre>
<p class="muted">Uppercase = White, lowercase = Black, "." = empty. FEN: <code>${esc(g.fen)}</code></p>
<p>Moves so far: ${g.san.length ? esc(pgnOf(g.san)) : "none yet"}</p>
${recent ? `<h3>Recent moves, newest first</h3><ul>${recent}</ul><p class="muted"><small>"By" is whatever the visitor's browser or agent reports about itself, so treat it as a hint.${counter}</small></p>` : ""}
<h2>Legal moves for ${side} (${moves.length})</h2>
<ul class="moves">${links}</ul>
${results ? `<h2>Finished games</h2><ul>${results}</ul>` : ""}
<p><small>Machine-readable state: <a href="/api/state">/api/state</a></small></p>
</body>
</html>`;
}
