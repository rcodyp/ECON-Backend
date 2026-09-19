import { describe, expect, it } from "vitest";
import request from "supertest";
import { buildTestApp } from "./testApp";

describe("GET /health", () => {
  it("returns online status with agent metadata basics", async () => {
    const { app, config } = buildTestApp();
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "online",
      agentId: config.agentId,
      network: "eip155:10143",
      capabilities: config.capabilities,
      priceCredits: config.priceCredits
    });
  });
});
