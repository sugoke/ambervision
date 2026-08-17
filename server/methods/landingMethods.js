import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { EmailService, EMAIL, emailShell, emailKvTable, emailNotice } from '../../imports/api/emailService.js';
import { LandingLeadsCollection, LandingLeadHelpers, LEAD_STATUS } from '../../imports/api/landingLeads.js';

/**
 * Meteor methods for the landing page contact form
 */
Meteor.methods({
  /**
   * Handle landing page contact form submission
   * Stores the lead in the database and sends email notification via SendPulse
   */
  async 'landing.submitContactForm'({ name, email, phone, consent }) {
    check(name, String);
    check(email, Match.Maybe(String));
    check(phone, Match.Maybe(String));
    check(consent, Match.Maybe(Object));

    // Validate that at least email or phone is provided
    if (!email && !phone) {
      throw new Meteor.Error('invalid-input', 'Please provide either an email or phone number');
    }

    // GDPR: storing prospect contact details rests on consent — refuse without it.
    if (!consent || consent.given !== true) {
      throw new Meteor.Error('consent-required', 'Please accept the privacy policy so we can store your contact details');
    }

    // Validate name is not empty
    if (!name || name.trim().length === 0) {
      throw new Meteor.Error('invalid-input', 'Please provide your name');
    }

    console.log(`[LANDING] New contact form submission received (email: ${email ? 'yes' : 'no'}, phone: ${phone ? 'yes' : 'no'})`);

    try {
      // Step 1: Store the lead in the database
      const lead = await LandingLeadHelpers.create({
        name: name.trim(),
        email: email ? email.trim() : null,
        phone: phone ? phone.trim() : null,
        source: 'landing-page-us-citizens',
        landingPage: '/#landing',
        consent: {
          given: true,
          at: new Date(),
          textVersion: String(consent.textVersion || 'privacy-2026-08')
        }
      });

      console.log(`[LANDING] Lead stored in database with ID: ${lead.leadId}`);

      // Step 2: Send email notification via SendPulse
      try {
        const emailHtml = emailShell({
          title: 'New Lead',
          subtitle: 'US Citizens Landing Page',
          bodyHtml: `${emailKvTable([
            ['Name', name],
            ['Email', email ? `<a href="mailto:${email}" style="color: ${EMAIL.amberText}; text-decoration: none;">${email}</a>` : `<span style="color: ${EMAIL.muted}; font-weight: 400;">Not provided</span>`],
            ['Phone', phone ? `<a href="tel:${phone}" style="color: ${EMAIL.amberText}; text-decoration: none;">${phone}</a>` : `<span style="color: ${EMAIL.muted}; font-weight: 400;">Not provided</span>`],
            ['Submitted', new Date().toLocaleString('en-GB', {
              timeZone: 'Europe/Paris',
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })]
          ])}${emailNotice('info', 'Lead Details', `<strong>Lead ID:</strong> ${lead.leadId}<br><strong>Source:</strong> US Citizens Landing Page (/#landing)`)}${emailNotice('warning', '⏱ Follow up promptly', 'Reply to this lead as soon as possible for best conversion rates!')}`,
          footerNote: 'This is an automated lead notification from the landing page.'
        });

        const emailText = `
New Lead from Landing Page

Name: ${name}
Email: ${email || 'Not provided'}
Phone: ${phone || 'Not provided'}
Submitted: ${new Date().toLocaleString('en-GB', { timeZone: 'Europe/Paris' })}

Lead ID: ${lead.leadId}
Source: US Citizens Landing Page (/#landing)

Reply to this lead as soon as possible for best conversion rates!
        `;

        await EmailService.sendEmail({
          subject: `🎯 New Lead: ${name} - Landing Page`,
          html: emailHtml,
          text: emailText,
          to: [{ email: 'mf@amberlakepartners.com', name: 'Michael Fiorentini' }]
        });

        console.log('[LANDING] Email notification sent successfully via SendPulse');

        // Update lead to note that notification was sent
        await LandingLeadHelpers.addNote(lead.leadId, 'Email notification sent to mf@amberlakepartners.com');

      } catch (emailError) {
        // Log email error but don't fail the submission
        console.error('[LANDING] Failed to send email notification:', emailError.message);
        await LandingLeadHelpers.addNote(lead.leadId, `Email notification failed: ${emailError.message}`);
      }

      return {
        success: true,
        message: 'Thank you! We will contact you shortly.',
        leadId: lead.leadId
      };

    } catch (error) {
      console.error('[LANDING] Error processing contact form:', error);
      throw new Meteor.Error('submission-failed', 'Failed to process your request. Please try again or contact us directly.');
    }
  },

  /**
   * Get all landing leads (admin only)
   */
  async 'landing.getLeads'({ sessionId, status, limit }) {
    check(sessionId, String);
    check(status, Match.Maybe(String));
    check(limit, Match.Maybe(Number));

    // Validate admin session
    const { SessionHelpers } = await import('../../imports/api/sessions.js');
    const { UsersCollection } = await import('../../imports/api/users.js');

    const session = await SessionHelpers.findByToken(sessionId);
    if (!session) {
      throw new Meteor.Error('not-authorized', 'Invalid session');
    }

    const user = await UsersCollection.findOneAsync(session.userId);
    if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
      throw new Meteor.Error('not-authorized', 'Admin privileges required');
    }

    const filters = {};
    if (status) filters.status = status;

    const options = {};
    if (limit) options.limit = limit;

    return await LandingLeadHelpers.getLeads(filters, options);
  },

  /**
   * Update lead status (admin only)
   */
  async 'landing.updateLeadStatus'({ sessionId, leadId, status, note }) {
    check(sessionId, String);
    check(leadId, String);
    check(status, String);
    check(note, Match.Maybe(String));

    // Validate admin session
    const { SessionHelpers } = await import('../../imports/api/sessions.js');
    const { UsersCollection } = await import('../../imports/api/users.js');

    const session = await SessionHelpers.findByToken(sessionId);
    if (!session) {
      throw new Meteor.Error('not-authorized', 'Invalid session');
    }

    const user = await UsersCollection.findOneAsync(session.userId);
    if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
      throw new Meteor.Error('not-authorized', 'Admin privileges required');
    }

    // Validate status
    if (!Object.values(LEAD_STATUS).includes(status)) {
      throw new Meteor.Error('invalid-status', `Invalid status: ${status}`);
    }

    await LandingLeadHelpers.updateStatus(leadId, status, note);

    return { success: true };
  }
});
