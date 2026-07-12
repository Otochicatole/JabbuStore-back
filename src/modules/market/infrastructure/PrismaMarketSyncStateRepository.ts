import { prisma } from "../../../shared/infrastructure/PrismaClient";
import {
  IMarketSyncStateRepository,
  MarketSyncStateProgress,
} from "../domain/IMarketSyncStateRepository";
import { MarketSyncState } from "../domain/MarketSyncState";

function mapState(row: {
  key: string;
  queueVersion: string;
  cursorIndex: number;
  lastRowsUsed: number;
  lastCandidatesVisited: number;
  lastError: string | null;
  lastStartedAt: Date | null;
  lastFinishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): MarketSyncState {
  return row;
}

export class PrismaMarketSyncStateRepository
  implements IMarketSyncStateRepository
{
  async get(key: string): Promise<MarketSyncState | null> {
    const row = await prisma.marketSyncState.findUnique({ where: { key } });
    return row ? mapState(row) : null;
  }

  async markStarted(
    key: string,
    queueVersion: string,
    cursorIndex: number,
  ): Promise<void> {
    await prisma.marketSyncState.upsert({
      where: { key },
      create: {
        key,
        queueVersion,
        cursorIndex,
        lastStartedAt: new Date(),
        lastFinishedAt: null,
        lastError: null,
      },
      update: {
        queueVersion,
        cursorIndex,
        lastStartedAt: new Date(),
        lastFinishedAt: null,
        lastError: null,
      },
    });
  }

  async markFinished(
    key: string,
    queueVersion: string,
    progress: MarketSyncStateProgress,
  ): Promise<void> {
    await prisma.marketSyncState.upsert({
      where: { key },
      create: {
        key,
        queueVersion,
        cursorIndex: progress.cursorIndex,
        lastRowsUsed: progress.lastRowsUsed,
        lastCandidatesVisited: progress.lastCandidatesVisited,
        lastError: progress.lastError ?? null,
        lastFinishedAt: new Date(),
      },
      update: {
        queueVersion,
        cursorIndex: progress.cursorIndex,
        lastRowsUsed: progress.lastRowsUsed,
        lastCandidatesVisited: progress.lastCandidatesVisited,
        lastError: progress.lastError ?? null,
        lastFinishedAt: new Date(),
      },
    });
  }
}

