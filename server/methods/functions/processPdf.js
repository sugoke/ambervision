import { Meteor } from 'meteor/meteor';
import { HTTP } from 'meteor/http';
import { Products } from '/imports/api/products/products.js';
import pdfParse from 'pdf-parse';

const getOpenAIKey = () => {
  const key = Meteor.settings?.private?.openaiKey;
  if (!key) {
    throw new Meteor.Error('openai-key-missing', 'OpenAI API key not configured');
  }
  return key;
};

Meteor.methods({
  async processPdfWithAI(fileData) {
    try {
      console.log('Starting PDF processing...');
      
      // Extract text from PDF
      const pdfData = await pdfParse(fileData);
      const pdfText = pdfData.text;

      const prompt = `You are a financial document parser specialized in structured products. 
      Parse this term sheet and return a JSON object with EXACTLY this structure:
      {
        "status": "pending",
        "genericData": {
          "ISINCode": "string",
          "currency": "string",
          "issuer": "string", //keep only the name of the bank
          "settlementType": "string", //physical or cash settlement, it will generally be in the final redemption section
          "settlementTx": "string", //here it is the number of days between trade date and settlement date
          "tradeDate": "YYYY-MM-DD",
          "paymentDate": "YYYY-MM-DD",
          "finalObservation": "YYYY-MM-DD",
          "maturityDate": "YYYY-MM-DD",
          "template": "phoenix",
          "name": "string"
        },
        "features": {
          "memoryCoupon": boolean, //generally the document will mention memory coupon, or include something like N x 4.1250% x (1 + T) Where: T is the number of Coupon Payment Dates since the last Coupon Payment Date on which aCoupon was paid
          "memoryAutocall": boolean, // generally it is true when there is this kind of wording: the official closing price of such Underlying Share on that Automatic Early Redemption Valuation Daten or any of the Automatic Early Redemption Valuation Daten which precede that Automatic Early Redemption Valuation Daten is greater than or equal to
          "oneStar": boolean,
          "lowStrike": boolean, //true when the formula takes into account a percentage of the initial reference level to calculate a loss. another way to spot a low strike is when the formula is something like "100% + 10% x (S/S0 - 1)" where S0 is the initial reference level and S is the final reference level is when a strike level for a stock is indicated lower than 100% or than its initial reference level
          "autocallStepdown": boolean, //true when Automatic Early Redemption Price goes down every period
          "jump": boolean,
          "stepDown": boolean, //true when Automatic Early Redemption Price goes down every period
          "couponBarrier": number,
          "capitalProtectionBarrier": number,
          "couponPerPeriod": number
        },
        "underlyings": [
          {
            "name": "string",
            "ticker": "string",
            "exchange": "string",
            "country": "string", 
            "currency": "string",
            "initialReferenceLevel": number,
            "eodTicker": "string",
            "lastPriceInfo": {}
          }
        ],
        "observationDates": [
          {
            "observationDate": "YYYY-MM-DD",
            "paymentDate": "YYYY-MM-DD",
            "couponBarrierLevel": number,
            "autocallLevel": number or null, //leave null if there is no autocall info for that date
            "couponPerPeriod": number
          } //make sure the last observation date is the Final Valuation Date and that its payment date is the Maturity Date
        ]
      }

      Important rules:
      1. The structure must match EXACTLY - no additional or missing fields
      2. All dates must be in YYYY-MM-DD format
      3. All percentages should be numbers (e.g., 70 instead of "70%")
      4. For missing fields, use null
      5. For underlyings, create the eodTicker by combining ticker and exchange (e.g., "AAPL.US")
      6. lastPriceInfo should be an empty object
      7. The name field should be "Phoenix on " followed by the tickers joined with " / "`;

      console.log('Sending request to OpenAI API...');
      
      const response = await HTTP.call('POST', 'https://api.openai.com/v1/chat/completions', {
        headers: {
          'Authorization': `Bearer ${getOpenAIKey()}`,
          'Content-Type': 'application/json',
        },
        data: {
          model: "gpt-4-1106-preview",
          messages: [
            {
              role: "user", 
              content: [
                {
                  type: "text",
                  text: prompt + "\n\nHere is the PDF content:\n" + pdfText.substring(0, 12000)
                }
              ]
            }
          ],
          temperature: 0.1,
          response_format: { type: "json_object" }
        }
      });

      console.log('Full API response:', JSON.stringify(response, null, 2));
      console.log('Response data type:', typeof response.data);
      console.log('Response content:', response.data.choices?.[0]?.message?.content);

      // Extract the message content directly from response
      let messageContent = response.data.choices[0].message.content;
      console.log('Raw message content:', messageContent);

      // Find the start of the JSON object (first '{')
      const jsonStartIndex = messageContent.indexOf('{');
      if (jsonStartIndex === -1) {
        console.error('No JSON object found in response');
        throw new Meteor.Error('parsing-error', 'No JSON object found in response');
      }

      // Extract only the JSON part
      messageContent = messageContent.substring(jsonStartIndex);
      console.log('Cleaned message content:', messageContent);

      // Attempt to parse the JSON content
      try {
        const parsedData = JSON.parse(messageContent);
        console.log('Successfully parsed JSON:', parsedData);
        const productId = Products.insert(parsedData);

        return {
          success: true,
          isin: parsedData.genericData.ISINCode,
          productId: productId
        };
      } catch (parseError) {
        console.error('Error parsing JSON:', parseError);
        throw new Meteor.Error('json-parsing-error', 'Failed to parse JSON from API response');
      }

    } catch (error) {
      console.error('Error processing PDF:', error);
      throw new Meteor.Error('processing-error', error.message);
    }
  }
});
