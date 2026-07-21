import { prisma } from "../../../shared/infrastructure/PrismaClient";
import type {
  FinishMarketSyncRunInput,
  IMarketSyncRunRepository,
  MarketSyncRunProgress,
  MarketSyncRunRecord,
  MarketSyncRunStatus,
  MarketSyncTelemetryDelta,
  StartMarketSyncRunAttemptInput,
} from "../domain/MarketSyncRun";

function asNumber(value: bigint | number): number {
  return typeof value === "bigint" ? Number(value) : value;
}

function nonNegativeInteger(value: number | undefined): number {
  return value == null || !Number.isFinite(value)
    ? 0
    : Math.max(0, Math.trunc(value));
}

function durationSince(from: Date, to: Date): number {
  return Math.max(0, to.getTime() - from.getTime());
}

function mapRun(row: any): MarketSyncRunRecord {
  return {
    ...row,
    status: row.status as MarketSyncRunStatus,
    activeDurationMs: asNumber(row.activeDurationMs),
    pausedDurationMs: asNumber(row.pausedDurationMs),
    quotaWaitDurationMs: asNumber(row.quotaWaitDurationMs),
    retryBackoffDurationMs: asNumber(row.retryBackoffDurationMs),
    latencyTotalMs: asNumber(row.latencyTotalMs),
    phases: (row.phases ?? []).map((phase: any) => ({
      phase: phase.phase,
      durationMs: asNumber(phase.durationMs),
      entryCount: phase.entryCount,
      lastEnteredAt: phase.lastEnteredAt,
    })),
  };
}

function latencyCounters(values: readonly number[] | undefined) {
  const samples = (values ?? [])
    .filter((value) => Number.isFinite(value) && value >= 0)
    .map((value) => Math.round(value));
  return {
    count: samples.length,
    total: samples.reduce((total, value) => total + value, 0),
    maximum: samples.length > 0 ? Math.max(...samples) : 0,
    le250: samples.filter((value) => value <= 250).length,
    le1000: samples.filter((value) => value > 250 && value <= 1_000).length,
    le3000: samples.filter((value) => value > 1_000 && value <= 3_000).length,
    le10000: samples.filter((value) => value > 3_000 && value <= 10_000).length,
    le30000: samples.filter((value) => value > 10_000 && value <= 30_000).length,
    gt30000: samples.filter((value) => value > 30_000).length,
  };
}

