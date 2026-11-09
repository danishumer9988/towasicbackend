const mongoose = require('mongoose');

const DescriptionBlockSchema = new mongoose.Schema({
  heading: { type: String, default: '' },
  content: { type: String, default: '' }, // HTML from RichTextEditor
}, { _id: false });

/* NEW: per-image effects sub-schema */
const ImageEffectsSchema = new mongoose.Schema({
  enabled:    { type: Boolean, default: false },
  type:       { type: String, enum: ['box', 'pixelate'], default: 'box' },
  radius:     { type: Number, default: 12,  min: 0,   max: 40 },
  brightness: { type: Number, default: 100, min: 50,  max: 150 },
  contrast:   { type: Number, default: 100, min: 50,  max: 150 },
  saturation: { type: Number, default: 100, min: 0,   max: 200 },
  sharpness:  { type: Number, default: 0,   min: 0,   max: 100 },
}, { _id: false });

const ProjectSchema = new mongoose.Schema({
  projectNumber: {
    type: Number,
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  descriptions: {
    type: [DescriptionBlockSchema],
    default: [],
  },
  description: {
    type: String,
    default: '',
  },
  link: {
    type: String,
    default: '',
  },
  videoLink: {
    type: String,
    default: '',
  },
  industry: {
    type: String,
    default: '',
  },

  /* LEGACY — kept so old projects still render blurred */
  blurImage: {
    type: Boolean,
    default: false,
  },

  /* NEW — array of { url, effects } objects OR raw url strings.
     Mixed lets us migrate old data without a DB migration script. */
  images: {
    type: [mongoose.Schema.Types.Mixed],
    default: [],
  },

  featured: {
    type: Boolean,
    default: false,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('Project', ProjectSchema);