const mongoose = require('mongoose');

const FaqSchema = new mongoose.Schema({
  question: {
    type: String,
    required: true
  },
  answer: {
    type: String,
    required: true
  }
});

const CategorySchema = new mongoose.Schema({
  category: {
    type: String,
    required: true
  },
  faqs: [FaqSchema]
}, {
  timestamps: true
});

module.exports = mongoose.model('Category', CategorySchema);
