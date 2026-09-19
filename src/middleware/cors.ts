import cors, { CorsOptions } from "cors";
import { AgentConfig } from "../types";

/**
 * Restricts CORS to the explicit allow-list configured in
 * ECON_FRONTEND_ORIGIN (comma-separated). Requests with no Origin header
 * (server-to-server, curl, health checks) are allowed through since CORS
 * only governs browser behavior; the allow-list is what protects browser
 * clients from unapproved origins.
 */
export function buildCorsOptions(config: AgentConfig): CorsOptions {
  const allowedOrigins = new Set(config.econFrontendOrigin);

  return {
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin "${origin}" is not an approved ECON frontend origin.`));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id"],
    credentials: false,
    maxAge: 600
  };
}

export function buildCorsMiddleware(config: AgentConfig) {
  return cors(buildCorsOptions(config));
}
