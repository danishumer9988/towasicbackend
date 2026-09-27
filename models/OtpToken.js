const mongoose = require('mongoose');

const OtpTokenSchema = new mongoose.Schema({
  email:     { type: String, required: true, lowercase: true, index: true },
  otpHash:   { type: String, required: true },   // bcrypt hash of the OTP
  purpose:   { type: String, required: true },   // 'login' | 'invite' | 'reset'
  expiresAt: { type: Date,   required: true },   // TTL index below
  usedAt:    { type: Date,   default: null },
  createdAt: { type: Date,   default: Date.now },
});

// Auto-delete expired OTPs
OtpTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('OtpToken', OtpTokenSchema);