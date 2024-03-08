import { Meteor } from 'meteor/meteor';
import { HTTP } from 'meteor/http';
import { Tickers } from '/imports/api/products/products.js'; // Adjust path as necessary

Meteor.methods({
  'tickers.refresh'() {
    console.log("Starting tickers refresh...");

    // Wiping out the Tickers collection
    console.log("Wiping out the Tickers collection...");
    Tickers.remove({});

    const exchanges = [
      // Your exchanges array
      {"Name":"Euronext Paris", "Code":"PA", "Country":"France"},
      {"Name":"USA Stocks", "Code":"US", "Country":"USA"},
  {"Name":"London Exchange", "Code":"LSE", "Country":"UK"},
    {"Name":"XETRA Stock Exchange", "Code":"XETRA", "Country":"Germany"},

/*      {"Name":"USA Stocks", "Code":"US", "Country":"USA"},
  {"Name":"London Exchange", "Code":"LSE", "Country":"UK"},
  {"Name":"Toronto Exchange", "Code":"TO", "Country":"Canada"},
  {"Name":"NEO Exchange", "Code":"NEO", "Country":"Canada"},
  {"Name":"TSX Venture Exchange", "Code":"V", "Country":"Canada"},
  {"Name":"Berlin Exchange", "Code":"BE", "Country":"Germany"},
  {"Name":"Hamburg Exchange", "Code":"HM", "Country":"Germany"},
  {"Name":"XETRA Stock Exchange", "Code":"XETRA", "Country":"Germany"},
  {"Name":"Dusseldorf Exchange", "Code":"DU", "Country":"Germany"},
  {"Name":"Hanover Exchange", "Code":"HA", "Country":"Germany"},
  {"Name":"Munich Exchange", "Code":"MU", "Country":"Germany"},
  {"Name":"Stuttgart Exchange", "Code":"STU", "Country":"Germany"},
  {"Name":"Frankfurt Exchange", "Code":"F", "Country":"Germany"},
  {"Name":"Luxembourg Stock Exchange", "Code":"LU", "Country":"Luxembourg"},
  {"Name":"Vienna Exchange", "Code":"VI", "Country":"Austria"},
  {"Name":"Euronext Paris", "Code":"PA", "Country":"France"},
  {"Name":"Euronext Brussels", "Code":"BR", "Country":"Belgium"},
  {"Name":"Madrid Exchange", "Code":"MC", "Country":"Spain"},
  {"Name":"SIX Swiss Exchange", "Code":"SW", "Country":"Switzerland"},
  {"Name":"Euronext Lisbon", "Code":"LS", "Country":"Portugal"},
  {"Name":"Euronext Amsterdam", "Code":"AS", "Country":"Netherlands"},
  {"Name":"Iceland Exchange", "Code":"IC", "Country":"Iceland"},
  {"Name":"Irish Exchange", "Code":"IR", "Country":"Ireland"},
  {"Name":"Helsinki Exchange", "Code":"HE", "Country":"Finland"},
  {"Name":"Oslo Stock Exchange", "Code":"OL", "Country":"Norway"},
  {"Name":"Copenhagen Exchange", "Code":"CO", "Country":"Denmark"},
  {"Name":"Stockholm Exchange", "Code":"ST", "Country":"Sweden"},
  {"Name":"Australian Securities Exchange", "Code":"AU", "Country":"Australia"},
  {"Name":"Athens Exchange", "Code":"AT", "Country":"Greece"},
  {"Name":"London IL", "Code":"IL", "Country":"UK"}*/
    ];

    const apiKey = "5c265eab2c9066.19444326"; // Your API key

    console.log(`Refreshing tickers for ${exchanges.length} exchanges.`);

    exchanges.forEach((exchange, index) => {
      console.log(`Processing exchange ${index + 1} of ${exchanges.length}: ${exchange.Code}`);

      const url = `https://eodhd.com/api/exchange-symbol-list/${exchange.Code}?api_token=${apiKey}&fmt=json`;

      console.log(`Fetching tickers from: ${url}`);

      // Perform the API request
      try {
        const response = HTTP.get(url);
        const tickers = JSON.parse(response.content);
        console.log(`Fetched ${tickers.length} tickers for ${exchange.Code}.`);

        tickers.forEach((ticker, tickerIndex) => {

          // Skip records with "Type": "FUND" or "Mutual Fund"
          if (ticker.Type === "FUND" || ticker.Type === "Mutual Fund") {
            console.log(`Skipping Fund: ${ticker.Code} - ${ticker.Name}`);
            return; // Skip this iteration
          }


          console.log(`Upserting ticker ${tickerIndex + 1} of ${tickers.length}: ${ticker.Code}`);

          // Here you can filter or adjust the ticker data as necessary
          Tickers.upsert(
            { Code: ticker.Code, Exchange: exchange.Code }, // Find ticker by Code and Exchange
            {
              $set: {
                Name: ticker.Name,
                Country: ticker.Country,
                Exchange: ticker.Exchange,
                Currency: ticker.Currency,
                Type: ticker.Type,
                Isin: ticker.Isin || '',
              }
            }
          );
        });
      } catch (error) {
        console.error(`Error fetching tickers for exchange ${exchange.Code}: ${error}`);
      }
    });

    console.log("Tickers refresh completed.");
  }
});
