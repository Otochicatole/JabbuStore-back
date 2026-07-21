import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import Database from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let databaseDirectory = "";
let previousDatabaseUrl: string | undefined;
let prisma: PrismaClient;
let repository: import("../PrismaMarketSyncRunRepository").PrismaMarketSyncRunRepository;

const stateKey = "global-market-assets";

async function createSchema(databasePath: string): Promise<void> {
  const database = new Database(databasePath);
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE "MarketSyncState" (
      "key" TEXT NOT NULL PRIMARY KEY,
      "queueVersion" TEXT NOT NULL,
      "cursorIndex" INTEGER NOT NULL DEFAULT 0,
      "lastRowsUsed" INTEGER NOT NULL DEFAULT 0,
      "lastCandidatesVisited" INTEGER NOT NULL DEFAULT 0,
      "lastError" TEXT,
      "lastStartedAt" DATETIME,
      "lastFinishedAt" DATETIME,
      "snapshotHash" TEXT,
      "rawAssetCount" INTEGER NOT NULL DEFAULT 0,
      "validAssetCount" INTEGER NOT NULL DEFAULT 0,
      "skippedAssetCount" INTEGER NOT NULL DEFAULT 0,
      "publishedListingCount" INTEGER NOT NULL DEFAULT 0,
      "publishedFloatCount" INTEGER NOT NULL DEFAULT 0,
      "lastDownloadedAt" DATETIME,
      "lastPublishedAt" DATETIME,
      "currentPhase" TEXT,
      "targetAssets" INTEGER NOT NULL DEFAULT 0,
      "assetsPerItem" INTEGER NOT NULL DEFAULT 0,
      "totalCandidates" INTEGER NOT NULL DEFAULT 0,
      "currentCandidate" TEXT,
      "quotaUnitsUsed" INTEGER NOT NULL DEFAULT 0,
      "quotaLimit" INTEGER NOT NULL DEFAULT 0,
      "quotaResetsAt" DATETIME,
      "completionReason" TEXT,
      "lastPublishedSnapshotHash" TEXT,
      "lastPublishedRawAssetCount" INTEGER NOT NULL DEFAULT 0,
      "lastPublishedValidAssetCount" INTEGER NOT NULL DEFAULT 0,
      "lastPublishedSkippedAssetCount" INTEGER NOT NULL DEFAULT 0,
      "lastPublishedListingCount" INTEGER NOT NULL DEFAULT 0,
      "lastPublishedFloatCount" INTEGER NOT NULL DEFAULT 0,
      "lastSuccessfulAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    );
  `);
  const telemetryMigration = await readFile(
    path.resolve(
      process.cwd(),
      "prisma/migrations/20260721200000_market_sync_run_telemetry/migration.sql",
    ),
    "utf8",
  );
  const latencyMigration = await readFile(
    path.resolve(
      process.cwd(),
      "prisma/migrations/20260721210000_market_asset_candidate_history_latency/migration.sql",
    ),
    "utf8",
  );
  database.exec(telemetryMigration);
  database.exec(latencyMigration);
  database.close();
}

function startInput(recoveryRequested = false) {
  return {
    stateKey,
    triggeredBy: recoveryRequested ? "scheduler-resume" : "manual",
    phase: "building_priority_queue",
    targetAssets: 10_000,
    assetsPerItem: 10,
    configuredConcurrency: 3,
    recoveryRequested,
    recoveryKind: recoveryRequested ? "checkpoint" : "none",
  };
}

describe("PrismaMarketSyncRunRepository durable SQLite lifecycle", () => {
  beforeAll(async () => {
    databaseDirectory = await mkdtemp(
      path.join(tmpdir(), "jabbu-market-sync-run-"),
    );
    const databasePath = path.join(databaseDirectory, "market-sync.db");
    await createSchema(databasePath);
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = `file:${databasePath.replace(/\\/g, "/")}`;
    delete (globalThis as typeof globalThis & { __jabbuPrisma?: PrismaClient })
      .__jabbuPrisma;
    vi.resetModules();

    ({ prisma } = await import("../../../../shared/infrastructure/PrismaClient"));
    const { PrismaMarketSyncRunRepository } = await import(
      "../PrismaMarketSyncRunRepository"
    );
    repository = new PrismaMarketSyncRunRepository();
  });

  beforeEach(async () => {
    await prisma.marketAssetCandidateHistory.deleteMany();
    await prisma.marketSyncPhaseMetric.deleteMany();
    await prisma.marketSyncRun.deleteMany();
    await prisma.marketSyncState.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    delete (globalThis as typeof globalThis & { __jabbuPrisma?: PrismaClient })
      .__jabbuPrisma;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (databaseDirectory) {
      await rm(databaseDirectory, { recursive: true, force: true });
    }
  });

  it("conserva id al pausar/reanudar, acumula fases y completa los punteros", async () => {
    const started = await repository.startAttempt(startInput());

    await prisma.marketSyncRun.update({
      where: { id: started.id },
      data: {
        metricsFlushedAt: new Date(Date.now() - 2_000),
        phaseStartedAt: new Date(Date.now() - 2_000),
      },
    });
    await repository.recordProgress(stateKey, {
      phase: "collecting_assets",
      totalCandidates: 2_000,
      candidatesVisited: 20,
      rawAssetCount: 200,
      validAssetCount: 150,
      skippedAssetCount: 50,
    });

    await prisma.marketSyncRun.update({
      where: { id: started.id },
      data: { metricsFlushedAt: new Date(Date.now() - 1_000) },
    });
    await repository.recordTelemetry(stateKey, {
      pageRequests: 3,
      httpAttempts: 4,
      httpSucceeded: 3,
      httpFailed: 1,
      retryCount: 1,
      timeoutCount: 1,
      emptyResponseCount: 1,
      notFoundCount: 1,
      rateLimitedCount: 1,
      quotaWaitCount: 1,
      quotaWaitDurationMs: 60_000,
      retryBackoffDurationMs: 1_500,
      requestLatenciesMs: [100, 500, 2_000, 5_000, 20_000, 40_000],
      runQuotaUnitsUsed: 30,
      creditsUsed: 1.25,
      currentConcurrency: 2,
      minimumConcurrencyUsed: 2,
      peakInFlight: 3,
      concurrencyReductionCount: 1,
      deferredCandidateCount: 4,
    });

    const withTelemetry = await repository.getCurrentOrLast(stateKey);
    expect(withTelemetry).toMatchObject({
      id: started.id,
      status: "running",
      currentPhase: "collecting_assets",
      pageRequests: 3,
      httpAttempts: 4,
      httpSucceeded: 3,
      httpFailed: 1,
      retryCount: 1,
      timeoutCount: 1,
      emptyResponseCount: 1,
      notFoundCount: 1,
      rateLimitedCount: 1,
      quotaWaitCount: 1,
      quotaWaitDurationMs: 60_000,
      retryBackoffDurationMs: 1_500,
      latencySampleCount: 6,
      latencyTotalMs: 67_600,
      latencyMaximumMs: 40_000,
      latencyLe250Count: 1,
      latencyLe1000Count: 1,
      latencyLe3000Count: 1,
      latencyLe10000Count: 1,
      latencyLe30000Count: 1,
      latencyGt30000Count: 1,
      runQuotaUnitsUsed: 30,
      creditsUsed: 1.25,
      configuredConcurrency: 3,
      currentConcurrency: 2,
      minimumConcurrencyUsed: 2,
      peakInFlight: 3,
      concurrencyReductionCount: 1,
      deferredCandidateCount: 4,
    });

    await prisma.marketSyncRun.update({
      where: { id: started.id },
      data: { metricsFlushedAt: new Date(Date.now() - 1_000) },
    });
    await repository.finishAttempt(stateKey, {
      error: "timeout recuperable",
      resumable: true,
    });
    const paused = await repository.getCurrentOrLast(stateKey);
    expect(paused).toMatchObject({
      id: started.id,
      status: "paused",
      currentPhase: "paused",
      attemptCount: 1,
      lastError: "timeout recuperable",
    });

    await prisma.marketSyncRun.update({
      where: { id: started.id },
      data: {
        latestAttemptFinishedAt: new Date(Date.now() - 3_000),
        lastHeartbeatAt: new Date(Date.now() - 3_000),
      },
    });
    const resumed = await repository.startAttempt(startInput(true));
    expect(resumed).toMatchObject({
      id: started.id,
      status: "running",
      attemptCount: 2,
      latestTriggeredBy: "scheduler-resume",
    });
    expect(resumed.pausedDurationMs).toBeGreaterThanOrEqual(2_900);

    await prisma.marketSyncRun.update({
      where: { id: started.id },
      data: { metricsFlushedAt: new Date(Date.now() - 1_500) },
    });
    await repository.recordProgress(stateKey, {
      phase: "validating_snapshot",
      validAssetCount: 10_000,
    });
    await prisma.marketSyncState.update({
      where: { key: stateKey },
      data: {
        totalCandidates: 2_000,
        lastCandidatesVisited: 1_100,
        rawAssetCount: 10_500,
        validAssetCount: 10_000,
        skippedAssetCount: 500,
        publishedListingCount: 1_000,
        publishedFloatCount: 10_000,
        snapshotHash: "a".repeat(64),
      },
    });
    await repository.complete(stateKey, { completionReason: "target_reached" });

    const state = await prisma.marketSyncState.findUniqueOrThrow({
      where: { key: stateKey },
    });
    expect(state).toMatchObject({ activeRunId: null, lastRunId: started.id });
    const completed = await repository.getCurrentOrLast(stateKey);
    expect(completed).toMatchObject({
      id: started.id,
      status: "completed",
      currentPhase: "completed",
      attemptCount: 2,
      totalCandidates: 2_000,
      candidatesVisited: 1_100,
      rawAssetCount: 10_500,
      validAssetCount: 10_000,
      skippedAssetCount: 500,
      publishedListingCount: 1_000,
      publishedFloatCount: 10_000,
      snapshotHash: "a".repeat(64),
      completionReason: "target_reached",
    });
    expect(completed!.activeDurationMs).toBeGreaterThanOrEqual(5_000);

    const phases = new Map(
      completed!.phases.map((phase) => [phase.phase, phase]),
    );
    expect(phases.get("building_priority_queue")).toMatchObject({
      entryCount: 2,
    });
    expect(phases.get("building_priority_queue")!.durationMs).toBeGreaterThanOrEqual(
      3_300,
    );
    expect(phases.get("collecting_assets")!.durationMs).toBeGreaterThanOrEqual(
      1_900,
    );
    expect(phases.has("paused")).toBe(true);
    expect(phases.has("validating_snapshot")).toBe(true);
    expect(phases.has("completed")).toBe(true);
  });

  it("serializa mutaciones concurrentes sin perder incrementos", async () => {
    await repository.startAttempt(startInput());
    const mutationCount = 40;

    await Promise.all(
      Array.from({ length: mutationCount }, () =>
        repository.recordTelemetry(stateKey, {
          pageRequests: 1,
          httpAttempts: 1,
          httpSucceeded: 1,
          retryCount: 1,
          quotaWaitCount: 1,
          quotaWaitDurationMs: 3,
          retryBackoffDurationMs: 2,
          requestLatenciesMs: [10],
          runQuotaUnitsUsed: 2,
          creditsUsed: 0.1,
          currentConcurrency: 2,
          minimumConcurrencyUsed: 2,
          peakInFlight: 3,
          concurrencyReductionCount: 1,
        }),
      ),
    );

    const run = await repository.getCurrentOrLast(stateKey);
    expect(run).toMatchObject({
      pageRequests: mutationCount,
      httpAttempts: mutationCount,
      httpSucceeded: mutationCount,
      retryCount: mutationCount,
      quotaWaitCount: mutationCount,
      quotaWaitDurationMs: mutationCount * 3,
      retryBackoffDurationMs: mutationCount * 2,
      latencySampleCount: mutationCount,
      latencyTotalMs: mutationCount * 10,
      latencyMaximumMs: 10,
      runQuotaUnitsUsed: mutationCount * 2,
      currentConcurrency: 2,
      minimumConcurrencyUsed: 2,
      peakInFlight: 3,
      concurrencyReductionCount: mutationCount,
    });
    expect(run!.creditsUsed).toBeCloseTo(mutationCount * 0.1, 8);
  });
});
