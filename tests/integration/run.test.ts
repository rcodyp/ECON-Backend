import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { buildTestApp } from "./testApp";
import { buildValidRunBody, TEST_REQUESTER } from "../testUtils";
import { PaymentValidationError } from "../../src/types";

describe("POST /run", () => {
  it("succeeds for a valid task with a verified reservation", async () => {
    const { app } = buildTestApp();
    const res = await request(app).post("/run").send(buildValidRunBody());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe("completed");
    expect(res.body.creditsConsumed).toBe(5);
    expect(res.body.creditsReturned).toBe(0);
    expect(res.body.result).toEqual({ echoed: "Analyze this dataset" });
    expect(typeof res.body.requestId).toBe("string");
  });

  it("rejects a request with a missing task (validation failure)", async () => {
    const { app } = buildTestApp();
    const res = await request(app).post("/run").send(buildValidRunBody({ task: "" }));

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.creditsConsumed).toBe(0);
    expect(res.body.creditsReturned).toBe(0);
    expect(res.body.error).toMatch(/task/i);
  });

  it("rejects a request with an invalid requester address", async () => {
    const { app } = buildTestApp();
    const res = await request(app).post("/run").send(buildValidRunBody({ requester: "not-an-address" }));

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("rejects a request for the wrong network", async () => {
    const { app } = buildTestApp();
    const res = await request(app).post("/run").send(buildValidRunBody({ network: "eip155:1" }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unsupported network/);
  });

  it("rejects a request for a mismatched agentId", async () => {
    const { app } = buildTestApp();
    const res = await request(app).post("/run").send(buildValidRunBody({ agentId: "999" }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not match/);
  });

  it("rejects invalid/expired payment and returns no credits (none were confirmed)", async () => {
    const { app, verifyPaymentMock } = buildTestApp();
    verifyPaymentMock.mockRejectedValueOnce(new PaymentValidationError("Reservation has expired."));

    const res = await request(app).post("/run").send(buildValidRunBody());

    expect(res.status).toBe(402);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/expired/);
    expect(res.body.creditsConsumed).toBe(0);
    expect(res.body.creditsReturned).toBe(0);
  });

  it("rejects insufficient reserved credits", async () => {
    const { app, verifyPaymentMock } = buildTestApp();
    verifyPaymentMock.mockRejectedValueOnce(
      new PaymentValidationError("Reserved amount (1) is insufficient for this agent's price (5).")
    );

    const res = await request(app).post("/run").send(buildValidRunBody());

    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/insufficient/i);
    expect(res.body.creditsConsumed).toBe(0);
    expect(res.body.creditsReturned).toBe(0);
  });

  it("releases credits in full when task execution fails after a valid reservation", async () => {
    const { app, executeMock } = buildTestApp();
    executeMock.mockRejectedValueOnce(new Error("downstream model call failed"));

    const res = await request(app).post("/run").send(buildValidRunBody());

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.creditsConsumed).toBe(0);
    expect(res.body.creditsReturned).toBe(5);
    expect(res.body.error).toMatch(/execution failed/i);
  });

  it("times out long-running execution and releases credits", async () => {
    const { app, executeMock } = buildTestApp({ requestTimeoutMs: 50 });
    executeMock.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve({ result: {} }), 5000))
    );

    const res = await request(app).post("/run").send(buildValidRunBody());

    expect(res.status).toBe(504);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/timed out/i);
    expect(res.body.creditsConsumed).toBe(0);
    expect(res.body.creditsReturned).toBe(5);
  }, 10000);

  it("replays the stored result for a duplicate request with the same reservationId", async () => {
    const { app } = buildTestApp();
    const body = buildValidRunBody();

    const first = await request(app).post("/run").send(body);
    expect(first.status).toBe(200);

    const second = await request(app).post("/run").send(body);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  it("rejects a concurrent duplicate request for the same reservationId as in-flight", async () => {
    // Deterministically simulate "another request already claimed this
    // reservation and is still processing it" rather than racing real
    // timers against a pending promise, which is flaky under load.
    const { app, idempotencyStore } = buildTestApp();
    const body = buildValidRunBody();

    idempotencyStore.claim(body.payment.reservationId);

    const res = await request(app).post("/run").send(body);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already being processed/i);
    expect(res.body.creditsConsumed).toBe(0);
  });

  it("never trusts a client-asserted payment amount — settlement always uses the agent's configured price", async () => {
    // The client field `payment.amount` is advisory; a malicious or buggy
    // client could send any number here. What actually gets charged comes
    // from CreditVerifier's on-chain read and this agent's own priceCredits
    // config, never from this field directly.
    const { app, config } = buildTestApp();
    const res = await request(app).post("/run").send(buildValidRunBody({ payment: { amount: 999 } }));

    expect(res.status).toBe(200);
    expect(res.body.creditsConsumed).toBe(config.priceCredits);
    expect(res.body.creditsConsumed).not.toBe(999);
  });

  it("rejects a task larger than MAX_TASK_SIZE", async () => {
    const { app } = buildTestApp({ maxTaskSizeBytes: 20 });
    const res = await request(app).post("/run").send(buildValidRunBody({ task: "x".repeat(100) }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exceeds maximum size/i);
  });

  it("rejects requests from a non-approved CORS origin at the browser level", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/run")
      .set("Origin", "https://evil.example.com")
      .send(buildValidRunBody());

    // cors() surfaces this as an error the centralized handler turns into 403
    expect(res.status).toBe(403);
  });

  it("allows requests from the approved ECON frontend origin", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/run")
      .set("Origin", "https://econ.example.com")
      .send(buildValidRunBody());

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("https://econ.example.com");
  });

  it("echoes back X-Request-Id when provided by the client", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/health").set("X-Request-Id", "client-req-1");
    expect(res.headers["x-request-id"]).toBe("client-req-1");
  });
});
