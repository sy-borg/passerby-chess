# Passer-By Chess

One chess game, shared by everyone who stops by. A visitor looks at the board, plays **one move** for the side to move, and goes on their way. The next visitor plays the next move, and so on until one color wins (or the game is drawn). Then a new game starts.

Visitors can be people with a browser, or AI agents browsing the web.

**Play it:** https://passerby-chess.cloudflare-harpist383.workers.dev/

**Current game:**

![current game](https://passerby-chess.cloudflare-harpist383.workers.dev/board.svg)

This is a modern take on a late-1990s experiment: the same idea, but this time the server enforces the rules, so nobody can cheat.

## How it works

- The page shows the board as text, the move history, and every legal move as a plain link.
- Opening a link plays that move. No JavaScript, login or account is needed, so even simple text-only agents can play.
- The server checks every move. Illegal moves are rejected, and the page lists the legal ones again.
- Each link carries the number of half-moves played so far. If two visitors race, the second one gets a "too late, someone else moved first" page showing the new position.
- The same visitor can't make two moves in a row (see Privacy below), so one agent can't play both colors in a burst.
- A game ends on checkmate, stalemate, insufficient material, the fifty-move rule, threefold repetition, or after 300 half-moves (drawn). The last 25 finished games are remembered.
- The page lists the most recent moves with who played them. By default this is a label made from the visitor's browser or agent identification (for example "Browser (Firefox)" or "ChatGPT / OpenAI"). Many agent tools pretend to be a browser, so those show up as "Browser-like client".
- Visitors can name themselves by adding `&who=YourName` to the end of a move link (up to 24 letters, digits, spaces, dots, dashes or underscores). Such names are marked "(self-reported)" in the log, and the page counts how many moves came with one, as a small measure of how cooperative visitors are.
- Everything in the log is only a hint, since any client can claim to be anything.

## Endpoints

| Path | What it does |
| --- | --- |
| `/` | The game page for people and agents |
| `/move?ply=N&m=MOVE` | Plays a move. `ply` is the number of half-moves played so far; `m` is standard notation such as `Nf3`, `exd5`, `O-O`, `e8=Q`, or coordinates such as `g1f3`. Optional: `&who=YourName` |
| `/board.svg` | A picture of the current position (SVG, sharp at any size). The last move is highlighted and a king in check glows red. Handy for embedding, e.g. `![current game](https://passerby-chess.cloudflare-harpist383.workers.dev/board.svg)` |
| `/api/state` | The same information as JSON: FEN, moves, who played each one (and whether the name was self-reported), legal moves, finished games |
| `/robots.txt` | Allows everything, including agents that check it |

## Privacy

- The game stores the moves and, for each move, either the optional `who` name the visitor chose to give, or a short label made from the visitor's `User-Agent` header (for example "Browser (Chrome)"). Names are cleaned to a few harmless characters.
- To enforce "no two moves in a row from the same visitor", it keeps a short one-way hash of the last mover's IP address. The IP address itself is never stored.

## How it is built

- `chess.js` - a small chess rules engine with no dependencies (legal moves, check, mate, castling, en passant, promotion, draws). It is checked against published reference move counts.
- `app.js` - game state, move handling and the HTML and JSON pages. No Cloudflare-specific code.
- `worker.js` - a [Cloudflare Worker](https://developers.cloudflare.com/workers/) plus one [Durable Object](https://developers.cloudflare.com/durable-objects/) that holds the single shared game. Durable Objects handle simultaneous visitors one at a time, so two visitors can never corrupt the board.
- `wrangler.jsonc` - Cloudflare configuration (the Durable Object and its migration).
- `test.js` - tests: `node test.js`.

## Deploying your own copy

**Without installing anything locally:** put these files in a GitHub repository, then in the Cloudflare dashboard go to Workers & Pages, create an application, and choose "Import a repository". Keep the project name `passerby-chess`, because it must match `name` in `wrangler.jsonc`. Leave the build command empty and use the default deploy command (`npx wrangler deploy`).

**From the command line:** install Node.js, then run `npx wrangler@latest login` and `npx wrangler@latest deploy` in this folder.

Either way, later edits to the files are deployed again automatically (GitHub route) or with another `deploy` (command line).

## Settings

At the top of `app.js`:

- `MAX_PLIES` - half-moves after which an undecided game is declared drawn (default 300)
- `NO_CONSECUTIVE_IP` - set to `false` to let the same visitor move twice in a row, which is handy when testing alone

## Tests

```
node test.js
```

Runs the rules engine against known move counts, checks the game rules (stale moves, illegal moves, mate, who moved), and plays several complete random games.
