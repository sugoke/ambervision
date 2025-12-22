import { Meteor } from 'meteor/meteor';
import { MailerSend, EmailParams, Sender, Recipient } from 'mailersend';

/**
 * Email Service using MailerSend API
 * Handles sending transactional emails like password resets
 */
export const EmailService = {
  /**
   * Get MailerSend configuration from settings
   */
  getConfig() {
    if (Meteor.isServer) {
      const settings = Meteor.settings.private;

      if (!settings) {
        throw new Meteor.Error('config-missing', 'Meteor settings not configured');
      }

      const config = {
        apiToken: settings.MAILERSEND_API_TOKEN,
        fromEmail: settings.MAILERSEND_FROM_EMAIL,
        fromName: settings.MAILERSEND_FROM_NAME,
        appUrl: settings.APP_URL,
        notificationsBcc: settings.EMAIL_NOTIFICATIONS_BCC || []
      };

      // Validate required fields
      if (!config.apiToken) {
        throw new Meteor.Error('config-missing', 'MAILERSEND_API_TOKEN not configured in settings');
      }
      if (!config.fromEmail) {
        throw new Meteor.Error('config-missing', 'MAILERSEND_FROM_EMAIL not configured in settings');
      }
      if (!config.appUrl) {
        throw new Meteor.Error('config-missing', 'APP_URL not configured in settings');
      }

      return config;
    }
  },

  /**
   * Initialize MailerSend client
   */
  getMailerSendClient() {
    const config = this.getConfig();
    return new MailerSend({
      apiKey: config.apiToken
    });
  },

  /**
   * Get BCC recipients from settings
   * @returns {Array} Array of Recipient objects for BCC
   */
  getBccRecipients() {
    const config = this.getConfig();
    const bcc = [];

    if (config.notificationsBcc && Array.isArray(config.notificationsBcc)) {
      config.notificationsBcc.forEach(bccEmail => {
        bcc.push(new Recipient(bccEmail, bccEmail));
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
      const mailerSend = this.getMailerSendClient();

      // Build reset URL
      const resetUrl = `${config.appUrl}/#reset-password?token=${token}`;

      // Create email sender
      const sentFrom = new Sender(config.fromEmail, config.fromName);

      // Create recipient
      const recipients = [new Recipient(email, userName || email)];

      // Build HTML email content
      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 40px 30px; border-radius: 8px 8px 0 0; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">Reset Your Password</h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; color: #333333; font-size: 16px; line-height: 1.6;">
                Hello${userName ? ` ${userName}` : ''},
              </p>

              <p style="margin: 0 0 20px; color: #333333; font-size: 16px; line-height: 1.6;">
                You recently requested to reset your password for your <strong>Amber Lake Partners</strong> account.
              </p>

              <p style="margin: 0 0 30px; color: #333333; font-size: 16px; line-height: 1.6;">
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

              <p style="margin: 0 0 20px; color: #666666; font-size: 14px; line-height: 1.6;">
                Or copy and paste this URL into your browser:
              </p>

              <p style="margin: 0 0 30px; padding: 12px; background-color: #f8f9fa; border: 1px solid #e9ecef; border-radius: 4px; word-break: break-all;">
                <a href="${resetUrl}" style="color: #667eea; text-decoration: none; font-size: 14px;">
                  ${resetUrl}
                </a>
              </p>

              <div style="margin: 30px 0; padding: 16px; background-color: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px;">
                <p style="margin: 0; color: #856404; font-size: 14px; line-height: 1.6;">
                  <strong>⚠️ Security Notice:</strong> This link will expire in 1 hour for your security.
                </p>
              </div>

              <p style="margin: 0 0 10px; color: #666666; font-size: 14px; line-height: 1.6;">
                If you didn't request this password reset, please ignore this email. Your password will remain unchanged.
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

      // Create email parameters
      const emailParams = new EmailParams()
        .setFrom(sentFrom)
        .setTo(recipients)
        .setSubject('Reset Your Amber Lake Partners Password')
        .setHtml(htmlContent)
        .setText(textContent);

      // Send email
      const response = await mailerSend.email.send(emailParams);

      console.log(`Password reset email sent to ${email}`);
      console.log('MailerSend response:', response);

      return {
        success: true,
        messageId: response.data?.id || 'unknown'
      };

    } catch (error) {
      console.error('Error sending password reset email:', error);

      // Log more details about the error
      if (error.response) {
        console.error('MailerSend API error:', {
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data
        });
      }

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
      const config = this.getConfig();
      const mailerSend = this.getMailerSendClient();

      const sentFrom = new Sender(config.fromEmail, config.fromName);
      const recipients = [new Recipient(email, userName || email)];

      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Changed Successfully</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 40px; border-radius: 8px 8px 0 0; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">✓ Password Changed</h1>
            </td>
          </tr>

          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; color: #333333; font-size: 16px; line-height: 1.6;">
                Hello${userName ? ` ${userName}` : ''},
              </p>

              <p style="margin: 0 0 20px; color: #333333; font-size: 16px; line-height: 1.6;">
                This is a confirmation that your password for your <strong>Amber Lake Partners</strong> account has been successfully changed.
              </p>

              <div style="margin: 30px 0; padding: 16px; background-color: #d1fae5; border-left: 4px solid #10b981; border-radius: 4px;">
                <p style="margin: 0; color: #065f46; font-size: 14px; line-height: 1.6;">
                  <strong>✓ All Set!</strong> Your password has been updated and all active sessions have been logged out for security.
                </p>
              </div>

              <p style="margin: 0; color: #666666; font-size: 14px; line-height: 1.6;">
                If you didn't make this change, please contact our support team immediately.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding: 30px 40px; background-color: #f8f9fa; border-radius: 0 0 8px 8px; border-top: 1px solid #e9ecef;">
              <p style="margin: 0; color: #666666; font-size: 13px; text-align: center;">
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

      const emailParams = new EmailParams()
        .setFrom(sentFrom)
        .setTo(recipients)
        .setSubject('Your Password Has Been Changed')
        .setHtml(htmlContent)
        .setText(textContent);

      const response = await mailerSend.email.send(emailParams);

      console.log(`Password changed confirmation email sent to ${email}`);

      return {
        success: true,
        messageId: response.data?.id || 'unknown'
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
      const mailerSend = this.getMailerSendClient();

      const sentFrom = new Sender(config.fromEmail, config.fromName);
      const recipients = [new Recipient(email, userName || email)];

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
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 40px; border-radius: 8px 8px 0 0; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">💰 Coupon Payment</h1>
            </td>
          </tr>

          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; color: #333333; font-size: 16px; line-height: 1.6;">
                Hello${userName ? ` ${userName}` : ''},
              </p>

              <p style="margin: 0 0 20px; color: #333333; font-size: 16px; line-height: 1.6;">
                A coupon payment of <strong style="color: #10b981;">${couponRate}</strong> has occurred for:
              </p>

              <div style="margin: 20px 0; padding: 20px; background-color: #f8f9fa; border-left: 4px solid #10b981; border-radius: 4px;">
                <p style="margin: 0 0 10px; color: #333333; font-size: 16px; font-weight: 600;">${product.title || product.productName}</p>
                <p style="margin: 0; color: #666666; font-size: 14px;">ISIN: ${product.isin || 'N/A'}</p>
              </div>

              <table width="100%" cellpadding="8" style="margin: 20px 0; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #666666;">Coupon Rate:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #333333; font-weight: 600;">${couponRate}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #666666;">Observation:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #333333;">${observationDate}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #666666;">Basket Level:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #333333;">${event.data.basketLevelFormatted}</td>
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
            <td style="padding: 30px 40px; background-color: #f8f9fa; border-radius: 0 0 8px 8px; border-top: 1px solid #e9ecef;">
              <p style="margin: 0; color: #666666; font-size: 13px; text-align: center;">
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

      const emailParams = new EmailParams()
        .setFrom(sentFrom)
        .setTo(recipients)
        .setSubject(`[Ambervision] Coupon Payment - ${product.title || product.productName}`)
        .setHtml(htmlContent)
        .setText(textContent);

      // Add BCC recipients if configured
      const bcc = this.getBccRecipients();
      if (bcc.length > 0) {
        emailParams.setBcc(bcc);
      }

      const response = await mailerSend.email.send(emailParams);
      console.log(`Coupon paid email sent to ${email}`);

      return { success: true, messageId: response.data?.id || 'unknown' };
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
      const mailerSend = this.getMailerSendClient();

      const sentFrom = new Sender(config.fromEmail, config.fromName);
      const recipients = [new Recipient(email, userName || email)];

      const productUrl = `${config.appUrl}/#products/${product._id}`;

      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Autocall Triggered</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); padding: 40px; border-radius: 8px 8px 0 0; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">🎯 Autocall Triggered</h1>
            </td>
          </tr>

          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; color: #333333; font-size: 16px; line-height: 1.6;">
                Hello${userName ? ` ${userName}` : ''},
              </p>

              <p style="margin: 0 0 20px; color: #333333; font-size: 16px; line-height: 1.6;">
                The following product has <strong style="color: #3b82f6;">autocalled early</strong>:
              </p>

              <div style="margin: 20px 0; padding: 20px; background-color: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 4px;">
                <p style="margin: 0 0 10px; color: #333333; font-size: 16px; font-weight: 600;">${product.title || product.productName}</p>
                <p style="margin: 0; color: #666666; font-size: 14px;">ISIN: ${product.isin || 'N/A'}</p>
              </div>

              <table width="100%" cellpadding="8" style="margin: 20px 0; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #666666;">Basket Level:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #333333; font-weight: 600;">${event.data.basketLevelFormatted}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #666666;">Autocall Level:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #333333;">${event.data.autocallLevelFormatted}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #666666;">Coupon Paid:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #333333;">${event.data.couponPaidFormatted}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #666666;">Redemption Date:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #333333;">${event.data.redemptionDate}</td>
                </tr>
              </table>

              <div style="margin: 20px 0; padding: 16px; background-color: #d1fae5; border-left: 4px solid #10b981; border-radius: 4px;">
                <p style="margin: 0; color: #065f46; font-size: 14px; line-height: 1.6;">
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
            <td style="padding: 30px 40px; background-color: #f8f9fa; border-radius: 0 0 8px 8px; border-top: 1px solid #e9ecef;">
              <p style="margin: 0; color: #666666; font-size: 13px; text-align: center;">
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

      const emailParams = new EmailParams()
        .setFrom(sentFrom)
        .setTo(recipients)
        .setSubject(`[Ambervision] Autocall Triggered - ${product.title || product.productName}`)
        .setHtml(htmlContent)
        .setText(textContent);

      // Add BCC recipients if configured
      const bcc = this.getBccRecipients();
      if (bcc.length > 0) {
        emailParams.setBcc(bcc);
      }

      const response = await mailerSend.email.send(emailParams);
      console.log(`Autocall email sent to ${email}`);

      return { success: true, messageId: response.data?.id || 'unknown' };
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
      const mailerSend = this.getMailerSendClient();

      const sentFrom = new Sender(config.fromEmail, config.fromName);
      const recipients = [new Recipient(email, userName || email)];

      const productUrl = `${config.appUrl}/#products/${product._id}`;

      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Barrier Breach Alert</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); padding: 40px; border-radius: 8px 8px 0 0; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">⚠️ Barrier Breach Alert</h1>
            </td>
          </tr>

          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; color: #333333; font-size: 16px; line-height: 1.6;">
                Hello${userName ? ` ${userName}` : ''},
              </p>

              <p style="margin: 0 0 20px; color: #333333; font-size: 16px; line-height: 1.6;">
                A protection barrier breach has been detected:
              </p>

              <div style="margin: 20px 0; padding: 20px; background-color: #fef2f2; border-left: 4px solid #ef4444; border-radius: 4px;">
                <p style="margin: 0 0 10px; color: #333333; font-size: 16px; font-weight: 600;">${product.title || product.productName}</p>
                <p style="margin: 0; color: #666666; font-size: 14px;">ISIN: ${product.isin || 'N/A'}</p>
              </div>

              <table width="100%" cellpadding="8" style="margin: 20px 0; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #666666;">Underlying:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #333333; font-weight: 600;">${event.data.underlyingTicker}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #666666;">Performance:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #333333; color: #ef4444;">${event.data.performanceFormatted}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #666666;">Distance to Barrier:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #333333;">${event.data.distanceToBarrierFormatted}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #666666;">Current Price:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #333333;">${event.data.currentPriceFormatted}</td>
                </tr>
              </table>

              <div style="margin: 20px 0; padding: 16px; background-color: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px;">
                <p style="margin: 0; color: #856404; font-size: 14px; line-height: 1.6;">
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
            <td style="padding: 30px 40px; background-color: #f8f9fa; border-radius: 0 0 8px 8px; border-top: 1px solid #e9ecef;">
              <p style="margin: 0; color: #666666; font-size: 13px; text-align: center;">
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

      const emailParams = new EmailParams()
        .setFrom(sentFrom)
        .setTo(recipients)
        .setSubject(`[Ambervision] Barrier Breach Alert - ${product.title || product.productName}`)
        .setHtml(htmlContent)
        .setText(textContent);

      // Add BCC recipients if configured
      const bcc = this.getBccRecipients();
      if (bcc.length > 0) {
        emailParams.setBcc(bcc);
      }

      const response = await mailerSend.email.send(emailParams);
      console.log(`Barrier breach email sent to ${email}`);

      return { success: true, messageId: response.data?.id || 'unknown' };
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
      const mailerSend = this.getMailerSendClient();

      const sentFrom = new Sender(config.fromEmail, config.fromName);
      const recipients = [new Recipient(email, userName || email)];

      const productUrl = `${config.appUrl}/#products/${product._id}`;

      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Near Barrier Warning</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); padding: 40px; border-radius: 8px 8px 0 0; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">⚠️ Near Barrier Warning</h1>
            </td>
          </tr>

          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; color: #333333; font-size: 16px; line-height: 1.6;">
                Hello${userName ? ` ${userName}` : ''},
              </p>

              <p style="margin: 0 0 20px; color: #333333; font-size: 16px; line-height: 1.6;">
                An underlying asset is approaching the protection barrier:
              </p>

              <div style="margin: 20px 0; padding: 20px; background-color: #fffbeb; border-left: 4px solid #f59e0b; border-radius: 4px;">
                <p style="margin: 0 0 10px; color: #333333; font-size: 16px; font-weight: 600;">${product.title || product.productName}</p>
                <p style="margin: 0; color: #666666; font-size: 14px;">ISIN: ${product.isin || 'N/A'}</p>
              </div>

              <table width="100%" cellpadding="8" style="margin: 20px 0; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #666666;">Underlying:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #333333; font-weight: 600;">${event.data.underlyingTicker}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #666666;">Performance:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #333333;">${event.data.performanceFormatted}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #666666;">Distance to Barrier:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #333333;">${event.data.distanceToBarrierFormatted}</td>
                </tr>
              </table>

              <div style="margin: 20px 0; padding: 16px; background-color: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px;">
                <p style="margin: 0; color: #856404; font-size: 14px; line-height: 1.6;">
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
            <td style="padding: 30px 40px; background-color: #f8f9fa; border-radius: 0 0 8px 8px; border-top: 1px solid #e9ecef;">
              <p style="margin: 0; color: #666666; font-size: 13px; text-align: center;">
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

      const emailParams = new EmailParams()
        .setFrom(sentFrom)
        .setTo(recipients)
        .setSubject(`[Ambervision] Near Barrier Warning - ${product.title || product.productName}`)
        .setHtml(htmlContent)
        .setText(textContent);

      // Add BCC recipients if configured
      const bcc = this.getBccRecipients();
      if (bcc.length > 0) {
        emailParams.setBcc(bcc);
      }

      const response = await mailerSend.email.send(emailParams);
      console.log(`Barrier near email sent to ${email}`);

      return { success: true, messageId: response.data?.id || 'unknown' };
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
      const mailerSend = this.getMailerSendClient();

      const sentFrom = new Sender(config.fromEmail, config.fromName);
      const recipients = [new Recipient(email, userName || email)];

      const productUrl = `${config.appUrl}/#products/${product._id}`;

      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Final Observation</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%); padding: 40px; border-radius: 8px 8px 0 0; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">📊 Final Observation</h1>
            </td>
          </tr>

          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; color: #333333; font-size: 16px; line-height: 1.6;">
                Hello${userName ? ` ${userName}` : ''},
              </p>

              <p style="margin: 0 0 20px; color: #333333; font-size: 16px; line-height: 1.6;">
                The final observation has occurred for:
              </p>

              <div style="margin: 20px 0; padding: 20px; background-color: #f5f3ff; border-left: 4px solid #8b5cf6; border-radius: 4px;">
                <p style="margin: 0 0 10px; color: #333333; font-size: 16px; font-weight: 600;">${product.title || product.productName}</p>
                <p style="margin: 0; color: #666666; font-size: 14px;">ISIN: ${product.isin || 'N/A'}</p>
              </div>

              <table width="100%" cellpadding="8" style="margin: 20px 0; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #666666;">Basket Level:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #333333; font-weight: 600;">${event.data.basketLevelFormatted}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #666666;">Coupon Paid:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #333333;">${event.data.couponPaidFormatted}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #666666;">Total Coupons Earned:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #333333; color: #10b981;">${event.data.totalCouponsEarnedFormatted}</td>
                </tr>
              </table>

              <div style="margin: 20px 0; padding: 16px; background-color: #dbeafe; border-left: 4px solid #3b82f6; border-radius: 4px;">
                <p style="margin: 0; color: #1e3a8a; font-size: 14px; line-height: 1.6;">
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
            <td style="padding: 30px 40px; background-color: #f8f9fa; border-radius: 0 0 8px 8px; border-top: 1px solid #e9ecef;">
              <p style="margin: 0; color: #666666; font-size: 13px; text-align: center;">
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

      const emailParams = new EmailParams()
        .setFrom(sentFrom)
        .setTo(recipients)
        .setSubject(`[Ambervision] Final Observation - ${product.title || product.productName}`)
        .setHtml(htmlContent)
        .setText(textContent);

      // Add BCC recipients if configured
      const bcc = this.getBccRecipients();
      if (bcc.length > 0) {
        emailParams.setBcc(bcc);
      }

      const response = await mailerSend.email.send(emailParams);
      console.log(`Final observation email sent to ${email}`);

      return { success: true, messageId: response.data?.id || 'unknown' };
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
      const mailerSend = this.getMailerSendClient();

      const sentFrom = new Sender(config.fromEmail, config.fromName);
      const recipients = [new Recipient(email, userName || email)];

      const productUrl = `${config.appUrl}/#products/${product._id}`;

      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Product Matured</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); padding: 40px; border-radius: 8px 8px 0 0; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">✓ Product Matured</h1>
            </td>
          </tr>

          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; color: #333333; font-size: 16px; line-height: 1.6;">
                Hello${userName ? ` ${userName}` : ''},
              </p>

              <p style="margin: 0 0 20px; color: #333333; font-size: 16px; line-height: 1.6;">
                The following product has reached maturity and has been redeemed:
              </p>

              <div style="margin: 20px 0; padding: 20px; background-color: #eef2ff; border-left: 4px solid #6366f1; border-radius: 4px;">
                <p style="margin: 0 0 10px; color: #333333; font-size: 16px; font-weight: 600;">${product.title || product.productName}</p>
                <p style="margin: 0; color: #666666; font-size: 14px;">ISIN: ${product.isin || 'N/A'}</p>
              </div>

              <div style="margin: 20px 0; padding: 16px; background-color: #d1fae5; border-left: 4px solid #10b981; border-radius: 4px;">
                <p style="margin: 0; color: #065f46; font-size: 14px; line-height: 1.6;">
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
            <td style="padding: 30px 40px; background-color: #f8f9fa; border-radius: 0 0 8px 8px; border-top: 1px solid #e9ecef;">
              <p style="margin: 0; color: #666666; font-size: 13px; text-align: center;">
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

      const emailParams = new EmailParams()
        .setFrom(sentFrom)
        .setTo(recipients)
        .setSubject(`[Ambervision] Product Matured - ${product.title || product.productName}`)
        .setHtml(htmlContent)
        .setText(textContent);

      // Add BCC recipients if configured
      const bcc = this.getBccRecipients();
      if (bcc.length > 0) {
        emailParams.setBcc(bcc);
      }

      const response = await mailerSend.email.send(emailParams);
      console.log(`Product matured email sent to ${email}`);

      return { success: true, messageId: response.data?.id || 'unknown' };
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
      const mailerSend = this.getMailerSendClient();

      const sentFrom = new Sender(config.fromEmail, config.fromName);
      const recipients = [new Recipient(email, userName || email)];

      const productUrl = `${config.appUrl}/#products/${product._id}`;

      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Memory Coupon Added</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #a855f7 0%, #9333ea 100%); padding: 40px; border-radius: 8px 8px 0 0; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">💾 Memory Coupon Added</h1>
            </td>
          </tr>

          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; color: #333333; font-size: 16px; line-height: 1.6;">
                Hello${userName ? ` ${userName}` : ''},
              </p>

              <p style="margin: 0 0 20px; color: #333333; font-size: 16px; line-height: 1.6;">
                A coupon has been added to memory for future payment:
              </p>

              <div style="margin: 20px 0; padding: 20px; background-color: #faf5ff; border-left: 4px solid #a855f7; border-radius: 4px;">
                <p style="margin: 0 0 10px; color: #333333; font-size: 16px; font-weight: 600;">${product.title || product.productName}</p>
                <p style="margin: 0; color: #666666; font-size: 14px;">ISIN: ${product.isin || 'N/A'}</p>
              </div>

              <table width="100%" cellpadding="8" style="margin: 20px 0; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #666666;">Coupon Added:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #333333; font-weight: 600;">${event.data.couponRateFormatted}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #666666;">Total in Memory:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #333333; color: #a855f7;">${event.data.totalMemoryCouponsFormatted}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #666666;">Basket Level:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #333333;">${event.data.basketLevelFormatted}</td>
                </tr>
              </table>

              <div style="margin: 20px 0; padding: 16px; background-color: #dbeafe; border-left: 4px solid #3b82f6; border-radius: 4px;">
                <p style="margin: 0; color: #1e3a8a; font-size: 14px; line-height: 1.6;">
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
            <td style="padding: 30px 40px; background-color: #f8f9fa; border-radius: 0 0 8px 8px; border-top: 1px solid #e9ecef;">
              <p style="margin: 0; color: #666666; font-size: 13px; text-align: center;">
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

      const emailParams = new EmailParams()
        .setFrom(sentFrom)
        .setTo(recipients)
        .setSubject(`[Ambervision] Memory Coupon Added - ${product.title || product.productName}`)
        .setHtml(htmlContent)
        .setText(textContent);

      // Add BCC recipients if configured
      const bcc = this.getBccRecipients();
      if (bcc.length > 0) {
        emailParams.setBcc(bcc);
      }

      const response = await mailerSend.email.send(emailParams);
      console.log(`Memory coupon email sent to ${email}`);

      return { success: true, messageId: response.data?.id || 'unknown' };
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
      const mailerSend = this.getMailerSendClient();

      const sentFrom = new Sender(config.fromEmail, config.fromName);
      const recipients = [new Recipient(email, userName || email)];

      const productUrl = `${config.appUrl}/#products/${product._id}`;

      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Barrier Recovered</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 40px; border-radius: 8px 8px 0 0; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">✓ Barrier Recovered</h1>
            </td>
          </tr>

          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; color: #333333; font-size: 16px; line-height: 1.6;">
                Hello${userName ? ` ${userName}` : ''},
              </p>

              <p style="margin: 0 0 20px; color: #333333; font-size: 16px; line-height: 1.6;">
                Good news! An underlying has recovered above the protection barrier:
              </p>

              <div style="margin: 20px 0; padding: 20px; background-color: #d1fae5; border-left: 4px solid #10b981; border-radius: 4px;">
                <p style="margin: 0 0 10px; color: #333333; font-size: 16px; font-weight: 600;">${product.title || product.productName}</p>
                <p style="margin: 0; color: #666666; font-size: 14px;">ISIN: ${product.isin || 'N/A'}</p>
              </div>

              <table width="100%" cellpadding="8" style="margin: 20px 0; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #666666;">Underlying:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #333333; font-weight: 600;">${event.data.underlyingTicker}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #666666;">Performance:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #333333; color: #10b981;">${event.data.performanceFormatted}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #666666;">Distance to Barrier:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #333333;">${event.data.distanceToBarrierFormatted}</td>
                </tr>
              </table>

              <div style="margin: 20px 0; padding: 16px; background-color: #d1fae5; border-left: 4px solid #10b981; border-radius: 4px;">
                <p style="margin: 0; color: #065f46; font-size: 14px; line-height: 1.6;">
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
            <td style="padding: 30px 40px; background-color: #f8f9fa; border-radius: 0 0 8px 8px; border-top: 1px solid #e9ecef;">
              <p style="margin: 0; color: #666666; font-size: 13px; text-align: center;">
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

      const emailParams = new EmailParams()
        .setFrom(sentFrom)
        .setTo(recipients)
        .setSubject(`[Ambervision] Barrier Recovered - ${product.title || product.productName}`)
        .setHtml(htmlContent)
        .setText(textContent);

      // Add BCC recipients if configured
      const bcc = this.getBccRecipients();
      if (bcc.length > 0) {
        emailParams.setBcc(bcc);
      }

      const response = await mailerSend.email.send(emailParams);
      console.log(`Barrier recovered email sent to ${email}`);

      return { success: true, messageId: response.data?.id || 'unknown' };
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
      const mailerSend = this.getMailerSendClient();

      const sentFrom = new Sender(config.fromEmail, config.fromName);
      const recipients = [new Recipient(recipientEmail, recipientEmail)];

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

      // Helper function to get event icon and color
      const getEventStyle = (eventType) => {
        const styles = {
          'coupon_paid': { icon: '💰', color: '#10b981', bgColor: '#d1fae5', borderColor: '#10b981' },
          'autocall_triggered': { icon: '🎯', color: '#3b82f6', bgColor: '#dbeafe', borderColor: '#3b82f6' },
          'barrier_breached': { icon: '⚠️', color: '#ef4444', bgColor: '#fee2e2', borderColor: '#ef4444' },
          'barrier_near': { icon: '⚠️', color: '#f59e0b', bgColor: '#fef3c7', borderColor: '#f59e0b' },
          'final_observation': { icon: '📊', color: '#8b5cf6', bgColor: '#ede9fe', borderColor: '#8b5cf6' },
          'product_matured': { icon: '✓', color: '#6366f1', bgColor: '#e0e7ff', borderColor: '#6366f1' },
          'memory_coupon_added': { icon: '💾', color: '#a855f7', bgColor: '#f3e8ff', borderColor: '#a855f7' },
          'barrier_recovered': { icon: '✓', color: '#10b981', bgColor: '#d1fae5', borderColor: '#10b981' }
        };
        return styles[eventType] || { icon: '📢', color: '#6b7280', bgColor: '#f3f4f6', borderColor: '#6b7280' };
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
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                <div style="display: flex; align-items: flex-start;">
                  <span style="font-size: 20px; margin-right: 12px;">${style.icon}</span>
                  <div style="flex: 1;">
                    <div style="font-weight: 600; color: ${style.color}; margin-bottom: 4px;">${eventName}</div>
                    <div style="color: #6b7280; font-size: 14px; line-height: 1.5;">${notif.summary}</div>
                  </div>
                </div>
              </td>
            </tr>
          `;
        });

        eventCardsHtml += `
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px; background-color: #ffffff; border-radius: 8px; border: 1px solid #e5e7eb; overflow: hidden;">
            <!-- Product Header -->
            <tr>
              <td style="padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                <h2 style="margin: 0 0 8px; color: #ffffff; font-size: 18px; font-weight: 600;">${productName}</h2>
                <p style="margin: 0 0 4px; color: #e0e7ff; font-size: 14px;">ISIN: ${productIsin}</p>
                <p style="margin: 0; color: #e0e7ff; font-size: 14px;">
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
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.07); overflow: hidden;">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 40px 32px; text-align: center;">
              <h1 style="margin: 0 0 8px; color: #ffffff; font-size: 28px; font-weight: 700;">Daily Product Notifications</h1>
              <p style="margin: 0; color: #e0e7ff; font-size: 16px;">${today}</p>
            </td>
          </tr>

          <!-- Summary Banner -->
          <tr>
            <td style="padding: 24px 40px; background: linear-gradient(to right, #ede9fe, #dbeafe); border-bottom: 1px solid #e5e7eb;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 8px;">
                    <div style="font-size: 32px; font-weight: 700; color: #4c1d95; margin-bottom: 4px;">${eventCount}</div>
                    <div style="font-size: 13px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Event${eventCount !== 1 ? 's' : ''}</div>
                  </td>
                  <td align="center" style="padding: 8px;">
                    <div style="font-size: 32px; font-weight: 700; color: #1e40af; margin-bottom: 4px;">${productCount}</div>
                    <div style="font-size: 13px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Product${productCount !== 1 ? 's' : ''}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 32px 40px;">
              <p style="margin: 0 0 24px; color: #374151; font-size: 15px; line-height: 1.6;">
                Here's your daily summary of structured product notifications. Review the events below and click through to view detailed product reports.
              </p>

              ${eventCardsHtml}

              <div style="margin-top: 24px; padding: 16px; background-color: #f9fafb; border-left: 4px solid #667eea; border-radius: 4px;">
                <p style="margin: 0; color: #4b5563; font-size: 14px; line-height: 1.5;">
                  <strong>📊 Need Help?</strong> For questions about these notifications or product performance, please contact your relationship manager.
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 32px 40px; background-color: #f9fafb; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0 0 8px; color: #6b7280; font-size: 14px; text-align: center;">
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

      const emailParams = new EmailParams()
        .setFrom(sentFrom)
        .setTo(recipients)
        .setSubject(`[Ambervision] Daily Digest - ${eventCount} Notification${eventCount !== 1 ? 's' : ''}`)
        .setHtml(htmlContent)
        .setText(textContent);

      // Add BCC recipients if configured
      const bcc = this.getBccRecipients();
      if (bcc.length > 0) {
        emailParams.setBcc(bcc);
      }

      const response = await mailerSend.email.send(emailParams);
      console.log(`[EmailService] Daily summary email sent to ${recipientEmail} with ${eventCount} notifications`);

      return {
        success: true,
        messageId: response.data?.id || 'unknown',
        notificationCount: eventCount,
        productCount: productCount
      };

    } catch (error) {
      console.error('[EmailService] Error sending daily summary email:', error);

      if (error.response) {
        console.error('MailerSend API error:', {
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data
        });
      }

      return { success: false, error: error.message };
    }
  }
};
