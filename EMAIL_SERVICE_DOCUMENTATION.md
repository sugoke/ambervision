# Email Service Documentation

## Overview

The Ambervision email service uses **SendPulse SMTP API** for sending transactional emails. All email functionality is centralized in `imports/api/emailService.js`.

## Configuration

### Required Settings

Add the following to your `settings.json` (or `settings-local.json` for development):

```json
{
  "private": {
    "SENDPULSE_CLIENT_ID": "your_client_id_here",
    "SENDPULSE_CLIENT_SECRET": "your_client_secret_here",
    "SENDPULSE_FROM_EMAIL": "contact@amberlakepartners.com",
    "SENDPULSE_FROM_NAME": "Ambervision",
    "APP_URL": "https://vision.amberlakepartners.com",
    "EMAIL_NOTIFICATIONS_BCC": ["optional@email.com"]
  }
}
```

### Settings Explained

| Setting | Description | Required |
|---------|-------------|----------|
| `SENDPULSE_CLIENT_ID` | Your SendPulse API client ID | Yes |
| `SENDPULSE_CLIENT_SECRET` | Your SendPulse API client secret | Yes |
| `SENDPULSE_FROM_EMAIL` | Sender email address | Yes |
| `SENDPULSE_FROM_NAME` | Sender display name | No (defaults to email) |
| `APP_URL` | Base URL for links in emails | Yes |
| `EMAIL_NOTIFICATIONS_BCC` | Array of emails to BCC on notifications | No |

## How to Get SendPulse Credentials

