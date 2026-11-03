const mongoose = require('mongoose');

const DescriptionBlockSchema = new mongoose.Schema({
  heading: { type: String, default: '' },
  content: { type: String, default: '' }, // HTML from RichTextEditor
}, { _id: false });

const ProjectSchema = new mongoose.Schema({
  projectNumber: {
    type: Number,
    required: true
  },
  title: {
    type: String,
    required: true
  },
  // NEW: array of rich-text description blocks
  descriptions: {
    type: [DescriptionBlockSchema],
    default: []
  },
  // LEGACY: kept for backward compatibility + admin table preview
  // (derived from the first block's plain text on save)
  description: {
    type: String,
    default: ''
  },
  link: {
    type: String,
    default: ''
  },
  videoLink: {
    type: String,
    default: ''
  },
  industry: {
    type: String,
    default: ''
  },
  blurImage: {
    type: Boolean,
    default: false
  },
  featured: {
    type: Boolean,
    default: false
  },
  images: [{
    type: String
  }]
}, {
  timestamps: true
});

module.exports = mongoose.model('Project', ProjectSchema);