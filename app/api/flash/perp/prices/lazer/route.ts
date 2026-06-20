import { NextResponse } from "next/server";

import {
  LAZER_STREAM_ENDPOINTS,
  buildLazerStreamUrl,
  buildLazerSubscribeMessage,
  transcodeLazerToHermes,
} from "@/lib/flash/lazer-relay";

// Long-lived SSE; needs the Node runtime for the global WebSocket client
// (undici, Node 18+) that connects out to Pyth Lazer.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Server-side relay for the Pyth Lazer real-time price stream. Holds the access
// token (never shipped to the browser), opens an authenticated upstream
// WebSocket, transcodes each 1-50ms tick into the Hermes "parsed" JSON shape the
// client already decodes, and rebroadcasts over SSE. Each browser connection
// gets its own upstream socket (same model as perps-games/prototype/
// lazer-relay.mjs). If the upstream drops, the client's Hermes EventSource keeps
// the scalp price live while this relay reconnects.
export async function GET(request: Request): Promise<Response> {
  const token = process.env.LAZER_TOKEN?.trim();
  if (!token) {
    return NextResponse.json(
      { error: "Lazer relay not configured (set LAZER_TOKEN)." },
      { status: 503 },
    );
  }

  const encoder = new TextEncoder();
  let ws: WebSocket | null = null;
  let endpointIdx = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      function cleanup() {
        if (closed) return;
        closed = true;
        request.signal.removeEventListener("abort", cleanup);
        if (reconnectTimer) clearTimeout(reconnectTimer);
        try {
          ws?.close();
        } catch {
          // already gone
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
      }

      const send = (data: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          cleanup();
        }
      };

      const scheduleReconnect = () => {
        if (closed || reconnectTimer) return;
        endpointIdx += 1; // round-robin to the next Lazer host
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, 500);
      };

      const connect = () => {
        if (closed) return;
        const endpoint =
          LAZER_STREAM_ENDPOINTS[endpointIdx % LAZER_STREAM_ENDPOINTS.length];
        let socket: WebSocket;
        try {
          socket = new WebSocket(buildLazerStreamUrl(endpoint, token));
        } catch {
          scheduleReconnect();
          return;
        }
        ws = socket;
        socket.onopen = () => {
          try {
            socket.send(buildLazerSubscribeMessage());
          } catch {
            // close handler will reconnect
          }
        };
        socket.onmessage = (event: MessageEvent) => {
          const raw =
            typeof event.data === "string" ? event.data : String(event.data);
          const hermes = transcodeLazerToHermes(raw);
          if (hermes) send(hermes);
        };
        socket.onerror = () => {
          // `close` fires next — reconnect there to avoid double-scheduling.
        };
        socket.onclose = () => {
          if (ws === socket) ws = null;
          scheduleReconnect();
        };
      };

      // SSE preamble flushes headers and opens the stream promptly for proxies.
      controller.enqueue(encoder.encode(": lazer relay connected\n\n"));
      request.signal.addEventListener("abort", cleanup);
      connect();
    },
    cancel() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        ws?.close();
      } catch {
        // already gone
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
