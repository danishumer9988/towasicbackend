const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
  },
  password: {
    type: String,
    required: true,
  },
  phone: {
    type: String,
    default: '',
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user',
  },
  // Set to true when admin invites them — they must verify OTP before first login
  pendingInvite: {
    type: Boolean,
    default: false,
  },
  lastLoginAt: { type: Date, default: null },
  lastLoginIp: { type: String, default: '' },
}, {
  timestamps: true,
});

module.exports = mongoose.model('User', UserSchema);