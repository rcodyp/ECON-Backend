/**
 * Shared type definitions for the ECON ERC-8004 agent backend.
 */

export interface AgentConfig {
  agentId: string;
  agentName: string;
  agentDescription: string;
  agentController: string;
  monadRpcUrl: string;
  monadChainId: number;
  creditVaultAddress: string;
  econFrontendOrigin: string[];
  maxTaskSizeBytes: number;
  requestTimeoutMs: number;
  priceCredits: number;
  capabilities: string[];
  port: number;
  nodeEnv: string;
}

export const MONAD_TESTNET_NETWORK_ID = "eip155:10143";

export interface PaymentPayload {
  vault: string;
  reservationId: string;
  amount: number;
  transactionHash: string;
}

export interface RunTaskRequestBody {
  task: string;
  agentId: string;
  requester: string;
  network: string;
  payment: PaymentPayload;
}

export interface AgentMetadata {
  type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";
  name: string;
  description: string;
  services: Array<{
    name: string;
    endpoint: string;
    protocol: string;
    priceCredits: number;
  }>;
  capabilities: string[];
  supportedTrust: string[];
  network: string;
}

export interface HealthResponse {
  status: "online";
  agentId: string;
  network: string;
  capabilities: string[];
  priceCredits: number;
}

export interface RunSuccessResponse {
  success: true;
  agentId: string;
  requestId: string;
  status: "completed";
  result: Record<string, unknown>;
  creditsConsumed: number;
  creditsReturned: number;
  timestamp: string;
}

export interface RunFailureResponse {
  success: false;
  agentId: string;
  requestId: string;
  status: "failed";
  error: string;
  creditsConsumed: number;
  creditsReturned: number;
  timestamp: string;
}

export type RunResponse = RunSuccessResponse | RunFailureResponse;

/**
 * Result of validating a reservation/payment against the CreditVault
 * contract (or a trusted indexer that mirrors its state).
 */
export interface ReservationState {
  exists: boolean;
  agentId: string;
  requester: string;
  amount: number;
  consumed: boolean;
  released: boolean;
  expiresAt: number; // unix seconds
}

export class TaskValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskValidationError";
  }
}

export class PaymentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentValidationError";
  }
}

export class DuplicateRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateRequestError";
  }
}