export class PrismaMarketSyncRunRepository
  implements IMarketSyncRunRepository
{
  private mutationTail: Promise<void> = Promise.resolve();

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async flushActiveTime(tx: any, run: any, now: Date): Promise<void> {
    if (run.status !== "running") return;
    const elapsed = durationSince(run.metricsFlushedAt, now);
    if (elapsed > 0) {
      await tx.marketSyncPhaseMetric.upsert({
        where: { runId_phase: { runId: run.id, phase: run.currentPhase } },
        create: {
          runId: run.id,
          phase: run.currentPhase,
          durationMs: BigInt(elapsed),
          entryCount: 1,
          lastEnteredAt: run.phaseStartedAt,
        },
        update: { durationMs: { increment: BigInt(elapsed) } },
      });
    }
    await tx.marketSyncRun.update({
      where: { id: run.id },
      data: {
        activeDurationMs: { increment: BigInt(elapsed) },
        metricsFlushedAt: now,
        lastHeartbeatAt: now,
      },
    });
  }

  private async enterPhase(
    tx: any,
    run: any,
    phase: string | undefined,
    now: Date,
  ): Promise<void> {
    await this.flushActiveTime(tx, run, now);
    if (!phase || phase === run.currentPhase) return;

    await tx.marketSyncPhaseMetric.upsert({
      where: { runId_phase: { runId: run.id, phase } },
      create: {
        runId: run.id,
        phase,
        durationMs: 0n,
        entryCount: 1,
        lastEnteredAt: now,
      },
      update: {
        entryCount: { increment: 1 },
        lastEnteredAt: now,
      },
    });
    await tx.marketSyncRun.update({
      where: { id: run.id },
      data: {
        currentPhase: phase,
        phaseStartedAt: now,
        metricsFlushedAt: now,
        lastHeartbeatAt: now,
      },
    });
  }

  private telemetryUpdate(run: any, delta: MarketSyncTelemetryDelta) {
    const latency = latencyCounters(delta.requestLatenciesMs);
    const currentConcurrency =
      delta.currentConcurrency == null
        ? run.currentConcurrency
        : nonNegativeInteger(delta.currentConcurrency);
    const requestedMinimum =
      delta.minimumConcurrencyUsed == null
        ? currentConcurrency
        : nonNegativeInteger(delta.minimumConcurrencyUsed);
    const minimumConcurrencyUsed =
      requestedMinimum <= 0
        ? run.minimumConcurrencyUsed
        : run.minimumConcurrencyUsed <= 0
          ? requestedMinimum
          : Math.min(run.minimumConcurrencyUsed, requestedMinimum);
    const peakInFlight = Math.max(
      run.peakInFlight,
      nonNegativeInteger(delta.peakInFlight),
    );

    return {
      pageRequests: { increment: nonNegativeInteger(delta.pageRequests) },
      httpAttempts: { increment: nonNegativeInteger(delta.httpAttempts) },
      httpSucceeded: { increment: nonNegativeInteger(delta.httpSucceeded) },
      httpFailed: { increment: nonNegativeInteger(delta.httpFailed) },
      retryCount: { increment: nonNegativeInteger(delta.retryCount) },
      timeoutCount: { increment: nonNegativeInteger(delta.timeoutCount) },
      emptyResponseCount: {
        increment: nonNegativeInteger(delta.emptyResponseCount),
      },
      notFoundCount: { increment: nonNegativeInteger(delta.notFoundCount) },
      rateLimitedCount: {
        increment: nonNegativeInteger(delta.rateLimitedCount),
      },
      quotaWaitCount: { increment: nonNegativeInteger(delta.quotaWaitCount) },
      quotaWaitDurationMs: {
        increment: BigInt(nonNegativeInteger(delta.quotaWaitDurationMs)),
      },
      retryBackoffDurationMs: {
        increment: BigInt(nonNegativeInteger(delta.retryBackoffDurationMs)),
      },
      latencySampleCount: { increment: latency.count },
      latencyTotalMs: { increment: BigInt(latency.total) },
      latencyMaximumMs: Math.max(run.latencyMaximumMs, latency.maximum),
      latencyLe250Count: { increment: latency.le250 },
      latencyLe1000Count: { increment: latency.le1000 },
      latencyLe3000Count: { increment: latency.le3000 },
      latencyLe10000Count: { increment: latency.le10000 },
      latencyLe30000Count: { increment: latency.le30000 },
      latencyGt30000Count: { increment: latency.gt30000 },
      runQuotaUnitsUsed: {
        increment: nonNegativeInteger(delta.runQuotaUnitsUsed),
      },
      creditsUsed: {
        increment:
          delta.creditsUsed != null && Number.isFinite(delta.creditsUsed)
            ? Math.max(0, delta.creditsUsed)
            : 0,
      },
      currentConcurrency,
      minimumConcurrencyUsed,
      peakInFlight,
      concurrencyReductionCount: {
        increment: nonNegativeInteger(delta.concurrencyReductionCount),
      },
      concurrencyIncreaseCount: {
        increment: nonNegativeInteger(delta.concurrencyIncreaseCount),
      },
      ...(delta.deferredCandidateCount == null
        ? {}
        : {
            deferredCandidateCount: nonNegativeInteger(
              delta.deferredCandidateCount,
            ),
          }),
    };
  }

  private throughputUpdate(
    run: any,
    validAssetCount: number | undefined,
    now: Date,
  ) {
    if (validAssetCount == null) return {};
    const nextValid = nonNegativeInteger(validAssetCount);
    const startedAt: Date | null = run.throughputWindowStartedAt;
    if (
      !startedAt ||
      nextValid < run.throughputWindowStartValidAssets
    ) {
      return {
        throughputWindowStartedAt: now,
        throughputWindowStartValidAssets: nextValid,
        recentValidAssetsPerMinute: null,
      };
    }

    const elapsedMs = durationSince(startedAt, now);
    const gained = Math.max(
      0,
      nextValid - run.throughputWindowStartValidAssets,
    );
    const recentRate =
      elapsedMs >= 30_000 ? (gained * 60_000) / elapsedMs : undefined;
    if (elapsedMs >= 120_000) {
      return {
        throughputWindowStartedAt: now,
        throughputWindowStartValidAssets: nextValid,
        ...(recentRate === undefined
          ? {}
          : { recentValidAssetsPerMinute: recentRate }),
      };
    }
    return recentRate === undefined
      ? {}
      : { recentValidAssetsPerMinute: recentRate };
  }

  async startAttempt(
    input: StartMarketSyncRunAttemptInput,
  ): Promise<MarketSyncRunRecord> {
    return this.serialize(async () => {
      const now = new Date();
      const row = await prisma.$transaction(async (tx) => {
        const state = await tx.marketSyncState.findUnique({
          where: { key: input.stateKey },
        });
        const active =
          input.recoveryRequested && state?.activeRunId
            ? await tx.marketSyncRun.findUnique({
                where: { id: state.activeRunId },
              })
            : null;

        if (
          active &&
          (active.status === "running" || active.status === "paused")
        ) {
          const previousAttemptEnd =
            active.latestAttemptFinishedAt ?? active.lastHeartbeatAt;
          const pausedMs = durationSince(previousAttemptEnd, now);
          await tx.marketSyncPhaseMetric.upsert({
            where: {
              runId_phase: { runId: active.id, phase: input.phase },
            },
            create: {
              runId: active.id,
              phase: input.phase,
              durationMs: 0n,
              entryCount: 1,
              lastEnteredAt: now,
            },
            update: {
              entryCount: { increment: 1 },
              lastEnteredAt: now,
            },
          });
          await tx.marketSyncRun.update({
            where: { id: active.id },
            data: {
              status: "running",
              latestTriggeredBy: input.triggeredBy,
              recoveryKind: input.recoveryKind ?? "pending",
              currentPhase: input.phase,
              latestAttemptStartedAt: now,
              latestAttemptFinishedAt: null,
              lastHeartbeatAt: now,
              phaseStartedAt: now,
              metricsFlushedAt: now,
              attemptCount: { increment: 1 },
              pausedDurationMs: { increment: BigInt(pausedMs) },
              targetAssets: input.targetAssets,
              assetsPerItem: input.assetsPerItem,
              configuredConcurrency: input.configuredConcurrency,
              currentConcurrency: input.configuredConcurrency,
              minimumConcurrencyUsed:
                active.minimumConcurrencyUsed > 0
                  ? Math.min(
                      active.minimumConcurrencyUsed,
                      input.configuredConcurrency,
                    )
                  : input.configuredConcurrency,
              throughputWindowStartedAt: now,
              throughputWindowStartValidAssets: active.validAssetCount,
              recentValidAssetsPerMinute: null,
              lastError: null,
            },
          });
          await tx.marketSyncState.update({
            where: { key: input.stateKey },
            data: {
              activeRunId: active.id,
              currentPhase: input.phase,
              lastStartedAt: now,
              lastFinishedAt: null,
              lastError: null,
            },
          });
          return tx.marketSyncRun.findUniqueOrThrow({
            where: { id: active.id },
            include: { phases: true },
          });
        }

        if (state?.activeRunId) {
          await tx.marketSyncRun.updateMany({
            where: {
              id: state.activeRunId,
              status: { in: ["running", "paused"] },
            },
            data: {
              status: "failed",
              runFinishedAt: now,
              latestAttemptFinishedAt: now,
              lastError: "La corrida fue reemplazada porque ya no existe trabajo recuperable.",
            },
          });
        }

        const created = await tx.marketSyncRun.create({
          data: {
            stateKey: input.stateKey,
            status: "running",
            initialTriggeredBy: input.triggeredBy,
            latestTriggeredBy: input.triggeredBy,
            recoveryKind: input.recoveryKind ??
              (input.recoveryRequested ? "pending" : "none"),
            resumedFromRecovery: input.recoveryRequested,
            currentPhase: input.phase,
            runStartedAt: now,
            latestAttemptStartedAt: now,
            lastHeartbeatAt: now,
            phaseStartedAt: now,
            metricsFlushedAt: now,
            targetAssets: input.targetAssets,
            assetsPerItem: input.assetsPerItem,
            configuredConcurrency: input.configuredConcurrency,
            currentConcurrency: input.configuredConcurrency,
            minimumConcurrencyUsed: input.configuredConcurrency,
            throughputWindowStartedAt: now,
            throughputWindowStartValidAssets: 0,
            phases: {
              create: {
                phase: input.phase,
                durationMs: 0n,
                entryCount: 1,
                lastEnteredAt: now,
              },
            },
          },
          include: { phases: true },
        });
        await tx.marketSyncState.upsert({
          where: { key: input.stateKey },
          create: {
            key: input.stateKey,
            queueVersion: "pending",
            activeRunId: created.id,
            currentPhase: input.phase,
            lastStartedAt: now,
            targetAssets: input.targetAssets,
            assetsPerItem: input.assetsPerItem,
          },
          update: {
            activeRunId: created.id,
            currentPhase: input.phase,
            lastStartedAt: now,
            lastFinishedAt: null,
            lastError: null,
            targetAssets: input.targetAssets,
            assetsPerItem: input.assetsPerItem,
          },
        });
        return created;
      });
      return mapRun(row);
    });
  }

  async getCurrentOrLast(stateKey: string): Promise<MarketSyncRunRecord | null> {
    const state = await prisma.marketSyncState.findUnique({
      where: { key: stateKey },
      select: { activeRunId: true, lastRunId: true },
    });
    const id = state?.activeRunId ?? state?.lastRunId;
    const row = id
      ? await prisma.marketSyncRun.findUnique({
          where: { id },
          include: { phases: true },
        })
      : await prisma.marketSyncRun.findFirst({
          where: { stateKey },
          orderBy: { runStartedAt: "desc" },
          include: { phases: true },
        });
    return row ? mapRun(row) : null;
  }

  async recordProgress(
    stateKey: string,
    progress: MarketSyncRunProgress,
  ): Promise<void> {
    await this.serialize(async () => {
      const now = new Date();
      await prisma.$transaction(async (tx) => {
        const state = await tx.marketSyncState.findUnique({ where: { key: stateKey } });
        if (!state?.activeRunId) return;
        const run = await tx.marketSyncRun.findUnique({
          where: { id: state.activeRunId },
        });
        if (!run || run.status !== "running") return;

        await this.enterPhase(tx, run, progress.phase, now);
        const data: any = {
          ...this.throughputUpdate(run, progress.validAssetCount, now),
          ...(progress.targetAssets == null
            ? {}
            : { targetAssets: nonNegativeInteger(progress.targetAssets) }),
          ...(progress.assetsPerItem == null
            ? {}
            : { assetsPerItem: nonNegativeInteger(progress.assetsPerItem) }),
          ...(progress.totalCandidates == null
            ? {}
            : { totalCandidates: nonNegativeInteger(progress.totalCandidates) }),
          ...(progress.candidatesVisited == null
            ? {}
            : {
                candidatesVisited: nonNegativeInteger(
                  progress.candidatesVisited,
                ),
              }),
          ...(progress.rawAssetCount == null
            ? {}
            : { rawAssetCount: nonNegativeInteger(progress.rawAssetCount) }),
          ...(progress.validAssetCount == null
            ? {}
            : { validAssetCount: nonNegativeInteger(progress.validAssetCount) }),
          ...(progress.skippedAssetCount == null
            ? {}
            : {
                skippedAssetCount: nonNegativeInteger(
                  progress.skippedAssetCount,
                ),
              }),
          ...(progress.publishedListingCount == null
            ? {}
            : {
                publishedListingCount: nonNegativeInteger(
                  progress.publishedListingCount,
                ),
              }),
          ...(progress.publishedFloatCount == null
            ? {}
            : {
                publishedFloatCount: nonNegativeInteger(
                  progress.publishedFloatCount,
                ),
              }),
          ...(progress.snapshotHash === undefined
            ? {}
            : { snapshotHash: progress.snapshotHash }),
          ...(progress.completionReason === undefined
            ? {}
            : { completionReason: progress.completionReason }),
        };
        if (progress.telemetry) {
          Object.assign(data, this.telemetryUpdate(run, progress.telemetry));
        }
        await tx.marketSyncRun.update({ where: { id: run.id }, data });
      });
    });
  }

  async recordTelemetry(
    stateKey: string,
    delta: MarketSyncTelemetryDelta,
  ): Promise<void> {
    await this.serialize(async () => {
      const now = new Date();
      await prisma.$transaction(async (tx) => {
        const state = await tx.marketSyncState.findUnique({ where: { key: stateKey } });
        if (!state?.activeRunId) return;
        const run = await tx.marketSyncRun.findUnique({
          where: { id: state.activeRunId },
        });
        if (!run || run.status !== "running") return;
        await this.flushActiveTime(tx, run, now);
        await tx.marketSyncRun.update({
          where: { id: run.id },
          data: this.telemetryUpdate(run, delta),
        });
      });
    });
  }

  async heartbeat(stateKey: string): Promise<void> {
    await this.serialize(async () => {
      const now = new Date();
      await prisma.$transaction(async (tx) => {
        const state = await tx.marketSyncState.findUnique({ where: { key: stateKey } });
        if (!state?.activeRunId) return;
        const run = await tx.marketSyncRun.findUnique({
          where: { id: state.activeRunId },
        });
        if (!run || run.status !== "running") return;
        await this.flushActiveTime(tx, run, now);
      });
    });
  }

  async complete(
    stateKey: string,
    input: FinishMarketSyncRunInput = {},
  ): Promise<void> {
    await this.serialize(async () => {
      const now = new Date();
      await prisma.$transaction(async (tx) => {
        const state = await tx.marketSyncState.findUnique({ where: { key: stateKey } });
        if (!state?.activeRunId) return;
        const run = await tx.marketSyncRun.findUnique({
          where: { id: state.activeRunId },
        });
        if (!run) return;
        await this.enterPhase(tx, run, "completed", now);
        await tx.marketSyncRun.update({
          where: { id: run.id },
          data: {
            status: "completed",
            currentPhase: "completed",
            latestAttemptFinishedAt: now,
            runFinishedAt: now,
            lastHeartbeatAt: now,
            metricsFlushedAt: now,
            targetAssets: state.targetAssets,
            assetsPerItem: state.assetsPerItem,
            totalCandidates: state.totalCandidates,
            candidatesVisited: state.lastCandidatesVisited,
            rawAssetCount: state.rawAssetCount,
            validAssetCount: state.validAssetCount,
            skippedAssetCount: state.skippedAssetCount,
            publishedListingCount: state.publishedListingCount,
            publishedFloatCount: state.publishedFloatCount,
            snapshotHash: state.snapshotHash,
            completionReason:
              input.completionReason ?? state.completionReason ?? null,
            lastError: null,
          },
        });
        await tx.marketSyncState.update({
          where: { key: stateKey },
          data: { activeRunId: null, lastRunId: run.id },
        });
      });
      // La retención es mantenimiento best-effort. La corrida y el snapshot ya
      // están confirmados; un fallo al depurar históricos nunca puede revertir
      // ese éxito ni hacer que el orquestador lo marque como failed.
      await this.prune(stateKey).catch((error) => {
        console.error("[Market Assets Sync] No se pudieron depurar corridas antiguas:", error);
      });
    });
  }

  async finishAttempt(
    stateKey: string,
    input: FinishMarketSyncRunInput,
  ): Promise<void> {
    await this.serialize(async () => {
      const now = new Date();
      await prisma.$transaction(async (tx) => {
        const state = await tx.marketSyncState.findUnique({ where: { key: stateKey } });
        if (!state?.activeRunId) return;
        const run = await tx.marketSyncRun.findUnique({
          where: { id: state.activeRunId },
        });
        if (!run) return;
        const phase = input.resumable ? "paused" : "failed";
        await this.enterPhase(tx, run, phase, now);
        await tx.marketSyncRun.update({
          where: { id: run.id },
          data: {
            status: phase,
            currentPhase: phase,
            latestAttemptFinishedAt: now,
            runFinishedAt: input.resumable ? null : now,
            lastHeartbeatAt: now,
            metricsFlushedAt: now,
            lastError: input.error ?? null,
          },
        });
        await tx.marketSyncState.update({
          where: { key: stateKey },
          data: input.resumable
            ? { activeRunId: run.id, currentPhase: "paused" }
            : {
                activeRunId: null,
                lastRunId: run.id,
                currentPhase: "failed",
              },
        });
      });
    });
  }

  async prune(stateKey: string, retainRuns = 100): Promise<number> {
    const keep = Math.max(1, Math.trunc(retainRuns));
    const stale = await prisma.marketSyncRun.findMany({
      where: {
        stateKey,
        status: { in: ["completed", "failed"] },
      },
      orderBy: { runStartedAt: "desc" },
      skip: keep,
      select: { id: true },
    });
    if (stale.length === 0) return 0;
    const result = await prisma.marketSyncRun.deleteMany({
      where: { id: { in: stale.map((row) => row.id) } },
    });
    return result.count;
  }
}
