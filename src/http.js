import http from "node:http";

/**
 * Pure request handler for the optional trigger endpoint.
 * Returns { code, body } so it can be unit-tested without a socket.
 */
export function buildResponse({ pathname, searchParams, headers = {}, ctx }) {
  const send = (code, body) => ({ code, body });

  if (pathname === "/health") return send(200, { ok: true });

  const user = (searchParams.get("user") || "").toLowerCase();
  const token = searchParams.get("token") || headers["x-trigger-token"] || "";
  const authorized = Boolean(user) && user === String(ctx.latestUser).toLowerCase();
  const tokenOk = !ctx.triggerToken || token === ctx.triggerToken;

  if (!authorized || !tokenOk) return send(401, { ok: false, error: "unauthorized" });

  if (pathname === "/latest") {
    if (ctx.dryRun) return send(400, { ok: false, error: "dry-run mode" });
    if (ctx.paused) return send(409, { ok: false, error: "paused" });
    ctx.startRun();
    return send(202, { ok: true, message: "run started", queue: ctx.status().queue });
  }

  if (pathname === "/status") return send(200, { ok: true, ...ctx.status() });

  return send(404, { ok: false, error: "not found" });
}

export function createTriggerServer(ctx) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const { code, body } = buildResponse({
      pathname: url.pathname,
      searchParams: url.searchParams,
      headers: req.headers,
      ctx,
    });
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  });
}
