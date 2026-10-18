const mongoose = require('mongoose');

const SystemLogSchema = new mongoose.Schema({
  action:    { type: String, required: true }, // e.g., 'ADMIN_LOGIN', 'BACKUP_RUN', 'UPDATE_LEGAL'
  user:      { type: String, default: 'System' },
  details:   { type: String, default: '' },
  ip:        { type: String, default: '' },
  timestamp: { type: Date, default: Date.now, index: true, expires: 365 * 24 * 60 * 60 } // Keep for 1 year
});

module.exports = mongoose.model('SystemLog', SystemLogSchema);