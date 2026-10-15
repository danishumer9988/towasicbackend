const mongoose = require('mongoose');

const LegalPageSchema = new mongoose.Schema({
  slug: {
    type: String,
    required: true,
    unique: true,
    index: true,
    enum: ['privacy-policy', 'terms-of-service'],
  },
  title: {
    type: String,
    required: true,
  },
  effectiveDate: {
    type: String,
    default: '',
  },
  content: {
    type: String,
    default: '',
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('LegalPage', LegalPageSchema);