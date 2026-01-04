import { Meteor } from 'meteor/meteor';
import { EmailService } from '/imports/api/emailService.js';

/**
 * Server-side test method for sending test emails
 */
Meteor.methods({
  /**
   * Send a test email to verify email service configuration
   * @param {string} recipientEmail - Email address to send test to
   * @param {string} sessionId - Session ID for authentication
   */
  async 'email.sendTest'(recipientEmail, sessionId) {
    console.log('Test email method called for:', recipientEmail);

    if (!this.userId && !sessionId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in to send test emails');
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(recipientEmail)) {
      throw new Meteor.Error('invalid-email', 'Please provide a valid email address');
    }

    // Validate configuration before attempting to send
    const requiredFields = ['SENDPULSE_CLIENT_ID', 'SENDPULSE_CLIENT_SECRET', 'SENDPULSE_FROM_EMAIL', 'APP_URL'];
    const settings = Meteor.settings.private || {};
    const missing = requiredFields.filter(field => !settings[field]);

    if (missing.length > 0) {
      throw new Meteor.Error(
        'config-incomplete',
        `Missing required settings: ${missing.join(', ')}. Please configure these in your settings.json file.`
      );
    }

    try {
      const config = EmailService.getConfig();
      console.log('SendPulse Config loaded:', {
        clientId: config.clientId ? `${config.clientId.substring(0, 15)}...` : 'MISSING',
        fromEmail: config.fromEmail || 'MISSING',
        fromName: config.fromName || 'MISSING',
        appUrl: config.appUrl || 'MISSING'
      });

      // Test token acquisition
      const token = await EmailService.getAccessToken();
      if (!token) {
        throw new Meteor.Error('auth-failed', 'Failed to get SendPulse access token');
      }
      console.log('SendPulse authentication successful');

      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Test Email</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 40px 30px; border-radius: 8px 8px 0 0; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">✅ Email Test Successful</h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; color: #333333; font-size: 16px; line-height: 1.6;">
                Hello!
              </p>

              <p style="margin: 0 0 20px; color: #333333; font-size: 16px; line-height: 1.6;">
                This is a test email from <strong>Ambervision</strong> by Amber Lake Partners.
              </p>

              <div style="margin: 30px 0; padding: 20px; background-color: #d1fae5; border-left: 4px solid #10b981; border-radius: 4px;">
                <p style="margin: 0; color: #065f46; font-size: 14px; line-height: 1.6;">
                  <strong>✓ Email Service Working!</strong><br>
                  Your email system is properly configured and sending emails successfully.
                </p>
              </div>

              <table width="100%" cellpadding="8" style="margin: 20px 0; border-collapse: collapse; background-color: #f8f9fa; border-radius: 4px;">
                <tr>
                  <td style="padding: 12px; color: #666666; font-size: 14px;">Sent from:</td>
                  <td style="padding: 12px; color: #333333; font-weight: 600; font-size: 14px;">${config.fromEmail}</td>
                </tr>
                <tr>
                  <td style="padding: 12px; color: #666666; font-size: 14px;">Sent to:</td>
                  <td style="padding: 12px; color: #333333; font-weight: 600; font-size: 14px;">${recipientEmail}</td>
                </tr>
                <tr>
                  <td style="padding: 12px; color: #666666; font-size: 14px;">Timestamp:</td>
                  <td style="padding: 12px; color: #333333; font-weight: 600; font-size: 14px;">${new Date().toLocaleString()}</td>
                </tr>
                <tr>
                  <td style="padding: 12px; color: #666666; font-size: 14px;">Service:</td>
                  <td style="padding: 12px; color: #333333; font-weight: 600; font-size: 14px;">SendPulse</td>
                </tr>
              </table>

              <p style="margin: 20px 0 0 0; color: #666666; font-size: 14px; line-height: 1.6;">
                If you received this email, your SendPulse integration is working perfectly!
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 30px 40px; background-color: #f8f9fa; border-radius: 0 0 8px 8px; border-top: 1px solid #e9ecef;">
              <p style="margin: 0 0 10px; color: #666666; font-size: 13px; text-align: center;">
                Best regards,<br>
                <strong>Amber Lake Partners Team</strong>
              </p>
              <p style="margin: 0; color: #999999; font-size: 12px; text-align: center;">
                This is an automated test email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
      `;

      const textContent = `
✅ Email Test Successful

Hello!

This is a test email from Ambervision by Amber Lake Partners.

✓ Email Service Working!
Your email system is properly configured and sending emails successfully.

Details:
- Sent from: ${config.fromEmail}
- Sent to: ${recipientEmail}
- Timestamp: ${new Date().toLocaleString()}
- Service: SendPulse

If you received this email, your SendPulse integration is working perfectly!

Best regards,
Amber Lake Partners Team

This is an automated test email.
      `;

      console.log('Sending test email via SendPulse...');

      // Send email via EmailService
      const response = await EmailService.sendEmail({
        subject: '✅ Ambervision Email Test - Success!',
        html: htmlContent,
        text: textContent,
        to: [{ email: recipientEmail, name: recipientEmail }]
      });

      console.log('Test email sent successfully to:', recipientEmail);
      console.log('SendPulse response:', JSON.stringify(response, null, 2));

      return {
        success: true,
        message: `Test email sent successfully to ${recipientEmail}`,
        messageId: response.messageId || 'unknown',
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('Error sending test email:', error);
      console.error('Error stack:', error.stack);

      // Provide specific error messages based on error type
      let errorMessage = error.message || error.reason || String(error) || 'Unknown error occurred';

      // Check for configuration errors
      if (error.error === 'config-missing' || error.error === 'config-incomplete') {
        errorMessage = `Configuration error: ${error.reason || error.message}. Check your settings.json file.`;
      }
      // Check for authentication errors
      else if (error.error === 'auth-failed') {
        errorMessage = 'SendPulse authentication failed. Please check your SENDPULSE_CLIENT_ID and SENDPULSE_CLIENT_SECRET in settings.json.';
      }
      // Network errors
      else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        errorMessage = 'Unable to connect to SendPulse API. Check your internet connection.';
      }

      throw new Meteor.Error(
        error.error || 'email-send-failed',
        errorMessage,
        error.message
      );
    }
  }
});
