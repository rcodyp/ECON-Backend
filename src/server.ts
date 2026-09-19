import express, { Express, NextFunction, Request, Response } from "express";
import { Wallet } from "ethers";
import { loadConfig } from "./config";
import { AgentConfig } from "./types";
import { buildHealthRouter } from "./routes/health";
import { buildMetadataRouter } from "./routes/metadata";
import { buildRunRouter, RunRouteDeps } from "./routes/run";
import { buildCorsMiddleware } from "./middleware/cors";
import { requestIdMiddleware } from "./middleware/requestId";
import { timeoutMiddleware } from "./middleware/timeout";
import { readRateLimiter } from "./middleware/rateLimit";
import { AgentRuntime } from "./agent/AgentRuntime";
import { CreditVerifier, createCreditVerifierDeps } from "./credits/CreditVerifier";
import { CreditSettlement } from "./credits/CreditSettlement";
import { IdempotencyStore } from "./store/IdempotencyStore";
import { logger } from "./logger";

export interface CreateAppOptions {
  config: AgentConfig;
  publicEndpoint: string;
  runDeps: RunRouteDeps;
}

/**
 * Builds the Express app with all middleware and routes wired up, without
 * starting a listener. Used by both the production entrypoint and tests
 * (which inject fake runDeps instead of hitting a real chain).
 */
export function createApp({ config, publicEndpoint, runDeps }: CreateAppOptions): Express {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(requestIdMiddleware);
  app.use(timeoutMiddleware(config.requestTimeoutMs + 5_000));
  app.use(buildCorsMiddleware(config));

  // Body size cap: task size limit plus headroom for the surrounding JSON
  // envelope (agentId, requester, network, payment object).
  app.use(express.json({ limit: config.maxTaskSizeBytes + 4_096 }));

  app.use(readRateLimiter);

  app.use(buildHealthRouter(config));
  app.use(buildMetadataRouter(config, publicEndpoint));
  app.use(buildRunRouter(runDeps));

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "Not found." });
  });

  // Centralized error handler: catches JSON parse errors, CORS rejections,
  // and anything else thrown synchronously in middleware/routes. Never
  // leaks stack traces or internals to the client.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    logger.error({ requestId: req.requestId, err: err.message }, "unhandled request error");
    if (res.headersSent) return;

    if (err.message.includes("not an approved ECON frontend origin")) {
      res.status(403).json({ error: "Origin not allowed." });
      return;
    }
    if (err.name === "SyntaxError") {
      res.status(400).json({ error: "Malformed JSON body." });
      return;
    }
    if (err.message.toLowerCase().includes("request entity too large")) {
      res.status(413).json({ error: "Task payload too large." });
      return;
    }
    res.status(500).json({ error: "Internal server error." });
  });

  return app;
}

/**
 * Production entrypoint: loads config from the environment, wires real
 * on-chain dependencies (RPC provider, CreditVault contract, agent signer),
 * and starts listening.
 */
function main(): void {
  const config = loadConfig();
  const publicEndpoint = process.env.PUBLIC_ENDPOINT ?? `http://localhost:${config.port}/run`;

  const signerKey = process.env.AGENT_SIGNER_PRIVATE_KEY;
  if (!signerKey) {
    throw new Error(
      "AGENT_SIGNER_PRIVATE_KEY is required to settle/release CreditVault reservations. " +
        "Provision it via a secrets manager or KMS — never commit it to source control."
    );
  }

  const { provider, vaultContract } = createCreditVerifierDeps(config);
  const signer = new Wallet(signerKey, provider);

  const runDeps: RunRouteDeps = {
    config,
    runtime: new AgentRuntime(config.capabilities),
    verifier: new CreditVerifier(config, { provider, vaultContract }),
    settlement: new CreditSettlement(config, { signer }),
    idempotencyStore: new IdempotencyStore()
  };

  const app = createApp({ config, publicEndpoint, runDeps });

  app.listen(config.port, () => {
    logger.info(
      { port: config.port, agentId: config.agentId, network: "eip155:10143" },
      "ECON agent backend listening"
    );
  });
}

if (require.main === module) {
  main();
}
