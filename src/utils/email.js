import nodemailer from "nodemailer"

// ─── Transporter ──────────────────────────────────────────────────────────────
const createTransporter = () => {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error(
      "[Email] SMTP configuration must be set in .env to send emails"
    )
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT || 587,
    secure: process.env.SMTP_PORT == 465, // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  })
}

// ─── sendEmail Utility ────────────────────────────────────────────────────────
export const sendEmail = async ({ to, subject, html }) => {
  const transporter = createTransporter()

  const mailOptions = {
    from: `"DevSync" <${process.env.SMTP_USER}>`,
    to,
    subject,
    html,
  }

  const info = await transporter.sendMail(mailOptions)

  // If using Ethereal email for development/testing, log the preview URL
  if (process.env.SMTP_HOST === 'smtp.ethereal.email') {
    console.log('✉️  Ethereal Mail Preview URL: %s', nodemailer.getTestMessageUrl(info))
  }
}

// ─── sendPasswordResetEmail ───────────────────────────────────────────────────
export const sendPasswordResetEmail = async (toEmail, userId, resetToken) => {
  const clientUrl = process.env.CLIENT_URL || "http://localhost:5173"
  // Link includes userId AND rawToken
  const resetLink = `${clientUrl}/reset-password/${userId}/${resetToken}`

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:'Courier New',monospace;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background-color:#111111;border:1px solid #1a1a1a;border-radius:16px;overflow:hidden;">
          
          <!-- Header -->
          <tr>
            <td style="padding:32px 40px 24px;border-bottom:1px solid #1a1a1a;">
              <p style="margin:0;color:#12b3a8;font-size:10px;letter-spacing:0.28em;text-transform:uppercase;">[ DEVSYNC ]</p>
              <h1 style="margin:8px 0 0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.03em;">Password Reset</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 40px;">
              <p style="margin:0 0 16px;color:#888888;font-size:13px;line-height:1.7;">
                A password reset was requested for your DevSync account. If this was you, click the button below to set a new password.
              </p>
              <p style="margin:0 0 24px;color:#555555;font-size:11px;line-height:1.6;">
                This link expires in <strong style="color:#12b3a8;">1 hour</strong>.
              </p>

              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center">
                    <a href="${resetLink}" 
                       style="display:inline-block;padding:14px 32px;background-color:transparent;border:1px solid #12b3a8;color:#12b3a8;text-decoration:none;font-size:11px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;border-radius:10px;">
                      Reset Password →
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Fallback link -->
              <p style="margin:28px 0 0;color:#444444;font-size:11px;line-height:1.7;">
                Or copy this link into your browser:<br/>
                <span style="color:#12b3a8;word-break:break-all;">${resetLink}</span>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px 28px;border-top:1px solid #1a1a1a;">
              <p style="margin:0;color:#333333;font-size:10px;line-height:1.7;">
                If you did not request this, you can safely ignore this email. Your password will remain unchanged.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim()

  await sendEmail({
    to: toEmail,
    subject: "[ DevSync ] Password Reset Request",
    html
  })
}
