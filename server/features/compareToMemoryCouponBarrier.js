export function compareToMemoryCouponBarrier(context, product, observation, parameters) {
  console.log('compareToMemoryCouponBarrier called with context:', JSON.stringify(context));
  console.log('Observation:', JSON.stringify(observation));
  console.log('Lifecycle parameters:', JSON.stringify(parameters));

  if (!context.identifiedUnderlying || context.identifiedUnderlying.performance === undefined) {
    console.error('Error: Missing or undefined performance in identifiedUnderlying');
    throw new Error('Missing or undefined performance in identifiedUnderlying');
  }

  const calculatedPerformance = context.identifiedUnderlying.performance;
  console.log(`Performance to compare: ${calculatedPerformance}`);

  const couponBarrierLevel = observation.couponBarrierLevel;

  // Ensure that unpaidCouponAmount is initialized correctly from the context
  const unpaidCouponAmount = parseFloat(context.unpaidCouponAmount) || 0;
  const couponAmount = parameters.couponAmountPerPeriod;

  console.log(`Comparing performance ${calculatedPerformance} to coupon barrier level ${couponBarrierLevel}`);
  console.log(`Current unpaidCouponAmount in context: ${unpaidCouponAmount}`);

  let couponToBePaid = 0;
  let updatedUnpaidCouponAmount = unpaidCouponAmount;

  if (calculatedPerformance >= couponBarrierLevel) {
    // Performance is above the barrier, pay the coupon + any unpaid coupons
    couponToBePaid = couponAmount + unpaidCouponAmount;
    updatedUnpaidCouponAmount = 0; // Reset unpaid coupon amount
    console.log(`Performance is above barrier. Coupon to be paid: ${couponToBePaid}, Unpaid coupon amount reset.`);
  } else {
    // Performance is below the barrier, no coupon is paid, add the missed coupon amount to the unpaidCouponAmount
    updatedUnpaidCouponAmount += couponAmount;
    console.log(`Performance is below barrier. No coupon paid. Unpaid coupon amount incremented: ${updatedUnpaidCouponAmount}`);
  }

  context.compareResult = {
    couponToBePaid: couponToBePaid.toFixed(4),
    unpaidCouponAmount: updatedUnpaidCouponAmount.toFixed(4) // Store the updated unpaid coupon amount
  };

  console.log(`compareToMemoryCouponBarrier returning: ${JSON.stringify(context.compareResult)}`);
  
  // Update the context with the latest unpaid coupon amount for the next steps
  context.unpaidCouponAmount = updatedUnpaidCouponAmount.toFixed(4);  

  return context;
}
