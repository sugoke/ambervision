import { Schedules } from '/imports/api/products/products.js';
import { Holdings } from '/imports/api/products/products.js';
import { Meteor } from 'meteor/meteor';

export const getScheduleData = (templateInstance) => {
  const scheduleEvents = () => {
    const currentUserId = Meteor.userId();
    console.log('Current User ID:', currentUserId);
    
    if (!currentUserId) return [];

    const userRole = templateInstance.userRole.get();
    console.log('User Role:', userRole);
    
    let schedules;

    if (userRole === 'superAdmin') {
      schedules = Schedules.find().fetch();
    } else {
      // Get user's holdings ISINs
      const userHoldings = Holdings.find({ userId: currentUserId }).fetch();
      console.log('User Holdings:', userHoldings);
      
      const userIsins = userHoldings.map(holding => holding.ISINCode);
      console.log('User ISINs:', userIsins);
      
      schedules = Schedules.find({ ISINCode: { $in: userIsins } }).fetch();
      console.log('Found Schedules:', schedules);
    }

    const now = new Date();
    console.log('Current date:', now);

    const formattedSchedules = schedules.flatMap(schedule => {
      console.log('Processing schedule:', schedule);
      
      if (!schedule.events || !Array.isArray(schedule.events)) {
        console.log('Schedule has no events:', schedule);
        return [];
      }

      return schedule.events.map(event => {
        // Ensure we're creating Date objects correctly
        const eventDate = new Date(event.date);
        console.log('Processing event:', {
          rawDate: event.date,
          parsedDate: eventDate,
          name: event.name || 'Unnamed Event',
          isin: event.ISINCode || schedule.ISINCode
        });
        
        // Calculate days left
        const daysLeft = Math.ceil((eventDate - now) / (1000 * 60 * 60 * 24));

        return {
          ...event,
          date: eventDate,
          name: event.name || event.observationType || 'Unnamed Event',
          ISINCode: event.ISINCode || schedule.ISINCode || 'Unknown ISIN',
          daysLeft: daysLeft
        };
      });
    }).filter(event => {
      const isValidDate = event.date instanceof Date && !isNaN(event.date);
      console.log('Validating event:', {
        date: event.date,
        isValid: isValidDate,
        name: event.name,
        isin: event.ISINCode
      });
      return isValidDate;
    });

    console.log('Formatted schedules:', formattedSchedules);

    // Group events by date and ISINCode
    const groupedEvents = formattedSchedules.reduce((acc, event) => {
      const key = `${event.date.toISOString()}_${event.ISINCode}`;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(event);
      return acc;
    }, {});

    console.log('Grouped events:', groupedEvents);

    // Process events, keeping only final dates when applicable
    const processedEvents = Object.values(groupedEvents).flatMap(group => {
      if (group.length > 1) {
        const finalDateEvent = group.find(e => e.observationType?.toLowerCase() === 'final date');
        if (finalDateEvent) {
          return [{ ...finalDateEvent, isFinalDate: true }];
        }
      }
      return group.map(e => ({ ...e, isFinalDate: group.length === 1 }));
    });

    console.log('Processed events before sorting:', processedEvents);

    // Sort events chronologically
    processedEvents.sort((a, b) => a.date - b.date);

    // Find the index of the first future event
    const nextEventIndex = processedEvents.findIndex(event => {
      const eventTime = event.date.getTime();
      const nowTime = now.getTime();
      const isInFuture = eventTime > nowTime;
      
      console.log('Comparing dates:', {
        eventDate: event.date,
        now: now,
        isInFuture,
        eventName: event.name,
        daysLeft: event.daysLeft
      });
      
      return isInFuture;
    });

    console.log('Next event index:', nextEventIndex);

    // Assign timing
    processedEvents.forEach((event, index) => {
      const timing = index < nextEventIndex ? 'past' 
                  : index === nextEventIndex ? 'next' 
                  : 'future';
      
      event.timing = timing;
      
      console.log('Event timing assigned:', {
        name: event.name,
        date: event.date,
        timing: timing,
        index,
        nextEventIndex
      });
    });

    console.log('Final events list:', processedEvents);

    return processedEvents;
  };

  const gt = (a, b) => {
    return a > b;
  };

  return {
    scheduleEvents,
    gt
  };
};

