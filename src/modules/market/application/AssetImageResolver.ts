import {
  getDopplerPhaseLabelByPaintIndex,
  normalizeDopplerPhaseLabel,
} from "../../pricing/domain/DopplerPhase";

function readPositiveNumber(...values: unknown[]): number | null {
  for (const raw of values) {
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function readImageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

export function readAssetPaintIndex(asset: any): number | null {
  return readPositiveNumber(
    asset?.paintindex,
    asset?.paint_index,
    asset?.paintIndex,
    asset?.item?.paintindex,
    asset?.item?.paint_index,
    asset?.item?.paintIndex,
    asset?.metadata?.paintindex,
    asset?.metadata?.paint_index,
    asset?.metadata?.paintIndex,
  );
}

export function resolveVariantImageUrl(
  item: any,
  paintIndex: number | null,
  phase: string | null,
): string | null {
  const variants = Array.isArray(item?.variants) ? item.variants : [];

  if (paintIndex != null) {
    const exactVariant = variants.find(
      (variant: any) =>
        readPositiveNumber(
          variant?.paintindex,
          variant?.paint_index,
          variant?.paintIndex,
        ) === paintIndex,
    );
    const exactImage = readImageUrl(exactVariant?.image);
    if (exactImage) return exactImage;
  }

  const canonicalPhase =
    getDopplerPhaseLabelByPaintIndex(paintIndex) ??
    normalizeDopplerPhaseLabel(phase);
  if (!canonicalPhase) return null;

  const phaseVariant = variants.find(
    (variant: any) =>
      normalizeDopplerPhaseLabel(variant?.phase) === canonicalPhase,
  );
  return readImageUrl(phaseVariant?.image);
}

export function resolveAssetImageUrl(asset: any): string | null {
  const paintIndex = readAssetPaintIndex(asset);
  const phase =
    getDopplerPhaseLabelByPaintIndex(paintIndex) ??
    normalizeDopplerPhaseLabel(
      asset?.phase ?? asset?.item?.phase ?? asset?.metadata?.phase,
    );
  const variantImage = resolveVariantImageUrl(asset?.item, paintIndex, phase);
  if (variantImage) return variantImage;

  const marketHashName = String(
    asset?.markethashname ?? asset?.market_hash_name ?? "",
  );
  if (/\b(?:Gamma\s+)?Doppler\b/i.test(marketHashName)) {
    return null;
  }

  return (
    readImageUrl(asset?.item?.image) ??
    readImageUrl(asset?.item?.itemimage) ??
    readImageUrl(asset?.image) ??
    readImageUrl(asset?.itemimage)
  );
}
