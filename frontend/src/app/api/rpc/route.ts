// =============================================================================
// RPC proxy
// =============================================================================
//
// The browser needs an RPC endpoint, and the good ones carry an API key in
// the URL. Anything the browser is handed is public, so a NEXT_PUBLIC_ RPC
// URL puts that key in the JavaScript bundle for anyone to lift.
//
// This forwards JSON-RPC to the endpoint named by RPC_URL, a server-only
// variable, so the key never leaves the server. The app talks to its own
// origin instead, and a deployment with no RPC_URL falls back to the public
// devnet endpoint, which needs no key.
//
// Subscriptions do not come through here: a websocket cannot be proxied by a
// route handler, so they go straight to the cluster. See lib/config.ts.

const UPSTREAM = process.env.RPC_URL?.trim() || "https://api.devnet.solana.com";

/**
 * What may be forwarded.
 *
 * Every read in the JSON-RPC surface is a `get*` method, so allowing that
 * prefix cannot break a read the app makes later. Beyond reads the app only
 * ever sends and simulates transactions. Everything else, `requestAirdrop`
 * included, is refused so this cannot be used as an open relay.
 */
const EXTRA_METHODS = new Set(["sendTransaction", "simulateTransaction"]);

function isAllowed(method: unknown): boolean {
  return typeof method === "string" && (method.startsWith("get") || EXTRA_METHODS.has(method));
}

/** A JSON-RPC error in the shape web3.js expects, so it surfaces cleanly. */
function rpcError(id: unknown, code: number, message: string, status: number) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status });
}

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return rpcError(null, -32700, "Body must be JSON", 400);
  }

  // web3.js batches some reads, so a body is either one call or an array.
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length === 0 || calls.length > 100) {
    return rpcError(null, -32600, "Between one and a hundred calls per request", 400);
  }

  const refused = calls.find((call) => !isAllowed((call as { method?: unknown })?.method));
  if (refused) {
    const method = (refused as { method?: unknown }).method;
    return rpcError(
      (refused as { id?: unknown }).id,
      -32601,
      `This endpoint does not forward ${typeof method === "string" ? method : "that method"}`,
      403,
    );
  }

  try {
    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    // Passed through untouched, status included, so a rate limit or an
    // upstream error reaches the client as itself rather than as a 500.
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store",
      },
    });
  } catch {
    return rpcError(null, -32603, "The RPC endpoint could not be reached", 502);
  }
}
