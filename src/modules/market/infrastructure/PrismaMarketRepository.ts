import { createHash } from 'node:crypto';

/** Stable across snapshot publications, which keeps cart references deterministic. */
export function stableMarketFloatId(market: string, assetId: string): string {
  return createHash('sha256')
    .update(`${market.trim().toLowerCase()}:${assetId.trim()}`)
    .digest('hex');
}
