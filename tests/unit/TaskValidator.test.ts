import { describe, expect, it } from "vitest";
import { validateRunRequest } from "../../src/agent/TaskValidator";
import { buildTestConfig, buildValidRunBody } from "../testUtils";

describe("TaskValidator", () => {
  const config = buildTestConfig();

  it("accepts a well-formed request", () => {
    const result = validateRunRequest(buildValidRunBody(), config);
    expect(result.ok).toBe(true);
    expect(result.data?.task).toBe("Analyze this dataset");
  });

  it("rejects a missing task", () => {
    const body = buildValidRunBody({ task: "" });
    const result = validateRunRequest(body, config);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/task/i);
  });

  it("rejects a task exceeding the configured max size", () => {
    const bigConfig = buildTestConfig({ maxTaskSizeBytes: 10 });
    const body = buildValidRunBody({ task: "x".repeat(50) });
    const result = validateRunRequest(body, bigConfig);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/exceeds maximum size/i);
  });

  it("rejects an invalid EVM requester address", () => {
    const body = buildValidRunBody({ requester: "not-an-address" });
    const result = validateRunRequest(body, config);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/requester/i);
  });

  it("rejects a network that is not Monad Testnet", () => {
    const body = buildValidRunBody({ network: "eip155:1" });
    const result = validateRunRequest(body, config);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Unsupported network/i);
  });

  it("rejects an agentId that does not match this backend", () => {
    const body = buildValidRunBody({ agentId: "999" });
    const result = validateRunRequest(body, config);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/does not match/i);
  });

  it("rejects a payment vault that does not match the configured CreditVault", () => {
    const body = buildValidRunBody({ payment: { vault: "0x" + "22".repeat(20) } });
    const result = validateRunRequest(body, config);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/vault/i);
  });

  it("rejects a malformed transaction hash", () => {
    const body = buildValidRunBody({ payment: { transactionHash: "0x1234" } });
    const result = validateRunRequest(body, config);
    expect(result.ok).toBe(false);
  });

  it("rejects a non-positive payment amount", () => {
    const body = buildValidRunBody({ payment: { amount: 0 } });
    const result = validateRunRequest(body, config);
    expect(result.ok).toBe(false);
  });
});
