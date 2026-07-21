import { describe, expect, it, vi } from "vitest";
import { MarketController } from "../../infrastructure/MarketController";

function responseDouble() {
  const response: any = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return response;
}

const completed = {
  listings: 1,
  floats: 10,
  rawAssets: 10,
  validAssets: 10,
  skippedAssets: 0,
  snapshotHash: "a".repeat(64),
  fetchedAt: new Date(0).toISOString(),
  completionReason: "catalog_exhausted" as const,
  recoveredSnapshot: false,
};

describe("MarketController.triggerSync", () => {
  it("responde 202 cuando adquiere el single-flight", async () => {
    const execution = Promise.resolve(completed);
    const run = { tryStart: vi.fn(() => ({ started: true, execution })) };
    const status = { execute: vi.fn() };
    const controller = new MarketController({} as any, run as any, status as any, {} as any);
    const res = responseDouble();

    await controller.triggerSync({} as any, res);
    await execution;

    expect(res.statusCode).toBe(202);
    expect(res.body).toMatchObject({
      started: true,
      statusUrl: "/api/market/sync/status",
    });
  });

  it("responde 409 con el estado vigente cuando ya está ocupado", async () => {
    const execution = Promise.resolve(completed);
    const run = {
      tryStart: vi.fn(() => ({
        started: false,
        execution,
        blockingReason: "market_assets",
      })),
    };
    const current = { running: true, phase: "collecting_assets" };
    const status = { execute: vi.fn(async () => current) };
    const controller = new MarketController({} as any, run as any, status as any, {} as any);
    const res = responseDouble();

    await controller.triggerSync({} as any, res);

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ started: false, status: current });
  });

  it("informa bloqueo bot-only sin adjuntar status de assets", async () => {
    const run = {
      tryStart: vi.fn(() => ({
        started: false,
        execution: null,
        blockingReason: "bot_only",
      })),
    };
    const status = { execute: vi.fn() };
    const controller = new MarketController(
      {} as any,
      run as any,
      status as any,
      {} as any,
    );
    const res = responseDouble();

    await controller.triggerSync({} as any, res);

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      started: false,
      blockingJob: "bot_only",
    });
    expect(res.body).not.toHaveProperty("status");
    expect(status.execute).not.toHaveBeenCalled();
  });
});
