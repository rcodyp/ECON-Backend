import { RunResponse } from "../types";

interface IdempotencyRecord {
  status: "in-flight" | "completed";
  response?: RunResponse;
  createdAt: number;
}

/**
 * Prevents a single reservationId from being consumed more than once.
 *
 * This in-memory implementation is sufficient for a single-instance
 * deployment. For multi-instance / horizontally scaled deployments, back
 * this with Redis (SETNX on reservationId) or a database unique constraint
 * on reservationId so idempotency holds across processes.
 */
export class IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();

  /**
   * Atomically claims a reservationId for processing. Returns false if it
   * was already claimed (in-flight or completed) by an earlier request.
   */
  claim(reservationId: string): boolean {
    if (this.records.has(reservationId)) {
      return false;
    }
    this.records.set(reservationId, { status: "in-flight", createdAt: Date.now() });
    return true;
  }

  complete(reservationId: string, response: RunResponse): void {
    this.records.set(reservationId, {
      status: "completed",
      response,
      createdAt: Date.now()
    });
  }

  /**
   * Releases a claim without recording a completed response — used when a
   * request fails validation before any credits were touched, so a
   * legitimate retry with the same reservationId is not permanently blocked.
   */
  release(reservationId: string): void {
    this.records.delete(reservationId);
  }

  getCompleted(reservationId: string): RunResponse | undefined {
    const record = this.records.get(reservationId);
    return record?.status === "completed" ? record.response : undefined;
  }

  isInFlight(reservationId: string): boolean {
    return this.records.get(reservationId)?.status === "in-flight";
  }

  size(): number {
    return this.records.size;
  }
}
