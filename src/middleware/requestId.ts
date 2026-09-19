import { randomUUID } from "crypto";
import { NextFunction, Request, Response } from "express";

declare module "express-serve-static-core" {
  interface Request {
    requestId: string;
  }
}

/**
 * Attaches a request ID to every request: reuses an incoming X-Request-Id
 * header if present (so clients can correlate their own logs), otherwise
 * generates a fresh UUID. Always echoes it back in the response headers.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header("X-Request-Id");
  req.requestId = incoming && incoming.trim().length > 0 ? incoming : randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  next();
}
