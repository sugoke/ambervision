import { Meteor } from 'meteor/meteor';

const ANTHROPIC_API_KEY = Meteor.settings.private?.ANTHROPIC_API_KEY;
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

/**
 * Known financial site API patterns.
 * These sites are SPAs that load price data via JSON APIs.
 * We detect the URL pattern and call the API directly.
 */
const KNOWN_API_PATTERNS = [
  {
    // Deutsche Börse / Börse Frankfurt
    // URL: https://live.deutsche-boerse.com/bond/xs2357951164-... or /equity/... or /etf/...
    match: (url) => {
      const m = url.match(/live\.deutsche-boerse\.com\/(?:bond|equity|etf|etp|fund|certificate)\/([a-z0-9]+)/i);
      if (!m) return null;
      // Extract ISIN from the slug (first part before the dash-separated name)
      const slug = m[1];
      // ISIN is the first 12 chars if it looks like one, otherwise extract from URL params
      const urlObj = new URL(url);
      const mic = urlObj.searchParams.get('mic') || 'XFRA';
      // The slug starts with the ISIN in lowercase
      const isin = slug.substring(0, 12).toUpperCase();
      if (!/^[A-Z]{2}[A-Z0-9]{10}$/.test(isin)) return null;
      return { isin, mic };
    },
    fetch: async ({ isin, mic }) => {
      const apiUrl = `https://api.boerse-frankfurt.de/v1/data/quote_box/single?isin=${isin}&mic=${mic}`;
      const response = await fetch(apiUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      if (!response.ok) throw new Error(`Börse Frankfurt API: HTTP ${response.status}`);
      const data = await response.json();
      if (data.lastPrice == null) throw new Error('No lastPrice in Börse Frankfurt response');
      return { price: data.lastPrice, confidence: 'high' };
    }
  }
];

/**
 * Try known API patterns first, return result or null
 */
async function tryKnownApis(url) {
  for (const pattern of KNOWN_API_PATTERNS) {
    const params = pattern.match(url);
    if (params) {
      console.log(`[PRICE_SCRAPER] Matched known API pattern, fetching directly`);
      return await pattern.fetch(params);
    }
  }
  return null;
}

/**
 * Fetch HTML page content from a URL using native fetch
 */
async function fetchPage(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      redirect: 'follow',
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const content = await response.text();
    if (!content || content.length === 0) {
      throw new Error('Page returned empty content');
    }

    return content;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Meteor.Error('fetch-failed', 'Request timed out after 15s');
    }
    throw new Meteor.Error('fetch-failed', `Failed to fetch page: ${error.message}`);
  }
}

/**
 * Clean HTML content: strip scripts, styles, tags, compress whitespace
 * Truncate to 50K chars to stay within token limits
 */
function cleanHtml(html) {
  let text = html;
  // Remove script and style blocks
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, ' ');
  // Decode common HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  // Compress whitespace
  text = text.replace(/\s+/g, ' ').trim();
  // Truncate to 50K chars
  if (text.length > 50000) {
    text = text.substring(0, 50000);
  }
  return text;
}

/**
 * Use Claude Haiku to extract price from cleaned page content
 */
async function extractPrice(content, name, currency) {
  if (!ANTHROPIC_API_KEY) {
    throw new Meteor.Error('config-error', 'ANTHROPIC_API_KEY not configured in settings');
  }

  const prompt = `Extract the current market price for the financial instrument "${name}" (currency: ${currency}) from the following webpage text. Look for the most prominent/current price displayed on the page.

Return ONLY a JSON object in this exact format, nothing else:
{"price": <number>, "confidence": "<high|medium|low>"}

Rules:
- "price" must be a number (no currency symbols, no commas as thousands separators)
- If you find a clear, unambiguous price, use "high" confidence
- If the price is somewhat ambiguous, use "medium"
- If you cannot find a reliable price, use "low" and set price to null
- Do NOT include any text outside the JSON object

Webpage content:
${content}`;

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 200,
        messages: [
          { role: 'user', content: prompt }
        ]
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Anthropic API ${response.status}: ${errBody}`);
    }

    const data = await response.json();
    const textBlock = data.content.find(b => b.type === 'text');
    if (!textBlock) {
      throw new Error('No text response from AI');
    }

    // Parse JSON from response
    const jsonMatch = textBlock.text.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in AI response');
    }

    const result = JSON.parse(jsonMatch[0]);

    if (result.price === null || result.price === undefined) {
      throw new Error(`AI could not extract price (confidence: ${result.confidence})`);
    }

    if (typeof result.price !== 'number' || isNaN(result.price)) {
      throw new Error(`Invalid price value: ${result.price}`);
    }

    console.log(`[PRICE_SCRAPER] Extracted price for "${name}": ${result.price} ${currency} (confidence: ${result.confidence})`);
    return result;
  } catch (error) {
    if (error.isClientSafe) throw error;
    throw new Meteor.Error('ai-extraction-failed', `AI extraction failed: ${error.message}`);
  }
}

/**
 * Full scrape pipeline:
 * 1. Try known API patterns (for SPA sites like Deutsche Börse)
 * 2. Fall back to HTML fetch + AI extraction
 */
export async function scrapePrice(url, name, currency) {
  console.log(`[PRICE_SCRAPER] Scraping price for "${name}" from ${url}`);

  // Step 1: Try known financial site APIs
  try {
    const apiResult = await tryKnownApis(url);
    if (apiResult) {
      console.log(`[PRICE_SCRAPER] Got price via known API: ${apiResult.price} (${apiResult.confidence})`);
      return apiResult;
    }
  } catch (error) {
    console.warn(`[PRICE_SCRAPER] Known API failed, falling back to HTML scrape: ${error.message}`);
  }

  // Step 2: Fallback to HTML fetch + AI extraction
  const html = await fetchPage(url);
  const cleaned = cleanHtml(html);

  if (cleaned.length < 50) {
    throw new Meteor.Error('empty-page', 'Page content too short - may be blocked or empty');
  }

  const result = await extractPrice(cleaned, name, currency);
  return result;
}
