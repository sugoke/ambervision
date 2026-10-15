/**
 * Term sheet audit runner.
 *
 * For every product with a stored term sheet PDF, an AI model reads the PDF
 * and returns what it states (dates, underlyings and initial levels, barriers,
 * coupon, observation dates); compareWithTermSheet() then diffs that against
 * the product's parameters. The model only reads: nothing in `products` is
 * changed, results go to the `termSheetAudits` collection (one row per product).
 *
 * Started by a job document in `termSheetAuditJobs` (status 'requested'), which
 * a poller picks up, so an administrator with database access can launch it.
 */
import fs from 'fs';
import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { HTTP } from 'meteor/http';
import { ProductsCollection } from '/imports/api/products';
import { protectionBarrierOf } from '/imports/api/underlyingsAnalysis';
import { resolveTermsheetPath, termsheetFilenameFromUrl } from '/imports/api/documentStorage';
import { compareWithTermSheet, checkInternalDates, hasErrors } from './compare.js';

export const TermSheetAuditsCollection = new Mongo.Collection('termSheetAudits');
export const TermSheetAuditJobsCollection = new Mongo.Collection('termSheetAuditJobs');

const API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-opus-5-5';
const CONCURRENCY = 3;

const PROMPT = `You are checking a structured product term sheet. Read the attached PDF and return ONLY a JSON object (no markdown, no commentary) with what the document states. Use null for anything the document does not state. Never guess or compute a value the document does not give.

{
  "isin": "ISIN of the note itself",
  "issuer": "issuer name as printed",
  "currency": "ISO code of the product currency",
  "denomination": number (nominal per certificate / specified denomination),
  "tradeDate": "YYYY-MM-DD" (trade / pricing / strike / initial fixing date),
  "valueDate": "YYYY-MM-DD" (issue / settlement / payment date at launch),
  "finalObservationDate": "YYYY-MM-DD" (final valuation / final fixing date),
  "maturityDate": "YYYY-MM-DD" (redemption / maturity / final payment date),
  "underlyings": [ { "name": "...", "ticker": "Bloomberg or Reuters code as printed", "isin": "...", "initialReferencePrice": number (absolute price at 100% of the initial fixing, as printed, null if not fixed yet) } ],
  "protectionBarrierPct": number (the level in % of initial below which capital is at risk at maturity: protection barrier, knock-in, capital-at-risk level; null if the capital is guaranteed or there is none),
  "couponBarrierPct": number (conditional coupon trigger level in % of initial),
  "firstAutocallLevelPct": number (autocall / early redemption level at the first callable date, in % of initial),
  "autocallStepDownPct": number (reduction of the autocall level per period, 0 if constant),
  "couponPerPeriodPct": number (coupon per period in % of denomination),
  "couponPerAnnumPct": number (coupon per annum in % of denomination),
  "memoryCoupon": true | false (unpaid coupons catch up when the condition is met again),
  "observationDates": [ { "valuationDate": "YYYY-MM-DD", "paymentDate": "YYYY-MM-DD" or null } ]
}

observationDates: list EVERY periodic valuation date of the schedule table(s) (coupon valuation and/or automatic early redemption valuation dates), one entry per distinct valuation date, with its payment date. Include the final valuation date if it is part of the table. Read every row of the tables; do not skip or summarise. Dates must be exact as printed, converted to ISO.`;

async function readFacts(pdfBase64, model, apiKey) {
  const response = await HTTP.post(API_URL, {
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    data: {
      model,
      max_tokens: 16000,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
          { type: 'text', text: PROMPT }
        ]
      }],
      thinking: { type: 'adaptive' }
    }
  });
  const text = (response.data?.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('No JSON in the model answer');
  return JSON.parse(text.slice(start, end + 1));
}

async function auditProduct(product, { model, apiKey, runId }) {
  const base = {
    _id: product._id,
    isin: product.isin || null,
    title: product.title || null,
    templateId: product.templateId || product.template || null,
    productStatus: product.productStatus || null,
    runId,
    model,
    auditedAt: new Date()
  };
  const internal = checkInternalDates(product);

  const filename = termsheetFilenameFromUrl(product.termSheet?.url);
  const filePath = filename ? resolveTermsheetPath(filename) : null;
  if (!filePath) {
    return { ...base, status: product.termSheet?.url ? 'file-missing' : 'no-termsheet', findings: internal, termSheet: product.termSheet || null };
  }
  try {
    const facts = await readFacts(fs.readFileSync(filePath).toString('base64'), model, apiKey);
    const findings = [...compareWithTermSheet(product, facts, { protectionBarrierOf }), ...internal];
    return { ...base, status: hasErrors(findings) ? 'errors' : findings.length ? 'warnings' : 'ok', findings, facts, termSheet: { filename, source: product.termSheet?.source || null, uploadedAt: product.termSheet?.uploadedAt || null } };
  } catch (error) {
    return { ...base, status: 'unreadable', error: String(error.reason || error.message || error).slice(0, 500), findings: internal };
  }
}

export async function runTermSheetAudit(job) {
  const apiKey = Meteor.settings.private?.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');
  const model = job.model || DEFAULT_MODEL;
  const runId = new Date().toISOString();

  const selector = job.productIds?.length ? { _id: { $in: job.productIds } } : {};
  const products = await ProductsCollection.find(selector).fetchAsync();
  console.log(`[TermSheetAudit] Auditing ${products.length} products with ${model}`);

  let done = 0;
  const queue = [...products];
  const worker = async () => {
    while (queue.length > 0) {
      const product = queue.shift();
      let result = await auditProduct(product, { model, apiKey, runId });
      // Transient API failure: one retry
      if (result.status === 'unreadable' && /50\d|429|overloaded|timeout/i.test(result.error || '')) {
        await new Promise(r => setTimeout(r, 5000));
        result = await auditProduct(product, { model, apiKey, runId });
      }
      await TermSheetAuditsCollection.rawCollection().replaceOne({ _id: result._id }, result, { upsert: true });
      done++;
      await TermSheetAuditJobsCollection.rawCollection().updateOne({ _id: 'current' }, { $set: { done, total: products.length, updatedAt: new Date() } });
      if (done % 10 === 0) console.log(`[TermSheetAudit] ${done}/${products.length}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log('[TermSheetAudit] Finished');
  return { runId, total: products.length };
}

/** Pick up a requested audit job; one server process wins the claim. */
export function startTermSheetAuditPoller() {
  Meteor.setInterval(async () => {
    try {
      const claimed = await TermSheetAuditJobsCollection.rawCollection().findOneAndUpdate(
        { _id: 'current', status: 'requested' },
        { $set: { status: 'running', startedAt: new Date(), done: 0 } },
        { returnDocument: 'after' }
      );
      const job = claimed?.value !== undefined ? claimed.value : claimed;
      if (!job) return;
      try {
        const result = await runTermSheetAudit(job);
        await TermSheetAuditJobsCollection.rawCollection().updateOne({ _id: 'current' }, { $set: { status: 'done', finishedAt: new Date(), ...result } });
      } catch (error) {
        console.error('[TermSheetAudit] Failed:', error.message);
        await TermSheetAuditJobsCollection.rawCollection().updateOne({ _id: 'current' }, { $set: { status: 'failed', error: error.message, finishedAt: new Date() } });
      }
    } catch (error) {
      console.error('[TermSheetAudit] Poller error:', error.message);
    }
  }, 30000);
}
