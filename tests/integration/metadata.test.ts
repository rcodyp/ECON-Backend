import { describe, expect, it } from "vitest";
import request from "supertest";
import { buildTestApp } from "./testApp";

describe("GET /metadata", () => {
  it("returns valid ERC-8004 registration-v1 metadata", async () => {
    const { app, config } = buildTestApp();
    const res = await request(app).get("/metadata");

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("https://eips.ethereum.org/EIPS/eip-8004#registration-v1");
    expect(res.body.name).toBe(config.agentName);
    expect(res.body.description).toBe(config.agentDescription);
    expect(res.body.network).toBe("eip155:10143");
    expect(res.body.capabilities).toEqual(config.capabilities);
    expect(res.body.supportedTrust).toEqual(["reputation", "crypto-economic"]);
    expect(res.body.services).toEqual([
      {
        name: "task execution",
        endpoint: "https://agent.example.com/run",
        protocol: "HTTP POST",
        priceCredits: config.priceCredits
      }
    ]);
  });
});
