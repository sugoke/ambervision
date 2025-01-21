import { Meteor } from 'meteor/meteor';
import { HTTP } from 'meteor/http';
import { check } from 'meteor/check';

Meteor.methods({
  getAiCommentary(productData, prompt) {
    check(productData, Object);
    check(prompt, String);

    try {
      // Remove news data to reduce payload size
      const cleanProductData = {
        ...productData,
        news: undefined
      };

      const result = HTTP.post('https://api.deepseek.com/v1/chat/completions', {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Meteor.settings.private.deepseekKey}`
        },
        data: {
          model: 'deepseek-chat',
          messages: [
            {
              role: 'system',
              content: 'You are a financial advisor providing commentary on structured products. Make a client friendly summary using all available information, with underlyings levels, explanation if related to some news, level compared to different barriers, time left till the end. Keep a positive vibe and don t blame the choice of underlyings. comment on the coupons paid. Speak in natural language as a paragraph no subheadings. Comment if some stocks have been locked for memoryAutocall lock'
            },
            {
              role: 'user',
              content: `${prompt}\n\nProduct Data: ${JSON.stringify(cleanProductData)}`
            }
          ],
          temperature: 0.7,
          max_tokens: 300
        }
      });

      if (!result.data || !result.data.choices || !result.data.choices[0]) {
        throw new Meteor.Error('api-error', 'Invalid response from Deepseek API');
      }

      return result.data.choices[0].message.content;
    } catch (error) {
      console.error('AI Commentary error:', error.message);
      throw new Meteor.Error('ai-commentary-error', 'Failed to generate AI commentary');
    }
  }
}); 