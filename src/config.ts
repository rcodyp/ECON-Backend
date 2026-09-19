import "dotenv/config";
import { AgentConfig } from "./types";

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, got: ${raw}`);
  }
  return parsed;
}

function parseListEnv(name: string, fallback: string[] = []): string[] {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Loads and validates configuration from environment variables.
 * Throws immediately on missing required values so misconfiguration
 * never reaches production silently.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const monadChainId = parseIntEnv("MONAD_CHAIN_ID", 10143);

  return {
    agentId: requireEnv("AGENT_ID"),
    agentName: requireEnv("AGENT_NAME"),
    agentDescription: requireEnv("AGENT_DESCRIPTION"),
    agentController: requireEnv("AGENT_CONTROLLER"),
    monadRpcUrl: requireEnv("MONAD_RPC_URL", "https://testnet-rpc.monad.xyz"),
    monadChainId,
    creditVaultAddress: requireEnv("CREDIT_VAULT_ADDRESS"),
    econFrontendOrigin: parseListEnv("ECON_FRONTEND_ORIGIN"),
    maxTaskSizeBytes: parseIntEnv("MAX_TASK_SIZE", 16_384),
    requestTimeoutMs: parseIntEnv("REQUEST_TIMEOUT_MS", 30_000),
    priceCredits: parseIntEnv("AGENT_PRICE_CREDITS", 5),
    capabilities: parseListEnv("AGENT_CAPABILITIES", ["data-analysis", "document-processing"]),
    port: parseIntEnv("PORT", 3000),
    nodeEnv: env.NODE_ENV ?? "development"
  };
}
