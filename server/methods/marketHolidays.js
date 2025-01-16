import { Meteor } from 'meteor/meteor';

Meteor.methods({
  getMarketHolidays() {
    // Combined US and European market holidays for 2024
    return [
      // US Holidays
      '2024-01-01', // New Year's Day
      '2024-01-15', // Martin Luther King Jr. Day (US)
      '2024-02-19', // Presidents Day (US)
      '2024-03-29', // Good Friday
      '2024-05-27', // Memorial Day (US)
      '2024-06-19', // Juneteenth (US)
      '2024-07-04', // Independence Day (US)
      '2024-09-02', // Labor Day (US)
      '2024-11-28', // Thanksgiving Day (US)
      '2024-12-25', // Christmas Day
      
      // European Holidays (Major markets - Germany, France, UK)
      '2024-01-01', // New Year's Day
      '2024-03-29', // Good Friday
      '2024-04-01', // Easter Monday
      '2024-05-01', // Labour Day (Europe)
      '2024-05-08', // Victory Day (France)
      '2024-05-09', // Ascension Day
      '2024-05-20', // Whit Monday
      '2024-07-14', // Bastille Day (France)
      '2024-08-15', // Assumption Day
      '2024-10-03', // German Unity Day
      '2024-11-01', // All Saints Day
      '2024-12-24', // Christmas Eve (half-day in many European markets)
      '2024-12-25', // Christmas Day
      '2024-12-26', // Boxing Day (UK, Germany)
      '2024-12-31', // New Year's Eve (half-day in many European markets)

      // UK Specific
      '2024-05-06', // Early May Bank Holiday
      '2024-08-26', // Summer Bank Holiday
      
      // Swiss Specific
      '2024-08-01', // Swiss National Day
      
      // Additional major European market closures
      '2024-06-03', // Pentecost Monday (Germany, France)
      '2024-10-28', // Bank Holiday (Ireland)
      '2024-12-06', // St. Nicholas Day (Germany - some regions)
    ].sort(); // Sort dates for better readability
  }
}); 