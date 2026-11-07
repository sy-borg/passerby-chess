# AGENTS.md

## Project Overview
This is a Cloudflare Worker project running a shared chess game where visitors play one move each and then leave. The game enforces rules through Durable Objects and uses a strict move validation system.

## Key Commands
- Run tests: `node test.js`
- Develop locally: `npm run dev`
- Deploy: `npm run deploy`

## File Structure
- `worker.js` - Cloudflare Worker entry point and the `Game` Durable Object
- `app.js` - Game state, move handling, and page rendering (HTML page, JSON state, SVG board picture); contains no Cloudflare-specific code
- `chess.js` - Chess rules engine
- `test.js` - Test suite with move validation tests
- `wrangler.jsonc` - Cloudflare configuration (Durable Object binding and migration)

## Game Behavior
- Visitors play one move per visit; the page never asks for more. There are no accounts or sessions
- The same visitor (identified only by a short one-way hash of the IP address) cannot make two moves in a row, but can play again after someone else has moved
- Every move link carries the number of half-moves played so far (`ply`); a stale link is rejected (409) and the current position is shown
- Illegal moves are rejected (400) with an error page that lists the legal moves again
- Moves are accepted in SAN (`Nf3`, `exd5`, `O-O`, `e8=Q`) or UCI (`g1f3`, `e7e8q`) notation
- Each move is logged with who played it: a label derived from the `User-Agent` header, or an optional self-reported name given with `&who=Name` (cleaned to letters, digits, spaces, `.`, `_`, `-`, at most 24 characters). Self-reported names are marked as such and counted
- Game state is maintained in a single Durable Object
- Uses FEN notation for board positions
- A game ends on checkmate, stalemate, insufficient material, the fifty-move rule, threefold repetition, or after 300 half-moves (a draw). It is archived (the last 25 are kept) and a new game starts immediately
- Tunable constants are at the top of `app.js`: `MAX_PLIES` and `NO_CONSECUTIVE_IP`

## Key Endpoints
- `/` - Main game page showing the board picture, the text board, recent moves and the legal moves as links
- `/move?ply=N&m=MOVE` - Endpoint for making moves via URL links (optional: `&who=Name`)
- `/api/state` - JSON API for current game state (FEN, moves, move log with who played each move, legal moves, finished games)
- `/board.svg` - SVG picture of the current position: last move highlighted, king in check marked, caption with game number, side to move and last move. Cached for 15 seconds, so it is suitable for embedding
- `/robots.txt` - Allows everything, including `/move`, on purpose so that agents that honor `robots.txt` can play

## Testing
The test suite validates chess move generation against known perft values, tests game logic (stale, illegal and repeated moves, checkmate, who-played-it log, self-reported names) and the SVG board picture, and plays complete random games. Run with: `node test.js`

## Deployment
Uses Cloudflare Workers with Durable Objects. Requires Wrangler CLI:
- `npm run dev` to develop locally
- `npm run deploy` to deploy

Cloudflare can also build and deploy directly from the GitHub repository. In that setup, the Worker name in the Cloudflare dashboard must match `name` in `wrangler.jsonc` (`passerby-chess`).

## Important Constraints
- Move validation is strict - illegal moves are rejected
- Consecutive moves from the same visitor are prohibited
- Game state persists through Durable Objects; games saved by older versions (missing newer fields such as `by`, `named`, `last` or `stats`) must keep working
- Raw IP addresses are never stored, only a short one-way hash
- The game enforces all chess rules through the rules engine in `chess.js`
- `/robots.txt` must keep allowing `/move`
