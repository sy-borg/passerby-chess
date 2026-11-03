// test.js - run with: node test.js
import { parseFen, perft, START_FEN, sanList } from "./chess.js";
import { freshStore, tryMove, renderPage, stateJson, agentLabel } from "./app.js";

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
