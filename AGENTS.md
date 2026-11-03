# AGENTS.md

## Project Overview
This is a Cloudflare Worker project running a shared chess game where visitors play one move each and then leave. The game enforces rules through Durable Objects and uses a strict move validation system.

## Key Commands
- Run tests: `node test.js`
- Develop locally: `npm run dev`
- Deploy: `npm run deploy`

## File Structure
- `worker.js` - Cloudflare Worker entry point
- `app.js` - Game state, move handling, and page rendering
- `chess.js` - Chess rules engine
- `test.js` - Test suite with move validation tests

## Game Behavior
- Each visitor plays exactly one move per session
- Same visitor cannot make two moves consecutively
- Illegal moves are rejected with error page
- Game state is maintained in Durable Objects
- Uses FEN notation for board positions
- Game ends with a result (win/draw) and starts new game

## Key Endpoints
- `/` - Main game page showing board and moves
- `/move` - Endpoint for making moves via URL links
- `/api/state` - JSON API for current game state

## Testing
The test suite validates chess move generation against known perft values and tests game logic. Run with: `node test.js`

## Deployment
Uses Cloudflare Workers with Durable Objects. Requires Wrangler CLI:
- `npm run dev` to develop locally
- `npm run deploy` to deploy

## Important Constraints
- Move validation is strict - illegal moves are rejected
- Consecutive moves from same visitor are prohibited
- Game state persists through Durable Objects
- The game enforces all chess rules through the rules engine in chess.js