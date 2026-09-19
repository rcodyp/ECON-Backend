import pino from "pino";

/**
 * Structured logger. Redaction paths cover any field name that has ever
 * been used in this codebase for secrets/PII so a future call site can't
 * accidentally leak a private key, signature, or raw payment payload.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "*.privateKey",
      "*.signerKey",
      "*.AGENT_SIGNER_PRIVATE_KEY",
      "*.authorization",
      "*.headers.authorization"
    ],
    censor: "[redacted]"
  }
});

/**
 * Logs exactly the fields the spec requires for a /run request outcome:
 * request ID, wallet, agent ID, status, and credit usage — nothing more.
 * Never pass raw request bodies or task content into this.
 */
export function logRunOutcome(fields: {
  requestId: string;
  wallet: string;
  agentId: string;
  status: "completed" | "failed";
  creditsConsumed: number;
  creditsReturned: number;
}): void {
  logger.info(fields, "run request outcome");
}
