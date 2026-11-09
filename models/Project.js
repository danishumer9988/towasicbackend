const mongoose = require('mongoose');

const DescriptionBlockSchema = new mongoose.Schema({
  heading: { type: String, default: '' },
  content: { type: String, default: '' }, // HTML from RichTextEditor
}, { _id: false });

// NEW: Image Schema
const ImageSchema = new mongoose.Schema({
  url: { type: String, required: true },
  blurred: { type: Boolean, default: false }
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
  descriptions: {
    type: [DescriptionBlockSchema],
    default: []
  },
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
  // Kept for backward compatibility with old projects
  blurImage: {
    type: Boolean,
    default: false
  },
  featured: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  // CHANGED: Now uses the ImageSchema array
  images: {
    type: [ImageSchema],
    default: []
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Project', ProjectSchema);