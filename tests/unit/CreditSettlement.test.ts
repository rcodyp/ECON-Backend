import { describe, expect, it, vi } from "vitest";
import { Contract } from "ethers";
import { CreditSettlement } from "../../src/credits/CreditSettlement";
import { buildTestConfig, TEST_TX_HASH } from "../testUtils";

// CreditSettlement builds its own `Contract` instance internally from the
// signer we pass in, so we mock ethers' Contract constructor to return a
// fake with the methods we need, letting us assert on call arguments
// without touching a real chain.
vi.mock("ethers", async () => {
  const actual = await vi.importActual<typeof import("ethers")>("ethers");
  return {
    ...actual,
    Contract: vi.fn()
  };
});

function mockContractImpl(settleReservation: any, releaseReservation: any) {
  (Contract as unknown as ReturnType<typeof vi.fn>).mockImplementation(function () {
    return { settleReservation, releaseReservation };
  });
}

describe("CreditSettlement", () => {
  const config = buildTestConfig();
  const fakeSigner = {} as import("ethers").Signer;

  it("settles a reservation, consuming the agent price and returning the surplus", async () => {
    const wait = vi.fn().mockResolvedValue({ hash: TEST_TX_HASH });
    const settleReservation = vi.fn().mockResolvedValue({ wait });
    mockContractImpl(settleReservation, vi.fn());

    const settlement = new CreditSettlement(config, { signer: fakeSigner });
    const outcome = await settlement.settleConsumed("0xdeadbeef", 5, 8);

    expect(settleReservation).toHaveBeenCalledWith("0xdeadbeef", 5);
    expect(outcome.creditsConsumed).toBe(5);
    expect(outcome.creditsReturned).toBe(3);
    expect(outcome.settlementTxHash).toBe(TEST_TX_HASH);
  });

  it("never returns a negative surplus if consumed exceeds reserved", async () => {
    const wait = vi.fn().mockResolvedValue({ hash: TEST_TX_HASH });
    const settleReservation = vi.fn().mockResolvedValue({ wait });
    mockContractImpl(settleReservation, vi.fn());

    const settlement = new CreditSettlement(config, { signer: fakeSigner });
    const outcome = await settlement.settleConsumed("0xdeadbeef", 5, 5);

    expect(outcome.creditsReturned).toBe(0);
  });

  it("releases a reservation in full", async () => {
    const wait = vi.fn().mockResolvedValue({ hash: TEST_TX_HASH });
    const releaseReservation = vi.fn().mockResolvedValue({ wait });
    mockContractImpl(vi.fn(), releaseReservation);

    const settlement = new CreditSettlement(config, { signer: fakeSigner });
    const outcome = await settlement.releaseFull("0xdeadbeef", 5);

    expect(releaseReservation).toHaveBeenCalledWith("0xdeadbeef");
    expect(outcome.creditsConsumed).toBe(0);
    expect(outcome.creditsReturned).toBe(5);
  });
});
