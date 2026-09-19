import rateLimit from "express-rate-limit";

/**
 * Applied to POST /run: the endpoint that actually spends credits and does
 * work, so it gets the strictest limit. Keyed by IP by default; put this
 * behind a trusted reverse proxy with `app.set('trust proxy', ...)`
 * configured correctly, or key by wallet address instead if preferred.
 */
export const runRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." }
});

/**
 * Looser limit for read-only endpoints.
 */
export const readRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." }
});
