import { Meteor } from 'meteor/meteor';

// Token caching for SendPulse OAuth2
let cachedToken = null;
let tokenExpiry = null;

// ---------------------------------------------------------------------------
// Ambervision email design system
// Email-safe rendition of the app's design language: table layout, inline
// styles, fixed hex colors (no CSS vars / color-mix in email clients).
// Light "paper" ground mirroring the light theme tokens, ink masthead with
// the signature amber rule, Georgia standing in for the Newsreader serif.
// ---------------------------------------------------------------------------
export const EMAIL = {
  paper: '#F7F4EC',
  card: '#FFFFFF',
  hairline: '#E2DCCB',
  ink: '#1C1F26',
  body: '#3A404C',
  muted: '#666C78',
  headerBg: '#14171D',
  headerText: '#F5F1E8',
  headerMuted: '#8B909C',
  amber: '#E0A138',      // rules/glyphs on dark grounds
  amberFill: '#B8841F',  // buttons and fills (white text)
  amberText: '#8A5F0B',  // amber used as text on paper (AA-safe)
  success: '#14724F', successWash: '#EAF3EE',
  danger: '#B03C2F',  dangerWash: '#F9EDEB',
  warning: '#8A5F0B', warningWash: '#F7EFDD',
  info: '#2B5E8C',    infoWash: '#EBF2F8',
  footerBg: '#F3EFE4',
  serif: "Georgia, 'Times New Roman', serif",
  sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
};

export const EMAIL_TONES = {
  success: { color: EMAIL.success, wash: EMAIL.successWash },
  danger: { color: EMAIL.danger, wash: EMAIL.dangerWash },
  warning: { color: EMAIL.warning, wash: EMAIL.warningWash },
  info: { color: EMAIL.info, wash: EMAIL.infoWash }
};

export const emailGreeting = (userName) => `
              <p style="margin: 0 0 18px; color: ${EMAIL.body}; font-size: 15px; line-height: 1.65;">Hello${userName ? ` ${userName}` : ''},</p>`;

export const emailParagraph = (html) => `
              <p style="margin: 0 0 18px; color: ${EMAIL.body}; font-size: 15px; line-height: 1.65;">${html}</p>`;

export const emailMutedNote = (html) => `
              <p style="margin: 0; color: ${EMAIL.muted}; font-size: 13px; line-height: 1.6;">${html}</p>`;

export const emailProductCard = (product) => `
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 20px 0;">
                <tr>
                  <td style="padding: 18px 20px; background-color: ${EMAIL.paper}; border: 1px solid ${EMAIL.hairline}; border-left: 3px solid ${EMAIL.amber}; border-radius: 8px;">
                    <p style="margin: 0 0 6px; color: ${EMAIL.ink}; font-family: ${EMAIL.serif}; font-size: 17px;">${product.title || product.productName}</p>
                    <p style="margin: 0; color: ${EMAIL.muted}; font-size: 11px; font-weight: 600; letter-spacing: 1.4px; text-transform: uppercase;">ISIN&nbsp;&nbsp;${product.isin || 'N/A'}</p>
                  </td>
                </tr>
              </table>`;

// rows: array of [label, value, optionalValueColor]
export const emailKvTable = (rows) => `
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 20px 0; border-collapse: collapse;">${rows.map(([label, value, valueColor]) => `
                <tr>
                  <td style="padding: 10px 0; border-bottom: 1px solid ${EMAIL.hairline}; color: ${EMAIL.muted}; font-size: 13px;">${label}</td>
                  <td align="right" style="padding: 10px 0; border-bottom: 1px solid ${EMAIL.hairline}; color: ${valueColor || EMAIL.ink}; font-size: 14px; font-weight: 600;">${value}</td>
                </tr>`).join('')}
              </table>`;

export const emailNotice = (tone, title, text = '') => {
  const t = EMAIL_TONES[tone] || EMAIL_TONES.info;
  return `
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 20px 0;">
                <tr>
                  <td style="padding: 14px 18px; background-color: ${t.wash}; border-left: 3px solid ${t.color}; border-radius: 6px;">
                    <p style="margin: 0; color: ${t.color}; font-size: 13.5px; line-height: 1.6;"><strong>${title}</strong>${text ? `<br>${text}` : ''}</p>
                  </td>
                </tr>
              </table>`;
};

