import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { CurrencyCache } from './currencyCache';
import { BankAccountsCollection } from './bankAccounts';

// Direct Equities Holdings collection - linked to bank accounts
export const EquityHoldingsCollection = new Mongo.Collection('equityHoldings');

// Equity Holdings Schema
// {
//   _id: ObjectId,
//   userId: String,           // User who owns this holding
//   bankAccountId: String,    // Reference to BankAccountsCollection
//   accountNumber: String,    // Bank account number (denormalized for easier queries)
//   symbol: String,           // Stock symbol (e.g., "AAPL")
//   isin: String,             // ISIN code if available
//   exchange: String,         // Exchange (e.g., "NASDAQ")
//   fullTicker: String,       // Full ticker (e.g., "AAPL.NASDAQ")
//   companyName: String,      // Company name
//   sector: String,           // Company sector
//   currency: String,         // Stock trading currency
//   quantity: Number,         // Number of shares owned
//   averagePrice: Number,     // Average purchase price per share
//   totalCost: Number,        // Total cost basis (quantity * averagePrice)
//   currentPrice: Number,     // Current market price per share
//   previousClosePrice: Number, // Previous day's closing price per share
//   currentValue: Number,     // Current market value (quantity * currentPrice)
//   dayChange: Number,        // Day change amount (based on previous close)
//   dayChangePercent: Number, // Day change percentage
//   totalReturn: Number,      // Total return amount (currentValue - totalCost)
//   totalReturnPercent: Number, // Total return percentage
//   purchaseDate: Date,       // Original purchase date
//   lastUpdated: Date,        // Last price update
//   transactions: [           // Transaction history
//     {
//       type: String,         // 'BUY', 'SELL', 'DIVIDEND'
//       quantity: Number,     // Shares bought/sold
//       price: Number,        // Price per share in STOCK currency
//       priceInAccountCurrency: Number, // Price per share in account currency
//       amount: Number,       // Total transaction amount in account currency
//       fees: Number,         // Transaction fees in account currency
//       date: Date,           // Transaction date
//       notes: String,        // Optional notes
//       fxRate: Number,       // FX rate at transaction time (stock currency to account currency)
//       fxPair: String,       // FX pair used (e.g., "EURUSD.FOREX")
//       stockCurrency: String, // Stock trading currency
//       accountCurrency: String // Account reference currency
//     }
//   ],
//   fxRates: {              // Historical FX rates for P&L calculation
//     averagePurchaseRate: Number, // Volume-weighted average FX rate for cost basis
//     currentRate: Number,   // Current FX rate for market value
//     lastRateUpdate: Date   // When current rate was last updated
//   }
// }

// Create indexes for efficient querying
if (Meteor.isServer) {
  // Holdings indexes
  EquityHoldingsCollection.createIndex({ bankAccountId: 1 });
  EquityHoldingsCollection.createIndex({ userId: 1 });
  EquityHoldingsCollection.createIndex({ userId: 1, bankAccountId: 1 });
  EquityHoldingsCollection.createIndex({ symbol: 1 });
  EquityHoldingsCollection.createIndex({ fullTicker: 1 });
  EquityHoldingsCollection.createIndex({ accountNumber: 1 });
}

