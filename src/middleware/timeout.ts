import { NextFunction, Request, Response } from "express";

/**
 * Enforces a hard wall-clock timeout on a request. If the handler hasn't
 * responded by then, sends a 504 and marks the request as timed out so
 * downstream code (e.g. the /run handler) can avoid double-responding and
 * can release any credit reservation it had claimed.
 */
export function timeoutMiddleware(timeoutMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    req.timedOut = false;

    const timer = setTimeout(() => {
      req.timedOut = true;
      if (!res.headersSent) {
        res.status(504).json({ error: "Request timed out." });
      }
    }, timeoutMs);

    res.on("finish", () => clearTimeout(timer));
    res.on("close", () => clearTimeout(timer));

    next();
  };
}

declare module "express-serve-static-core" {
  interface Request {
    timedOut?: boolean;
  }
}
