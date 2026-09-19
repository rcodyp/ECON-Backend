import { describe, expect, it } from "vitest";
import { IdempotencyStore } from "../../src/store/IdempotencyStore";
import { RunFailureResponse } from "../../src/types";

describe("IdempotencyStore", () => {
  it("allows the first claim on a reservationId", () => {
    const store = new IdempotencyStore();
    expect(store.claim("res-1")).toBe(true);
  });

  it("rejects a second claim while the first is in-flight", () => {
    const store = new IdempotencyStore();
    store.claim("res-1");
    expect(store.claim("res-1")).toBe(false);
    expect(store.isInFlight("res-1")).toBe(true);
  });

  it("returns the stored response for a completed reservation", () => {
    const store = new IdempotencyStore();
    store.claim("res-1");
    const response: RunFailureResponse = {
      success: false,
      agentId: "123",
      requestId: "req-1",
      status: "failed",
      error: "boom",
      creditsConsumed: 0,
      creditsReturned: 5,
      timestamp: new Date().toISOString()
    };
    store.complete("res-1", response);
    expect(store.getCompleted("res-1")).toEqual(response);
    expect(store.isInFlight("res-1")).toBe(false);
  });

  it("allows a fresh claim after release", () => {
    const store = new IdempotencyStore();
    store.claim("res-1");
    store.release("res-1");
    expect(store.claim("res-1")).toBe(true);
  });

  it("does not confuse different reservationIds", () => {
    const store = new IdempotencyStore();
    store.claim("res-1");
    expect(store.claim("res-2")).toBe(true);
    expect(store.size()).toBe(2);
  });
});
