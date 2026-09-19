import { AgentConfig, MONAD_TESTNET_NETWORK_ID } from "../src/types";

export const TEST_VAULT_ADDRESS = "0x" + "11".repeat(20);
export const TEST_REQUESTER = ("0x" + "a1".repeat(20)).toLowerCase();
export const TEST_TX_HASH = "0x" + "ab".repeat(32);

export function buildTestConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    agentId: "123",
    agentName: "Test Agent",
    agentDescription: "An agent used in tests.",
    agentController: "0x000000000000000000000000000000000000C1",
    monadRpcUrl: "https://testnet-rpc.monad.xyz",
    monadChainId: 10143,
    creditVaultAddress: TEST_VAULT_ADDRESS,
    econFrontendOrigin: ["https://econ.example.com"],
    maxTaskSizeBytes: 16_384,
    requestTimeoutMs: 2_000,
    priceCredits: 5,
    capabilities: ["data-analysis", "document-processing"],
    port: 3000,
    nodeEnv: "test",
    ...overrides
  };
}

export function buildValidRunBody(overrides: Record<string, unknown> = {}) {
  const { payment: paymentOverrides, ...rest } = overrides;
  return {
    task: "Analyze this dataset",
    agentId: "123",
    requester: TEST_REQUESTER,
    network: MONAD_TESTNET_NETWORK_ID,
    payment: {
      vault: TEST_VAULT_ADDRESS,
      reservationId: "0xdeadbeef",
      amount: 5,
      transactionHash: TEST_TX_HASH,
      ...(paymentOverrides as Record<string, unknown> | undefined)
    },
    ...rest
  };
}
