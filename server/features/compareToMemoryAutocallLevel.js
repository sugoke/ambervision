import { Historical, Products } from '/imports/api/products/products.js';

export function compareToMemoryAutocallLevel(calculatedPerformance, autocallLevel, productId, observationDate) {
  console.log('compareToMemoryAutocallLevel - Raw Input:', {
    calculatedPerformance,
    autocallLevel,
    productId,
    observationDate
  });

  // Input validation and default values
  calculatedPerformance = Number(calculatedPerformance);
  if (isNaN(calculatedPerformance)) {
    console.warn('Invalid calculatedPerformance. Returning default result.');
    return {
      isAutocalled: false,
      status: "Not Autocalled (Invalid Performance)"
    };
  }

  if (autocallLevel === undefined || autocallLevel === null) {
    console.warn('Missing autocallLevel. Assuming this is not an autocall date.');
    return {
      isAutocalled: false,
      status: "Not an autocall date"
    };
  }

  if (!productId) {
    console.warn('Missing productId. Cannot proceed with memory autocall.');
    return {
      isAutocalled: false,
      status: "Not Autocalled (Missing Product ID)"
    };
  }

  // Fetch the product from the database
  const product = Products.findOne(productId);
  if (!product) {
    console.warn(`Product not found for ID: ${productId}`);
    return {
      isAutocalled: false,
      status: "Not Autocalled (Product Not Found)"
    };
  }

  console.log('compareToMemoryAutocallLevel - Processed Input:', {
    calculatedPerformance,
    autocallLevel,
    productId: product._id,
    observationDate
  });

  let allLocked = true;
  let newlyLockedUnderlyings = [];

  // Check each underlying
  for (let i = 0; i < product.underlyings.length; i++) {
    let underlying = product.underlyings[i];
    if (!underlying.locked) {
      if (calculatedPerformance >= -autocallLevel) {
        // Mark the underlying as locked if it's above the autocall level
        newlyLockedUnderlyings.push(underlying.ticker);
        product.underlyings[i].locked = true;
        console.log(`${underlying.ticker} is now locked.`);
      } else {
        allLocked = false;
      }
    }
  }

  // Update the product document in the database if there were changes
  if (newlyLockedUnderlyings.length > 0) {
    updateProductUnderlyings(product._id, product.underlyings);
  }

  const result = {
    isAutocalled: allLocked,
    status: allLocked ? "Autocalled" : "Not Autocalled",
    newlyLockedUnderlyings: newlyLockedUnderlyings
  };

  console.log('compareToMemoryAutocallLevel - Result:', result);
  return result;
}

function updateProductUnderlyings(productId, underlyings) {
  Products.update(
    { _id: productId },
    { $set: { underlyings: underlyings } }
  );
}

export function resetUnderlyingsLockedStatus(productId) {
  const product = Products.findOne(productId);
  if (!product) {
    throw new Error(`Product not found: ${productId}`);
  }

  const updatedUnderlyings = product.underlyings.map(u => ({...u, locked: false}));

  Products.update(
    { _id: productId },
    { $set: { underlyings: updatedUnderlyings } }
  );
  console.log('Reset locked status for underlyings of product:', productId);
}
