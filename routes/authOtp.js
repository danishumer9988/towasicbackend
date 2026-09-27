const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();

const User = require('../models/User');
const OtpToken = require('../models/OtpToken');
const { protect } = require('../middleware/auth');
const {
  sendLoginOtp,
  sendInviteOtp,
  sendResetOtp,
  sendLoginNotification,
} = require('../utils/mailer');

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

const generateToken = (id, role) =>
  jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: '30d' });

const generateOtp = () =>
  String(Math.floor(100000 + Math.random() * 900000)); // 6 digits

const maskEmail = (email = '') => {
  const [user, domain] = email.split('@');
  if (!domain) return email;
  const visible = user.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(1, user.length - 2))}@${domain}`;
};

const getReqMeta = (req) => {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
          || req.ip
          || '';
  const ua = req.headers['user-agent'] || '';
  const lower = ua.toLowerCase();
  const browser = /edg\//.test(lower) ? 'Edge'
                : /chrome|crios/.test(lower) ? 'Chrome'
                : /firefox|fxios/.test(lower) ? 'Firefox'
                : /safari/.test(lower) ? 'Safari'
                : 'Other';
  const device = /mobile|android|iphone/.test(lower) ? 'mobile'
               : /ipad|tablet/.test(lower) ? 'tablet'
               : 'desktop';
  const city = req.headers['x-vercel-ip-city'] || '';
  const region = req.headers['x-vercel-ip-country-region'] || '';
  const country = req.headers['x-vercel-ip-country'] || '';
  const location = [city, region, country].filter(Boolean).join(', ');
  return { ip, ua, browser, device, location };
};

/* Issue a new OTP for an email/purpose. Invalidates old ones. */
async function issueOtp(email, purpose) {
  // Invalidate prior unused OTPs for this email+purpose
  await OtpToken.deleteMany({ email: email.toLowerCase(), purpose, usedAt: null });

  const otp = generateOtp();
  const otpHash = await bcrypt.hash(otp, 10);
  await OtpToken.create({
    email: email.toLowerCase(),
    otpHash,
    purpose,
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });
  return otp;
}

/* Verify an OTP for email+purpose. Marks it used. Returns boolean. */
async function consumeOtp(email, purpose, otp) {
  const record = await OtpToken.findOne({
    email: email.toLowerCase(),
    purpose,
    usedAt: null,
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });

  if (!record) return false;
  const match = await bcrypt.compare(otp, record.otpHash);
  if (!match) return false;
  record.usedAt = new Date();
  await record.save();
  return true;
}

const publicUser = (u) => ({
  _id: u._id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  role: u.role,
});

/* ==================================================================
   LOGIN
   ================================================================== */

/* POST /api/auth-otp/login-start   { email, password } */
router.post('/login-start', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ message: 'Invalid email or password' });

    if (user.pendingInvite) {
      return res.status(403).json({ message: 'Account not activated. Verify your invite first.' });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ message: 'Invalid email or password' });

    const otp = await issueOtp(user.email, 'login');
    const sent = await sendLoginOtp(user.email, otp);
    if (!sent) return res.status(500).json({ message: 'Failed to send OTP email' });

    return res.json({ ok: true, otpSentTo: maskEmail(user.email) });
  } catch (err) {
    console.error('[auth-otp login-start]', err);
    return res.status(500).json({ message: err.message });
  }
});

/* POST /api/auth-otp/login-verify   { email, otp } */
router.post('/login-verify', async (req, res) => {
  const { email, otp } = req.body || {};
  if (!email || !otp) return res.status(400).json({ message: 'Email and code are required' });

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const valid = await consumeOtp(user.email, 'login', otp);
    if (!valid) return res.status(401).json({ message: 'Invalid or expired code' });

    // Record login metadata
    const meta = getReqMeta(req);
    user.lastLoginAt = new Date();
    user.lastLoginIp = meta.ip;
    await user.save();

    // Fire-and-forget admin notification
    sendLoginNotification(user.email, meta).catch(() => {});

    return res.json({
      user: publicUser(user),
      token: generateToken(user._id, user.role),
    });
  } catch (err) {
    console.error('[auth-otp login-verify]', err);
    return res.status(500).json({ message: err.message });
  }
});

/* ==================================================================
   INVITE (admin-only)
   ================================================================== */

/* POST /api/auth-otp/invite   { name, email, role }   [protected] */
router.post('/invite', protect, async (req, res) => {
  const { name, email, role = 'user' } = req.body || {};
  if (!name || !email) return res.status(400).json({ message: 'Name and email are required' });
  if (!['user', 'admin'].includes(role)) {
    return res.status(400).json({ message: 'Invalid role' });
  }

  try {
    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists) return res.status(400).json({ message: 'User with this email already exists' });

    // Create pending user — placeholder password, must be set on activation
    const placeholder = await bcrypt.hash('PENDING_' + Date.now(), 10);
    await User.create({
      name,
      email: email.toLowerCase(),
      password: placeholder,
      role,
      pendingInvite: true,
    });

    const otp = await issueOtp(email, 'invite');
    const sent = await sendInviteOtp(name, email, otp);
    if (!sent) {
      return res.status(500).json({ message: 'User created but email failed. Check SMTP settings.' });
    }

    return res.json({
      ok: true,
      message: `Invite OTP sent to ${process.env.ADMIN_EMAIL}`,
      newUserEmail: email,
    });
  } catch (err) {
    console.error('[auth-otp invite]', err);
    return res.status(500).json({ message: err.message });
  }
});

/* POST /api/auth-otp/verify-invite   { email, otp, password } */
router.post('/verify-invite', async (req, res) => {
  const { email, otp, password } = req.body || {};
  if (!email || !otp || !password) {
    return res.status(400).json({ message: 'Email, code and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters' });
  }

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ message: 'No pending invite for this email' });
    if (!user.pendingInvite) return res.status(400).json({ message: 'Account already activated' });

    const valid = await consumeOtp(user.email, 'invite', otp);
    if (!valid) return res.status(401).json({ message: 'Invalid or expired code' });

    user.password = await bcrypt.hash(password, 10);
    user.pendingInvite = false;
    await user.save();

    return res.json({
      user: publicUser(user),
      token: generateToken(user._id, user.role),
    });
  } catch (err) {
    console.error('[auth-otp verify-invite]', err);
    return res.status(500).json({ message: err.message });
  }
});

/* ==================================================================
   PASSWORD RESET
   ================================================================== */

/* POST /api/auth-otp/forgot-password   { email } */
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ message: 'Email is required' });

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    // Always respond OK to avoid leaking which emails exist
    if (!user || user.pendingInvite) return res.json({ ok: true });

    const otp = await issueOtp(user.email, 'reset');
    await sendResetOtp(user.email, otp);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[auth-otp forgot]', err);
    return res.status(500).json({ message: err.message });
  }
});

/* POST /api/auth-otp/reset-password   { email, otp, newPassword } */
router.post('/reset-password', async (req, res) => {
  const { email, otp, newPassword } = req.body || {};
  if (!email || !otp || !newPassword) {
    return res.status(400).json({ message: 'Email, code and new password are required' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters' });
  }

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const valid = await consumeOtp(user.email, 'reset', otp);
    if (!valid) return res.status(401).json({ message: 'Invalid or expired code' });

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    return res.json({ ok: true });
  } catch (err) {
    console.error('[auth-otp reset]', err);
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;