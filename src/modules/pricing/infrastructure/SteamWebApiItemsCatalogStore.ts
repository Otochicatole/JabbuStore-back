import { promises as fs } from "fs";
import { randomBytes } from "node:crypto";
import path from "path";
import { config } from "../../../shared/config";
import type {
  BotPriceCatalogStatus,
  SteamWebApiItemsCatalogIndex,
  SteamWebApiItemsCatalogRow,
  SteamWebApiItemsCatalogSnapshot,
} from "../domain/types";
import { MarketHashNameNormalizer } from "../application/MarketHashNameNormalizer";

let memorySnapshot: SteamWebApiItemsCatalogSnapshot | null = null;
let memoryIndex: SteamWebApiItemsCatalogIndex | null = null;

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function hasName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isMissingFile(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

async function recoverNewestBackup(filePath: string): Promise<boolean> {
  const directory = path.dirname(filePath);
  const prefix = `${path.basename(filePath)}.`;
  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    if (isMissingFile(error)) return false;
    throw error;
  }

  const candidates = await Promise.all(
    names
      .filter((name) => name.startsWith(prefix) && name.endsWith(".bak"))
      .map(async (name) => ({
        path: path.join(directory, name),
        modifiedAt: (await fs.stat(path.join(directory, name))).mtimeMs,
      })),
  );
  const newest = candidates.sort(
    (left, right) => right.modifiedAt - left.modifiedAt,
  )[0];
  if (!newest) return false;
  await fs.rename(newest.path, filePath);
  return true;
}

function addIndexRow(
  index: Map<string, SteamWebApiItemsCatalogRow[]>,
  key: string | null | undefined,
  row: SteamWebApiItemsCatalogRow,
): void {
  if (!hasName(key)) return;
  const normalized = normalizeKey(key);
  const rows = index.get(normalized);
  if (rows) {
    if (!rows.includes(row)) rows.push(row);
  } else {
    index.set(normalized, [row]);
  }
}

export class SteamWebApiItemsCatalogStore {
  private normalizer = new MarketHashNameNormalizer();

  constructor(private catalogPath = config.itemsCatalog.path) {}

  get absolutePath(): string {
    return path.isAbsolute(this.catalogPath)
      ? this.catalogPath
      : path.resolve(process.cwd(), this.catalogPath);
  }

  async readCatalog(): Promise<SteamWebApiItemsCatalogSnapshot | null> {
    if (memorySnapshot) return memorySnapshot;
    try {
      const raw = await fs.readFile(this.absolutePath, "utf8");
      const parsed = JSON.parse(raw) as SteamWebApiItemsCatalogSnapshot;
      if (!Array.isArray(parsed.items)) return null;
      memorySnapshot = parsed;
      memoryIndex = null;
      return parsed;
    } catch (err: unknown) {
      if (isMissingFile(err)) {
        if (await recoverNewestBackup(this.absolutePath)) {
          return this.readCatalog();
        }
        return null;
      }
      throw err;
    }
  }

  async writeCatalog(snapshot: SteamWebApiItemsCatalogSnapshot): Promise<void> {
    const filePath = this.absolutePath;
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const suffix = `${process.pid}.${randomBytes(6).toString("hex")}`;
    const tempPath = `${filePath}.${suffix}.tmp`;
    const backupPath = `${filePath}.${suffix}.bak`;
    try {
      const handle = await fs.open(tempPath, "wx");
      try {
        await handle.writeFile(JSON.stringify(snapshot, null, 2), "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }

      try {
        await fs.rename(tempPath, filePath);
      } catch (error: any) {
        if (!["EEXIST", "EPERM", "ENOTEMPTY"].includes(String(error?.code))) {
          throw error;
        }
        let movedPrevious = false;
        try {
          await fs.rename(filePath, backupPath);
          movedPrevious = true;
        } catch (backupError: any) {
          if (backupError?.code !== "ENOENT") throw backupError;
        }
        try {
          await fs.rename(tempPath, filePath);
          if (movedPrevious) await fs.rm(backupPath, { force: true });
        } catch (replaceError) {
          if (movedPrevious) {
            await fs.rename(backupPath, filePath).catch(() => undefined);
          }
          throw replaceError;
        }
      }
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }

    memorySnapshot = snapshot;
    memoryIndex = this.buildIndex(snapshot);
  }

  async getIndex(): Promise<SteamWebApiItemsCatalogIndex | null> {
    if (memoryIndex) return memoryIndex;
    const snapshot = await this.readCatalog();
    if (!snapshot) return null;
    memoryIndex = this.buildIndex(snapshot);
    return memoryIndex;
  }

  buildIndex(
    snapshot: SteamWebApiItemsCatalogSnapshot,
  ): SteamWebApiItemsCatalogIndex {
    const rowsByName = new Map<string, SteamWebApiItemsCatalogRow[]>();

    for (const row of snapshot.items) {
      const names = [
        row.markethashname,
        row.market_hash_name,
        row.marketname,
        row.normalizedname,
      ];

      for (const name of names) {
        addIndexRow(rowsByName, name, row);
        if (hasName(name)) {
          const { baseName } = this.normalizer.splitDopplerPhase(name);
          if (baseName && baseName !== name) {
            addIndexRow(rowsByName, baseName, row);
          }
        }
      }
    }

    return {
      rowsByName,
      itemCount: snapshot.itemCount,
      fetchedAt: snapshot.fetchedAt,
    };
  }

  async getStatus(): Promise<BotPriceCatalogStatus> {
    const snapshot = await this.readCatalog();
    const fetchedAtMs = snapshot?.fetchedAt
      ? new Date(snapshot.fetchedAt).getTime()
      : 0;
    const stale =
      !snapshot ||
      !Number.isFinite(fetchedAtMs) ||
      Date.now() - fetchedAtMs > config.itemsCatalog.staleAfterMs;

    const status: BotPriceCatalogStatus = {
      exists: Boolean(snapshot),
      stale,
      fetchedAt: snapshot?.fetchedAt ?? null,
      itemCount: snapshot?.itemCount ?? 0,
      pageCount: snapshot?.pageCount ?? 0,
      currency: snapshot?.currency ?? config.itemsCatalog.currency,
      market: snapshot?.market ?? config.itemsCatalog.market,
      path: this.absolutePath,
    };
    const lastError = snapshot?.errors?.[snapshot.errors.length - 1];
    if (lastError) status.lastError = lastError;
    return status;
  }

  clearMemoryCache(): void {
    memorySnapshot = null;
    memoryIndex = null;
  }
}
