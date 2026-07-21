import { describe, expect, it } from "vitest";
import { SyncExecutionCoordinator } from "../SyncExecutionCoordinator";

describe("SyncExecutionCoordinator", () => {
  it("hace single-flight y excluye mutuamente assets y bots", () => {
    const coordinator = new SyncExecutionCoordinator();
    const bot = coordinator.tryAcquire("bot_only");
    expect(bot).not.toBeNull();
    expect(coordinator.tryAcquire("bot_only")).toBeNull();
    expect(coordinator.tryAcquire("market_assets")).toBeNull();

    bot?.release();
    const assets = coordinator.tryAcquire("market_assets");
    expect(assets).not.toBeNull();
    expect(coordinator.tryAcquire("bot_only")).toBeNull();
    assets?.release();
  });
});
