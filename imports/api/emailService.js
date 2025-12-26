import { Meteor } from 'meteor/meteor';

// Token caching for SendPulse OAuth2
let cachedToken = null;
let tokenExpiry = null;

/**
 * Email Service using SendPulse SMTP API
 * Handles sending transactional emails like password resets
 */
export const EmailService = {
  /**
   * Get SendPulse configuration from settings
   */
  getConfig() {
    if (Meteor.isServer) {
      const settings = Meteor.settings.private;

      if (!settings) {
        throw new Meteor.Error('config-missing', 'Meteor settings not configured');
      }

      const config = {
        clientId: settings.SENDPULSE_CLIENT_ID,
        clientSecret: settings.SENDPULSE_CLIENT_SECRET,
        fromEmail: settings.SENDPULSE_FROM_EMAIL,
        fromName: settings.SENDPULSE_FROM_NAME,
        appUrl: settings.APP_URL,
        notificationsBcc: settings.EMAIL_NOTIFICATIONS_BCC || []
      };

      // Validate required fields
      if (!config.clientId) {
        throw new Meteor.Error('config-missing', 'SENDPULSE_CLIENT_ID not configured in settings');
      }
      if (!config.clientSecret) {
        throw new Meteor.Error('config-missing', 'SENDPULSE_CLIENT_SECRET not configured in settings');
      }
      if (!config.fromEmail) {
        throw new Meteor.Error('config-missing', 'SENDPULSE_FROM_EMAIL not configured in settings');
      }
      if (!config.appUrl) {
        throw new Meteor.Error('config-missing', 'APP_URL not configured in settings');
      }

      return config;
    }
  },

  /**
   * Get OAuth2 access token from SendPulse
   * Caches token and auto-refreshes 5 minutes before expiry
   */
  async getAccessToken() {
    const config = this.getConfig();

    // Return cached token if still valid (with 5-min buffer)
    if (cachedToken && tokenExpiry && Date.now() < tokenExpiry - 300000) {
      return cachedToken;
    }

    try {
      const response = await fetch('https://api.sendpulse.com/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: config.clientId,
          client_secret: config.clientSecret
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`SendPulse auth failed: ${response.status} - ${errorData.error_description || response.statusText}`);
      }

      const data = await response.json();
      cachedToken = data.access_token;
      tokenExpiry = Date.now() + (data.expires_in * 1000);

      console.log('[EmailService] SendPulse token obtained, expires in', data.expires_in, 'seconds');
      return cachedToken;
    } catch (error) {
      console.error('[EmailService] Failed to get SendPulse access token:', error);
      throw new Meteor.Error('auth-failed', 'Failed to authenticate with SendPulse', error.message);
    }
  },

  /**
   * Send email via SendPulse SMTP API
   * @param {Object} emailData - Email data object
   * @param {string} emailData.subject - Email subject
   * @param {string} emailData.html - HTML content
   * @param {string} emailData.text - Plain text content
   * @param {Array} emailData.to - Array of {email, name} recipients
   * @param {Array} emailData.bcc - Optional array of {email, name} BCC recipients
   */
  async sendEmail(emailData) {
    const config = this.getConfig();
    const token = await this.getAccessToken();

    // Build SendPulse email payload
    const payload = {
      email: {
        subject: emailData.subject,
        html: Buffer.from(emailData.html).toString('base64'),
        text: emailData.text,
        from: {
          name: config.fromName,
          email: config.fromEmail
        },
        to: emailData.to.map(r => ({ name: r.name || r.email, email: r.email }))
      }
    };

    // Add BCC if provided
    if (emailData.bcc && emailData.bcc.length > 0) {
      payload.email.bcc = emailData.bcc.map(r => ({ name: r.name || r.email, email: r.email }));
    }

    try {
      const response = await fetch('https://api.sendpulse.com/smtp/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('[EmailService] SendPulse API error:', data);
        throw new Error(`SendPulse error: ${data.message || response.statusText}`);
      }

      return {
        success: true,
        messageId: data.id || 'unknown',
        result: data.result
      };
    } catch (error) {
      console.error('[EmailService] Failed to send email:', error);
      throw error;
    }
  },

  /**
   * Get BCC recipients from settings
   * @returns {Array} Array of {email, name} objects for BCC
   */
  getBccRecipients() {
    const config = this.getConfig();
    const bcc = [];

    if (config.notificationsBcc && Array.isArray(config.notificationsBcc)) {
      config.notificationsBcc.forEach(bccEmail => {
        bcc.push({ email: bccEmail, name: bccEmail });
      });
    }

    return bcc;
  },

  /**
   * Send password reset email
   * @param {string} email - Recipient email address
   * @param {string} token - Password reset token
   * @param {string} userName - User's name (optional)
   */
  async sendPasswordResetEmail(email, token, userName = '') {
    if (!Meteor.isServer) {
      throw new Meteor.Error('server-only', 'This method can only be called on the server');
    }

    try {
      const config = this.getConfig();

      // Build reset URL
      const resetUrl = `${config.appUrl}/#reset-password?token=${token}`;

      // Create recipient
      const recipients = [{ email, name: userName || email }];

      // Build HTML email content
      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #1a1a1a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1a1a1a; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #2d2d2d; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 40px 30px; border-radius: 8px 8px 0 0; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">Reset Your Password</h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; color: #e0e0e0; font-size: 16px; line-height: 1.6;">
                Hello${userName ? ` ${userName}` : ''},
              </p>

              <p style="margin: 0 0 20px; color: #e0e0e0; font-size: 16px; line-height: 1.6;">
                You recently requested to reset your password for your <strong>Amber Lake Partners</strong> account.
              </p>

              <p style="margin: 0 0 30px; color: #e0e0e0; font-size: 16px; line-height: 1.6;">
                Click the button below to reset your password:
              </p>

              <!-- Reset Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 0 0 30px;">
                    <a href="${resetUrl}" style="display: inline-block; padding: 16px 40px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                      Reset Password
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 20px; color: #b0b0b0; font-size: 14px; line-height: 1.6;">
                Or copy and paste this URL into your browser:
              </p>

              <p style="margin: 0 0 30px; padding: 12px; background-color: #3a3a3a; border: 1px solid #4a4a4a; border-radius: 4px; word-break: break-all;">
                <a href="${resetUrl}" style="color: #667eea; text-decoration: none; font-size: 14px;">
                  ${resetUrl}
                </a>
              </p>

              <div style="margin: 30px 0; padding: 16px; background-color: #3d3520; border-left: 4px solid #ffc107; border-radius: 4px;">
                <p style="margin: 0; color: #ffc107; font-size: 14px; line-height: 1.6;">
                  <strong>⚠️ Security Notice:</strong> This link will expire in 1 hour for your security.
                </p>
              </div>

              <p style="margin: 0 0 10px; color: #b0b0b0; font-size: 14px; line-height: 1.6;">
                If you didn't request this password reset, please ignore this email. Your password will remain unchanged.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 30px 40px; background-color: #3a3a3a; border-radius: 0 0 8px 8px; border-top: 1px solid #4a4a4a;">
              <p style="margin: 0 0 10px; color: #b0b0b0; font-size: 13px; text-align: center;">
                Best regards,<br>
                <strong>Amber Lake Partners Team</strong>
              </p>
              <p style="margin: 0; color: #808080; font-size: 12px; text-align: center;">
                This is an automated email. Please do not reply to this message.
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

      // Plain text version
      const textContent = `
Reset Your Password

Hello${userName ? ` ${userName}` : ''},

You recently requested to reset your password for your Amber Lake Partners account.

Click the link below to reset your password:
${resetUrl}

⚠️ Security Notice: This link will expire in 1 hour for your security.

If you didn't request this password reset, please ignore this email. Your password will remain unchanged.

Best regards,
Amber Lake Partners Team

This is an automated email. Please do not reply to this message.
      `;

      // Send email via SendPulse
      const response = await this.sendEmail({
        subject: 'Reset Your Amber Lake Partners Password',
        html: htmlContent,
        text: textContent,
        to: recipients
      });

      console.log(`Password reset email sent to ${email}`);
      console.log('SendPulse response:', response);

      return {
        success: true,
        messageId: response.messageId
      };

    } catch (error) {
      console.error('Error sending password reset email:', error);

      throw new Meteor.Error(
        'email-send-failed',
        'Failed to send password reset email',
        error.message
      );
    }
  },

  /**
   * Send password changed confirmation email
   * @param {string} email - Recipient email address
   * @param {string} userName - User's name (optional)
   */
  async sendPasswordChangedEmail(email, userName = '') {
    if (!Meteor.isServer) {
      throw new Meteor.Error('server-only', 'This method can only be called on the server');
    }

    try {
      const recipients = [{ email, name: userName || email }];

      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Changed Successfully</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #1a1a1a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1a1a1a; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #2d2d2d; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 40px; border-radius: 8px 8px 0 0; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">✓ Password Changed</h1>
            </td>
          </tr>

          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; color: #e0e0e0; font-size: 16px; line-height: 1.6;">
                Hello${userName ? ` ${userName}` : ''},
              </p>

              <p style="margin: 0 0 20px; color: #e0e0e0; font-size: 16px; line-height: 1.6;">
                This is a confirmation that your password for your <strong>Amber Lake Partners</strong> account has been successfully changed.
              </p>

              <div style="margin: 30px 0; padding: 16px; background-color: #1a3d2e; border-left: 4px solid #10b981; border-radius: 4px;">
                <p style="margin: 0; color: #10b981; font-size: 14px; line-height: 1.6;">
                  <strong>✓ All Set!</strong> Your password has been updated and all active sessions have been logged out for security.
                </p>
              </div>

              <p style="margin: 0; color: #b0b0b0; font-size: 14px; line-height: 1.6;">
                If you didn't make this change, please contact our support team immediately.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding: 30px 40px; background-color: #3a3a3a; border-radius: 0 0 8px 8px; border-top: 1px solid #4a4a4a;">
              <p style="margin: 0; color: #b0b0b0; font-size: 13px; text-align: center;">
                Best regards,<br>
                <strong>Amber Lake Partners Team</strong>
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
Password Changed Successfully

Hello${userName ? ` ${userName}` : ''},

This is a confirmation that your password for your Amber Lake Partners account has been successfully changed.

All active sessions have been logged out for security.

If you didn't make this change, please contact our support team immediately.

Best regards,
Amber Lake Partners Team
      `;

      // Send email via SendPulse
      const response = await this.sendEmail({
        subject: 'Your Password Has Been Changed',
        html: htmlContent,
        text: textContent,
        to: recipients
      });

      console.log(`Password changed confirmation email sent to ${email}`);

      return {
        success: true,
        messageId: response.messageId
      };

    } catch (error) {
      console.error('Error sending password changed email:', error);
      // Don't throw error for confirmation emails - just log it
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * Send coupon paid notification email
   * @param {string} email - Recipient email
   * @param {string} userName - Recipient name
   * @param {Object} product - Product data
   * @param {Object} event - Event data
   */
  async sendCouponPaidEmail(email, userName, product, event) {
    if (!Meteor.isServer) {
      throw new Meteor.Error('server-only', 'This method can only be called on the server');
    }

    try {
      const config = this.getConfig();
      const recipients = [{ email, name: userName || email }];

      const productUrl = `${config.appUrl}/#products/${product._id}`;
      const couponRate = event.data.couponRateFormatted;
      const observationDate = event.data.observationIndex
        ? `Observation ${event.data.observationIndex}/${event.data.totalObservations}`
        : 'Recent observation';

      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Coupon Payment</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #1a1a1a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1a1a1a; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #2d2d2d; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 40px; border-radius: 8px 8px 0 0; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">💰 Coupon Payment</h1>
            </td>
          </tr>

          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; color: #e0e0e0; font-size: 16px; line-height: 1.6;">
                Hello${userName ? ` ${userName}` : ''},
              </p>

              <p style="margin: 0 0 20px; color: #e0e0e0; font-size: 16px; line-height: 1.6;">
                A coupon payment of <strong style="color: #10b981;">${couponRate}</strong> has occurred for:
              </p>

              <div style="margin: 20px 0; padding: 20px; background-color: #3a3a3a; border-left: 4px solid #10b981; border-radius: 4px;">
                <p style="margin: 0 0 10px; color: #e0e0e0; font-size: 16px; font-weight: 600;">${product.title || product.productName}</p>
                <p style="margin: 0; color: #b0b0b0; font-size: 14px;">ISIN: ${product.isin || 'N/A'}</p>
              </div>

              <table width="100%" cellpadding="8" style="margin: 20px 0; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #b0b0b0;">Coupon Rate:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #e0e0e0; font-weight: 600;">${couponRate}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #b0b0b0;">Observation:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #e0e0e0;">${observationDate}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #b0b0b0;">Basket Level:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #e0e0e0;">${event.data.basketLevelFormatted}</td>
                </tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 20px 0;">
                    <a href="${productUrl}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px;">
                      View Product Details
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding: 30px 40px; background-color: #3a3a3a; border-radius: 0 0 8px 8px; border-top: 1px solid #4a4a4a;">
              <p style="margin: 0; color: #b0b0b0; font-size: 13px; text-align: center;">
                Best regards,<br>
                <strong>Amber Lake Partners Team</strong>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

      const textContent = `
Coupon Payment

Hello${userName ? ` ${userName}` : ''},

A coupon payment of ${couponRate} has occurred for ${product.title || product.productName} (${product.isin || 'N/A'}).

Coupon Rate: ${couponRate}
Observation: ${observationDate}
Basket Level: ${event.data.basketLevelFormatted}

View product details: ${productUrl}

Best regards,
Amber Lake Partners Team
`;

      // Send email via SendPulse
      const bcc = this.getBccRecipients();
      const response = await this.sendEmail({
        subject: `[Ambervision] Coupon Payment - ${product.title || product.productName}`,
        html: htmlContent,
        text: textContent,
        to: recipients,
        bcc: bcc.length > 0 ? bcc : undefined
      });
      console.log(`Coupon paid email sent to ${email}`);

      return { success: true, messageId: response.messageId };
    } catch (error) {
      console.error('Error sending coupon paid email:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Send autocall notification email
   */
  async sendAutocallEmail(email, userName, product, event) {
    if (!Meteor.isServer) {
      throw new Meteor.Error('server-only', 'This method can only be called on the server');
    }

    try {
      const config = this.getConfig();
      const recipients = [{ email, name: userName || email }];

      const productUrl = `${config.appUrl}/#products/${product._id}`;

      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Autocall Triggered</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #1a1a1a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1a1a1a; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #2d2d2d; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); padding: 40px; border-radius: 8px 8px 0 0; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">🎯 Autocall Triggered</h1>
            </td>
          </tr>

          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; color: #e0e0e0; font-size: 16px; line-height: 1.6;">
                Hello${userName ? ` ${userName}` : ''},
              </p>

              <p style="margin: 0 0 20px; color: #e0e0e0; font-size: 16px; line-height: 1.6;">
                The following product has <strong style="color: #3b82f6;">autocalled early</strong>:
              </p>

              <div style="margin: 20px 0; padding: 20px; background-color: #1a2a3d; border-left: 4px solid #3b82f6; border-radius: 4px;">
                <p style="margin: 0 0 10px; color: #e0e0e0; font-size: 16px; font-weight: 600;">${product.title || product.productName}</p>
                <p style="margin: 0; color: #b0b0b0; font-size: 14px;">ISIN: ${product.isin || 'N/A'}</p>
              </div>

              <table width="100%" cellpadding="8" style="margin: 20px 0; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #b0b0b0;">Basket Level:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #e0e0e0; font-weight: 600;">${event.data.basketLevelFormatted}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #b0b0b0;">Autocall Level:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #e0e0e0;">${event.data.autocallLevelFormatted}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #b0b0b0;">Coupon Paid:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #e0e0e0;">${event.data.couponPaidFormatted}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #b0b0b0;">Redemption Date:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #e0e0e0;">${event.data.redemptionDate}</td>
                </tr>
              </table>

              <div style="margin: 20px 0; padding: 16px; background-color: #1a3d2e; border-left: 4px solid #10b981; border-radius: 4px;">
                <p style="margin: 0; color: #10b981; font-size: 14px; line-height: 1.6;">
                  <strong>✓ Early Redemption</strong><br>
                  The product will be redeemed early as the autocall condition has been met.
                </p>
              </div>

              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 20px 0;">
                    <a href="${productUrl}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px;">
                      View Product Details
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding: 30px 40px; background-color: #3a3a3a; border-radius: 0 0 8px 8px; border-top: 1px solid #4a4a4a;">
              <p style="margin: 0; color: #b0b0b0; font-size: 13px; text-align: center;">
                Best regards,<br>
                <strong>Amber Lake Partners Team</strong>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

      const textContent = `
Autocall Triggered

Hello${userName ? ` ${userName}` : ''},

The following product has autocalled early: ${product.title || product.productName} (${product.isin || 'N/A'})

Basket Level: ${event.data.basketLevelFormatted}
Autocall Level: ${event.data.autocallLevelFormatted}
Coupon Paid: ${event.data.couponPaidFormatted}
Redemption Date: ${event.data.redemptionDate}

The product will be redeemed early as the autocall condition has been met.

View product details: ${productUrl}

Best regards,
Amber Lake Partners Team
`;

      // Send email via SendPulse
      const bcc = this.getBccRecipients();
      const response = await this.sendEmail({
        subject: `[Ambervision] Autocall Triggered - ${product.title || product.productName}`,
        html: htmlContent,
        text: textContent,
        to: recipients,
        bcc: bcc.length > 0 ? bcc : undefined
      });
      console.log(`Autocall email sent to ${email}`);

      return { success: true, messageId: response.messageId };
    } catch (error) {
      console.error('Error sending autocall email:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Send barrier breach notification email
   */
  async sendBarrierBreachEmail(email, userName, product, event) {
    if (!Meteor.isServer) {
      throw new Meteor.Error('server-only', 'This method can only be called on the server');
    }

    try {
      const config = this.getConfig();
      const recipients = [{ email, name: userName || email }];

      const productUrl = `${config.appUrl}/#products/${product._id}`;

      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Barrier Breach Alert</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #1a1a1a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1a1a1a; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #2d2d2d; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); padding: 40px; border-radius: 8px 8px 0 0; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">⚠️ Barrier Breach Alert</h1>
            </td>
          </tr>

          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; color: #e0e0e0; font-size: 16px; line-height: 1.6;">
                Hello${userName ? ` ${userName}` : ''},
              </p>

              <p style="margin: 0 0 20px; color: #e0e0e0; font-size: 16px; line-height: 1.6;">
                A protection barrier breach has been detected:
              </p>

              <div style="margin: 20px 0; padding: 20px; background-color: #3d1a1a; border-left: 4px solid #ef4444; border-radius: 4px;">
                <p style="margin: 0 0 10px; color: #e0e0e0; font-size: 16px; font-weight: 600;">${product.title || product.productName}</p>
                <p style="margin: 0; color: #b0b0b0; font-size: 14px;">ISIN: ${product.isin || 'N/A'}</p>
              </div>

              <table width="100%" cellpadding="8" style="margin: 20px 0; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #b0b0b0;">Underlying:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #e0e0e0; font-weight: 600;">${event.data.underlyingTicker}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #b0b0b0;">Performance:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #e0e0e0; color: #ef4444;">${event.data.performanceFormatted}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #b0b0b0;">Distance to Barrier:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #e0e0e0;">${event.data.distanceToBarrierFormatted}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #b0b0b0;">Current Price:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #e0e0e0;">${event.data.currentPriceFormatted}</td>
                </tr>
              </table>

              <div style="margin: 20px 0; padding: 16px; background-color: #3d3520; border-left: 4px solid #ffc107; border-radius: 4px;">
                <p style="margin: 0; color: #ffc107; font-size: 14px; line-height: 1.6;">
                  <strong>⚠️ Attention Required</strong><br>
                  The underlying asset has fallen below the protection barrier. Capital protection is no longer guaranteed.
                </p>
              </div>

              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 20px 0;">
                    <a href="${productUrl}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px;">
                      View Product Details
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding: 30px 40px; background-color: #3a3a3a; border-radius: 0 0 8px 8px; border-top: 1px solid #4a4a4a;">
              <p style="margin: 0; color: #b0b0b0; font-size: 13px; text-align: center;">
                Best regards,<br>
                <strong>Amber Lake Partners Team</strong>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

      const textContent = `
Barrier Breach Alert

Hello${userName ? ` ${userName}` : ''},

A protection barrier breach has been detected for ${product.title || product.productName} (${product.isin || 'N/A'}).

Underlying: ${event.data.underlyingTicker}
Performance: ${event.data.performanceFormatted}
Distance to Barrier: ${event.data.distanceToBarrierFormatted}
Current Price: ${event.data.currentPriceFormatted}

⚠️ The underlying asset has fallen below the protection barrier. Capital protection is no longer guaranteed.

View product details: ${productUrl}

Best regards,
Amber Lake Partners Team
`;

      // Send email via SendPulse
      const bcc = this.getBccRecipients();
      const response = await this.sendEmail({
        subject: `[Ambervision] Barrier Breach Alert - ${product.title || product.productName}`,
        html: htmlContent,
        text: textContent,
        to: recipients,
        bcc: bcc.length > 0 ? bcc : undefined
      });
      console.log(`Barrier breach email sent to ${email}`);

      return { success: true, messageId: response.messageId };
    } catch (error) {
      console.error('Error sending barrier breach email:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Send barrier near warning email
   */
  async sendBarrierNearEmail(email, userName, product, event) {
    if (!Meteor.isServer) {
      throw new Meteor.Error('server-only', 'This method can only be called on the server');
    }

    try {
      const config = this.getConfig();
      const recipients = [{ email, name: userName || email }];

      const productUrl = `${config.appUrl}/#products/${product._id}`;

      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Near Barrier Warning</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #1a1a1a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1a1a1a; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #2d2d2d; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); padding: 40px; border-radius: 8px 8px 0 0; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">⚠️ Near Barrier Warning</h1>
            </td>
          </tr>

          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; color: #e0e0e0; font-size: 16px; line-height: 1.6;">
                Hello${userName ? ` ${userName}` : ''},
              </p>

              <p style="margin: 0 0 20px; color: #e0e0e0; font-size: 16px; line-height: 1.6;">
                An underlying asset is approaching the protection barrier:
              </p>

              <div style="margin: 20px 0; padding: 20px; background-color: #fffbeb; border-left: 4px solid #f59e0b; border-radius: 4px;">
                <p style="margin: 0 0 10px; color: #e0e0e0; font-size: 16px; font-weight: 600;">${product.title || product.productName}</p>
                <p style="margin: 0; color: #b0b0b0; font-size: 14px;">ISIN: ${product.isin || 'N/A'}</p>
              </div>

              <table width="100%" cellpadding="8" style="margin: 20px 0; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #b0b0b0;">Underlying:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #e0e0e0; font-weight: 600;">${event.data.underlyingTicker}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #b0b0b0;">Performance:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #e0e0e0;">${event.data.performanceFormatted}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #b0b0b0;">Distance to Barrier:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #e0e0e0;">${event.data.distanceToBarrierFormatted}</td>
                </tr>
              </table>

              <div style="margin: 20px 0; padding: 16px; background-color: #3d3520; border-left: 4px solid #ffc107; border-radius: 4px;">
                <p style="margin: 0; color: #ffc107; font-size: 14px; line-height: 1.6;">
                  <strong>⚠️ Monitor Closely</strong><br>
                  The underlying is within 10% of the protection barrier. Please monitor the situation closely.
                </p>
              </div>

              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 20px 0;">
                    <a href="${productUrl}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px;">
                      View Product Details
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding: 30px 40px; background-color: #3a3a3a; border-radius: 0 0 8px 8px; border-top: 1px solid #4a4a4a;">
              <p style="margin: 0; color: #b0b0b0; font-size: 13px; text-align: center;">
                Best regards,<br>
                <strong>Amber Lake Partners Team</strong>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

      const textContent = `
Near Barrier Warning

Hello${userName ? ` ${userName}` : ''},

An underlying asset is approaching the protection barrier for ${product.title || product.productName} (${product.isin || 'N/A'}).

Underlying: ${event.data.underlyingTicker}
Performance: ${event.data.performanceFormatted}
Distance to Barrier: ${event.data.distanceToBarrierFormatted}

⚠️ The underlying is within 10% of the protection barrier. Please monitor the situation closely.

View product details: ${productUrl}

Best regards,
Amber Lake Partners Team
`;

      // Send email via SendPulse
      const bcc = this.getBccRecipients();
      const response = await this.sendEmail({
        subject: `[Ambervision] Near Barrier Warning - ${product.title || product.productName}`,
        html: htmlContent,
        text: textContent,
        to: recipients,
        bcc: bcc.length > 0 ? bcc : undefined
      });
      console.log(`Barrier near email sent to ${email}`);

      return { success: true, messageId: response.messageId };
    } catch (error) {
      console.error('Error sending barrier near email:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Send final observation notification email
   */
  async sendFinalObservationEmail(email, userName, product, event) {
    if (!Meteor.isServer) {
      throw new Meteor.Error('server-only', 'This method can only be called on the server');
    }

    try {
      const config = this.getConfig();
      const recipients = [{ email, name: userName || email }];

      const productUrl = `${config.appUrl}/#products/${product._id}`;

      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Final Observation</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #1a1a1a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1a1a1a; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #2d2d2d; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%); padding: 40px; border-radius: 8px 8px 0 0; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">📊 Final Observation</h1>
            </td>
          </tr>

          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; color: #e0e0e0; font-size: 16px; line-height: 1.6;">
                Hello${userName ? ` ${userName}` : ''},
              </p>

              <p style="margin: 0 0 20px; color: #e0e0e0; font-size: 16px; line-height: 1.6;">
                The final observation has occurred for:
              </p>

              <div style="margin: 20px 0; padding: 20px; background-color: #2a1a3d; border-left: 4px solid #8b5cf6; border-radius: 4px;">
                <p style="margin: 0 0 10px; color: #e0e0e0; font-size: 16px; font-weight: 600;">${product.title || product.productName}</p>
                <p style="margin: 0; color: #b0b0b0; font-size: 14px;">ISIN: ${product.isin || 'N/A'}</p>
              </div>

              <table width="100%" cellpadding="8" style="margin: 20px 0; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #b0b0b0;">Basket Level:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #e0e0e0; font-weight: 600;">${event.data.basketLevelFormatted}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #b0b0b0;">Coupon Paid:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #e0e0e0;">${event.data.couponPaidFormatted}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #b0b0b0;">Total Coupons Earned:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #e0e0e0; color: #10b981;">${event.data.totalCouponsEarnedFormatted}</td>
                </tr>
              </table>

              <div style="margin: 20px 0; padding: 16px; background-color: #1a2a3d; border-left: 4px solid #3b82f6; border-radius: 4px;">
                <p style="margin: 0; color: #60a5fa; font-size: 14px; line-height: 1.6;">
                  <strong>ℹ️ Maturity Approaching</strong><br>
                  The product will mature shortly. Final settlement details will be provided.
                </p>
              </div>

              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 20px 0;">
                    <a href="${productUrl}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%); color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px;">
                      View Product Details
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding: 30px 40px; background-color: #3a3a3a; border-radius: 0 0 8px 8px; border-top: 1px solid #4a4a4a;">
              <p style="margin: 0; color: #b0b0b0; font-size: 13px; text-align: center;">
                Best regards,<br>
                <strong>Amber Lake Partners Team</strong>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

      const textContent = `
Final Observation

Hello${userName ? ` ${userName}` : ''},

The final observation has occurred for ${product.title || product.productName} (${product.isin || 'N/A'}).

Basket Level: ${event.data.basketLevelFormatted}
Coupon Paid: ${event.data.couponPaidFormatted}
Total Coupons Earned: ${event.data.totalCouponsEarnedFormatted}

The product will mature shortly. Final settlement details will be provided.

View product details: ${productUrl}

Best regards,
Amber Lake Partners Team
`;

      // Send email via SendPulse
      const bcc = this.getBccRecipients();
      const response = await this.sendEmail({
        subject: `[Ambervision] Final Observation - ${product.title || product.productName}`,
        html: htmlContent,
        text: textContent,
        to: recipients,
        bcc: bcc.length > 0 ? bcc : undefined
      });
      console.log(`Final observation email sent to ${email}`);

      return { success: true, messageId: response.messageId };
    } catch (error) {
      console.error('Error sending final observation email:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Send product matured notification email
   */
  async sendProductMaturedEmail(email, userName, product, event) {
    if (!Meteor.isServer) {
      throw new Meteor.Error('server-only', 'This method can only be called on the server');
    }

    try {
      const config = this.getConfig();
      const recipients = [{ email, name: userName || email }];

      const productUrl = `${config.appUrl}/#products/${product._id}`;

      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Product Matured</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #1a1a1a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1a1a1a; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #2d2d2d; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); padding: 40px; border-radius: 8px 8px 0 0; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">✓ Product Matured</h1>
            </td>
          </tr>

          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; color: #e0e0e0; font-size: 16px; line-height: 1.6;">
                Hello${userName ? ` ${userName}` : ''},
              </p>

              <p style="margin: 0 0 20px; color: #e0e0e0; font-size: 16px; line-height: 1.6;">
                The following product has reached maturity and has been redeemed:
              </p>

              <div style="margin: 20px 0; padding: 20px; background-color: #eef2ff; border-left: 4px solid #6366f1; border-radius: 4px;">
                <p style="margin: 0 0 10px; color: #e0e0e0; font-size: 16px; font-weight: 600;">${product.title || product.productName}</p>
                <p style="margin: 0; color: #b0b0b0; font-size: 14px;">ISIN: ${product.isin || 'N/A'}</p>
              </div>

              <div style="margin: 20px 0; padding: 16px; background-color: #1a3d2e; border-left: 4px solid #10b981; border-radius: 4px;">
                <p style="margin: 0; color: #10b981; font-size: 14px; line-height: 1.6;">
                  <strong>✓ Settlement Complete</strong><br>
                  Final redemption proceeds have been calculated and will be settled according to the product terms.
                </p>
              </div>

              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 20px 0;">
                    <a href="${productUrl}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px;">
                      View Product Details
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding: 30px 40px; background-color: #3a3a3a; border-radius: 0 0 8px 8px; border-top: 1px solid #4a4a4a;">
              <p style="margin: 0; color: #b0b0b0; font-size: 13px; text-align: center;">
                Best regards,<br>
                <strong>Amber Lake Partners Team</strong>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

      const textContent = `
Product Matured

Hello${userName ? ` ${userName}` : ''},

The following product has reached maturity and has been redeemed: ${product.title || product.productName} (${product.isin || 'N/A'})

Final redemption proceeds have been calculated and will be settled according to the product terms.

View product details: ${productUrl}

Best regards,
Amber Lake Partners Team
`;

      // Send email via SendPulse
      const bcc = this.getBccRecipients();
      const response = await this.sendEmail({
        subject: `[Ambervision] Product Matured - ${product.title || product.productName}`,
        html: htmlContent,
        text: textContent,
        to: recipients,
        bcc: bcc.length > 0 ? bcc : undefined
      });
      console.log(`Product matured email sent to ${email}`);

      return { success: true, messageId: response.messageId };
    } catch (error) {
      console.error('Error sending product matured email:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Send memory coupon added notification email
   */
  async sendMemoryCouponEmail(email, userName, product, event) {
    if (!Meteor.isServer) {
      throw new Meteor.Error('server-only', 'This method can only be called on the server');
    }

    try {
      const config = this.getConfig();
      const recipients = [{ email, name: userName || email }];

      const productUrl = `${config.appUrl}/#products/${product._id}`;

      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Memory Coupon Added</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #1a1a1a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1a1a1a; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #2d2d2d; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #a855f7 0%, #9333ea 100%); padding: 40px; border-radius: 8px 8px 0 0; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">💾 Memory Coupon Added</h1>
            </td>
          </tr>

          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; color: #e0e0e0; font-size: 16px; line-height: 1.6;">
                Hello${userName ? ` ${userName}` : ''},
              </p>

              <p style="margin: 0 0 20px; color: #e0e0e0; font-size: 16px; line-height: 1.6;">
                A coupon has been added to memory for future payment:
              </p>

              <div style="margin: 20px 0; padding: 20px; background-color: #faf5ff; border-left: 4px solid #a855f7; border-radius: 4px;">
                <p style="margin: 0 0 10px; color: #e0e0e0; font-size: 16px; font-weight: 600;">${product.title || product.productName}</p>
                <p style="margin: 0; color: #b0b0b0; font-size: 14px;">ISIN: ${product.isin || 'N/A'}</p>
              </div>

              <table width="100%" cellpadding="8" style="margin: 20px 0; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #b0b0b0;">Coupon Added:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #e0e0e0; font-weight: 600;">${event.data.couponRateFormatted}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #b0b0b0;">Total in Memory:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #e0e0e0; color: #a855f7;">${event.data.totalMemoryCouponsFormatted}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #b0b0b0;">Basket Level:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #e0e0e0;">${event.data.basketLevelFormatted}</td>
                </tr>
              </table>

              <div style="margin: 20px 0; padding: 16px; background-color: #1a2a3d; border-left: 4px solid #3b82f6; border-radius: 4px;">
                <p style="margin: 0; color: #60a5fa; font-size: 14px; line-height: 1.6;">
                  <strong>ℹ️ Memory Coupon</strong><br>
                  Coupons in memory will be paid when the product meets coupon payment conditions or at maturity.
                </p>
              </div>

              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 20px 0;">
                    <a href="${productUrl}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #a855f7 0%, #9333ea 100%); color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px;">
                      View Product Details
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding: 30px 40px; background-color: #3a3a3a; border-radius: 0 0 8px 8px; border-top: 1px solid #4a4a4a;">
              <p style="margin: 0; color: #b0b0b0; font-size: 13px; text-align: center;">
                Best regards,<br>
                <strong>Amber Lake Partners Team</strong>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

      const textContent = `
Memory Coupon Added

Hello${userName ? ` ${userName}` : ''},

A coupon has been added to memory for future payment for ${product.title || product.productName} (${product.isin || 'N/A'}).

Coupon Added: ${event.data.couponRateFormatted}
Total in Memory: ${event.data.totalMemoryCouponsFormatted}
Basket Level: ${event.data.basketLevelFormatted}

Coupons in memory will be paid when the product meets coupon payment conditions or at maturity.

View product details: ${productUrl}

Best regards,
Amber Lake Partners Team
`;

      // Send email via SendPulse
      const bcc = this.getBccRecipients();
      const response = await this.sendEmail({
        subject: `[Ambervision] Memory Coupon Added - ${product.title || product.productName}`,
        html: htmlContent,
        text: textContent,
        to: recipients,
        bcc: bcc.length > 0 ? bcc : undefined
      });
      console.log(`Memory coupon email sent to ${email}`);

      return { success: true, messageId: response.messageId };
    } catch (error) {
      console.error('Error sending memory coupon email:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Send barrier recovered notification email
   */
  async sendBarrierRecoveredEmail(email, userName, product, event) {
    if (!Meteor.isServer) {
      throw new Meteor.Error('server-only', 'This method can only be called on the server');
    }

    try {
      const config = this.getConfig();
      const recipients = [{ email, name: userName || email }];

      const productUrl = `${config.appUrl}/#products/${product._id}`;

      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Barrier Recovered</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #1a1a1a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1a1a1a; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #2d2d2d; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 40px; border-radius: 8px 8px 0 0; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">✓ Barrier Recovered</h1>
            </td>
          </tr>

          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; color: #e0e0e0; font-size: 16px; line-height: 1.6;">
                Hello${userName ? ` ${userName}` : ''},
              </p>

              <p style="margin: 0 0 20px; color: #e0e0e0; font-size: 16px; line-height: 1.6;">
                Good news! An underlying has recovered above the protection barrier:
              </p>

              <div style="margin: 20px 0; padding: 20px; background-color: #1a3d2e; border-left: 4px solid #10b981; border-radius: 4px;">
                <p style="margin: 0 0 10px; color: #e0e0e0; font-size: 16px; font-weight: 600;">${product.title || product.productName}</p>
                <p style="margin: 0; color: #b0b0b0; font-size: 14px;">ISIN: ${product.isin || 'N/A'}</p>
              </div>

              <table width="100%" cellpadding="8" style="margin: 20px 0; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #b0b0b0;">Underlying:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #e0e0e0; font-weight: 600;">${event.data.underlyingTicker}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #b0b0b0;">Performance:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #e0e0e0; color: #10b981;">${event.data.performanceFormatted}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #b0b0b0;">Distance to Barrier:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #4a4a4a; color: #e0e0e0;">${event.data.distanceToBarrierFormatted}</td>
                </tr>
              </table>

              <div style="margin: 20px 0; padding: 16px; background-color: #1a3d2e; border-left: 4px solid #10b981; border-radius: 4px;">
                <p style="margin: 0; color: #10b981; font-size: 14px; line-height: 1.6;">
                  <strong>✓ Capital Protection Restored</strong><br>
                  The underlying has recovered above the protection barrier. Capital protection is now active.
                </p>
              </div>

              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 20px 0;">
                    <a href="${productUrl}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px;">
                      View Product Details
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding: 30px 40px; background-color: #3a3a3a; border-radius: 0 0 8px 8px; border-top: 1px solid #4a4a4a;">
              <p style="margin: 0; color: #b0b0b0; font-size: 13px; text-align: center;">
                Best regards,<br>
                <strong>Amber Lake Partners Team</strong>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

      const textContent = `
Barrier Recovered

Hello${userName ? ` ${userName}` : ''},

Good news! An underlying has recovered above the protection barrier for ${product.title || product.productName} (${product.isin || 'N/A'}).

Underlying: ${event.data.underlyingTicker}
Performance: ${event.data.performanceFormatted}
Distance to Barrier: ${event.data.distanceToBarrierFormatted}

✓ The underlying has recovered above the protection barrier. Capital protection is now active.

View product details: ${productUrl}

Best regards,
Amber Lake Partners Team
`;

      // Send email via SendPulse
      const bcc = this.getBccRecipients();
      const response = await this.sendEmail({
        subject: `[Ambervision] Barrier Recovered - ${product.title || product.productName}`,
        html: htmlContent,
        text: textContent,
        to: recipients,
        bcc: bcc.length > 0 ? bcc : undefined
      });
      console.log(`Barrier recovered email sent to ${email}`);

      return { success: true, messageId: response.messageId };
    } catch (error) {
      console.error('Error sending barrier recovered email:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Send daily summary email with all notifications
   * @param {Array} notifications - Array of enriched notification objects
   * @param {String} recipientEmail - Email address to send to
   */
  async sendDailySummaryEmail(notifications, recipientEmail) {
    if (!Meteor.isServer) {
      throw new Meteor.Error('server-only', 'This method can only be called on the server');
    }

    if (!notifications || notifications.length === 0) {
      console.log('[EmailService] No notifications to send in daily summary');
      return { success: true, message: 'No notifications to send' };
    }

    try {
      const config = this.getConfig();
      const recipients = [{ email: recipientEmail, name: recipientEmail }];

      // Import event priority for sorting
      const { EVENT_PRIORITY, EVENT_TYPE_NAMES } = await import('./notifications');

      // Sort notifications by priority
      const sortedNotifications = notifications.sort((a, b) => {
        const priorityA = EVENT_PRIORITY[a.eventType] || 10;
        const priorityB = EVENT_PRIORITY[b.eventType] || 10;
        return priorityA - priorityB;
      });

      // Group notifications by product
      const productGroups = {};
      sortedNotifications.forEach(notif => {
        if (!productGroups[notif.productId]) {
          productGroups[notif.productId] = [];
        }
        productGroups[notif.productId].push(notif);
      });

      const productCount = Object.keys(productGroups).length;
      const eventCount = notifications.length;
      const today = new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      // Helper function to get event icon and color (dark mode)
      const getEventStyle = (eventType) => {
        const styles = {
          'coupon_paid': { icon: '💰', color: '#10b981', bgColor: '#1a3d2e', borderColor: '#10b981' },
          'autocall_triggered': { icon: '🎯', color: '#60a5fa', bgColor: '#1a2a3d', borderColor: '#3b82f6' },
          'barrier_breached': { icon: '⚠️', color: '#f87171', bgColor: '#3d1a1a', borderColor: '#ef4444' },
          'barrier_near': { icon: '⚠️', color: '#fbbf24', bgColor: '#3d3520', borderColor: '#f59e0b' },
          'final_observation': { icon: '📊', color: '#a78bfa', bgColor: '#2a1a3d', borderColor: '#8b5cf6' },
          'product_matured': { icon: '✓', color: '#818cf8', bgColor: '#1a1a3d', borderColor: '#6366f1' },
          'memory_coupon_added': { icon: '💾', color: '#c084fc', bgColor: '#2a1a3d', borderColor: '#a855f7' },
          'barrier_recovered': { icon: '✓', color: '#10b981', bgColor: '#1a3d2e', borderColor: '#10b981' }
        };
        return styles[eventType] || { icon: '📢', color: '#9ca3af', bgColor: '#2d2d2d', borderColor: '#6b7280' };
      };

      // Helper function to format currency
      const formatCurrency = (amount, currency = 'CHF') => {
        return new Intl.NumberFormat('en-CH', {
          style: 'currency',
          currency: currency,
          minimumFractionDigits: 0,
          maximumFractionDigits: 0
        }).format(amount);
      };

      // Build event cards HTML
      let eventCardsHtml = '';
      for (const productId in productGroups) {
        const productNotifications = productGroups[productId];
        const firstNotif = productNotifications[0];
        const productName = firstNotif.productName;
        const productIsin = firstNotif.productIsin;
        const totalInvested = firstNotif.allocation?.totalNominalInvested || 0;
        const clientCount = firstNotif.allocation?.clientCount || 0;
        const currency = firstNotif.allocation?.currency || 'CHF';
        const productUrl = `${config.appUrl}/#products/${productId}`;

        // Build events list for this product
        let eventsListHtml = '';
        productNotifications.forEach(notif => {
          const style = getEventStyle(notif.eventType);
          const eventName = EVENT_TYPE_NAMES[notif.eventType] || notif.eventType;

          eventsListHtml += `
            <tr>
              <td style="padding: 12px 0; border-bottom: 1px solid #4a4a4a;">
                <div style="display: flex; align-items: flex-start;">
                  <span style="font-size: 20px; margin-right: 12px;">${style.icon}</span>
                  <div style="flex: 1;">
                    <div style="font-weight: 600; color: ${style.color}; margin-bottom: 4px;">${eventName}</div>
                    <div style="color: #9ca3af; font-size: 14px; line-height: 1.5;">${notif.summary}</div>
                  </div>
                </div>
              </td>
            </tr>
          `;
        });

        eventCardsHtml += `
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px; background-color: #2d2d2d; border-radius: 8px; border: 1px solid #4a4a4a; overflow: hidden;">
            <!-- Product Header -->
            <tr>
              <td style="padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                <h2 style="margin: 0 0 8px; color: #ffffff; font-size: 18px; font-weight: 600;">${productName}</h2>
                <p style="margin: 0 0 4px; color: #a5b4fc; font-size: 14px;">ISIN: ${productIsin}</p>
                <p style="margin: 0; color: #a5b4fc; font-size: 14px;">
                  ${formatCurrency(totalInvested, currency)} invested · ${clientCount} client${clientCount !== 1 ? 's' : ''}
                </p>
              </td>
            </tr>

            <!-- Events List -->
            <tr>
              <td style="padding: 0 20px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  ${eventsListHtml}
                </table>
              </td>
            </tr>

            <!-- View Button -->
            <tr>
              <td style="padding: 20px;" align="center">
                <a href="${productUrl}" style="display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 600; border-radius: 6px;">
                  View Product Report →
                </a>
              </td>
            </tr>
          </table>
        `;
      }

      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily Product Notifications</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #1a1a1a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1a1a1a; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #2d2d2d; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.07); overflow: hidden;">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 40px 32px; text-align: center;">
              <h1 style="margin: 0 0 8px; color: #ffffff; font-size: 28px; font-weight: 700;">Daily Product Notifications</h1>
              <p style="margin: 0; color: #a5b4fc; font-size: 16px;">${today}</p>
            </td>
          </tr>

          <!-- Summary Banner -->
          <tr>
            <td style="padding: 24px 40px; background: linear-gradient(to right, #2a1a3d, #1a2a3d); border-bottom: 1px solid #4a4a4a;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 8px;">
                    <div style="font-size: 32px; font-weight: 700; color: #4c1d95; margin-bottom: 4px;">${eventCount}</div>
                    <div style="font-size: 13px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.5px;">Event${eventCount !== 1 ? 's' : ''}</div>
                  </td>
                  <td align="center" style="padding: 8px;">
                    <div style="font-size: 32px; font-weight: 700; color: #60a5fa; margin-bottom: 4px;">${productCount}</div>
                    <div style="font-size: 13px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.5px;">Product${productCount !== 1 ? 's' : ''}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 32px 40px;">
              <p style="margin: 0 0 24px; color: #c0c0c0; font-size: 15px; line-height: 1.6;">
                Here's your daily summary of structured product notifications. Review the events below and click through to view detailed product reports.
              </p>

              ${eventCardsHtml}

              <div style="margin-top: 24px; padding: 16px; background-color: #3a3a3a; border-left: 4px solid #667eea; border-radius: 4px;">
                <p style="margin: 0; color: #4b5563; font-size: 14px; line-height: 1.5;">
                  <strong>📊 Need Help?</strong> For questions about these notifications or product performance, please contact your relationship manager.
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 32px 40px; background-color: #3a3a3a; border-top: 1px solid #4a4a4a;">
              <p style="margin: 0 0 8px; color: #9ca3af; font-size: 14px; text-align: center;">
                <strong>Amber Lake Partners</strong>
              </p>
              <p style="margin: 0; color: #9ca3af; font-size: 12px; text-align: center;">
                This is an automated daily digest. Please do not reply to this email.
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

      // Build plain text version
      let textContent = `
Daily Product Notifications - ${today}

${eventCount} event${eventCount !== 1 ? 's' : ''} across ${productCount} product${productCount !== 1 ? 's' : ''}

`;

      for (const productId in productGroups) {
        const productNotifications = productGroups[productId];
        const firstNotif = productNotifications[0];
        const productUrl = `${config.appUrl}/#products/${productId}`;

        textContent += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${firstNotif.productName}
ISIN: ${firstNotif.productIsin}
Total Invested: ${formatCurrency(firstNotif.allocation?.totalNominalInvested || 0, firstNotif.allocation?.currency || 'CHF')}
Clients: ${firstNotif.allocation?.clientCount || 0}

`;
        productNotifications.forEach(notif => {
          const eventName = EVENT_TYPE_NAMES[notif.eventType] || notif.eventType;
          textContent += `  • ${eventName}: ${notif.summary}\n`;
        });

        textContent += `\nView Report: ${productUrl}\n`;
      }

      textContent += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Best regards,
Amber Lake Partners Team

This is an automated daily digest. Please do not reply to this email.
      `;

      // Send email via SendPulse
      const bcc = this.getBccRecipients();
      const response = await this.sendEmail({
        subject: `[Ambervision] Daily Digest - ${eventCount} Notification${eventCount !== 1 ? 's' : ''}`,
        html: htmlContent,
        text: textContent,
        to: recipients,
        bcc: bcc.length > 0 ? bcc : undefined
      });
      console.log(`[EmailService] Daily summary email sent to ${recipientEmail} with ${eventCount} notifications`);

      return {
        success: true,
        messageId: response.messageId,
        notificationCount: eventCount,
        productCount: productCount
      };

    } catch (error) {
      console.error('[EmailService] Error sending daily summary email:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Send bank sync completion email with sync results and notifications
   * @param {String} recipientEmail - Email address to send to
   * @param {Object} syncResults - Results from bankFileSyncJob
   * @param {Array} notifications - Notifications generated during sync
   */
  async sendBankSyncCompletionEmail(recipientEmail, syncResults, notifications = []) {
    if (!Meteor.isServer) {
      throw new Meteor.Error('server-only', 'This method can only be called on the server');
    }

    try {
      const recipients = [{ email: recipientEmail, name: 'Ambervision Admin' }];

      const today = new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      const time = new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Zurich'
      }) + ' CET';

      // Extract sync details
      const {
        triggerSource = 'cron',
        connectionsProcessed = 0,
        connectionsSucceeded = 0,
        connectionsFailed = 0,
        filesDownloaded = 0,
        positionsProcessed = 0,
        operationsProcessed = 0,
        errors = [],
        fileDetails = []
      } = syncResults;

      // Status colors and icons
      const hasErrors = connectionsFailed > 0 || errors.length > 0;
      const statusColor = hasErrors ? '#ef4444' : '#10b981';
      const statusIcon = hasErrors ? '⚠️' : '✓';
      const statusText = hasErrors ? 'Completed with Errors' : 'Completed Successfully';
      const headerGradient = hasErrors
        ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)'
        : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';

      // Build connection details rows
      let connectionRowsHtml = '';
      fileDetails.forEach(detail => {
        const statusIcon = detail.success ? '✓' : '✗';
        const statusColor = detail.success ? '#10b981' : '#ef4444';
        const filesText = detail.downloadedFiles?.length > 0
          ? detail.downloadedFiles.join(', ')
          : (detail.success ? 'No new files' : detail.error || 'Failed');

        connectionRowsHtml += `
          <tr class="table-row">
            <td class="table-cell" style="padding: 12px 16px; border-bottom: 1px solid #4a4a4a;">
              <span style="color: ${statusColor}; font-weight: 600; margin-right: 8px;">${statusIcon}</span>
              <strong class="text-primary" style="color: #e0e0e0;">${detail.connectionName}</strong>
              <span class="text-muted" style="color: #9ca3af; font-size: 13px; margin-left: 8px;">(${detail.connectionType})</span>
            </td>
            <td class="table-cell" style="padding: 12px 16px; border-bottom: 1px solid #4a4a4a; text-align: center; color: #c0c0c0;">${detail.positionsProcessed || 0}</td>
            <td class="table-cell" style="padding: 12px 16px; border-bottom: 1px solid #4a4a4a; text-align: center; color: #c0c0c0;">${detail.operationsProcessed || 0}</td>
            <td class="table-cell" style="padding: 12px 16px; border-bottom: 1px solid #4a4a4a; color: ${detail.success ? '#6b7280' : '#ef4444'}; font-size: 13px;">${filesText}</td>
          </tr>
        `;
      });

      // Build notifications section
      let notificationsHtml = '';
      if (notifications.length > 0) {
        const notificationItems = notifications.map(notif => {
          const typeColors = {
            'unauthorized_overdraft': { bg: '#fef2f2', darkBg: '#451a1a', border: '#ef4444', icon: '💰', text: 'Negative Cash' },
            'allocation_breach': { bg: '#fef3c7', darkBg: '#451a03', border: '#f59e0b', icon: '⚠️', text: 'Allocation Breach' },
            'unknown_structured_product': { bg: '#dbeafe', darkBg: '#1e3a5f', border: '#3b82f6', icon: '❓', text: 'Unknown Product' },
            'auto_allocation_created': { bg: '#d1fae5', darkBg: '#14532d', border: '#10b981', icon: '✓', text: 'Auto-Allocation' },
            'price_override': { bg: '#ede9fe', darkBg: '#2e1065', border: '#8b5cf6', icon: '📊', text: 'Price Update' }
          };
          const style = typeColors[notif.eventType] || { bg: '#f3f4f6', darkBg: '#374151', border: '#6b7280', icon: '📢', text: notif.eventType };

          return `
            <div class="notification-item" style="margin-bottom: 12px; padding: 12px 16px; background-color: ${style.darkBg}; border-left: 4px solid ${style.border}; border-radius: 4px;">
              <div class="text-primary" style="font-weight: 600; color: #c0c0c0; margin-bottom: 4px;">
                ${style.icon} ${style.text}
              </div>
              <div class="text-secondary" style="color: #9ca3af; font-size: 14px;">${notif.message || notif.summary || ''}</div>
            </div>
          `;
        }).join('');

        notificationsHtml = `
          <tr>
            <td class="notification-section" style="padding: 24px 40px; background-color: #3a3a3a; border-top: 1px solid #4a4a4a;">
              <h2 class="text-primary" style="margin: 0 0 16px; font-size: 18px; font-weight: 600; color: #e0e0e0;">
                Notifications Generated (${notifications.length})
              </h2>
              ${notificationItems}
            </td>
          </tr>
        `;
      }

      // Build errors section
      let errorsHtml = '';
      if (errors.length > 0) {
        const errorItems = errors.map(err => `
          <div class="error-item" style="margin-bottom: 8px; padding: 12px 16px; background-color: #3d1a1a; border-left: 4px solid #ef4444; border-radius: 4px;">
            <strong style="color: #991b1b;">${err.connectionName || 'Unknown'}</strong>
            <div style="color: #7f1d1d; font-size: 14px; margin-top: 4px;">${err.error}</div>
          </div>
        `).join('');

        errorsHtml = `
          <tr>
            <td class="error-section" style="padding: 24px 40px; background-color: #3d1a1a;">
              <h2 style="margin: 0 0 16px; font-size: 18px; font-weight: 600; color: #991b1b;">
                ⚠️ Errors (${errors.length})
              </h2>
              ${errorItems}
            </td>
          </tr>
        `;
      }

      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>Bank Sync Report</title>
  <style>
    :root {
      color-scheme: light dark;
      supported-color-schemes: light dark;
    }

    /* Dark mode styles */
    @media (prefers-color-scheme: dark) {
      .email-body {
        background-color: #e0e0e0 !important;
      }
      .email-container {
        background-color: #2d2d2d !important;
        box-shadow: 0 4px 6px rgba(0,0,0,0.3) !important;
      }
      .content-section {
        background-color: #2d2d2d !important;
        border-color: #4a4a4a !important;
      }
      .stat-card {
        background-color: #3a3a3a !important;
      }
      .text-primary {
        color: #e0e0e0 !important;
      }
      .text-secondary {
        color: #b0b0b0 !important;
      }
      .text-muted {
        color: #9ca3af !important;
      }
      .table-header {
        background-color: #3a3a3a !important;
        border-color: #4a4a4a !important;
      }
      .table-row {
        border-color: #4a4a4a !important;
      }
      .table-cell {
        border-color: #4a4a4a !important;
        color: #d0d0d0 !important;
      }
      .footer-section {
        background-color: #3a3a3a !important;
        border-color: #4a4a4a !important;
      }
      .notification-section {
        background-color: #3a3a3a !important;
        border-color: #4a4a4a !important;
      }
      .notification-item {
        background-color: #3a3a3a !important;
      }
      .error-section {
        background-color: #451a1a !important;
      }
      .error-item {
        background-color: #7f1d1d !important;
      }
      .details-table {
        border-color: #c0c0c0 !important;
      }
    }
  </style>
</head>
<body class="email-body" style="margin: 0; padding: 0; font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #1a1a1a;">
  <table width="100%" cellpadding="0" cellspacing="0" class="email-body" style="background-color: #1a1a1a; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="700" cellpadding="0" cellspacing="0" class="email-container" style="background-color: #2d2d2d; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.07); overflow: hidden;">

          <!-- Header -->
          <tr>
            <td style="background: ${headerGradient}; padding: 40px 40px 32px; text-align: center;">
              <h1 style="margin: 0 0 8px; color: #ffffff; font-size: 28px; font-weight: 700;">
                ${statusIcon} Bank Sync ${statusText}
              </h1>
              <p style="margin: 0 0 4px; color: #a5b4fc; font-size: 16px;">${today}</p>
              <p style="margin: 0; color: #a5b4fc; font-size: 14px;">
                Triggered: ${triggerSource === 'cron' ? 'Automatic (Cron)' : 'Manual'} at ${time}
              </p>
            </td>
          </tr>

          <!-- Summary Stats -->
          <tr>
            <td class="content-section" style="padding: 32px 40px; border-bottom: 1px solid #4a4a4a; background-color: #2d2d2d;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" class="stat-card" style="padding: 16px; background-color: #3a3a3a; border-radius: 8px; margin-right: 12px;">
                    <div style="font-size: 36px; font-weight: 700; color: ${connectionsSucceeded === connectionsProcessed ? '#10b981' : '#f59e0b'};">
                      ${connectionsSucceeded}/${connectionsProcessed}
                    </div>
                    <div class="text-muted" style="font-size: 13px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px;">Connections</div>
                  </td>
                  <td width="12"></td>
                  <td align="center" class="stat-card" style="padding: 16px; background-color: #3a3a3a; border-radius: 8px;">
                    <div style="font-size: 36px; font-weight: 700; color: #3b82f6;">${filesDownloaded}</div>
                    <div class="text-muted" style="font-size: 13px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px;">Files Downloaded</div>
                  </td>
                  <td width="12"></td>
                  <td align="center" class="stat-card" style="padding: 16px; background-color: #3a3a3a; border-radius: 8px;">
                    <div style="font-size: 36px; font-weight: 700; color: #8b5cf6;">${positionsProcessed}</div>
                    <div class="text-muted" style="font-size: 13px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px;">Positions</div>
                  </td>
                  <td width="12"></td>
                  <td align="center" class="stat-card" style="padding: 16px; background-color: #3a3a3a; border-radius: 8px;">
                    <div style="font-size: 36px; font-weight: 700; color: #06b6d4;">${operationsProcessed}</div>
                    <div class="text-muted" style="font-size: 13px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px;">Operations</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Connection Details -->
          <tr>
            <td class="content-section" style="padding: 24px 40px; background-color: #2d2d2d;">
              <h2 class="text-primary" style="margin: 0 0 16px; font-size: 18px; font-weight: 600; color: #e0e0e0;">Connection Details</h2>
              <table width="100%" cellpadding="0" cellspacing="0" class="details-table" style="border: 1px solid #4a4a4a; border-radius: 8px; overflow: hidden;">
                <thead>
                  <tr class="table-header" style="background-color: #3a3a3a;">
                    <th class="table-cell" style="padding: 12px 16px; text-align: left; font-size: 13px; font-weight: 600; color: #c0c0c0; border-bottom: 1px solid #4a4a4a;">Connection</th>
                    <th class="table-cell" style="padding: 12px 16px; text-align: center; font-size: 13px; font-weight: 600; color: #c0c0c0; border-bottom: 1px solid #4a4a4a;">Positions</th>
                    <th class="table-cell" style="padding: 12px 16px; text-align: center; font-size: 13px; font-weight: 600; color: #c0c0c0; border-bottom: 1px solid #4a4a4a;">Operations</th>
                    <th class="table-cell" style="padding: 12px 16px; text-align: left; font-size: 13px; font-weight: 600; color: #c0c0c0; border-bottom: 1px solid #4a4a4a;">Files</th>
                  </tr>
                </thead>
                <tbody>
                  ${connectionRowsHtml || '<tr><td colspan="4" class="table-cell text-muted" style="padding: 24px; text-align: center; color: #9ca3af;">No connections processed</td></tr>'}
                </tbody>
              </table>
            </td>
          </tr>

          ${notificationsHtml}
          ${errorsHtml}

          <!-- Footer -->
          <tr>
            <td class="footer-section" style="padding: 32px 40px; background-color: #3a3a3a; border-top: 1px solid #4a4a4a;">
              <p class="text-secondary" style="margin: 0 0 8px; color: #9ca3af; font-size: 14px; text-align: center;">
                <strong>Ambervision</strong> - Amber Lake Partners
              </p>
              <p class="text-muted" style="margin: 0; color: #9ca3af; font-size: 12px; text-align: center;">
                This is an automated bank sync report. Please do not reply to this email.
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

      // Build plain text version
      let textContent = `
BANK SYNC ${statusText.toUpperCase()}
${'='.repeat(50)}

Date: ${today}
Time: ${time}
Trigger: ${triggerSource === 'cron' ? 'Automatic (Cron)' : 'Manual'}

SUMMARY
-------
Connections: ${connectionsSucceeded}/${connectionsProcessed} succeeded
Files Downloaded: ${filesDownloaded}
Positions Processed: ${positionsProcessed}
Operations Processed: ${operationsProcessed}

CONNECTION DETAILS
------------------
`;

      fileDetails.forEach(detail => {
        textContent += `${detail.success ? '✓' : '✗'} ${detail.connectionName} (${detail.connectionType}): `;
        textContent += `${detail.positionsProcessed || 0} positions, ${detail.operationsProcessed || 0} operations\n`;
        if (detail.downloadedFiles?.length > 0) {
          textContent += `  Files: ${detail.downloadedFiles.join(', ')}\n`;
        }
        if (detail.error) {
          textContent += `  Error: ${detail.error}\n`;
        }
      });

      if (notifications.length > 0) {
        textContent += `\nNOTIFICATIONS GENERATED (${notifications.length})\n`;
        textContent += '-'.repeat(30) + '\n';
        notifications.forEach(notif => {
          textContent += `• ${notif.title || notif.eventType}: ${notif.message || notif.summary || ''}\n`;
        });
      }

      if (errors.length > 0) {
        textContent += `\nERRORS (${errors.length})\n`;
        textContent += '-'.repeat(30) + '\n';
        errors.forEach(err => {
          textContent += `• ${err.connectionName}: ${err.error}\n`;
        });
      }

      textContent += `
--
Ambervision - Amber Lake Partners
This is an automated bank sync report.
      `;

      // Send email via SendPulse
      const response = await this.sendEmail({
        subject: `[Ambervision] Bank Sync Report - ${connectionsSucceeded}/${connectionsProcessed} connections ${hasErrors ? '(with errors)' : 'OK'}`,
        html: htmlContent,
        text: textContent,
        to: recipients
      });

      console.log(`[EmailService] Bank sync completion email sent to ${recipientEmail}`);

      return {
        success: true,
        messageId: response.messageId
      };

    } catch (error) {
      console.error('[EmailService] Error sending bank sync completion email:', error);
      return { success: false, error: error.message };
    }
  }
};