export const emailButton = (url, label) => `
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 22px 0 8px;">
                    <a href="${url}" style="display: inline-block; padding: 13px 34px; background-color: ${EMAIL.amberFill}; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 600; letter-spacing: 0.4px; border-radius: 8px;">${label}</a>
                  </td>
                </tr>
              </table>`;

/**
 * Full email document: paper ground, white card, amber rule, ink masthead
 * with eyebrow + serif title, content cell, optional extra full-width
 * sections (already wrapped in <tr>), and the standard footer.
 */
export const emailShell = ({
  title,
  subtitle = '',
  headerExtraHtml = '',
  width = 600,
  bodyHtml,
  sectionsHtml = '',
  footerNote = 'This is an automated email. Please do not reply to this message.',
  signatureName = 'Amberlake Partners Team'
}) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; font-family: ${EMAIL.sans}; background-color: ${EMAIL.paper};">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: ${EMAIL.paper}; padding: 36px 16px;">
    <tr>
      <td align="center">
        <table width="${width}" cellpadding="0" cellspacing="0" style="background-color: ${EMAIL.card}; border: 1px solid ${EMAIL.hairline}; border-radius: 12px; overflow: hidden;">
          <!-- Signature amber rule -->
          <tr>
            <td height="3" style="background-color: ${EMAIL.amber}; font-size: 0; line-height: 0;">&nbsp;</td>
          </tr>
          <!-- Masthead -->
          <tr>
            <td style="background-color: ${EMAIL.headerBg}; padding: 32px 40px 28px; text-align: center;">
              <p style="margin: 0 0 12px; color: ${EMAIL.headerMuted}; font-size: 11px; font-weight: 600; letter-spacing: 3px; text-transform: uppercase;">Amberlake Partners</p>
              <h1 style="margin: 0; color: ${EMAIL.headerText}; font-family: ${EMAIL.serif}; font-size: 26px; font-weight: 500; letter-spacing: 0.3px;">${title}</h1>
              ${subtitle ? `<p style="margin: 10px 0 0; color: ${EMAIL.headerMuted}; font-size: 13px;">${subtitle}</p>` : ''}${headerExtraHtml}
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding: 34px 40px 26px;">
${bodyHtml}
            </td>
          </tr>
