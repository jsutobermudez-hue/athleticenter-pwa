import type { Product, Offer } from './definitions';

export interface OfferCalculationResult {
  finalPrice: number;
  totalDiscountPercentage: number;
  appliedOffers: Offer[];
  hasOffer: boolean;
}

/**
 * Calculates the final price of a product after applying active offers.
 * @param product The product to calculate the price for.
 * @param allOffers A list of all available offers in the system.
 * @returns An object containing the final price, total discount, and applied offers.
 */
export function calculateOfferPrice(
  product: Product,
  allOffers: Offer[] | null | undefined
): OfferCalculationResult {
  const listPrice = product.price;

  if (!allOffers || !product.activeOfferIds || product.activeOfferIds.length === 0) {
    return {
      finalPrice: listPrice,
      totalDiscountPercentage: 0,
      appliedOffers: [],
      hasOffer: false,
    };
  }

  const appliedOffers = allOffers.filter(
    (offer) =>
      product.activeOfferIds?.includes(offer.id) && offer.isActive === true
  );

  if (appliedOffers.length === 0) {
    return {
      finalPrice: listPrice,
      totalDiscountPercentage: 0,
      appliedOffers: [],
      hasOffer: false,
    };
  }

  const totalDiscountPercentage = appliedOffers.reduce(
    (sum, offer) => sum + offer.discountPercentage,
    0
  );

  // Ensure discount doesn't exceed 100%
  const effectiveDiscount = Math.min(totalDiscountPercentage, 1);

  const finalPrice = listPrice * (1 - effectiveDiscount);

  return {
    finalPrice,
    totalDiscountPercentage: effectiveDiscount,
    appliedOffers,
    hasOffer: true,
  };
}
