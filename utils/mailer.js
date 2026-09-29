const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_APP_PASSWORD,
  },
});

const BRAND_NAME = 'Towasicsolutions';
const BRAND_TEAM = 'Towasicsolutions Team';
const FROM = `"${BRAND_NAME}" <${process.env.SMTP_USER}>`;
const ADMIN = process.env.ADMIN_EMAIL;

async function sendMail({ to, subject, html, text }) {
  if (!process.env.SMTP_USER || !process.env.SMTP_APP_PASSWORD) {
    console.warn('[mailer] SMTP credentials missing — email not sent.');
    return false;
  }
  try {
    await transporter.sendMail({ from: FROM, to, subject, html, text });
    return true;
  } catch (err) {
    console.error('[mailer] send failed:', err.message);
    return false;
  }
}

/* ---------- Shared layout ---------- */
const layout = (body) => `
  <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">
    <div style="text-align:center;margin-bottom:24px">
      <div style="display:inline-block;background:#0a85a7;color:white;padding:10px 22px;border-radius:12px;font-weight:700;font-size:18px;letter-spacing:0.5px">
        ${BRAND_NAME}
      </div>
    </div>
    <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;padding:28px">
      ${body}
    </div>
    <p style="text-align:center;color:#6b7280;font-size:13px;margin-top:24px;margin-bottom:4px">
      — The ${BRAND_TEAM}
    </p>
    <p style="text-align:center;color:#9ca3af;font-size:12px;margin-top:8px">
      If you didn't request this, please ignore this email.
    </p>
  </div>
`;

const otpBlock = (otp) => `
  <div style="text-align:center;margin:24px 0">
    <div style="display:inline-block;font-size:36px;letter-spacing:10px;font-weight:800;color:#0a85a7;padding:16px 24px;background:#EEFAFD;border-radius:12px;border:1px dashed #0a85a7">
      ${otp}
    </div>
  </div>
  <p style="color:#6b7280;font-size:13px;text-align:center">This code expires in 2 minutes.</p>
`;

/* ---------- Templates ---------- */
async function sendLoginOtp(to, otp) {
  return sendMail({
    to,
    subject: `${BRAND_NAME} · Your login code`,
    text:
      `${BRAND_NAME}\n\n` +
      `Your login verification code is: ${otp}\n` +
      `This code expires in 2 minutes.\n\n` +
      `— The ${BRAND_TEAM}`,
    html: layout(`
      <h2 style="margin:0 0 8px;color:#086B87">Login verification</h2>
      <p style="color:#4b5563;margin:0 0 4px">Use the code below to complete your sign-in:</p>
      ${otpBlock(otp)}
    `),
  });
}

async function sendInviteOtp(newUserName, newUserEmail, otp) {
  return sendMail({
    to: ADMIN,
    subject: `${BRAND_NAME} · New user invite: ${newUserEmail}`,
    text:
      `${BRAND_NAME}\n\n` +
      `You invited ${newUserName} (${newUserEmail}).\n` +
      `Their activation code is: ${otp}\n` +
      `This code expires in 2 minutes.\n\n` +
      `— The ${BRAND_TEAM}`,
    html: layout(`
      <h2 style="margin:0 0 8px;color:#086B87">New user invite</h2>
      <p style="color:#4b5563;margin:0 0 4px">You are inviting:</p>
      <p style="color:#111;font-weight:700;margin:0 0 16px">${newUserName} &lt;${newUserEmail}&gt;</p>
      <p style="color:#4b5563;margin:0 0 4px">Share this activation code with them:</p>
      ${otpBlock(otp)}
      <p style="color:#6b7280;font-size:13px">The user will visit your site to activate the account using this code.</p>
    `),
  });
}

async function sendResetOtp(to, otp) {
  return sendMail({
    to,
    subject: `${BRAND_NAME} · Password reset code`,
    text:
      `${BRAND_NAME}\n\n` +
      `Your password reset code is: ${otp}\n` +
      `This code expires in 2 minutes.\n\n` +
      `— The ${BRAND_TEAM}`,
    html: layout(`
      <h2 style="margin:0 0 8px;color:#086B87">Password reset</h2>
      <p style="color:#4b5563;margin:0 0 4px">Use this code to reset your password:</p>
      ${otpBlock(otp)}
    `),
  });
}

async function sendLoginNotification(userEmail, info = {}) {
  const rows = [
    ['Account',  userEmail],
    ['Time',     new Date().toLocaleString('en-GB', { timeZone: 'UTC' }) + ' UTC'],
    ['IP',       info.ip || '—'],
    ['Location', info.location || '—'],
    ['Browser',  info.browser || '—'],
    ['Device',   info.device || '—'],
  ];

  const rowsHtml = rows.map(([k, v]) => `
    <tr>
      <td style="padding:8px 0;color:#6b7280;font-size:13px;width:110px">${k}</td>
      <td style="padding:8px 0;color:#111;font-size:13px;font-weight:600">${v}</td>
    </tr>
  `).join('');

  return sendMail({
    to: ADMIN,
    subject: `${BRAND_NAME} · Login alert: ${userEmail}`,
    text:
      `${BRAND_NAME} — New login\n\n` +
      `Account: ${userEmail}\n` +
      `IP: ${info.ip || '—'}\n` +
      `Time: ${new Date().toISOString()}\n\n` +
      `— The ${BRAND_TEAM}`,
    html: layout(`
      <h2 style="margin:0 0 12px;color:#086B87">New sign-in detected</h2>
      <p style="color:#4b5563;margin:0 0 16px">A user just logged in to your admin panel.</p>
      <table style="width:100%;border-collapse:collapse">${rowsHtml}</table>
    `),
  });
}

module.exports = {
  sendLoginOtp,
  sendInviteOtp,
  sendResetOtp,
  sendLoginNotification,
};