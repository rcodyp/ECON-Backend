import { JsonRpcProvider, Contract, TransactionReceipt } from "ethers";
import { AgentConfig, PaymentPayload, PaymentValidationError, ReservationState } from "../types";

/**
 * Minimal CreditVault ABI required for read-only reservation verification.
 *
 * IMPORTANT: This ABI is a documented assumption about the ECON CreditVault
 * contract's interface. Replace it with the real deployed ABI before going
 * to production — do not assume these exact signatures are correct for the
 * live contract without checking against the ECON CreditVault source/ABI.
 *
 * Expected semantics:
 *   getReservation(reservationId) -> struct with:
 *     agentId    (string)   the agent the credits were reserved for
 *     requester  (address)  the wallet that made the reservation
 *     amount     (uint256)  credits reserved
 *     consumed   (bool)     whether the reservation was already settled
 *     released   (bool)     whether the reservation was released/refunded
 *     expiresAt  (uint256)  unix timestamp after which the reservation is dead
 */
const CREDIT_VAULT_ABI = [
  "function getReservation(bytes32 reservationId) view returns (string agentId, address requester, uint256 amount, bool consumed, bool released, uint256 expiresAt)"
];

export interface CreditVerifierDeps {
  provider: JsonRpcProvider;
  vaultContract: Contract;
}

/**
 * Builds live ethers.js dependencies from config. Kept separate from the
 * verifier logic so tests can inject fakes instead of hitting a real RPC.
 */
export function createCreditVerifierDeps(config: AgentConfig): CreditVerifierDeps {
  const provider = new JsonRpcProvider(config.monadRpcUrl, config.monadChainId);
  const vaultContract = new Contract(config.creditVaultAddress, CREDIT_VAULT_ABI, provider);
  return { provider, vaultContract };
}

export class CreditVerifier {
  constructor(
    private readonly config: AgentConfig,
    private readonly deps: CreditVerifierDeps
  ) {}

  /**
   * Reads the current on-chain state of a reservation. Never trusts
   * anything the client sent about balances — this is the source of truth.
   */
  async getReservationState(reservationId: string): Promise<ReservationState> {
    try {
      const result = await this.deps.vaultContract.getReservation(reservationId);
      const [agentId, requester, amount, consumed, released, expiresAt] = result;

      const exists = requester !== "0x0000000000000000000000000000000000000000" && agentId !== "";

      return {
        exists,
        agentId,
        requester,
        amount: Number(amount),
        consumed,
        released,
        expiresAt: Number(expiresAt)
      };
    } catch (err) {
      throw new PaymentValidationError(
        `Failed to read reservation "${reservationId}" from CreditVault: ${(err as Error).message}`
      );
    }
  }

  /**
   * Confirms the transaction hash actually exists on Monad Testnet, was
   * successful, and was sent to the configured CreditVault address.
   */
  async verifyTransaction(transactionHash: string): Promise<TransactionReceipt> {
    const receipt = await this.deps.provider.getTransactionReceipt(transactionHash);

    if (!receipt) {
      throw new PaymentValidationError(
        `Transaction "${transactionHash}" was not found on-chain (not yet mined or invalid hash).`
      );
    }

    if (receipt.status !== 1) {
      throw new PaymentValidationError(`Transaction "${transactionHash}" reverted on-chain.`);
    }

    if (receipt.to?.toLowerCase() !== this.config.creditVaultAddress.toLowerCase()) {
      throw new PaymentValidationError(
        `Transaction "${transactionHash}" was not sent to the configured CreditVault address.`
      );
    }

    return receipt;
  }

  /**
   * Full verification pipeline for a /run request's payment payload:
   *   1. The reservation must exist on-chain.
   *   2. It must belong to this agent and this requester.
   *   3. It must not already be consumed or released.
   *   4. It must not be expired.
   *   5. The reserved amount must cover the agent's price.
   *   6. The settling transaction must be a real, successful, on-chain tx
   *      sent to this agent's CreditVault.
   *
   * Throws PaymentValidationError with a human-readable reason on any failure.
   */
  async verifyPayment(payment: PaymentPayload, requester: string): Promise<ReservationState> {
    if (payment.vault.toLowerCase() !== this.config.creditVaultAddress.toLowerCase()) {
      throw new PaymentValidationError("Payment vault does not match this agent's CreditVault.");
    }

    const reservation = await this.getReservationState(payment.reservationId);

    if (!reservation.exists) {
      throw new PaymentValidationError(`Reservation "${payment.reservationId}" does not exist.`);
    }

    if (reservation.agentId !== this.config.agentId) {
      throw new PaymentValidationError("Reservation was made for a different agent.");
    }

    if (reservation.requester.toLowerCase() !== requester.toLowerCase()) {
      throw new PaymentValidationError("Reservation requester does not match the request sender.");
    }

    if (reservation.consumed) {
      throw new PaymentValidationError("Reservation has already been consumed.");
    }

    if (reservation.released) {
      throw new PaymentValidationError("Reservation has already been released.");
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (reservation.expiresAt !== 0 && reservation.expiresAt < nowSeconds) {
      throw new PaymentValidationError("Reservation has expired.");
    }

    if (reservation.amount < this.config.priceCredits) {
      throw new PaymentValidationError(
        `Reserved amount (${reservation.amount}) is insufficient for this agent's price (${this.config.priceCredits}).`
      );
    }

    if (payment.amount < this.config.priceCredits) {
      throw new PaymentValidationError(
        `Requested payment amount (${payment.amount}) is insufficient for this agent's price (${this.config.priceCredits}).`
      );
    }

    await this.verifyTransaction(payment.transactionHash);

    return reservation;
  }
}
