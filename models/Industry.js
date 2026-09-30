const mongoose = require('mongoose');

const IndustrySchema = new mongoose.Schema({
  name:  { type: String, required: true, unique: true, trim: true },
  slug:  { type: String, required: true, unique: true, lowercase: true, trim: true },
  order: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('Industry', IndustrySchema);