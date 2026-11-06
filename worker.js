// worker.js - Cloudflare Worker entry point.
// One Durable Object ("Game") holds the single shared game, so simultaneous visitors are handled one at a time.
import { DurableObject } from "cloudflare:workers";
import { freshStore, tryMove, renderPage, renderBoardSvg, stateJson, agentLabel } from "./app.js";

const HEADERS = { "Cache-Control": "no-store" };
const html = (body, status = 200) =>
  new Response(body, { status, headers: { ...HEADERS, "Content-Type": "text/html; charset=utf-8" } });
const json = (obj) =>
  new Response(JSON.stringify(obj, null, 2), { headers: { ...HEADERS, "Content-Type": "application/json" } });

// Only a short hash of the visitor's IP is kept, to stop one visitor from playing both colours in a row.
async function hashIp(ip) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("passerby-chess:" + ip));
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class Game extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.store = (await ctx.storage.get("store")) || freshStore();
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/") return html(renderPage(this.store, null));
    if (url.pathname === "/api/state") return json(stateJson(this.store));
    if (url.pathname === "/board.svg") {
      // Short cache so embedded copies (READMEs, chats) stay reasonably fresh without hammering the game.
      return new Response(renderBoardSvg(this.store), {
        headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=15" },
      });
    }
    if (url.pathname === "/move") {
      const ply = parseInt(url.searchParams.get("ply") ?? "", 10);
      const move = (url.searchParams.get("m") ?? "").slice(0, 20);
      const ip = request.headers.get("CF-Connecting-IP") || "";
      const agent = agentLabel(request.headers.get("User-Agent"));
      const res = tryMove(this.store, { ply, move, ipHash: ip ? await hashIp(ip) : "", agent, who: url.searchParams.get("who") ?? "" });
      if (res.status === 200) await this.ctx.storage.put("store", this.store);
      return html(renderPage(this.store, res), res.status);
    }
    return new Response("Not found", { status: 404 });
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/robots.txt") {
      // Everyone is welcome, including agents that check robots.txt
      return new Response("User-agent: *\nAllow: /\n", { headers: { "Content-Type": "text/plain" } });
    }
    const stub = env.GAME.get(env.GAME.idFromName("main"));
    return stub.fetch(request);
  },
};
