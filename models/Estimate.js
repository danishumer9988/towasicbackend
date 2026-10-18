const mongoose = require('mongoose');

const EstimateSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  }
}, {
  timestamps: true
});

// Auto-delete after 730 days (24 months) based on creation date
EstimateSchema.index({ createdAt: 1 }, { expireAfterSeconds: 730 * 24 * 60 * 60 });

module.exports = mongoose.model('Estimate', EstimateSchema);