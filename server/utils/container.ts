/**
 * Extracts liquid volume in liters from a size label or product name.
 * Examples: "10L" -> 10, "1.5L" -> 1.5, "500ml" -> 0.5, "5 Litres" -> 5.
 * Returns null if no liquid unit is specified.
 */
export function parseSizeToLiters(sizeLabel?: string | null, productName?: string | null): number | null {
  const parseStr = (str: string): number | null => {
    const cleaned = str.trim().toLowerCase();
    if (!cleaned) return null;

    // Single words indicating 1 liter
    if (cleaned === 'l' || cleaned === 'litre' || cleaned === 'litres') {
      return 1;
    }

    // Match patterns like "500ml", "750 ml"
    const mlMatch = cleaned.match(/(?:^|\b|\s)([0-9]+(?:\.[0-9]+)?)\s*ml(?:\b|\s|$)/i);
    if (mlMatch) {
      const val = parseFloat(mlMatch[1]);
      return !isNaN(val) && val > 0 ? val / 1000 : null;
    }

    // Match patterns like "10L", "1.5 l", "5 litres", "20l"
    const lMatch = cleaned.match(/(?:^|\b|\s)([0-9]+(?:\.[0-9]+)?)\s*(?:l|litre|litres)(?:\b|\s|$)/i);
    if (lMatch) {
      const val = parseFloat(lMatch[1]);
      return !isNaN(val) && val > 0 ? val : null;
    }

    return null;
  };

  if (sizeLabel) {
    const parsed = parseStr(sizeLabel);
    if (parsed !== null) return parsed;
  }

  if (productName) {
    const parsed = parseStr(productName);
    if (parsed !== null) return parsed;
  }

  return null;
}

/**
 * Calculates number of returnable containers required for a cart item or sale line.
 * E.g. Buying 10L of bulk Vaisselle with a 10L bidon (capacity_liters = 10) -> 1 container.
 * Buying 20L of Vaisselle with a 10L bidon -> 2 containers.
 * Buying 2 x 5L pre-packaged bottles with 5L bidon -> 2 containers.
 */
export function calculateContainersNeeded(
  quantity: number,
  packMultiplier: number = 1,
  sizeLabel?: string | null,
  containerCapacityLiters?: number | null,
  productName?: string | null
): number {
  const qty = Math.max(0, quantity || 0);
  if (qty <= 0) return 0;
  const multiplier = Math.max(1, packMultiplier || 1);
  const totalUnits = qty * multiplier;

  // If container has no capacity limit (e.g. piece/crate/palette), 1 container per unit
  if (!containerCapacityLiters || containerCapacityLiters <= 0) {
    return Math.max(1, Math.round(totalUnits));
  }

  const productLiters = parseSizeToLiters(sizeLabel, productName);
  if (productLiters && productLiters > 0) {
    const totalVolume = totalUnits * productLiters;
    return Math.floor(totalVolume / containerCapacityLiters);
  }

  // If product has no size_label or is sold per-unit/per-liter, totalUnits directly represents volume
  return Math.floor(totalUnits / containerCapacityLiters);
}
