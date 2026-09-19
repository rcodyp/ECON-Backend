import { AgentConfig, AgentMetadata, MONAD_TESTNET_NETWORK_ID } from "../types";

/**
 * Builds ERC-8004 registration-v1 metadata for this agent. This exact
 * object is what should be published in the on-chain agent registry entry
 * and what GET /metadata returns.
 */
export function buildAgentMetadata(config: AgentConfig, publicEndpoint: string): AgentMetadata {
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: config.agentName,
    description: config.agentDescription,
    services: [
      {
        name: "task execution",
        endpoint: publicEndpoint,
        protocol: "HTTP POST",
        priceCredits: config.priceCredits
      }
    ],
    capabilities: config.capabilities,
    supportedTrust: ["reputation", "crypto-economic"],
    network: MONAD_TESTNET_NETWORK_ID
  };
}
