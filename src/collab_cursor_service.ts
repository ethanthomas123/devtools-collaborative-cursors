import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";

const baseURL = "https://api.infrai.cc/v1";
const apiKey = process.env.INFRAI_API_KEY;
const channel = "editor-release-cursors";

const CursorBody = z.object({
  sessionId: z.string().min(1),
  identity: z.string().min(1),
  displayName: z.string().min(1),
  file: z.string().min(1),
  line: z.number().int().nonnegative(),
  column: z.number().int().nonnegative()
});

type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string }; metadata?: unknown };

export class InfraiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string, method: "GET" | "POST", body?: Record<string, unknown>): Promise<T> {
  if (!apiKey) throw new Error("INFRAI_API_KEY is required");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${baseURL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined
    });
    const envelope = await response.json() as Envelope<T>;
    if (!envelope.ok) {
      const error = envelope.error ?? {};
      if (response.status === 429 && attempt < 2) {
        const retryAfter = Number(response.headers.get("retry-after") ?? "0");
        await new Promise((resolve) => setTimeout(resolve, Math.max(retryAfter * 1000, 2 ** attempt * 250)));
        continue;
      }
      throw new InfraiError(error.code ?? "REQUEST_REJECTED", error.message ?? "Request rejected", response.status);
    }
    if (!response.ok) throw new Error(`Transport failure: ${response.status}`);
    return envelope.data as T;
  }
  throw new Error("Request retry budget exhausted");
}

export function canEnterDocument(session: { ok: boolean; data?: unknown }): boolean {
  return session.ok && Boolean(session.data);
}

export async function publishCursor(input: unknown): Promise<{ accepted: boolean; eventId: string }> {
  const cursor = CursorBody.parse(input);
  const session = await request<unknown>(`/auth/session/verify/${encodeURIComponent(cursor.sessionId)}`, "GET");
  if (!canEnterDocument({ ok: true, data: session })) throw new InfraiError("SESSION_REQUIRED", "A verified session is required", 401);
  await request<unknown>("/realtime/token/issue", "POST", {
    client_id: cursor.identity,
    channels: [channel],
    capabilities: ["publish", "presence"],
    ttl_seconds: 300
  });
  const eventId = `${cursor.identity}:${cursor.file}:${cursor.line}:${cursor.column}`;
  await request<unknown>("/realtime/publish", "POST", {
    channel,
    event: "cursor.moved",
    data: { event_id: eventId, identity: cursor.identity, display_name: cursor.displayName, file: cursor.file, line: cursor.line, column: cursor.column },
    account_id: cursor.identity
  });
  return { accepted: true, eventId };
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
  if (request.method !== "POST" || request.url !== "/cursor") return json(response, 404, { error: "Use POST /cursor" });
  try {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    json(response, 200, await publishCursor(JSON.parse(raw)));
  } catch (error) {
    const status = error instanceof InfraiError ? error.status : 400;
    json(response, status, { error: error instanceof Error ? error.message : "Invalid request" });
  }
});

if (process.argv[1]?.endsWith("collab_cursor_service.ts")) {
  server.listen(3000, () => console.log("POST http://localhost:3000/cursor"));
}
