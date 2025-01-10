export function compareToCouponBarrier(calculatedPerformance, couponBarrierLevel, fixedCouponAmount) {
  if (typeof calculatedPerformance !== 'number') {
    throw new Error(`Invalid calculatedPerformance: expected number, got ${typeof calculatedPerformance}`);
  }
  if (typeof couponBarrierLevel !== 'number') {
    throw new Error(`Invalid couponBarrierLevel: expected number, got ${typeof couponBarrierLevel}`);
  }
  if (typeof fixedCouponAmount !== 'number') {
    throw new Error(`Invalid fixedCouponAmount: expected number, got ${typeof fixedCouponAmount}`);
  }

  // We're checking if the performance is above or equal to the coupon barrier level
  const isAboveBarrier = calculatedPerformance >= -100 + couponBarrierLevel;

  return {
    calculatedPerformance: calculatedPerformance.toFixed(2) + '%',
    couponBarrierLevel: couponBarrierLevel.toFixed(2) + '%',
    isAboveBarrier: isAboveBarrier,
    status: isAboveBarrier ? 'Coupon Barrier Met' : 'Coupon Barrier Not Met',
    couponPaid: isAboveBarrier,
    couponAmount: isAboveBarrier ? (fixedCouponAmount * 100).toFixed(2) + '%' : '0%'
  };
}
