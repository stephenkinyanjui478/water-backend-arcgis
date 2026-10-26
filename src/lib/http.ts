/**
 * Shared HTTP plumbing for API routes: CORS, method guards, JSON-auth extraction
 * and a uniform error-handling wrapper. Keeps each route handler small and
 * focused on business logic.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { config } from "@/lib/config";
import { verifySession, type CustomerClaims } from "@/lib/jwt";

/** Apply CORS headers. Returns true if the request was a preflight (already ended). */
export function applyCors(req: NextApiRequest, res: NextApiResponse): boolean {
  const origin = req.headers.origin;
  if (origin && config.allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else if (config.allowedOrigins.length) {
    res.setHeader("Access-Control-Allow-Origin", config.allowedOrigins[0]);
  }
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Handler = (req: NextApiRequest, res: NextApiResponse) => Promise<void> | void;

/** Wrap a handler with CORS + top-level error handling. */
export function withApi(handler: Handler): Handler {
  return async (req, res) => {
    if (applyCors(req, res)) return;
    try {
      await handler(req, res);
    } catch (err: any) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500) console.error(`[api] ${req.method} ${req.url}:`, err);
      res.status(status).json({ error: err?.message || "Internal error" });
    }
  };
}

/** Throw unless the request method is one of the allowed ones. */
export function requireMethod(req: NextApiRequest, ...methods: string[]) {
  if (!methods.includes(req.method || "")) {
    throw new HttpError(405, `Method ${req.method} not allowed`);
  }
}

/** Verify the Bearer token and return the customer's claims, or 401. */
export function requireAuth(req: NextApiRequest): CustomerClaims {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    throw new HttpError(401, "Missing or malformed Authorization header");
  }
  try {
    return verifySession(token);
  } catch {
    throw new HttpError(401, "Invalid or expired session");
  }
}
