import { z } from "zod";
import { isAddress } from "ethers";
import { AgentConfig, MONAD_TESTNET_NETWORK_ID, RunTaskRequestBody, TaskValidationError } from "../types";

const evmAddressSchema = z
  .string()
  .refine((val) => isAddress(val), { message: "must be a valid EVM address" });

const txHashSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, "must be a 32-byte hex transaction hash");

const paymentSchema = z.object({
  vault: evmAddressSchema,
  reservationId: z
    .string()
    .min(1, "reservationId is required")
    .regex(/^0x[a-fA-F0-9]+$/, "reservationId must be a hex string"),
  amount: z.number().positive("amount must be greater than zero"),
  transactionHash: txHashSchema
});

/**
 * Builds a Zod schema bound to this agent's configuration so that
 * maxTaskSize is enforced structurally rather than as an afterthought.
 */
export function buildRunRequestSchema(config: AgentConfig) {
  return z.object({
    task: z
      .string()
      .min(1, "task is required")
      .max(config.maxTaskSizeBytes, `task exceeds maximum size of ${config.maxTaskSizeBytes} bytes`),
    agentId: z.string().min(1, "agentId is required"),
    requester: evmAddressSchema,
    network: z.string().min(1, "network is required"),
    payment: paymentSchema
  });
}

export interface ValidationResult {
  ok: boolean;
  data?: RunTaskRequestBody;
  error?: string;
}

/**
 * Validates a raw /run request body against structural rules AND
 * agent-specific business rules (agentId match, network match).
 * Does NOT validate payment state on-chain — that is CreditVerifier's job.
 */
export function validateRunRequest(body: unknown, config: AgentConfig): ValidationResult {
  const schema = buildRunRequestSchema(config);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const path = firstIssue.path.join(".");
    const message = path ? `${path}: ${firstIssue.message}` : firstIssue.message;
    return { ok: false, error: message };
  }

  const data = parsed.data as RunTaskRequestBody;

  if (data.network !== MONAD_TESTNET_NETWORK_ID) {
    return {
      ok: false,
      error: `Unsupported network "${data.network}". Expected "${MONAD_TESTNET_NETWORK_ID}".`
    };
  }

  if (data.agentId !== config.agentId) {
    return {
      ok: false,
      error: `Request agentId "${data.agentId}" does not match this backend's agentId "${config.agentId}".`
    };
  }

  if (data.payment.vault.toLowerCase() !== config.creditVaultAddress.toLowerCase()) {
    return {
      ok: false,
      error: "Payment vault address does not match this agent's configured CreditVault."
    };
  }

  return { ok: true, data };
}

/**
 * Throwing variant for call sites that prefer exceptions over result objects.
 */
export function assertValidRunRequest(body: unknown, config: AgentConfig): RunTaskRequestBody {
  const result = validateRunRequest(body, config);
  if (!result.ok || !result.data) {
    throw new TaskValidationError(result.error ?? "Invalid request");
  }
  return result.data;
}
