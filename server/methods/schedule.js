import { Meteor } from 'meteor/meteor';
import { Products } from '/imports/api/products/products.js';
import { Holdings } from '/imports/api/products/products.js';
import { Schedules } from '/imports/api/products/products.js';

Meteor.methods({
  generateUserSchedule() {
    console.log('Generating schedules for all users');

    try {
      // Clear existing schedules
      const removedCount = Schedules.remove({});
      console.log(`Cleared ${removedCount} existing schedules`);

      // Fetch all products
      const products = Products.find().fetch();
      console.log('Found products:', products.length);
      console.log('Product ISINs:', products.map(p => p.genericData?.ISINCode).filter(Boolean));

      // Create a map to store all events by ISIN
      const productEvents = new Map();
      const ownedProducts = new Set();

      products.forEach(product => {
        const { genericData, observationDates, observationsTable } = product;
        const ISINCode = genericData?.ISINCode;
        console.log('\n--- Processing product:', ISINCode);
        console.log('Trade date:', genericData?.tradeDate);
        console.log('Final observation:', genericData?.finalObservation);
        console.log('Observation dates:', observationDates?.length || 0);
        console.log('Observations table:', observationsTable?.length || 0);

        const events = [];
        let isAutocalled = false;

        // Add trade date event
        if (genericData && genericData.tradeDate) {
          events.push({
            date: genericData.tradeDate,
            ISINCode,
            productName: genericData.name || 'Unknown Product',
            observationType: 'trade date'
          });
          console.log('Added trade date event:', genericData.tradeDate);
        }

        // Add observation date events
        if (observationDates && Array.isArray(observationDates)) {
          observationDates.forEach((obs, index) => {
            if (obs && obs.observationDate) {
              // Check if the date is present in observationsTable and has autocalled
              const observationResult = observationsTable && observationsTable[index];

              const eventType = index === 0 ? 'first observation' :
                              index === observationDates.length - 1 ? 'final observation' :
                              obs.autocallLevel ? 'autocall observation' : 'coupon observation';

              events.push({
                date: obs.observationDate,
                ISINCode,
                productName: genericData.name || 'Unknown Product',
                observationType: eventType,
                couponBarrier: obs.couponBarrierLevel,
                autocallLevel: obs.autocallLevel,
                couponPerPeriod: obs.couponPerPeriod
              });
              console.log(`Added ${eventType} event:`, obs.observationDate);

              if (observationResult && observationResult.autocalled === true) {
                isAutocalled = true;
                console.log('Product autocalled at:', obs.observationDate);
              }
            }
          });
        }

        // Add maturity date event if not autocalled
        if (!isAutocalled && genericData && genericData.maturityDate) {
          events.push({
            date: genericData.maturityDate,
            ISINCode,
            productName: genericData.name || 'Unknown Product',
            observationType: 'maturity'
          });
          console.log('Added maturity date event:', genericData.maturityDate);
        }

        console.log('Total events generated for product:', events.length);

        // Store events in the map
        productEvents.set(ISINCode, events);

        // Create schedules for users who hold the product
        const holdings = Holdings.find({ isin: ISINCode }).fetch();
        if (holdings.length > 0) {
          ownedProducts.add(ISINCode);
          holdings.forEach(holding => {
            Schedules.upsert(
              { userId: holding.userId },
              {
                $setOnInsert: { userId: holding.userId },
                $addToSet: { events: { $each: events } }
              }
            );
          });
        }
      });

      // Create superAdmin schedule with only unowned products
      const unownedEvents = Array.from(productEvents.entries())
        .filter(([isin]) => !ownedProducts.has(isin))
        .map(([, events]) => events)
        .flat();

      if (unownedEvents.length > 0) {
        Schedules.upsert(
          { userId: 'superAdmin' },
          {
            $setOnInsert: { userId: 'superAdmin' },
            $set: { 
              events: unownedEvents,
              isGlobalSchedule: true
            }
          }
        );
      }

      const finalScheduleCount = Schedules.find().count();
      console.log('\nFinal schedule count in database:', finalScheduleCount);
      console.log('Schedule generation complete');
      
      return { message: 'Schedules generated and updated successfully' };
    } catch (error) {
      console.error('Error generating schedules:', error);
      throw new Meteor.Error('schedule.generation.error', error.message);
    }
  }
});
