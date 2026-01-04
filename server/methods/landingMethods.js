import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { EmailService } from '../../imports/api/emailService.js';
import { LandingLeadsCollection, LandingLeadHelpers, LEAD_STATUS } from '../../imports/api/landingLeads.js';

/**
 * Meteor methods for the landing page contact form
 */
Meteor.methods({
  /**
   * Handle landing page contact form submission
   * Stores the lead in the database and sends email notification via SendPulse
   */
  async 'landing.submitContactForm'({ name, email, phone }) {
    check(name, String);
    check(email, Match.Maybe(String));
    check(phone, Match.Maybe(String));

    // Validate that at least email or phone is provided
    if (!email && !phone) {
      throw new Meteor.Error('invalid-input', 'Please provide either an email or phone number');
    }

    // Validate name is not empty
    if (!name || name.trim().length === 0) {
      throw new Meteor.Error('invalid-input', 'Please provide your name');
    }

    console.log(`[LANDING] New contact form submission: ${name}, ${email || 'no email'}, ${phone || 'no phone'}`);

    try {
      // Step 1: Store the lead in the database
      const lead = await LandingLeadHelpers.create({
        name: name.trim(),
        email: email ? email.trim() : null,
        phone: phone ? phone.trim() : null,
        source: 'landing-page-us-citizens',
        landingPage: '/#landing'
      });

      console.log(`[LANDING] Lead stored in database with ID: ${lead.leadId}`);

      // Step 2: Send email notification via SendPulse
      try {
        const emailHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #1A2B40; color: white; padding: 20px; text-align: center;">
              <h1 style="margin: 0; font-size: 24px;">🎯 New Lead from Landing Page</h1>
            </div>
            <div style="padding: 30px; background: #f5f5f5;">
              <h2 style="color: #1A2B40; margin-top: 0;">Contact Details</h2>
              <table style="width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden;">
                <tr>
                  <td style="padding: 15px; border-bottom: 1px solid #eee; font-weight: bold; width: 120px; color: #666;">Name</td>
                  <td style="padding: 15px; border-bottom: 1px solid #eee; color: #333;">${name}</td>
                </tr>
                <tr>
                  <td style="padding: 15px; border-bottom: 1px solid #eee; font-weight: bold; color: #666;">Email</td>
                  <td style="padding: 15px; border-bottom: 1px solid #eee;">
                    ${email ? `<a href="mailto:${email}" style="color: #DD772A;">${email}</a>` : '<span style="color: #999;">Not provided</span>'}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 15px; border-bottom: 1px solid #eee; font-weight: bold; color: #666;">Phone</td>
                  <td style="padding: 15px; border-bottom: 1px solid #eee;">
                    ${phone ? `<a href="tel:${phone}" style="color: #DD772A;">${phone}</a>` : '<span style="color: #999;">Not provided</span>'}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 15px; font-weight: bold; color: #666;">Submitted</td>
                  <td style="padding: 15px; color: #333;">${new Date().toLocaleString('en-GB', {
                    timeZone: 'Europe/Paris',
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}</td>
                </tr>
              </table>

              <div style="margin-top: 20px; padding: 15px; background: #e8f4f8; border-radius: 8px; border-left: 4px solid #DD772A;">
                <p style="margin: 0; color: #1A2B40; font-size: 14px;">
                  <strong>Lead ID:</strong> ${lead.leadId}<br>
                  <strong>Source:</strong> US Citizens Landing Page (/#landing)
                </p>
              </div>
            </div>
            <div style="background: #DD772A; color: white; padding: 15px; text-align: center;">
              <p style="margin: 0; font-size: 14px;">
                Reply to this lead as soon as possible for best conversion rates!
              </p>
            </div>
          </div>
        `;

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
    const { SessionsCollection } = await import('../../imports/api/sessions.js');
    const { UsersCollection } = await import('../../imports/api/users.js');

    const session = await SessionsCollection.findOneAsync({ sessionId, isActive: true });
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
    const { SessionsCollection } = await import('../../imports/api/sessions.js');
    const { UsersCollection } = await import('../../imports/api/users.js');

    const session = await SessionsCollection.findOneAsync({ sessionId, isActive: true });
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
