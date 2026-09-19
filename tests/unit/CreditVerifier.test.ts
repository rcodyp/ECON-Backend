import { describe, expect, it, vi } from "vitest";
import { CreditVerifier } from "../../src/credits/CreditVerifier";
import { PaymentValidationError } from "../../src/types";
import { buildTestConfig, TEST_REQUESTER, TEST_TX_HASH, TEST_VAULT_ADDRESS } from "../testUtils";

function buildFakeDeps(overrides: {
  reservation?: unknown[];
  reservationThrows?: Error;
  receipt?: Record<string, unknown> | null;
}) {
  const getReservation = overrides.reservationThrows
    ? vi.fn().mockRejectedValue(overrides.reservationThrows)
    : vi.fn().mockResolvedValue(overrides.reservation);

  const getTransactionReceipt = vi.fn().mockResolvedValue(overrides.receipt ?? null);

  return {
    provider: { getTransactionReceipt } as unknown as import("ethers").JsonRpcProvider,
    vaultContract: { getReservation } as unknown as import("ethers").Contract
  };
}

const validReservationTuple = (over: Partial<Record<string, unknown>> = {}) => [
  over.agentId ?? "123",
  over.requester ?? TEST_REQUESTER,
  over.amount ?? 5n,
  over.consumed ?? false,
  over.released ?? false,
  over.expiresAt ?? BigInt(Math.floor(Date.now() / 1000) + 3600)
];

const validReceipt = {
  status: 1,
  to: TEST_VAULT_ADDRESS,
  hash: TEST_TX_HASH
};

const payment = {
  vault: TEST_VAULT_ADDRESS,
  reservationId: "0xdeadbeef",
  amount: 5,
  transactionHash: TEST_TX_HASH
};

describe("CreditVerifier", () => {
  const config = buildTestConfig();

  it("verifies a valid reservation and successful transaction", async () => {
    const deps = buildFakeDeps({ reservation: validReservationTuple(), receipt: validReceipt });
    const verifier = new CreditVerifier(config, deps);
    const result = await verifier.verifyPayment(payment, TEST_REQUESTER);
    expect(result.exists).toBe(true);
    expect(result.amount).toBe(5);
  });

  it("rejects when the reservation does not exist", async () => {
    const deps = buildFakeDeps({
      reservation: ["", "0x0000000000000000000000000000000000000000", 0n, false, false, 0n]
    });
    const verifier = new CreditVerifier(config, deps);
    await expect(verifier.verifyPayment(payment, TEST_REQUESTER)).rejects.toThrow(PaymentValidationError);
  });

  it("rejects when the reservation belongs to a different agent", async () => {
    const deps = buildFakeDeps({ reservation: validReservationTuple({ agentId: "999" }) });
    const verifier = new CreditVerifier(config, deps);
    await expect(verifier.verifyPayment(payment, TEST_REQUESTER)).rejects.toThrow(/different agent/);
  });

  it("rejects when the reservation requester does not match", async () => {
    const deps = buildFakeDeps({ reservation: validReservationTuple({ requester: "0x" + "99".repeat(20) }) });
    const verifier = new CreditVerifier(config, deps);
    await expect(verifier.verifyPayment(payment, TEST_REQUESTER)).rejects.toThrow(/does not match/);
  });

  it("rejects an already-consumed reservation", async () => {
    const deps = buildFakeDeps({ reservation: validReservationTuple({ consumed: true }) });
    const verifier = new CreditVerifier(config, deps);
    await expect(verifier.verifyPayment(payment, TEST_REQUESTER)).rejects.toThrow(/already been consumed/);
  });

  it("rejects an already-released reservation", async () => {
    const deps = buildFakeDeps({ reservation: validReservationTuple({ released: true }) });
    const verifier = new CreditVerifier(config, deps);
    await expect(verifier.verifyPayment(payment, TEST_REQUESTER)).rejects.toThrow(/already been released/);
  });

  it("rejects an expired reservation", async () => {
    const deps = buildFakeDeps({
      reservation: validReservationTuple({ expiresAt: BigInt(Math.floor(Date.now() / 1000) - 10) })
    });
    const verifier = new CreditVerifier(config, deps);
    await expect(verifier.verifyPayment(payment, TEST_REQUESTER)).rejects.toThrow(/expired/);
  });

  it("rejects a reservation with insufficient amount", async () => {
    const deps = buildFakeDeps({ reservation: validReservationTuple({ amount: 1n }) });
    const verifier = new CreditVerifier(config, deps);
    await expect(verifier.verifyPayment(payment, TEST_REQUESTER)).rejects.toThrow(/insufficient/);
  });

  it("rejects when the transaction is not found on-chain", async () => {
    const deps = buildFakeDeps({ reservation: validReservationTuple(), receipt: null });
    const verifier = new CreditVerifier(config, deps);
    await expect(verifier.verifyPayment(payment, TEST_REQUESTER)).rejects.toThrow(/not found on-chain/);
  });

  it("rejects when the transaction reverted", async () => {
    const deps = buildFakeDeps({ reservation: validReservationTuple(), receipt: { ...validReceipt, status: 0 } });
    const verifier = new CreditVerifier(config, deps);
    await expect(verifier.verifyPayment(payment, TEST_REQUESTER)).rejects.toThrow(/reverted/);
  });

  it("rejects when the transaction was sent to a different address than the vault", async () => {
    const deps = buildFakeDeps({
      reservation: validReservationTuple(),
      receipt: { ...validReceipt, to: "0x" + "77".repeat(20) }
    });
    const verifier = new CreditVerifier(config, deps);
    await expect(verifier.verifyPayment(payment, TEST_REQUESTER)).rejects.toThrow(/not sent to the configured/);
  });

  it("wraps RPC failures from getReservation in a PaymentValidationError", async () => {
    const deps = buildFakeDeps({ reservationThrows: new Error("RPC down") });
    const verifier = new CreditVerifier(config, deps);
    await expect(verifier.verifyPayment(payment, TEST_REQUESTER)).rejects.toThrow(PaymentValidationError);
  });
});
