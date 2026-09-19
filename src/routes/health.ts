import { Router } from "express";
import { AgentConfig, HealthResponse, MONAD_TESTNET_NETWORK_ID } from "../types";

export function buildHealthRouter(config: AgentConfig): Router {
  const router = Router();

  router.get("/health", (_req, res) => {
    const body: HealthResponse = {
      status: "online",
      agentId: config.agentId,
      network: MONAD_TESTNET_NETWORK_ID,
      capabilities: config.capabilities,
      priceCredits: config.priceCredits
    };
    res.status(200).json(body);
  });

  return router;
}
