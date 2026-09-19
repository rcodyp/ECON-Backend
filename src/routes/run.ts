import { randomUUID } from "crypto";
import { Router, Request, Response } from "express";
import { AgentConfig, PaymentValidationError, RunFailureResponse, RunSuccessResponse } from "../types";
import { validateRunRequest } from "../agent/TaskValidator";
import { AgentRuntime } from "../agent/AgentRuntime";
import { CreditVerifier } from "../credits/CreditVerifier";
import { CreditSettlement } from "../credits/CreditSettlement";
import { IdempotencyStore } from "../store/IdempotencyStore";
import { logRunOutcome, logger } from "../logger";
import { runRateLimiter } from "../middleware/rateLimit";

export interface RunRouteDeps {
  config: AgentConfig;
  runtime: AgentRuntime;
  verifier: CreditVerifier;
  settlement: CreditSettlement;
  idempotencyStore: IdempotencyStore;
}

class ExecutionTimeoutError extends Error {
  constructor() {
    super("Task execution exceeded the configured timeout.");
    this.name = "ExecutionTimeoutError";
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ExecutionTimeoutError()), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function failureResponse(
  agentId: string,
  requestId: string,
  error: string,
  creditsReturned: number
): RunFailureResponse {
  return {
    success: false,
    agentId,
    requestId,
    status: "failed",
    error,
    creditsConsumed: 0,
    creditsReturned,
    timestamp: new Date().toISOString()
  };
}

export function buildRunRouter(deps: RunRouteDeps): Router {
  const router = Router();
  const { config, runtime, verifier, settlement, idempotencyStore } = deps;

  router.post("/run", runRateLimiter, async (req: Request, res: Response) => {
    const requestId = randomUUID();

    // 1. Structural + business-rule validation (task present, valid EVM
    //    address, correct network, matching agentId, vault address match).
    const validation = validateRunRequest(req.body, config);
    if (!validation.ok || !validation.data) {
      const response = failureResponse(config.agentId, requestId, validation.error ?? "Invalid request", 0);
      logRunOutcome({
        requestId,
        wallet: typeof req.body?.requester === "string" ? req.body.requester : "unknown",
        agentId: config.agentId,
        status: "failed",
        creditsConsumed: 0,
        creditsReturned: 0
      });
      res.status(400).json(response);
      return;
    }

    const body = validation.data;
    const { reservationId } = body.payment;

    // 2. Idempotency: has this exact reservation already been processed or
    //    is it currently being processed by a concurrent request?
    const alreadyCompleted = idempotencyStore.getCompleted(reservationId);
    if (alreadyCompleted) {
      res.status(200).json(alreadyCompleted);
      return;
    }
    if (!idempotencyStore.claim(reservationId)) {
      res.status(409).json(
        failureResponse(config.agentId, requestId, "This reservation is already being processed.", 0)
      );
      return;
    }

    try {
      // 3. Verify payment/reservation state against the CreditVault
      //    contract. Never trust client-provided balances.
      let reservation;
      try {
        reservation = await verifier.verifyPayment(body.payment, body.requester);
      } catch (err) {
        idempotencyStore.release(reservationId);
        const message = err instanceof PaymentValidationError ? err.message : "Payment verification failed.";
        const response = failureResponse(config.agentId, requestId, message, 0);
        logRunOutcome({
          requestId,
          wallet: body.requester,
          agentId: config.agentId,
          status: "failed",
          creditsConsumed: 0,
          creditsReturned: 0
        });
        res.status(402).json(response);
        return;
      }

      // 4. Execute the task, bounded by REQUEST_TIMEOUT_MS.
      try {
        const { result } = await withTimeout(runtime.execute(body.task), config.requestTimeoutMs);

        // 5. Settle: consume this agent's price, return any surplus.
        const outcome = await settlement.settleConsumed(reservationId, config.priceCredits, reservation.amount);

        const successResponse: RunSuccessResponse = {
          success: true,
          agentId: config.agentId,
          requestId,
          status: "completed",
          result,
          creditsConsumed: outcome.creditsConsumed,
          creditsReturned: outcome.creditsReturned,
          timestamp: new Date().toISOString()
        };

        idempotencyStore.complete(reservationId, successResponse);
        logRunOutcome({
          requestId,
          wallet: body.requester,
          agentId: config.agentId,
          status: "completed",
          creditsConsumed: outcome.creditsConsumed,
          creditsReturned: outcome.creditsReturned
        });
        res.status(200).json(successResponse);
        return;
      } catch (executionErr) {
        // 6. Execution failed or timed out after a valid reservation was
        //    confirmed: release the full reservation back to the requester.
        const releaseOutcome = await settlement.releaseFull(reservationId, reservation.amount);
        const message =
          executionErr instanceof ExecutionTimeoutError
            ? "Task execution timed out."
            : `Task execution failed: ${(executionErr as Error).message}`;

        const response: RunFailureResponse = {
          success: false,
          agentId: config.agentId,
          requestId,
          status: "failed",
          error: message,
          creditsConsumed: 0,
          creditsReturned: releaseOutcome.creditsReturned,
          timestamp: new Date().toISOString()
        };

        idempotencyStore.complete(reservationId, response);
        logRunOutcome({
          requestId,
          wallet: body.requester,
          agentId: config.agentId,
          status: "failed",
          creditsConsumed: 0,
          creditsReturned: releaseOutcome.creditsReturned
        });

        const statusCode = executionErr instanceof ExecutionTimeoutError ? 504 : 500;
        res.status(statusCode).json(response);
        return;
      }
    } catch (unexpected) {
      // Safety net: never leave a claimed reservation stuck as in-flight
      // forever if something above threw outside the inner try/catches.
      idempotencyStore.release(reservationId);
      logger.error({ requestId, err: (unexpected as Error).message }, "unexpected error in /run");
      res
        .status(500)
        .json(failureResponse(config.agentId, requestId, "Internal server error.", 0));
    }
  });

  return router;
}
