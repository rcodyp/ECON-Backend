import { Contract, Signer } from "ethers";
import { AgentConfig } from "../types";

/**
 * Minimal CreditVault ABI required to settle a reservation once a task has
 * actually run. As with CreditVerifier, treat this as a documented
 * assumption to be reconciled against the real deployed ABI.
 *
 * settleReservation: called after a successful task run. Marks
 *   `consumedAmount` as spent and refunds the remainder of the reservation
 *   back to the requester (or marks it recyclable), atomically on-chain.
 * releaseReservation: called when a task fails validation/execution before
 *   any work was done, returning the full reservation to the requester.
 */
const CREDIT_VAULT_SETTLE_ABI = [
  "function settleReservation(bytes32 reservationId, uint256 consumedAmount) returns (bool)",
  "function releaseReservation(bytes32 reservationId) returns (bool)"
];

export interface CreditSettlementDeps {
  /**
   * Signer authorized by the CreditVault to settle/release reservations on
   * this agent's behalf. This should be the agent's own operational key
   * (e.g. AGENT_CONTROLLER), loaded from a secrets manager or KMS in
   * production — never logged, never returned in any response, and never
   * a user's wallet key.
   */
  signer: Signer;
}

export interface SettlementOutcome {
  creditsConsumed: number;
  creditsReturned: number;
  settlementTxHash: string;
}

export class CreditSettlement {
  private readonly vaultWithSigner: Contract;

  constructor(
    private readonly config: AgentConfig,
    deps: CreditSettlementDeps
  ) {
    this.vaultWithSigner = new Contract(config.creditVaultAddress, CREDIT_VAULT_SETTLE_ABI, deps.signer);
  }

  /**
   * Settles a reservation after successful task execution: consumes exactly
   * the agent's price and returns the rest to the requester on-chain.
   */
  async settleConsumed(reservationId: string, consumedAmount: number, reservedAmount: number): Promise<SettlementOutcome> {
    const tx = await this.vaultWithSigner.settleReservation(reservationId, consumedAmount);
    const receipt = await tx.wait();

    return {
      creditsConsumed: consumedAmount,
      creditsReturned: Math.max(reservedAmount - consumedAmount, 0),
      settlementTxHash: receipt.hash
    };
  }

  /**
   * Releases a reservation in full — used when a request fails validation
   * or execution and no credits should be charged.
   */
  async releaseFull(reservationId: string, reservedAmount: number): Promise<SettlementOutcome> {
    const tx = await this.vaultWithSigner.releaseReservation(reservationId);
    const receipt = await tx.wait();

    return {
      creditsConsumed: 0,
      creditsReturned: reservedAmount,
      settlementTxHash: receipt.hash
    };
  }
}
