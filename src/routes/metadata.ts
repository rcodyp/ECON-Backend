import { Router } from "express";
import { AgentConfig } from "../types";
import { buildAgentMetadata } from "../agent/metadata";

export function buildMetadataRouter(config: AgentConfig, publicEndpoint: string): Router {
  const router = Router();

  router.get("/metadata", (_req, res) => {
    res.status(200).json(buildAgentMetadata(config, publicEndpoint));
  });

  return router;
}
