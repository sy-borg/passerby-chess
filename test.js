// test.js - run with: node test.js
import { parseFen, perft, START_FEN, sanList } from "./chess.js";
import { freshStore, tryMove, renderPage, renderBoardSvg, stateJson, agentLabel, cleanWho } from "./app.js";

let failed = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} ${extra}`);
  if (!ok) failed++;
};

// 1. Rules engine: known perft node counts (these catch almost any move-generation bug).
const perfts = [
  ["start position, depth 3", START_FEN, 3, 8902],
  ["kiwipete (castling, pins, ep), depth 3", "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", 3, 97862],
  ["endgame with ep checks, depth 4", "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", 4, 43238],
  ["promotions and castling, depth 3", "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1", 3, 9467],
  ["promotion into check, depth 3", "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8", 3, 62379],
];
for (const [name, fen, depth, expected] of perfts) {
  const got = perft(parseFen(fen), depth);
  check(name, got === expected, `(got ${got}, expected ${expected})`);
}

// 2. Specific rule behaviour through the game layer.
{
  const s = freshStore();
  let r = tryMove(s, { ply: 0, move: "e4", ipHash: "A" });
  check("legal move accepted", r.status === 200);
  r = tryMove(s, { ply: 0, move: "e5", ipHash: "B" });
  check("stale ply rejected (409)", r.status === 409);
  r = tryMove(s, { ply: 1, move: "e5", ipHash: "A" });
  check("same visitor twice in a row rejected (429)", r.status === 429);
  r = tryMove(s, { ply: 1, move: "Ke2", ipHash: "B" });
  check("illegal move rejected (400)", r.status === 400);
  r = tryMove(s, { ply: 1, move: "e7e5", ipHash: "B" });
  check("UCI notation accepted", r.status === 200);
  check("state stays consistent", s.game.san.join(" ") === "e4 e5");

  // Fool's mate: Black wins, game archived, new game starts.
  const f = freshStore();
  const seq = ["f3", "e5", "g4", "Qh4#"];
  seq.forEach((m, i) => tryMove(f, { ply: i, move: m, ipHash: i % 2 ? "B" : "A" }));
  check("checkmate archived as 0-1", f.finished[0]?.result === "0-1" && f.finished[0]?.reason === "checkmate");
  check("new game started after mate", f.game.n === 2 && f.game.san.length === 0);
}

// 2b. Who played each move.
{
  const labels = [
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0", "Browser (Edge)"],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0", "Browser (Firefox)"],
    ["Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15", "Browser (Safari)"],
    ["Mozilla/5.0 AppleWebKit/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/126 Safari/537.36", "Googlebot"],
    ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot", "ChatGPT / OpenAI"],
    ["Claude-User", "Claude / Anthropic"],
    ["python-requests/2.32", "Python script"],
    ["", "unknown"],
  ];
  for (const [ua, want] of labels) check(`label for "${ua.slice(0, 30)}"`, agentLabel(ua) === want, `(got "${agentLabel(ua)}")`);

  const odd = agentLabel("MyCoolAgent/1.0 <script>alert(1)</script> and a very long tail that goes on and on");
  check("unknown agents are cleaned and shortened", odd.startsWith("MyCoolAgent/1.0") && !/[<>()]/.test(odd) && odd.length <= 30, `(got "${odd}")`);

  const s = freshStore();
  tryMove(s, { ply: 0, move: "e4", ipHash: "A", agent: "ChatGPT / OpenAI" });
  tryMove(s, { ply: 1, move: "e5", ipHash: "B", agent: "Browser (Firefox)" });
  check("movers recorded per move", s.game.by.join("|") === "ChatGPT / OpenAI|Browser (Firefox)");
  const page = renderPage(s, null);
  check("page shows who moved", page.includes("by ChatGPT / OpenAI") && page.includes("by Browser (Firefox)"));
  check("api move_log has movers", stateJson(s).move_log[1].by === "Browser (Firefox)" && stateJson(s).move_log[1].side === "black");

  // A game saved by the previous version (moves but no `by` list) must keep working.
  const old = freshStore();
  old.game.san = ["e4", "Nf6"];
  old.game.fen = "rnbqkb1r/pppppppp/5n2/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 1 2";
  old.game.reps = { "rnbqkb1r/pppppppp/5n2/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -": 1 };
  delete old.game.by;
  check("old saved game still renders", renderPage(old, null).includes("Game #1"));
  const r = tryMove(old, { ply: 2, move: "Nc3", ipHash: "C", agent: "Claude / Anthropic" });
  check("old saved game accepts a move", r.status === 200);
  check("old moves padded as unknown", old.game.by.join("|") === "unknown|unknown|Claude / Anthropic");
}

// 2c. Self-reported names (&who=).
{
  check("who: plain name kept", cleanWho("OpenCode-Qwen 3") === "OpenCode-Qwen 3");
  check("who: markup and symbols removed", cleanWho("<b>Hi</b>; DROP 'x'") === "bHib DROP x");
  check("who: shortened to 24", cleanWho("a".repeat(100)).length === 24);
  check("who: empty and missing", cleanWho("") === "" && cleanWho(undefined) === "" && cleanWho("   ") === "");
  check("generic browser header gets neutral label", agentLabel("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko)") === "Browser-like client");

  const s = freshStore();
  tryMove(s, { ply: 0, move: "e4", ipHash: "A", agent: "Browser-like client", who: "OpenCode-Qwen" });
  tryMove(s, { ply: 1, move: "e5", ipHash: "B", agent: "Browser (Firefox)" });
  check("self-reported name wins over user agent", s.game.by[0] === "OpenCode-Qwen" && s.game.named[0] === true);
  check("no name falls back to user agent", s.game.by[1] === "Browser (Firefox)" && s.game.named[1] === false);
  check("counters", s.stats.moves === 2 && s.stats.named === 1);
  const page = renderPage(s, null);
  check("page marks self-reported names", page.includes("OpenCode-Qwen") && page.includes("(self-reported)"));
  check("page shows the counter", page.includes("1 of 2 moves came with a self-reported name"));
  check("page invites agents to add who", page.includes("&amp;who=YourName"));
  check("api shows the flag and counters", stateJson(s).move_log[0].self_reported === true && stateJson(s).moves_with_self_reported_name === 1);

  // The game that is already running (saved before names and counters existed) must keep working.
  const old = freshStore();
  old.game.san = ["e4", "Nf6"];
  old.game.by = ["unknown", "unknown"];
  delete old.game.named;
  delete old.stats;
  old.game.fen = "rnbqkb1r/pppppppp/5n2/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 1 2";
  old.game.reps = { "rnbqkb1r/pppppppp/5n2/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -": 1 };
  check("running game renders without counters", renderPage(old, null).includes("Game #1"));
  const r = tryMove(old, { ply: 2, move: "Nc3", ipHash: "C", agent: "Browser-like client", who: "Tester" });
  check("running game accepts a named move", r.status === 200 && old.game.named.join() === "false,false,true");
  check("counters start from zero", old.stats.moves === 1 && old.stats.named === 1);
}

// 2d. The board picture (SVG).
{
  const pieces = (svg) => (svg.match(/class="p"/g) || []).length;
  const s = freshStore();
  let svg = renderBoardSvg(s);
  check("svg: starts with 32 pieces and 64 squares", pieces(svg) === 32 && (svg.match(/fill="#(f0d9b5|b58863)"/g) || []).length === 64);
  check("svg: new game caption", svg.includes("Game #1") && svg.includes("White to move") && svg.includes("be the first to move"));
  check("svg: no highlight before the first move", !svg.includes('fill-opacity=".5"'));

  tryMove(s, { ply: 0, move: "e4", ipHash: "A", agent: "Browser (Firefox)", who: "A & B <i>" });
  tryMove(s, { ply: 1, move: "f6", ipHash: "B", agent: "Claude / Anthropic" });
  svg = renderBoardSvg(s);
  check("svg: last move highlighted on two squares", (svg.match(/fill-opacity="\.5"/g) || []).length === 2);
  check("svg: last move in caption", svg.includes("Last move: 1... f6 by Claude / Anthropic"));

  tryMove(s, { ply: 2, move: "Qh5", ipHash: "A", agent: "x", who: "A & B <i>" });
  svg = renderBoardSvg(s);
  check("svg: check is marked", svg.includes('fill="url(#chk)"') && svg.includes("check!"));
  check("svg: names are escaped", !svg.includes("<i>") && svg.includes("by A B i"));
  check("svg: describes the position for screen readers", svg.includes("<desc") && svg.includes("Position (FEN)"));

  // Previous result is shown when a new game starts.
  const f = freshStore();
  ["f3", "e5", "g4", "Qh4#"].forEach((m, i) => tryMove(f, { ply: i, move: m, ipHash: i % 2 ? "B" : "A" }));
  check("svg: shows previous result on a fresh game", renderBoardSvg(f).includes("Previous game: Black wins by checkmate"));

  // A game saved before the last move was remembered still draws.
  const old = freshStore();
  old.game.san = ["e4", "Nf6"];
  old.game.fen = "rnbqkb1r/pppppppp/5n2/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 1 2";
  delete old.game.last;
  check("svg: old saved game draws without highlight", renderBoardSvg(old).includes("<svg") && pieces(renderBoardSvg(old)) === 32);
  check("page embeds the picture", renderPage(s, null).includes('src="/board.svg?v=1-3"'));
}

// 3. Random games played to the end through the public functions.
{
  const s = freshStore();
  let seed = 12345;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  let turn = 0;
  let guard = 0;
  while (s.finished.length < 6 && guard++ < 5000) {
    const pos = parseFen(s.game.fen);
    const list = sanList(pos);
    const pick = list[rnd(list.length)].san;
    const r = tryMove(s, { ply: s.game.san.length, move: pick, ipHash: turn++ % 2 ? "B" : "A" });
    if (r.status !== 200) { check("random game move accepted", false, r.message); break; }
  }
  check("6 random games finished", s.finished.length === 6, `(reasons: ${s.finished.map((f) => f.reason).join(", ")})`);
  const page = renderPage(s, { status: 200, message: "<b>test</b>" });
  check("page renders and escapes text", page.includes("&lt;b&gt;test") && page.includes("Passer-By Chess"));
  check("api state renders", Array.isArray(stateJson(s).legal_moves));
}

console.log(failed ? `\n${failed} test(s) FAILED` : "\nAll tests passed");
process.exit(failed ? 1 : 0);
