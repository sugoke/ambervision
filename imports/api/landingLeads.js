import { Mongo } from 'meteor/mongo';

/**
 * Landing Leads Collection
 * Stores contact form submissions from the landing page
 */
export const LandingLeadsCollection = new Mongo.Collection('landingLeads');

/**
 * Lead status enum
 */
export const LEAD_STATUS = {
  NEW: 'new',
  CONTACTED: 'contacted',
  QUALIFIED: 'qualified',
  CONVERTED: 'converted',
  CLOSED: 'closed'
};

/**
 * Helper functions for landing leads
 */
export const LandingLeadHelpers = {
  /**
   * Create a new lead
   */
  async create(leadData) {
    const now = new Date();

    const lead = {
      name: leadData.name,
      email: leadData.email || null,
      phone: leadData.phone || null,
      source: leadData.source || 'landing-page',
      status: LEAD_STATUS.NEW,
      notes: [],
      createdAt: now,
      updatedAt: now,
      // Track submission metadata
      metadata: {
        userAgent: leadData.userAgent || null,
        referrer: leadData.referrer || null,
        landingPage: leadData.landingPage || '/#landing',
        ipAddress: leadData.ipAddress || null
      }
    };

    const leadId = await LandingLeadsCollection.insertAsync(lead);
    console.log(`[LandingLeads] Created new lead: ${leadId} - ${lead.name}`);

    return { leadId, ...lead };
  },

  /**
   * Update lead status
   */
  async updateStatus(leadId, status, note = null) {
    const update = {
      $set: {
        status,
        updatedAt: new Date()
      }
    };

    if (note) {
      update.$push = {
        notes: {
          text: note,
          createdAt: new Date()
        }
      };
    }

    await LandingLeadsCollection.updateAsync(leadId, update);
    console.log(`[LandingLeads] Updated lead ${leadId} status to: ${status}`);
  },

  /**
   * Add note to lead
   */
  async addNote(leadId, noteText, userId = null) {
    await LandingLeadsCollection.updateAsync(leadId, {
      $push: {
        notes: {
          text: noteText,
          userId,
          createdAt: new Date()
        }
      },
      $set: {
        updatedAt: new Date()
      }
    });
  },

  /**
   * Get all leads with optional filters
   */
  async getLeads(filters = {}, options = {}) {
    const query = {};

    if (filters.status) {
      query.status = filters.status;
    }

    if (filters.source) {
      query.source = filters.source;
    }

    const defaultOptions = {
      sort: { createdAt: -1 },
      limit: 100,
      ...options
    };

    return await LandingLeadsCollection.find(query, defaultOptions).fetchAsync();
  }
};
