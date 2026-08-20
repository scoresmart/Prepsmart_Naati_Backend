// services/emailService.js
import { Resend } from "resend";
import dotenv from "dotenv";

dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.RESEND_FROM || "Naati <naati@prepsmart.au>";

/**
 * Send an email using Resend
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} html - HTML body
 */
const sendEmailFunc = async (to, subject, html) => {
  try {
    console.log(`Sending email to ${to} via Resend...`);
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [to],
      subject,
      html,
    });

    if (error) {
      console.error("Resend error:", error);
      return null;
    }

    console.log("Email sent successfully via Resend. ID:", data?.id);
    return data;
  } catch (error) {
    console.error("Error sending email:", error);
    return null;
  }
};

/**
 * Send a welcome email after successful registration
 * @param {string} to - Recipient email
 * @param {string} name - User's name
 */
export const sendWelcomeEmail = async (to, name) => {
  const html = `
<div style="font-family:'Segoe UI',Arial,Helvetica,sans-serif; background:#0a0f1a; padding:32px 16px;">
  <div style="max-width:560px; margin:0 auto; background:linear-gradient(145deg,#111827,#1a2332); border-radius:16px; padding:36px 32px; border:1px solid #1f2937;">
    
    <!-- Logo / Brand -->
    <div style="text-align:center; margin-bottom:28px;">
      <h1 style="margin:0; font-size:28px; font-weight:800; color:#10b981; letter-spacing:-0.5px;">PrepSmart</h1>
      <p style="margin:4px 0 0; font-size:12px; color:#6b7280; text-transform:uppercase; letter-spacing:2px;">NAATI CCL Preparation</p>
    </div>

    <!-- Divider -->
    <div style="height:1px; background:linear-gradient(90deg,transparent,#1f2937,transparent); margin:0 0 28px;"></div>

    <!-- Welcome Message -->
    <h2 style="margin:0 0 12px; font-size:22px; color:#f9fafb; font-weight:700;">Welcome aboard, ${name}! 🎉</h2>
    <p style="margin:0 0 20px; font-size:15px; color:#9ca3af; line-height:1.7;">
      Your PrepSmart account has been created successfully. You're one step closer to acing your NAATI CCL exam!
    </p>

    <!-- Features Box -->
    <div style="background:#0d1117; border-radius:12px; padding:20px 24px; margin:0 0 24px; border:1px solid #1f2937;">
      <p style="margin:0 0 14px; font-size:14px; color:#d1d5db; font-weight:600;">Here's what you can do:</p>
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%;">
        <tr>
          <td style="padding:6px 0; font-size:14px; color:#9ca3af;">✅ Practice with real exam dialogues</td>
        </tr>
        <tr>
          <td style="padding:6px 0; font-size:14px; color:#9ca3af;">✅ Take timed mock tests</td>
        </tr>
        <tr>
          <td style="padding:6px 0; font-size:14px; color:#9ca3af;">✅ Track your progress with detailed analytics</td>
        </tr>
        <tr>
          <td style="padding:6px 0; font-size:14px; color:#9ca3af;">✅ Build vocabulary with rapid review</td>
        </tr>
      </table>
    </div>

    <!-- CTA Button -->
    <div style="text-align:center; margin:0 0 24px;">
      <a href="https://naati.prepsmart.au" style="display:inline-block; padding:14px 40px; background:linear-gradient(135deg,#10b981,#059669); color:#ffffff; font-size:15px; font-weight:700; text-decoration:none; border-radius:10px; letter-spacing:0.3px;">
        Start Practicing →
      </a>
    </div>

    <!-- Divider -->
    <div style="height:1px; background:linear-gradient(90deg,transparent,#1f2937,transparent); margin:0 0 20px;"></div>

    <!-- Footer -->
    <p style="margin:0; font-size:12px; color:#4b5563; text-align:center; line-height:1.6;">
      Need help? Reply to this email or visit our support page.<br/>
      © ${new Date().getFullYear()} PrepSmart. All rights reserved.
    </p>
  </div>
</div>
`;
  return sendEmailFunc(to, "Welcome to PrepSmart – Let's ace NAATI CCL! 🎓", html);
};

/**
 * Send OTP verification email
 * @param {string} to - Recipient email
 * @param {string} otp - OTP code
 * @param {string} purpose - 'verify' | 'reset'
 */
export const sendOtpEmail = async (to, otp, purpose = "verify") => {
  const isReset = purpose === "reset";
  const title = isReset ? "Reset your password" : "Verify your account";
  const subtitle = isReset
    ? "Use the OTP below to reset your password. This code expires soon."
    : "Use the OTP below to verify your account. This code expires soon.";

  const html = `
<div style="font-family:'Segoe UI',Arial,Helvetica,sans-serif; background:#0a0f1a; padding:32px 16px;">
  <div style="max-width:560px; margin:0 auto; background:linear-gradient(145deg,#111827,#1a2332); border-radius:16px; padding:36px 32px; border:1px solid #1f2937;">
    
    <!-- Logo / Brand -->
    <div style="text-align:center; margin-bottom:28px;">
      <h1 style="margin:0; font-size:28px; font-weight:800; color:#10b981; letter-spacing:-0.5px;">PrepSmart</h1>
      <p style="margin:4px 0 0; font-size:12px; color:#6b7280; text-transform:uppercase; letter-spacing:2px;">NAATI CCL Preparation</p>
    </div>

    <!-- Divider -->
    <div style="height:1px; background:linear-gradient(90deg,transparent,#1f2937,transparent); margin:0 0 28px;"></div>

    <!-- Title -->
    <h2 style="margin:0 0 10px; font-size:20px; color:#f9fafb; font-weight:700;">${title}</h2>
    <p style="margin:0 0 24px; font-size:14px; color:#9ca3af; line-height:1.6;">
      ${subtitle}
    </p>

    <!-- OTP Box -->
    <div style="text-align:center; margin:0 0 24px;">
      <div style="display:inline-block; padding:16px 28px; border-radius:12px; background:linear-gradient(135deg,#10b981,#059669); color:#ffffff; font-size:28px; letter-spacing:8px; font-weight:800;">
        ${otp}
      </div>
    </div>

    <p style="margin:0 0 8px; font-size:13px; color:#6b7280; text-align:center;">
      This code expires in <strong style="color:#f9fafb;">10 minutes</strong>.
    </p>

    <!-- Divider -->
    <div style="height:1px; background:linear-gradient(90deg,transparent,#1f2937,transparent); margin:20px 0;"></div>

    <!-- Security Note -->
    <p style="margin:0 0 4px; font-size:12px; color:#4b5563;">
      🔒 If you didn't request this, you can safely ignore this email.
    </p>
    <p style="margin:12px 0 0; font-size:11px; color:#374151; text-align:center;">
      © ${new Date().getFullYear()} PrepSmart. All rights reserved.
    </p>
  </div>
</div>
`;
  return sendEmailFunc(to, `${title} – PrepSmart`, html);
};

export default sendEmailFunc;
