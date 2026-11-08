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
  blurImage: {
    type: Boolean,
    default: false
  },
  featured: {
    type: Boolean,
    default: false
  },
  // NEW: whether this project is visible on the public site
  isActive: {
    type: Boolean,
    default: true
  },
  images: [{
    type: String
  }]
}, {
  timestamps: true
});

module.exports = mongoose.model('Project', ProjectSchema);