1. Go to [SendPulse](https://sendpulse.com)
2. Create an account or log in
3. Navigate to **Settings > API**
4. Find your Client ID and Client Secret
5. Add them to your settings file

## Usage

### Import the Service

```javascript
import { EmailService } from '/imports/api/emailService';
```

### Send a Custom Email

```javascript
await EmailService.sendEmail({
  subject: 'Your Subject',
  html: '<h1>Hello World</h1>',  // HTML content
  text: 'Hello World',           // Plain text fallback
  to: [
    { email: 'user@example.com', name: 'User Name' }
  ],
  bcc: [  // Optional
    { email: 'admin@example.com', name: 'Admin' }
  ]
});
```

### Available Email Methods

| Method | Description | Parameters |
|--------|-------------|------------|
| `sendEmail(emailData)` | Core method - send any email | `{ subject, html, text, to, bcc }` |
| `sendPasswordResetEmail(email, token, userName)` | Password reset link | email, token, optional name |
| `sendPasswordChangedEmail(email, userName)` | Password change confirmation | email, optional name |
| `sendCouponPaidEmail(email, userName, product, event)` | Coupon payment notification | email, name, product obj, event obj |
| `sendAutocallEmail(email, userName, product, event)` | Autocall triggered notification | email, name, product obj, event obj |
| `sendBarrierBreachEmail(email, userName, product, event)` | Barrier breach alert | email, name, product obj, event obj |
| `sendBarrierNearEmail(email, userName, product, event)` | Near barrier warning | email, name, product obj, event obj |
| `sendFinalObservationEmail(email, userName, product, event)` | Final observation notice | email, name, product obj, event obj |
| `sendProductMaturedEmail(email, userName, product, event)` | Product maturity notification | email, name, product obj, event obj |
| `sendMemoryCouponEmail(email, userName, product, event)` | Memory coupon added | email, name, product obj, event obj |
| `sendBarrierRecoveredEmail(email, userName, product, event)` | Barrier recovered notification | email, name, product obj, event obj |
| `sendDailySummaryEmail(notifications, recipientEmail)` | Daily digest of notifications | notifications array, email |
| `sendBankSyncCompletionEmail(recipientEmail, syncResults, notifications)` | Bank sync report | email, results obj, notifications |

## Adding a New Email Type

### Step 1: Create the Method

Add a new async method to the `EmailService` object in `imports/api/emailService.js`:

```javascript
async sendMyNewEmail(recipientEmail, data) {
  if (!Meteor.isServer) {
    throw new Meteor.Error('server-only', 'This method can only be called on the server');
  }

  try {
    const recipients = [{ email: recipientEmail, name: recipientEmail }];

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>My Email</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Poppins', Arial, sans-serif; background-color: #f3f4f6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px;">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px; border-radius: 12px 12px 0 0; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px;">Your Title</h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <p>Your content here: ${data.someValue}</p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 32px; background-color: #f9fafb; border-radius: 0 0 12px 12px;">
              <p style="margin: 0; color: #6b7280; font-size: 14px; text-align: center;">
                <strong>Amber Lake Partners</strong>
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

    const textContent = `Your plain text version here: ${data.someValue}`;

    const response = await this.sendEmail({
      subject: '[Ambervision] My Email Subject',
      html: htmlContent,
      text: textContent,
      to: recipients
    });

    console.log(`My email sent to ${recipientEmail}`);
    return { success: true, messageId: response.messageId };

  } catch (error) {
    console.error('Error sending my email:', error);
    return { success: false, error: error.message };
  }
}
```

### Step 2: Use the Method

```javascript
import { EmailService } from '/imports/api/emailService';

await EmailService.sendMyNewEmail('user@example.com', {
  someValue: 'Hello!'
});
```

## Email Template Styling

All emails use inline CSS for maximum compatibility. Follow these conventions:

### Color Palette

| Color | Hex | Usage |
|-------|-----|-------|
| Primary Gradient | `#667eea` to `#764ba2` | Headers |
| Success | `#10b981` | Positive notifications |
| Warning | `#f59e0b` | Warnings |
| Error | `#ef4444` | Errors, alerts |
| Info | `#3b82f6` | Information |
| Text Primary | `#1f2937` | Main text |
| Text Secondary | `#6b7280` | Secondary text |
| Background | `#f3f4f6` | Page background |
| Card Background | `#ffffff` | Content cards |

### Standard Elements

```html
<!-- Button -->
<a href="..." style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px;">
  Button Text
</a>

<!-- Info Box -->
<div style="padding: 16px; background-color: #dbeafe; border-left: 4px solid #3b82f6; border-radius: 4px;">
  <p style="margin: 0; color: #1e3a8a;">Information message</p>
</div>

<!-- Warning Box -->
<div style="padding: 16px; background-color: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px;">
  <p style="margin: 0; color: #92400e;">Warning message</p>
</div>

<!-- Error Box -->
<div style="padding: 16px; background-color: #fef2f2; border-left: 4px solid #ef4444; border-radius: 4px;">
  <p style="margin: 0; color: #991b1b;">Error message</p>
</div>
```

## Testing Emails

### Test from Intranet Page

1. Go to the Intranet page in Ambervision
2. Find the "Email Test" section
3. Enter a test email address
4. Click "Send Test Email"

### Test via Meteor Method

```javascript
// From browser console (when logged in as admin)
Meteor.call('testEmail.send', sessionId, 'test@example.com', (err, result) => {
  console.log(result);
});
```

## Token Caching

The service automatically caches SendPulse OAuth2 tokens to minimize API calls:

- Tokens are cached in memory
- Automatic refresh 5 minutes before expiry
- No configuration needed

## Troubleshooting

### "Missing required settings" Error

Ensure all required settings are present in your settings file:
- `SENDPULSE_CLIENT_ID`
- `SENDPULSE_CLIENT_SECRET`
- `SENDPULSE_FROM_EMAIL`
- `APP_URL`

### "SendPulse auth failed" Error

1. Verify your Client ID and Secret are correct
2. Check that your SendPulse account is active
3. Ensure you have SMTP API access enabled

### Emails Not Arriving

1. Check spam/junk folder
2. Verify recipient email is valid
3. Check SendPulse dashboard for delivery status
4. Review server logs for errors

## API Reference

### SendPulse API Endpoints Used

- **Auth**: `POST https://api.sendpulse.com/oauth/access_token`
- **Send**: `POST https://api.sendpulse.com/smtp/emails`

### HTML Encoding

HTML content is automatically base64 encoded before sending to SendPulse. No manual encoding needed.

## File Location

- **Email Service**: `imports/api/emailService.js`
- **Test Method**: `server/testEmailMethod.js`
- **Settings Example**: `settings.example.json`