${sectionsHtml}
          <!-- Footer -->
          <tr>
            <td style="padding: 26px 40px; background-color: ${EMAIL.footerBg}; border-top: 1px solid ${EMAIL.hairline}; text-align: center;">
              <p style="margin: 0 0 8px; color: ${EMAIL.muted}; font-size: 13px;">Best regards,<br><strong style="color: ${EMAIL.ink};">${signatureName}</strong></p>
              <p style="margin: 0; color: ${EMAIL.muted}; font-size: 11px; letter-spacing: 0.3px;">${footerNote}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

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
        // A SendPulse API key (sp_apikey_...) is sent as the bearer token as-is.
        // The older ID + secret pair goes through the OAuth exchange instead;
        // it stays supported so either form of credential works.
        apiKey: settings.SENDPULSE_API_KEY,
        clientId: settings.SENDPULSE_CLIENT_ID,
        clientSecret: settings.SENDPULSE_CLIENT_SECRET,
        fromEmail: settings.SENDPULSE_FROM_EMAIL,
        fromName: settings.SENDPULSE_FROM_NAME,
        appUrl: settings.APP_URL,
        notificationsBcc: settings.EMAIL_NOTIFICATIONS_BCC || []
      };

      // Validate required fields
      if (!config.apiKey && !config.clientId) {
        throw new Meteor.Error('config-missing', 'SENDPULSE_API_KEY (or SENDPULSE_CLIENT_ID) not configured in settings');
      }
      if (!config.apiKey && !config.clientSecret) {
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

    // An API key needs no exchange: it is the bearer token.
    if (config.apiKey) return config.apiKey;

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
   * @param {Array} emailData.attachments - Optional array of {name, content, type} attachments
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

    // Add attachments if provided
    // SendPulse expects: attachments: { "filename.txt": "base64content", ... }
    if (emailData.attachments && emailData.attachments.length > 0) {
      payload.email.attachments = {};
      emailData.attachments.forEach(att => {
        // If content is already base64, use as-is; otherwise encode it
        const content = att.isBase64 ? att.content : Buffer.from(att.content).toString('base64');
        payload.email.attachments[att.name] = content;
      });
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

      const htmlContent = emailShell({
        title: 'Reset Your Password',
        bodyHtml: `${emailGreeting(userName)}${emailParagraph(
          'You recently requested to reset your password for your <strong>Amberlake Partners</strong> account.'
        )}${emailParagraph('Click the button below to reset your password:')}${emailButton(resetUrl, 'Reset Password')}
              <p style="margin: 20px 0 10px; color: ${EMAIL.muted}; font-size: 13px; line-height: 1.6;">Or copy and paste this URL into your browser:</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 8px;">
                <tr>
                  <td style="padding: 12px 14px; background-color: ${EMAIL.paper}; border: 1px solid ${EMAIL.hairline}; border-radius: 6px; word-break: break-all;">
                    <a href="${resetUrl}" style="color: ${EMAIL.amberText}; text-decoration: none; font-size: 13px;">${resetUrl}</a>
                  </td>
                </tr>
              </table>${emailNotice('warning', 'Security Notice:', 'This link will expire in 1 hour for your security.')}${emailMutedNote(
          "If you didn't request this password reset, please ignore this email. Your password will remain unchanged."
        )}`
      });

      // Plain text version
      const textContent = `
Reset Your Password

Hello${userName ? ` ${userName}` : ''},

You recently requested to reset your password for your Amberlake Partners account.

Click the link below to reset your password:
${resetUrl}

⚠️ Security Notice: This link will expire in 1 hour for your security.

If you didn't request this password reset, please ignore this email. Your password will remain unchanged.

Best regards,
Amberlake Partners Team

This is an automated email. Please do not reply to this message.
      `;

      // Send email via SendPulse
      const response = await this.sendEmail({
        subject: 'Reset Your Amberlake Partners Password',
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

      const htmlContent = emailShell({
        title: 'Password Changed',
        bodyHtml: `${emailGreeting(userName)}${emailParagraph(
          'This is a confirmation that your password for your <strong>Amberlake Partners</strong> account has been successfully changed.'
        )}${emailNotice('success', '✓ All Set!', 'Your password has been updated and all active sessions have been logged out for security.')}${emailMutedNote(
          "If you didn't make this change, please contact our support team immediately."
        )}`
      });

      const textContent = `
Password Changed Successfully

Hello${userName ? ` ${userName}` : ''},

This is a confirmation that your password for your Amberlake Partners account has been successfully changed.

All active sessions have been logged out for security.

If you didn't make this change, please contact our support team immediately.

Best regards,
Amberlake Partners Team
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

      const htmlContent = emailShell({
        title: 'Coupon Payment',
        bodyHtml: `${emailGreeting(userName)}${emailParagraph(
          `A coupon payment of <strong style="color: ${EMAIL.success};">${couponRate}</strong> has occurred for:`
        )}${emailProductCard(product)}${emailKvTable([
          ['Coupon Rate', couponRate, EMAIL.success],
          ['Observation', observationDate],
          ['Basket Level', event.data.basketLevelFormatted]
        ])}${emailButton(productUrl, 'View Product Details')}`
      });

      const textContent = `
Coupon Payment

Hello${userName ? ` ${userName}` : ''},

A coupon payment of ${couponRate} has occurred for ${product.title || product.productName} (${product.isin || 'N/A'}).

Coupon Rate: ${couponRate}
Observation: ${observationDate}
Basket Level: ${event.data.basketLevelFormatted}

View product details: ${productUrl}

Best regards,
Amberlake Partners Team
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

      const htmlContent = emailShell({
        title: 'Autocall Triggered',
        bodyHtml: `${emailGreeting(userName)}${emailParagraph(
          `The following product has <strong style="color: ${EMAIL.amberText};">autocalled early</strong>:`
        )}${emailProductCard(product)}${emailKvTable([
          ['Basket Level', event.data.basketLevelFormatted],
          ['Autocall Level', event.data.autocallLevelFormatted],
          ['Coupon Paid', event.data.couponPaidFormatted],
          ['Redemption Date', event.data.redemptionDate]
        ])}${emailNotice('success', '✓ Early Redemption', 'The product will be redeemed early as the autocall condition has been met.')}${emailButton(productUrl, 'View Product Details')}`
      });

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
Amberlake Partners Team
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

      const htmlContent = emailShell({
        title: 'Barrier Breach Alert',
        bodyHtml: `${emailGreeting(userName)}${emailParagraph(
          'A protection barrier breach has been detected:'
        )}${emailProductCard(product)}${emailKvTable([
          ['Underlying', event.data.underlyingTicker],
          ['Performance', event.data.performanceFormatted, EMAIL.danger],
          ['Distance to Barrier', event.data.distanceToBarrierFormatted],
          ['Current Price', event.data.currentPriceFormatted]
        ])}${emailNotice('danger', '⚠️ Attention Required', 'The underlying asset has fallen below the protection barrier. Capital protection is no longer guaranteed.')}${emailButton(productUrl, 'View Product Details')}`
      });

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
Amberlake Partners Team
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

      const htmlContent = emailShell({
        title: 'Near Barrier Warning',
        bodyHtml: `${emailGreeting(userName)}${emailParagraph(
          'An underlying asset is approaching the protection barrier:'
        )}${emailProductCard(product)}${emailKvTable([
          ['Underlying', event.data.underlyingTicker],
          ['Performance', event.data.performanceFormatted],
          ['Distance to Barrier', event.data.distanceToBarrierFormatted, EMAIL.amberText]
        ])}${emailNotice('warning', '⚠️ Monitor Closely', 'The underlying is within 10% of the protection barrier. Please monitor the situation closely.')}${emailButton(productUrl, 'View Product Details')}`
      });

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
Amberlake Partners Team
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

      const htmlContent = emailShell({
        title: 'Final Observation',
        bodyHtml: `${emailGreeting(userName)}${emailParagraph(
          'The final observation has occurred for:'
        )}${emailProductCard(product)}${emailKvTable([
          ['Basket Level', event.data.basketLevelFormatted],
          ['Coupon Paid', event.data.couponPaidFormatted],
          ['Total Coupons Earned', event.data.totalCouponsEarnedFormatted, EMAIL.success]
        ])}${emailNotice('info', 'ℹ️ Maturity Approaching', 'The product will mature shortly. Final settlement details will be provided.')}${emailButton(productUrl, 'View Product Details')}`
      });

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
Amberlake Partners Team
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

      const htmlContent = emailShell({
        title: 'Product Matured',
        bodyHtml: `${emailGreeting(userName)}${emailParagraph(
          'The following product has reached maturity and has been redeemed:'
        )}${emailProductCard(product)}${emailNotice('success', '✓ Settlement Complete', 'Final redemption proceeds have been calculated and will be settled according to the product terms.')}${emailButton(productUrl, 'View Product Details')}`
      });

      const textContent = `
Product Matured

Hello${userName ? ` ${userName}` : ''},

The following product has reached maturity and has been redeemed: ${product.title || product.productName} (${product.isin || 'N/A'})

Final redemption proceeds have been calculated and will be settled according to the product terms.

View product details: ${productUrl}

Best regards,
Amberlake Partners Team
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

      const htmlContent = emailShell({
        title: 'Memory Coupon Added',
        bodyHtml: `${emailGreeting(userName)}${emailParagraph(
          'A coupon has been added to memory for future payment:'
        )}${emailProductCard(product)}${emailKvTable([
          ['Coupon Added', event.data.couponRateFormatted],
          ['Total in Memory', event.data.totalMemoryCouponsFormatted, EMAIL.amberText],
          ['Basket Level', event.data.basketLevelFormatted]
        ])}${emailNotice('info', 'ℹ️ Memory Coupon', 'Coupons in memory will be paid when the product meets coupon payment conditions or at maturity.')}${emailButton(productUrl, 'View Product Details')}`
      });

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
Amberlake Partners Team
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

      const htmlContent = emailShell({
        title: 'Barrier Recovered',
        bodyHtml: `${emailGreeting(userName)}${emailParagraph(
          'Good news! An underlying has recovered above the protection barrier:'
        )}${emailProductCard(product)}${emailKvTable([
          ['Underlying', event.data.underlyingTicker],
          ['Performance', event.data.performanceFormatted, EMAIL.success],
          ['Distance to Barrier', event.data.distanceToBarrierFormatted]
        ])}${emailNotice('success', '✓ Capital Protection Restored', 'The underlying has recovered above the protection barrier. Capital protection is now active.')}${emailButton(productUrl, 'View Product Details')}`
      });

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
Amberlake Partners Team
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

      // Helper function to get event icon and semantic color
      const getEventStyle = (eventType) => {
        const styles = {
          'coupon_paid': { icon: '💰', color: EMAIL.success },
          'autocall_triggered': { icon: '🎯', color: EMAIL.info },
          'barrier_breached': { icon: '⚠️', color: EMAIL.danger },
          'barrier_near': { icon: '⚠️', color: EMAIL.warning },
          'final_observation': { icon: '📊', color: EMAIL.info },
          'product_matured': { icon: '✓', color: EMAIL.success },
          'memory_coupon_added': { icon: '💾', color: EMAIL.info },
          'barrier_recovered': { icon: '✓', color: EMAIL.success }
        };
        return styles[eventType] || { icon: '📢', color: EMAIL.muted };
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
              <td width="34" valign="top" style="padding: 12px 0; border-bottom: 1px solid ${EMAIL.hairline}; font-size: 18px;">${style.icon}</td>
              <td style="padding: 12px 0; border-bottom: 1px solid ${EMAIL.hairline};">
                <div style="font-weight: 600; color: ${style.color}; font-size: 14px; margin-bottom: 4px;">${eventName}</div>
                <div style="color: ${EMAIL.muted}; font-size: 13.5px; line-height: 1.5;">${notif.summary}</div>
              </td>
            </tr>
          `;
        });

        eventCardsHtml += `
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 22px; border: 1px solid ${EMAIL.hairline}; border-radius: 10px; overflow: hidden;">
            <!-- Product Header -->
            <tr>
              <td style="padding: 18px 20px; background-color: ${EMAIL.headerBg}; border-bottom: 2px solid ${EMAIL.amber};">
                <h2 style="margin: 0 0 6px; color: ${EMAIL.headerText}; font-family: ${EMAIL.serif}; font-size: 17px; font-weight: 500;">${productName}</h2>
                <p style="margin: 0 0 4px; color: ${EMAIL.headerMuted}; font-size: 11px; font-weight: 600; letter-spacing: 1.4px; text-transform: uppercase;">ISIN&nbsp;&nbsp;${productIsin}</p>
                <p style="margin: 0; color: ${EMAIL.headerMuted}; font-size: 13px;">
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
              <td style="padding: 18px 20px;" align="center">
                <a href="${productUrl}" style="display: inline-block; padding: 11px 24px; background-color: ${EMAIL.amberFill}; color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 600; letter-spacing: 0.4px; border-radius: 7px;">
                  View Product Report →
                </a>
              </td>
            </tr>
          </table>
        `;
      }

      const htmlContent = emailShell({
        title: 'Daily Product Notifications',
        subtitle: today,
        bodyHtml: `
              <!-- Summary stats -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 24px;">
                <tr>
                  <td align="center" width="50%" style="padding: 16px; background-color: ${EMAIL.paper}; border: 1px solid ${EMAIL.hairline}; border-radius: 10px;">
                    <div style="font-family: ${EMAIL.serif}; font-size: 30px; color: ${EMAIL.ink};">${eventCount}</div>
                    <div style="font-size: 11px; font-weight: 600; color: ${EMAIL.muted}; text-transform: uppercase; letter-spacing: 1.4px; margin-top: 4px;">Event${eventCount !== 1 ? 's' : ''}</div>
                  </td>
                  <td width="12"></td>
                  <td align="center" width="50%" style="padding: 16px; background-color: ${EMAIL.paper}; border: 1px solid ${EMAIL.hairline}; border-radius: 10px;">
                    <div style="font-family: ${EMAIL.serif}; font-size: 30px; color: ${EMAIL.ink};">${productCount}</div>
                    <div style="font-size: 11px; font-weight: 600; color: ${EMAIL.muted}; text-transform: uppercase; letter-spacing: 1.4px; margin-top: 4px;">Product${productCount !== 1 ? 's' : ''}</div>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 24px; color: ${EMAIL.body}; font-size: 14.5px; line-height: 1.65;">
                Here's your daily summary of structured product notifications. Review the events below and click through to view detailed product reports.
              </p>

              ${eventCardsHtml}${emailNotice('info', '📊 Need Help?', 'For questions about these notifications or product performance, please contact your relationship manager.')}`,
        footerNote: 'This is an automated daily digest. Please do not reply to this email.'
      });

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
Amberlake Partners Team

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
        connectionsWithStaleData = 0,
        filesDownloaded = 0,
        positionsProcessed = 0,
        operationsProcessed = 0,
        errors = [],
        fileDetails = []
      } = syncResults;

      // Status - considers both errors and stale data
      const hasErrors = connectionsFailed > 0 || errors.length > 0;
      const hasStaleData = connectionsWithStaleData > 0;

      let statusTone, statusIcon, statusText;
      if (hasErrors) {
        statusTone = 'danger';
        statusIcon = '⚠️';
        statusText = 'Completed with Errors';
      } else if (hasStaleData) {
        statusTone = 'warning';
        statusIcon = '⚠️';
        statusText = `${connectionsSucceeded}/${connectionsProcessed} Fresh Data`;
      } else {
        statusTone = 'success';
        statusIcon = '✓';
        statusText = 'All Data Fresh';
      }
      const statusColor = EMAIL_TONES[statusTone].color;

      // Build connection details rows
      let connectionRowsHtml = '';
      fileDetails.forEach(detail => {
        const rowIcon = detail.success ? '✓' : '✗';
        const rowIconColor = detail.success ? EMAIL.success : EMAIL.danger;
        // Show files for SFTP (downloaded) or local (deposited) connections
        // For local, show skipped files if no new files (to show what's available)
        const hasNewFiles = detail.downloadedFiles?.length > 0;
        const hasSkippedFiles = detail.skippedFiles?.length > 0;
        let filesText;
        if (!detail.success) {
          filesText = detail.error || 'Failed';
        } else if (hasNewFiles) {
          filesText = detail.downloadedFiles.join(', ');
        } else {
          filesText = 'No new files';
        }

        // Freshness indicator
        const freshness = detail.freshness || {};
        let freshnessIcon, freshnessColor, freshnessText;
        if (!detail.success) {
          freshnessIcon = '❌';
          freshnessColor = EMAIL.danger;
          freshnessText = 'Error';
        } else if (freshness.status === 'fresh') {
          freshnessIcon = '🟢';
          freshnessColor = EMAIL.success;
          freshnessText = freshness.formattedDate || 'Fresh';
        } else if (freshness.status === 'stale') {
          freshnessIcon = '🟡';
          freshnessColor = EMAIL.warning;
          freshnessText = `${freshness.formattedDate} (1 day old)`;
        } else if (freshness.status === 'old') {
          freshnessIcon = '🟠';
          freshnessColor = EMAIL.warning;
          freshnessText = `${freshness.formattedDate} (${freshness.businessDaysOld} days old)`;
        } else {
          freshnessIcon = '⚪';
          freshnessColor = EMAIL.muted;
          freshnessText = 'No data';
        }

        connectionRowsHtml += `
          <tr>
            <td style="padding: 12px 16px; border-bottom: 1px solid ${EMAIL.hairline};">
              <span style="color: ${rowIconColor}; font-weight: 600; margin-right: 8px;">${rowIcon}</span>
              <strong style="color: ${EMAIL.ink};">${detail.connectionName}</strong>
              <span style="color: ${EMAIL.muted}; font-size: 13px; margin-left: 8px;">(${detail.connectionType})</span>
            </td>
            <td style="padding: 12px 16px; border-bottom: 1px solid ${EMAIL.hairline}; text-align: center; color: ${EMAIL.body};">${detail.positionsProcessed || 0}</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid ${EMAIL.hairline}; text-align: center; color: ${freshnessColor}; font-size: 13px;">
              ${freshnessIcon} ${freshnessText}
            </td>
            <td style="padding: 12px 16px; border-bottom: 1px solid ${EMAIL.hairline}; color: ${detail.success ? EMAIL.muted : EMAIL.danger}; font-size: 13px;">${filesText}</td>
          </tr>
        `;
      });

      // Build notifications section
      let notificationsHtml = '';
      if (notifications.length > 0) {
        const notificationItems = notifications.map(notif => {
          const typeTones = {
            'unauthorized_overdraft': { tone: 'danger', icon: '💰', text: 'Negative Cash' },
            'allocation_breach': { tone: 'warning', icon: '⚠️', text: 'Allocation Breach' },
            'unknown_structured_product': { tone: 'info', icon: '❓', text: 'Unknown Product' },
            'auto_allocation_created': { tone: 'success', icon: '✓', text: 'Auto-Allocation' },
            'price_override': { tone: 'info', icon: '📊', text: 'Price Update' }
          };
          const mapped = typeTones[notif.eventType] || { tone: 'info', icon: '📢', text: notif.eventType };
          const t = EMAIL_TONES[mapped.tone];

          return `
            <div style="margin-bottom: 12px; padding: 12px 16px; background-color: ${t.wash}; border-left: 3px solid ${t.color}; border-radius: 6px;">
              <div style="font-weight: 600; color: ${t.color}; font-size: 14px; margin-bottom: 4px;">
                ${mapped.icon} ${mapped.text}
              </div>
              <div style="color: ${EMAIL.body}; font-size: 13.5px;">${notif.message || notif.summary || ''}</div>
            </div>
          `;
        }).join('');

        notificationsHtml = `
          <tr>
            <td style="padding: 24px 40px; background-color: ${EMAIL.paper}; border-top: 1px solid ${EMAIL.hairline};">
              <h2 style="margin: 0 0 16px; font-family: ${EMAIL.serif}; font-size: 18px; font-weight: 500; color: ${EMAIL.ink};">
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
          <div style="margin-bottom: 8px; padding: 12px 16px; background-color: ${EMAIL.card}; border: 1px solid ${EMAIL.hairline}; border-left: 3px solid ${EMAIL.danger}; border-radius: 6px;">
            <strong style="color: ${EMAIL.danger};">${err.connectionName || 'Unknown'}</strong>
            <div style="color: ${EMAIL.body}; font-size: 13.5px; margin-top: 4px;">${err.error}</div>
          </div>
        `).join('');

        errorsHtml = `
          <tr>
            <td style="padding: 24px 40px; background-color: ${EMAIL.dangerWash}; border-top: 1px solid ${EMAIL.hairline};">
              <h2 style="margin: 0 0 16px; font-family: ${EMAIL.serif}; font-size: 18px; font-weight: 500; color: ${EMAIL.danger};">
                ⚠️ Errors (${errors.length})
              </h2>
              ${errorItems}
            </td>
          </tr>
        `;
      }

      const htmlContent = emailShell({
        title: 'Bank Sync Report',
        subtitle: `${today} · Triggered: ${triggerSource === 'cron' ? 'Automatic (Cron)' : 'Manual'} at ${time}`,
        headerExtraHtml: `
              <div style="margin-top: 14px;"><span style="display: inline-block; padding: 6px 16px; border-radius: 20px; background-color: ${statusColor}; color: #ffffff; font-size: 12.5px; font-weight: 600; letter-spacing: 0.3px;">${statusIcon} ${statusText}</span></div>`,
        width: 700,
        bodyHtml: `
              <!-- Summary Stats -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 28px;">
                <tr>
                  <td align="center" style="padding: 16px 8px; background-color: ${EMAIL.paper}; border: 1px solid ${EMAIL.hairline}; border-radius: 10px;">
                    <div style="font-family: ${EMAIL.serif}; font-size: 28px; color: ${connectionsFailed === 0 ? EMAIL.success : EMAIL.danger};">
                      ${connectionsProcessed - connectionsFailed}/${connectionsProcessed}
                    </div>
                    <div style="font-size: 11px; font-weight: 600; color: ${EMAIL.muted}; text-transform: uppercase; letter-spacing: 1.2px; margin-top: 4px;">Connected</div>
                  </td>
                  <td width="12"></td>
                  <td align="center" style="padding: 16px 8px; background-color: ${EMAIL.paper}; border: 1px solid ${EMAIL.hairline}; border-radius: 10px;">
                    <div style="font-family: ${EMAIL.serif}; font-size: 28px; color: ${EMAIL.ink};">${filesDownloaded}</div>
                    <div style="font-size: 11px; font-weight: 600; color: ${EMAIL.muted}; text-transform: uppercase; letter-spacing: 1.2px; margin-top: 4px;">New Files</div>
                  </td>
                  <td width="12"></td>
                  <td align="center" style="padding: 16px 8px; background-color: ${EMAIL.paper}; border: 1px solid ${EMAIL.hairline}; border-radius: 10px;">
                    <div style="font-family: ${EMAIL.serif}; font-size: 28px; color: ${EMAIL.ink};">${positionsProcessed}</div>
                    <div style="font-size: 11px; font-weight: 600; color: ${EMAIL.muted}; text-transform: uppercase; letter-spacing: 1.2px; margin-top: 4px;">Positions</div>
                  </td>
                  <td width="12"></td>
                  <td align="center" style="padding: 16px 8px; background-color: ${EMAIL.paper}; border: 1px solid ${EMAIL.hairline}; border-radius: 10px;">
                    <div style="font-family: ${EMAIL.serif}; font-size: 28px; color: ${connectionsSucceeded === connectionsProcessed ? EMAIL.success : (connectionsSucceeded > 0 ? EMAIL.warning : EMAIL.danger)};">${connectionsSucceeded}/${connectionsProcessed}</div>
                    <div style="font-size: 11px; font-weight: 600; color: ${EMAIL.muted}; text-transform: uppercase; letter-spacing: 1.2px; margin-top: 4px;">Data Fresh</div>
                  </td>
                </tr>
              </table>

              <!-- Connection Details -->
              <h2 style="margin: 0 0 16px; font-family: ${EMAIL.serif}; font-size: 18px; font-weight: 500; color: ${EMAIL.ink};">Connection Details</h2>
              <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid ${EMAIL.hairline}; border-radius: 8px; overflow: hidden;">
                <thead>
                  <tr style="background-color: ${EMAIL.paper};">
                    <th style="padding: 12px 16px; text-align: left; font-size: 11px; font-weight: 600; letter-spacing: 1.2px; text-transform: uppercase; color: ${EMAIL.muted}; border-bottom: 1px solid ${EMAIL.hairline};">Connection</th>
                    <th style="padding: 12px 16px; text-align: center; font-size: 11px; font-weight: 600; letter-spacing: 1.2px; text-transform: uppercase; color: ${EMAIL.muted}; border-bottom: 1px solid ${EMAIL.hairline};">Positions</th>
                    <th style="padding: 12px 16px; text-align: center; font-size: 11px; font-weight: 600; letter-spacing: 1.2px; text-transform: uppercase; color: ${EMAIL.muted}; border-bottom: 1px solid ${EMAIL.hairline};">Data Freshness</th>
                    <th style="padding: 12px 16px; text-align: left; font-size: 11px; font-weight: 600; letter-spacing: 1.2px; text-transform: uppercase; color: ${EMAIL.muted}; border-bottom: 1px solid ${EMAIL.hairline};">Files</th>
                  </tr>
                </thead>
                <tbody>
                  ${connectionRowsHtml || `<tr><td colspan="4" style="padding: 24px; text-align: center; color: ${EMAIL.muted};">No connections processed</td></tr>`}
                </tbody>
              </table>`,
        sectionsHtml: `${notificationsHtml}${errorsHtml}`,
        footerNote: 'This is an automated bank sync report. Please do not reply to this email.'
      });

      // Build plain text version
      let textContent = `
BANK SYNC ${statusText.toUpperCase()}
${'='.repeat(50)}

Date: ${today}
Time: ${time}
Trigger: ${triggerSource === 'cron' ? 'Automatic (Cron)' : 'Manual'}

SUMMARY
-------
Connected: ${connectionsProcessed - connectionsFailed}/${connectionsProcessed}
Data Fresh: ${connectionsSucceeded}/${connectionsProcessed}
Stale Data: ${connectionsWithStaleData}
New Files: ${filesDownloaded}
Positions Processed: ${positionsProcessed}
Operations Processed: ${operationsProcessed}

CONNECTION DETAILS
------------------
`;

      fileDetails.forEach(detail => {
        const freshnessText = detail.freshness?.status === 'fresh' ? `🟢 ${detail.freshness.formattedDate}`
          : detail.freshness?.status === 'stale' ? `🟡 ${detail.freshness.formattedDate} (1 day old)`
          : detail.freshness?.status === 'old' ? `🟠 ${detail.freshness.formattedDate} (${detail.freshness.businessDaysOld} days old)`
          : '⚪ No data';

        textContent += `${detail.success ? '✓' : '✗'} ${detail.connectionName} (${detail.connectionType}): `;
        textContent += `${detail.positionsProcessed || 0} positions | ${freshnessText}\n`;
        // For local connections, only show files if positions were actually processed
        const hasNewActivity = detail.positionsProcessed > 0 || (detail.connectionType === 'sftp' && detail.downloadedFiles?.length > 0);
        if (hasNewActivity && detail.downloadedFiles?.length > 0) {
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
Ambervision - Amberlake Partners
This is an automated bank sync report.
      `;

      // Build email data - subject reflects both connection and freshness status
      const connectionsWorked = connectionsProcessed - connectionsFailed;
      let subjectStatus;
      if (hasErrors) {
        subjectStatus = `⚠️ ${connectionsWorked}/${connectionsProcessed} Synced, Errors`;
      } else if (hasStaleData) {
        subjectStatus = `⚠️ ${connectionsWorked}/${connectionsProcessed} Synced, ${connectionsSucceeded}/${connectionsProcessed} Fresh`;
      } else {
        subjectStatus = `✓ ${connectionsWorked}/${connectionsProcessed} Synced, All Fresh`;
      }
      const emailData = {
        subject: `[Ambervision] Bank Sync - ${subjectStatus}`,
        html: htmlContent,
        text: textContent,
        to: recipients
      };

      // Send email via SendPulse
      const response = await this.sendEmail(emailData);

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
