import { createApp } from "../../src/server";
import { RunRouteDeps } from "../../src/routes/run";
import { AgentRuntime } from "../../src/agent/AgentRuntime";
import { CreditVerifier } from "../../src/credits/CreditVerifier";
import { CreditSettlement } from "../../src/credits/CreditSettlement";
import { IdempotencyStore } from "../../src/store/IdempotencyStore";
import { AgentConfig, PaymentPayload, PaymentValidationError, ReservationState } from "../../src/types";
import { buildTestConfig, TEST_REQUESTER, TEST_TX_HASH } from "../testUtils";
import { vi } from "vitest";

export interface TestAppHandles {
  app: ReturnType<typeof createApp>;
  config: AgentConfig;
  verifyPaymentMock: ReturnType<typeof vi.fn>;
  executeMock: ReturnType<typeof vi.fn>;
  idempotencyStore: IdempotencyStore;
}

/**
 * Builds a fully wired Express app for integration tests, with the two
 * genuinely external dependencies (on-chain verification and settlement)
 * replaced by controllable fakes. Everything else — validation,
 * idempotency, routing, CORS, error handling — runs for real.
 */
export function buildTestApp(configOverrides: Partial<AgentConfig> = {}): TestAppHandles {
  const config = buildTestConfig(configOverrides);

  const defaultReservation: ReservationState = {
    exists: true,
    agentId: config.agentId,
    requester: TEST_REQUESTER,
    amount: config.priceCredits,
    consumed: false,
    released: false,
    expiresAt: Math.floor(Date.now() / 1000) + 3600
  };

  const verifyPaymentMock = vi.fn(
    async (_payment: PaymentPayload, _requester: string): Promise<ReservationState> => defaultReservation
  );

  const executeMock = vi.fn(async (task: string) => ({ result: { echoed: task } }));

  const fakeVerifier = { verifyPayment: verifyPaymentMock } as unknown as CreditVerifier;
  const fakeRuntime = { execute: executeMock } as unknown as AgentRuntime;
  const fakeSettlement = {
    settleConsumed: vi.fn(async (_id: string, consumed: number, reserved: number) => ({
      creditsConsumed: consumed,
      creditsReturned: Math.max(reserved - consumed, 0),
      settlementTxHash: TEST_TX_HASH
    })),
    releaseFull: vi.fn(async (_id: string, reserved: number) => ({
      creditsConsumed: 0,
      creditsReturned: reserved,
      settlementTxHash: TEST_TX_HASH
    }))
  } as unknown as CreditSettlement;

  const idempotencyStore = new IdempotencyStore();

  const runDeps: RunRouteDeps = {
    config,
    runtime: fakeRuntime,
    verifier: fakeVerifier,
    settlement: fakeSettlement,
    idempotencyStore
  };

  const app = createApp({
    config,
    publicEndpoint: "https://agent.example.com/run",
    runDeps
  });

  return { app, config, verifyPaymentMock, executeMock, idempotencyStore };
}

export function throwPaymentError(message: string) {
  return async () => {
    throw new PaymentValidationError(message);
  };
}