// Equity Holdings helper methods
export const EquityHoldingsHelpers = {
  // Currency pair conventions - respecting market standards
  getStandardCurrencyPair(fromCurrency, toCurrency) {
    // Major currency pairs with standard ordering
    const majorPairs = {
      'EUR': ['USD', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD', 'NZD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF'],
      'GBP': ['USD', 'CHF', 'JPY', 'CAD', 'AUD', 'NZD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF'],
      'AUD': ['USD', 'JPY', 'CAD', 'NZD', 'CHF'],
      'NZD': ['USD', 'JPY', 'CAD', 'CHF'],
      'USD': ['JPY', 'CHF', 'CAD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'TRY', 'ZAR', 'MXN', 'BRL', 'CNY', 'HKD', 'SGD', 'KRW', 'INR', 'THB', 'MYR', 'IDR', 'PHP']
    };

    // Check if fromCurrency is base in major pairs
    if (majorPairs[fromCurrency] && majorPairs[fromCurrency].includes(toCurrency)) {
      return {
        pair: `${fromCurrency}${toCurrency}.FOREX`,
        base: fromCurrency,
        quote: toCurrency,
        isInverted: false
      };
    }

    // Check if toCurrency is base in major pairs  
    if (majorPairs[toCurrency] && majorPairs[toCurrency].includes(fromCurrency)) {
      return {
        pair: `${toCurrency}${fromCurrency}.FOREX`,
        base: toCurrency,
        quote: fromCurrency,
        isInverted: true
      };
    }

    // For non-major pairs, default to alphabetical order
    if (fromCurrency < toCurrency) {
      return {
        pair: `${fromCurrency}${toCurrency}.FOREX`,
        base: fromCurrency,
        quote: toCurrency,
        isInverted: false
      };
    } else {
      return {
        pair: `${toCurrency}${fromCurrency}.FOREX`,
        base: toCurrency,
        quote: fromCurrency,
        isInverted: true
      };
    }
  },

  // Get FX rate with metadata for historical tracking
  async getFxRateWithMetadata(fromCurrency, toCurrency) {
    if (fromCurrency === toCurrency) {
      return {
        rate: 1,
        pair: null,
        inverse: false,
        timestamp: new Date()
      };
    }
    
    try {
      // Get the standard currency pair format
      const standardPair = this.getStandardCurrencyPair(fromCurrency, toCurrency);
      
      // Try to get rate using the standard pair format
      let rateData = await CurrencyCache.getCachedRate(standardPair.pair);
      if (rateData && rateData.rate && rateData.rate > 0) {
        const actualRate = standardPair.isInverted ? 1 / rateData.rate : rateData.rate;
        return {
          rate: actualRate,
          pair: standardPair.pair,
          inverse: standardPair.isInverted,
          timestamp: rateData.timestamp || new Date()
        };
      }
      
      // Fallback: Try both direct and inverse pairs (legacy support)
      const directPair = `${fromCurrency}${toCurrency}.FOREX`;
      const inversePair = `${toCurrency}${fromCurrency}.FOREX`;
      
      rateData = await CurrencyCache.getCachedRate(directPair);
      if (rateData && rateData.rate && rateData.rate > 0) {
        return {
          rate: rateData.rate,
          pair: directPair,
          inverse: false,
          timestamp: rateData.timestamp || new Date()
        };
      }
      
      rateData = await CurrencyCache.getCachedRate(inversePair);
      if (rateData && rateData.rate && rateData.rate > 0) {
        return {
          rate: 1 / rateData.rate,
          pair: inversePair,
          inverse: true,
          timestamp: rateData.timestamp || new Date()
        };
      }
      
      // Handle USD-based conversions using standard pairs
      if (fromCurrency === 'USD') {
        const standardUsdPair = this.getStandardCurrencyPair('USD', toCurrency);
        rateData = await CurrencyCache.getCachedRate(standardUsdPair.pair);
        if (rateData && rateData.rate && rateData.rate > 0) {
          const actualRate = standardUsdPair.isInverted ? 1 / rateData.rate : rateData.rate;
          return {
            rate: actualRate,
            pair: standardUsdPair.pair,
            inverse: standardUsdPair.isInverted,
            timestamp: rateData.timestamp || new Date()
          };
        }
      } else if (toCurrency === 'USD') {
        const standardUsdPair = this.getStandardCurrencyPair(fromCurrency, 'USD');
        rateData = await CurrencyCache.getCachedRate(standardUsdPair.pair);
        if (rateData && rateData.rate && rateData.rate > 0) {
          const actualRate = standardUsdPair.isInverted ? 1 / rateData.rate : rateData.rate;
          return {
            rate: actualRate,
            pair: standardUsdPair.pair,
            inverse: standardUsdPair.isInverted,
            timestamp: rateData.timestamp || new Date()
          };
        }
      }
      
      console.error(`❌ No FX rate found for ${fromCurrency}/${toCurrency}`);
      return {
        rate: 1,
        pair: null,
        inverse: false,
        timestamp: new Date(),
        error: `No rate found for ${fromCurrency}/${toCurrency}`
      };
    } catch (error) {
      console.error(`❌ Error getting FX rate ${fromCurrency} to ${toCurrency}:`, error);
      return {
        rate: 1,
        pair: null,
        inverse: false,
        timestamp: new Date(),
        error: error.message
      };
    }
  },
  // Convert amount from one currency to another
  async convertCurrency(amount, fromCurrency, toCurrency) {
    if (fromCurrency === toCurrency) {
      return amount; // No conversion needed
    }
    
    try {
      console.log(`🔄 Converting ${amount} from ${fromCurrency} to ${toCurrency}`);
      
      // Get the standard currency pair format
      const standardPair = this.getStandardCurrencyPair(fromCurrency, toCurrency);
      
      // First, try to fetch fresh rates if not cached using standard pair
      const pairsToTry = [standardPair.pair];
      await CurrencyCache.refreshCurrencyRates(pairsToTry);
      
      // Try using the standard pair format first
      let rateData = await CurrencyCache.getCachedRate(standardPair.pair);
      if (rateData && rateData.rate && rateData.rate > 0) {
        const actualRate = standardPair.isInverted ? 1 / rateData.rate : rateData.rate;        const convertedAmount = amount * actualRate;
        console.log(`   Result: ${amount} ${fromCurrency} = ${convertedAmount.toFixed(4)} ${toCurrency}`);
        return convertedAmount;
      }
      
      // Fallback: Try both direct and inverse pairs (legacy support)
      const directPair = `${fromCurrency}${toCurrency}.FOREX`;
      const inversePair = `${toCurrency}${fromCurrency}.FOREX`;
      
      const directRate = await CurrencyCache.getCachedRate(directPair);
      if (directRate && directRate.rate && directRate.rate > 0) {        const convertedAmount = amount * directRate.rate;
        console.log(`   Result: ${amount} ${fromCurrency} = ${convertedAmount.toFixed(4)} ${toCurrency}`);
        return convertedAmount;
      }
      
      const inverseRate = await CurrencyCache.getCachedRate(inversePair);
      if (inverseRate && inverseRate.rate && inverseRate.rate > 0) {        const convertedAmount = amount / inverseRate.rate;
        console.log(`   Result: ${amount} ${fromCurrency} = ${convertedAmount.toFixed(4)} ${toCurrency}`);
        return convertedAmount;
      }
      
      // Special handling for USD pairs using standard pair format
      let finalRate = null;
      let ratePair = null;
      
      if (fromCurrency === 'USD' || toCurrency === 'USD') {
        const usdStandardPair = this.getStandardCurrencyPair(fromCurrency, toCurrency);
        const rate = await CurrencyCache.getCachedRate(usdStandardPair.pair);
        if (rate && rate.rate && rate.rate > 0) {
          finalRate = usdStandardPair.isInverted ? 1 / rate.rate : rate.rate;
          ratePair = `${usdStandardPair.pair} ${usdStandardPair.isInverted ? '(inverted)' : ''}`;        }
      } else {
        // Neither is USD, need to convert through USD
        // Convert from->USD, then USD->to
        console.log(`🔄 Cross-currency conversion ${fromCurrency}->${toCurrency} via USD`);
        const fromToUsd = await this.convertCurrency(amount, fromCurrency, 'USD');
        if (Math.abs(fromToUsd - amount) > 0.0001) { // Conversion succeeded (allow for small floating point differences)
          const result = await this.convertCurrency(fromToUsd, 'USD', toCurrency);
          console.log(`   Cross-conversion result: ${amount} ${fromCurrency} -> ${fromToUsd.toFixed(4)} USD -> ${result.toFixed(4)} ${toCurrency}`);
          return result;
        }
        console.warn(`❌ Cross-currency conversion failed: ${fromCurrency} -> USD returned same amount`);
      }
      
      if (finalRate && finalRate > 0) {
        const convertedAmount = amount * finalRate;
        console.log(`   Final result: ${amount} ${fromCurrency} = ${convertedAmount.toFixed(4)} ${toCurrency} (using ${ratePair})`);
        return convertedAmount;
      }
      
      // As last resort, try to refresh the main currency pairs and try again
      console.log(`🔄 Last resort: refreshing main currency pairs...`);
      await CurrencyCache.refreshCurrencyRates();
      
      // Try one more time with the refreshed cache using standard pair
      const retryStandardRate = await CurrencyCache.getCachedRate(standardPair.pair);
      if (retryStandardRate && retryStandardRate.rate && retryStandardRate.rate > 0) {
        const actualRate = standardPair.isInverted ? 1 / retryStandardRate.rate : retryStandardRate.rate;        const convertedAmount = amount * actualRate;
        return convertedAmount;
      }
      
      // Final fallback with legacy pairs
      const retryDirectRate = await CurrencyCache.getCachedRate(directPair);
      if (retryDirectRate && retryDirectRate.rate && retryDirectRate.rate > 0) {        const convertedAmount = amount * retryDirectRate.rate;
        return convertedAmount;
      }
      
      const retryInverseRate = await CurrencyCache.getCachedRate(inversePair);
      if (retryInverseRate && retryInverseRate.rate && retryInverseRate.rate > 0) {        const convertedAmount = amount / retryInverseRate.rate;
        return convertedAmount;
      }
      
      console.error(`❌ Currency conversion FAILED: No rate found for ${fromCurrency}/${toCurrency} after all attempts`);
      console.error(`   Attempted standard pair: ${standardPair.pair}, fallback pairs: ${directPair}, ${inversePair}`);
      console.error(`   This will result in incorrect currency display!`);
      return amount;
      
    } catch (error) {
      console.error(`❌ Error converting currency ${fromCurrency} to ${toCurrency}:`, error);
      return amount; // Return original amount on error
    }
  },

  // Add a stock holding to bank account
  async addHolding(bankAccountId, userId, accountNumber, stockData, transactionData) {
    check(bankAccountId, String);
    check(userId, String);
    check(accountNumber, String);
    check(stockData, {
      symbol: String,
      isin: Match.Optional(String),
      exchange: String,
      fullTicker: String,
      companyName: String,
      sector: Match.Optional(String),
      currency: String,
      currentPrice: Number
    });
    check(transactionData, {
      quantity: Number,
      price: Number,
      fees: Match.Optional(Number),
      date: Match.Optional(Date),
      notes: Match.Optional(String),
      manualFxRate: Match.Optional(Number)
    });

    // Get bank account to know reference currency
    const bankAccount = await BankAccountsCollection.findOneAsync(bankAccountId);
    if (!bankAccount) {
      throw new Meteor.Error('bank-account-not-found', 'Bank account not found');
    }

    const referenceCurrency = bankAccount.referenceCurrency || 'USD';
    const stockCurrency = stockData.currency || 'USD';
    
    // IMPORTANT: Reference currency changes
    // When a user changes their bank account reference currency, existing holdings
    // maintain their historical FX rates for accurate cost basis calculation.
    // Only new transactions use the updated reference currency.
    // This ensures P&L calculations remain accurate across currency changes.

    // Get FX rate - use manual rate if provided, otherwise fetch current market rate
    let currentFxRate;
    let fxRateData;
    
    if (transactionData.manualFxRate && transactionData.manualFxRate > 0) {
      // Use manual FX rate provided by user
      currentFxRate = transactionData.manualFxRate;
      fxRateData = {
        rate: currentFxRate,
        pair: `${stockCurrency}${referenceCurrency}.MANUAL`,
        inverse: false,
        timestamp: new Date()
      };
      console.log(`💱 Using manual FX rate: ${stockCurrency}→${referenceCurrency}: ${currentFxRate} (USER PROVIDED)`);
    } else {
      // Fetch current market FX rate
      fxRateData = await this.getFxRateWithMetadata(stockCurrency, referenceCurrency);
      currentFxRate = fxRateData.rate;
      console.log(`💱 Using market FX rate: ${stockCurrency}→${referenceCurrency}: ${currentFxRate} (${fxRateData.pair})`);
    }

    // Convert current price to account currency for display
    const convertedCurrentPrice = stockData.currentPrice * currentFxRate;
    // Convert transaction price to account currency
    const convertedTransactionPrice = transactionData.price * currentFxRate;

    // Check if holding already exists
    const existingHolding = await EquityHoldingsCollection.findOneAsync({
      bankAccountId,
      userId,
      symbol: stockData.symbol,
      exchange: stockData.exchange
    });

    const transaction = {
      type: 'BUY',
      quantity: transactionData.quantity,
      price: transactionData.price, // Original price in stock currency
      priceInAccountCurrency: convertedTransactionPrice, // Price in account currency
      amount: transactionData.quantity * convertedTransactionPrice, // Total in account currency
      fees: transactionData.fees || 0,
      date: transactionData.date || new Date(),
      notes: transactionData.notes || '',
      // FX rate metadata for historical P&L calculation
      fxRate: currentFxRate,
      fxPair: fxRateData.pair,
      stockCurrency: stockCurrency,
      accountCurrency: referenceCurrency,
      // Manual FX rate tracking
      isManualFxRate: !!(transactionData.manualFxRate && transactionData.manualFxRate > 0),
      originalManualFxRate: transactionData.manualFxRate || null
    };

    if (existingHolding) {
      // Update existing holding with weighted average FX rate calculation
      const newQuantity = existingHolding.quantity + transactionData.quantity;
      const newTotalCost = existingHolding.totalCost + transaction.amount + transaction.fees;
      const newAveragePrice = newTotalCost / newQuantity;
      
      // Calculate weighted average FX rate for cost basis
      const existingTotalCost = existingHolding.totalCost || 0;
      const newTransactionCost = transaction.amount + transaction.fees;
      const existingFxRate = existingHolding.fxRates?.averagePurchaseRate || 1;
      
      const weightedAverageFxRate = existingTotalCost + newTransactionCost > 0 ?
        ((existingTotalCost * existingFxRate) + (newTransactionCost * currentFxRate)) / (existingTotalCost + newTransactionCost) :
        currentFxRate;

      // Calculate current value using current FX rate
      const newCurrentValue = newQuantity * convertedCurrentPrice;
      const newTotalReturn = newCurrentValue - newTotalCost;
      const newTotalReturnPercent = newTotalCost > 0 ? (newTotalReturn / newTotalCost) * 100 : 0;      await EquityHoldingsCollection.updateAsync(existingHolding._id, {
        $set: {
          quantity: newQuantity,
          averagePrice: newAveragePrice,
          totalCost: newTotalCost,
          currentPrice: convertedCurrentPrice,
          currentValue: newCurrentValue,
          totalReturn: newTotalReturn,
          totalReturnPercent: newTotalReturnPercent,
          lastUpdated: new Date(),
          // Store FX rates for accurate P&L calculation
          fxRates: {
            averagePurchaseRate: weightedAverageFxRate,
            currentRate: currentFxRate,
            lastRateUpdate: new Date()
          },
          // Store original price information
          originalPrice: stockData.currentPrice,
          originalCurrency: stockCurrency
        },
        $push: { transactions: transaction }
      });

      return existingHolding._id;
    } else {
      // Create new holding
      const totalCost = transaction.amount + transaction.fees;
      const currentValue = transactionData.quantity * convertedCurrentPrice;
      const totalReturn = currentValue - totalCost;
      const totalReturnPercent = totalCost > 0 ? (totalReturn / totalCost) * 100 : 0;      const holding = {
        userId,
        bankAccountId,
        accountNumber,
        symbol: stockData.symbol,
        isin: stockData.isin || '',
        exchange: stockData.exchange,
        fullTicker: stockData.fullTicker,
        companyName: stockData.companyName,
        sector: stockData.sector || '',
        currency: stockCurrency, // Store original stock currency
        quantity: transactionData.quantity,
        averagePrice: convertedTransactionPrice,
        totalCost,
        currentPrice: convertedCurrentPrice,
        previousClosePrice: convertedCurrentPrice, // Initialize with current price
        currentValue,
        dayChange: 0, // No day change on first day
        dayChangePercent: 0,
        totalReturn,
        totalReturnPercent,
        purchaseDate: transaction.date,
        lastUpdated: new Date(),
        transactions: [transaction],
        // Store FX rates for accurate P&L calculation
        fxRates: {
          averagePurchaseRate: currentFxRate, // Initial purchase rate
          currentRate: currentFxRate, // Current rate (same as purchase initially)
          lastRateUpdate: new Date()
        },
        // Store original price information for reference
        originalPrice: stockData.currentPrice,
        originalCurrency: stockCurrency
      };

      return await EquityHoldingsCollection.insertAsync(holding);
    }
  },

  // Get holdings for a bank account
  async getBankAccountHoldings(bankAccountId, userId) {
    check(bankAccountId, String);
    check(userId, String);
    
    return await EquityHoldingsCollection.find(
      { bankAccountId, userId },
      { sort: { currentValue: -1 } }
    ).fetchAsync();
  },

  // Get all holdings for a user across all their bank accounts
  async getUserHoldings(userId) {
    check(userId, String);
    
    return await EquityHoldingsCollection.find(
      { userId },
      { sort: { currentValue: -1 } }
    ).fetchAsync();
  },

  // Remove a holding
  async removeHolding(holdingId, userId) {
    check(holdingId, String);
    check(userId, String);
    
    const holding = await EquityHoldingsCollection.findOneAsync({ _id: holdingId, userId });
    if (!holding) throw new Meteor.Error('not-found', 'Holding not found');

    await EquityHoldingsCollection.removeAsync(holdingId);
  },

  // Sell shares from a holding
  async sellShares(holdingId, userId, quantity, price, fees = 0, date = new Date(), notes = '') {
    check(holdingId, String);
    check(userId, String);
    check(quantity, Number);
    check(price, Number);
    check(fees, Number);
    check(date, Date);
    check(notes, String);

    const holding = await EquityHoldingsCollection.findOneAsync({ _id: holdingId, userId });
    if (!holding) throw new Meteor.Error('not-found', 'Holding not found');
    
    if (quantity > holding.quantity) {
      throw new Meteor.Error('insufficient-shares', 'Not enough shares to sell');
    }

    const transaction = {
      type: 'SELL',
      quantity: -quantity, // Negative for sale
      price,
      amount: quantity * price,
      fees,
      date,
      notes
    };

    const newQuantity = holding.quantity - quantity;
    
    if (newQuantity === 0) {
      // Remove holding completely
      await this.removeHolding(holdingId, userId);
    } else {
      // Update holding with remaining shares
      const newCurrentValue = newQuantity * holding.currentPrice;
      const newTotalReturn = newCurrentValue - holding.totalCost;
      const newTotalReturnPercent = (newTotalReturn / holding.totalCost) * 100;

      await EquityHoldingsCollection.updateAsync(holdingId, {
        $set: {
          quantity: newQuantity,
          currentValue: newCurrentValue,
          totalReturn: newTotalReturn,
          totalReturnPercent: newTotalReturnPercent,
          lastUpdated: new Date()
        },
        $push: { transactions: transaction }
      });
    }
  },

  // Update prices for all holdings with currency conversion
  async updatePrices(bankAccountId, userId, priceData) {
    check(bankAccountId, String);
    check(userId, String);
    check(priceData, Object);

    // Get bank account to know reference currency
    const bankAccount = await BankAccountsCollection.findOneAsync(bankAccountId);
    if (!bankAccount) {
      throw new Meteor.Error('bank-account-not-found', 'Bank account not found');
    }

    const referenceCurrency = bankAccount.referenceCurrency || 'USD';
    const holdings = await this.getBankAccountHoldings(bankAccountId, userId);
    
    for (const holding of holdings) {
      const priceInfo = priceData[holding.fullTicker];
      if (priceInfo && !priceInfo.error) {
        // Extract price from the price object
        const newPriceInStockCurrency = typeof priceInfo === 'number' ? priceInfo : 
                                       (priceInfo.price || priceInfo.close || 0);
        
        if (newPriceInStockCurrency > 0) {
          // Convert price from stock currency to bank account reference currency
          const stockCurrency = holding.currency || 'USD';
          console.log(`🔄 Processing ${holding.symbol}: ${stockCurrency} -> ${referenceCurrency}`);
          
          let convertedPrice;
          let conversionRate;
          
          if (stockCurrency === referenceCurrency) {
            // No conversion needed
            convertedPrice = newPriceInStockCurrency;
            conversionRate = 1;
            console.log(`   No conversion needed (same currency)`);
          } else {
            // Get current FX rate with metadata
            const fxRateData = await this.getFxRateWithMetadata(stockCurrency, referenceCurrency);
            convertedPrice = newPriceInStockCurrency * fxRateData.rate;
            conversionRate = fxRateData.rate;
            
            console.log(`   Price conversion: ${newPriceInStockCurrency} ${stockCurrency} -> ${convertedPrice.toFixed(4)} ${referenceCurrency}`);
            console.log(`   FX rate: ${conversionRate.toFixed(4)} (${fxRateData.pair})`);
            
            if (fxRateData.error) {
              console.warn(`⚠️  FX rate error for ${stockCurrency} -> ${referenceCurrency}: ${fxRateData.error}`);
            }
          }
          
          // For day change, use the EOD API's change/change_p fields which represent the last session performance
          // These fields show the change from the previous close, whether market is open or closed
          let dayChange = 0;
          let dayChangePercent = 0;
          let previousClosePrice = holding.previousClosePrice || 0;
          let priceChangePerShare = 0;
          
          // First priority: Use EOD API's change and change_p if available (these are the last session's change)
          if (priceInfo.change !== undefined && priceInfo.change !== null && priceInfo.change !== 'NA' && priceInfo.change !== 0) {
            // The change is in stock currency, convert to account currency
            const changeInStockCurrency = typeof priceInfo.change === 'number' ? priceInfo.change : parseFloat(priceInfo.change);
            if (!isNaN(changeInStockCurrency) && changeInStockCurrency !== 0) {
              priceChangePerShare = changeInStockCurrency * conversionRate;
              dayChange = holding.quantity * priceChangePerShare;
              
              // Also get the percentage if available
              if (priceInfo.change_p !== undefined && priceInfo.change_p !== null && priceInfo.change_p !== 'NA') {
                const changePercent = typeof priceInfo.change_p === 'number' ? priceInfo.change_p : parseFloat(priceInfo.change_p);
                if (!isNaN(changePercent)) {
                  dayChangePercent = changePercent;
                }
              } else if (priceInfo.changePercent !== undefined && priceInfo.changePercent !== null && priceInfo.changePercent !== 'NA') {
                const changePercent = typeof priceInfo.changePercent === 'number' ? priceInfo.changePercent : parseFloat(priceInfo.changePercent);
                if (!isNaN(changePercent)) {
                  dayChangePercent = changePercent;
                }
              } else {
                // Calculate percentage from the change amount
                const prevPrice = convertedPrice - priceChangePerShare;
                dayChangePercent = prevPrice > 0 ? (priceChangePerShare / prevPrice) * 100 : 0;
              }
            }
          }
          
          // Second priority: Calculate from previous close if available
          if (dayChange === 0) {
            // Try to get previous close from API response
            const apiPrevClose = priceInfo.previousClose || priceInfo.previous_close || priceInfo.prev_close;
            
            if (apiPrevClose && apiPrevClose > 0) {
              // Convert previous close to account currency
              const fxRateData = await this.getFxRateWithMetadata(stockCurrency, referenceCurrency);
              previousClosePrice = apiPrevClose * fxRateData.rate;
              priceChangePerShare = convertedPrice - previousClosePrice;
              dayChange = holding.quantity * priceChangePerShare;
              dayChangePercent = previousClosePrice > 0 ? (priceChangePerShare / previousClosePrice) * 100 : 0;
            } else if (holding.previousClosePrice && holding.previousClosePrice > 0) {
              // Use stored previous close as fallback
              previousClosePrice = holding.previousClosePrice;
              priceChangePerShare = convertedPrice - previousClosePrice;
              dayChange = holding.quantity * priceChangePerShare;
              dayChangePercent = previousClosePrice > 0 ? (priceChangePerShare / previousClosePrice) * 100 : 0;
            }
          }
          
          const newCurrentValue = holding.quantity * convertedPrice;

          console.log(`   Day change calculation for ${holding.symbol}:`);
          if (priceInfo.change !== undefined && priceInfo.change !== null) {
            console.log(`   Using EOD API change data: ${priceInfo.change} ${stockCurrency} (${priceInfo.change_p || priceInfo.changePercent || 0}%)`);
          } else if (previousClosePrice > 0) {
            console.log(`   Previous close: ${previousClosePrice.toFixed(4)} ${referenceCurrency}`);
            console.log(`   Current price: ${convertedPrice.toFixed(4)} ${referenceCurrency}`);
          }
          console.log(`   Day change: ${dayChange.toFixed(2)} ${referenceCurrency} (${dayChangePercent.toFixed(2)}%)`);
          
          // Cost basis must always be in the bank account reference currency.
          // It is tracked via averagePrice in reference currency, so recompute from quantity * averagePrice.
          const costBasis = (holding.quantity || 0) * (holding.averagePrice || 0);
          const newTotalReturn = newCurrentValue - costBasis;
          const newTotalReturnPercent = costBasis > 0 ? (newTotalReturn / costBasis) * 100 : 0;

          // Debug: verify basis and percent calculations
          try {
            console.log(`   Basis check for ${holding.symbol}: qty=${holding.quantity}, avgPrice=${(holding.averagePrice||0).toFixed(4)} ${referenceCurrency}`);
            console.log(`   costBasis=${costBasis.toFixed(2)} ${referenceCurrency}, prevTotalCost=${(holding.totalCost||0).toFixed(2)} ${referenceCurrency}`);
            console.log(`   return=${newTotalReturn.toFixed(2)} ${referenceCurrency} (${newTotalReturnPercent.toFixed(2)}%)`);
          } catch (_) {}

          // Use the price date if available, otherwise current time
          const priceDate = priceInfo.date || new Date();
          
          console.log(`   Final values: currentValue ${newCurrentValue.toFixed(2)} ${referenceCurrency}, totalReturn ${newTotalReturn.toFixed(2)} ${referenceCurrency}`);
          
          // Calculate proper P&L using historical FX rates
          const averagePurchaseRate = holding.fxRates?.averagePurchaseRate || conversionRate;
          
          // Cost basis: Historical cost in account currency (using average purchase FX rate)
          const totalCostInAccountCurrency = holding.totalCost || (holding.quantity * holding.averagePrice);
          
          // Current value: Current stock price * current FX rate * quantity
          const currentValueInAccountCurrency = newCurrentValue;
          
          // P&L in account currency
          const totalReturnInAccountCurrency = currentValueInAccountCurrency - totalCostInAccountCurrency;
          const totalReturnPercentInAccountCurrency = totalCostInAccountCurrency > 0 ? 
            (totalReturnInAccountCurrency / totalCostInAccountCurrency) * 100 : 0;

          console.log(`   FX-adjusted P&L: Purchase rate ${averagePurchaseRate.toFixed(4)}, Current rate ${conversionRate.toFixed(4)}`);
          console.log(`   Cost basis: ${totalCostInAccountCurrency.toFixed(2)} ${referenceCurrency}, Current value: ${currentValueInAccountCurrency.toFixed(2)} ${referenceCurrency}`);
          console.log(`   Total return: ${totalReturnInAccountCurrency.toFixed(2)} ${referenceCurrency} (${totalReturnPercentInAccountCurrency.toFixed(2)}%)`);

          await EquityHoldingsCollection.updateAsync(holding._id, {
            $set: {
              // Store previous current price as previous close before updating
              previousClosePrice: holding.currentPrice || previousClosePrice,
              currentPrice: convertedPrice,
              currentValue: currentValueInAccountCurrency,
              totalCost: totalCostInAccountCurrency,
              dayChange,
              dayChangePercent,
              totalReturn: totalReturnInAccountCurrency,
              totalReturnPercent: totalReturnPercentInAccountCurrency,
              lastPriceUpdate: priceDate,
              lastUpdated: new Date(),
              // Update current FX rate for future calculations
              'fxRates.currentRate': conversionRate,
              'fxRates.lastRateUpdate': new Date(),
              // Store original price information for reference
              originalPrice: newPriceInStockCurrency,
              originalCurrency: stockCurrency,
              // Store price metadata for display
              priceSource: priceInfo.source || 'unknown',
              isMarketClose: priceInfo.isMarketClose || false,
              originalTimestamp: priceInfo.originalTimestamp || null
            }
          });        } else {
          console.log(`Invalid price data for ${holding.fullTicker}: ${newPriceInStockCurrency}`);
        }
      } else {
        console.log(`No price data for ${holding.fullTicker}:`, priceInfo?.error || 'No data');
      }
    }
  },

  // Get summary statistics for a bank account
  async getBankAccountSummary(bankAccountId, userId) {
    check(bankAccountId, String);
    check(userId, String);
    
    const holdings = await this.getBankAccountHoldings(bankAccountId, userId);
    
    return holdings.reduce((acc, holding) => {
      acc.totalValue += holding.currentValue;
      acc.totalCost += holding.totalCost;
      acc.dayChange += holding.dayChange;
      acc.totalReturn += holding.totalReturn;
      acc.holdingsCount++;
      return acc;
    }, { 
      totalValue: 0, 
      totalCost: 0, 
      dayChange: 0, 
      totalReturn: 0,
      holdingsCount: 0,
      totalReturnPercent: 0,
      dayChangePercent: 0
    });
  },

  // Migrate existing holdings to use new FX rate structure
  async migrateFxRatesForHolding(holdingId) {
    const holding = await EquityHoldingsCollection.findOneAsync(holdingId);
    if (!holding) {
      throw new Meteor.Error('not-found', 'Holding not found');
    }

    // Skip if already migrated
    if (holding.fxRates) {
      console.log(`Holding ${holding.symbol} already has FX rates structure`);
      return;
    }

    const bankAccount = await BankAccountsCollection.findOneAsync(holding.bankAccountId);
    const referenceCurrency = bankAccount?.referenceCurrency || 'USD';
    const stockCurrency = holding.currency || 'USD';

    console.log(`🔄 Migrating FX rates for ${holding.symbol} (${stockCurrency} → ${referenceCurrency})`);

    // Calculate weighted average FX rate from historical transactions
    let totalCost = 0;
    let weightedFxRateSum = 0;

    if (holding.transactions && holding.transactions.length > 0) {
      for (const transaction of holding.transactions) {
        if (transaction.type === 'BUY' && transaction.fxRate) {
          // Transaction already has FX rate
          const transactionCost = transaction.amount;
          totalCost += transactionCost;
          weightedFxRateSum += transactionCost * transaction.fxRate;
        } else if (transaction.type === 'BUY') {
          // Calculate FX rate from original vs converted prices
          const transactionCost = transaction.amount;
          totalCost += transactionCost;
          
          // If we have original price info, calculate the rate
          if (transaction.priceInAccountCurrency && transaction.price) {
            const calculatedRate = transaction.priceInAccountCurrency / transaction.price;
            weightedFxRateSum += transactionCost * calculatedRate;
          } else {
            // Use current conversion rate as fallback
            const fxRateData = await this.getFxRateWithMetadata(stockCurrency, referenceCurrency);
            weightedFxRateSum += transactionCost * fxRateData.rate;
          }
        }
      }
    }

    const averagePurchaseRate = totalCost > 0 ? weightedFxRateSum / totalCost : 1;
    
    // Get current FX rate
    const currentFxRateData = await this.getFxRateWithMetadata(stockCurrency, referenceCurrency);
    
    console.log(`   Average purchase FX rate: ${averagePurchaseRate.toFixed(4)}`);
    console.log(`   Current FX rate: ${currentFxRateData.rate.toFixed(4)}`);

    // Update holding with FX rate structure
    await EquityHoldingsCollection.updateAsync(holdingId, {
      $set: {
        fxRates: {
          averagePurchaseRate: averagePurchaseRate,
          currentRate: currentFxRateData.rate,
          lastRateUpdate: new Date()
        }
      }
    });  },

  // Migrate all holdings to use new FX rate structure
  async migrateAllHoldingsFxRates() {
    const holdings = await EquityHoldingsCollection.find({ 
      fxRates: { $exists: false } 
    }).fetchAsync();

    console.log(`🔄 Migrating ${holdings.length} holdings to new FX rate structure`);

    for (const holding of holdings) {
      try {
        await this.migrateFxRatesForHolding(holding._id);
      } catch (error) {
        console.error(`❌ Failed to migrate ${holding.symbol}:`, error);
      }
    }  }
};