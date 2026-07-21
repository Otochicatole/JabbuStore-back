import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(async () => ({})),
  deleteMany: vi.fn(async () => ({ count: 2 })),
  transaction: vi.fn(async (operations: unknown[]) => Promise.all(operations)),
}));

vi.mock("../../../../shared/infrastructure/PrismaClient", () => ({
  prisma: {
    marketAssetCandidateHistory: {
      findMany: vi.fn(async () => []),
      upsert: mocks.upsert,
      deleteMany: mocks.deleteMany,
    },
    $transaction: mocks.transaction,
  },
}));

import { PrismaMarketAssetCandidateHistoryRepository } from "../PrismaMarketAssetCandidateHistoryRepository";

describe("PrismaMarketAssetCandidateHistoryRepository", () => {
  beforeEach(() => vi.clearAllMocks());

  it("no reemplaza disponibilidad confirmada con errores transitorios o fatales", async () => {
    const repository = new PrismaMarketAssetCandidateHistoryRepository();
    await repository.recordObservations("run-1", [
      {
        candidateKey: "ak-redline",
        queueVersion: "queue-1",
        marketHashName: "AK-47 | Redline (Field-Tested)",
        outcome: "transient_error",
      },
      {
        candidateKey: "awp-asiimov",
        queueVersion: "queue-1",
        marketHashName: "AWP | Asiimov (Battle-Scarred)",
        outcome: "fatal_error",
      },
    ]);

    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("conserva hints por 90 dias por defecto", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T00:00:00.000Z"));
    try {
      const repository = new PrismaMarketAssetCandidateHistoryRepository();
      await expect(repository.prune()).resolves.toBe(2);
      expect(mocks.deleteMany).toHaveBeenCalledWith({
        where: {
          observedAt: { lt: new Date("2026-04-22T00:00:00.000Z") },
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("persiste la latencia acumulada de la ultima observacion confirmada", async () => {
    const repository = new PrismaMarketAssetCandidateHistoryRepository();
    await repository.recordObservations("run-1", [
      {
        candidateKey: "ak-redline",
        queueVersion: "queue-1",
        marketHashName: "AK-47 | Redline (Field-Tested)",
        outcome: "available",
        providerTotal: 10,
        validAssetCount: 10,
        latencyMs: 4_321.9,
      },
    ]);

    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ latencyMs: 4_321 }),
        update: expect.objectContaining({ latencyMs: 4_321 }),
      }),
    );
  });
});
