const mongoose = require('mongoose');

const BlogSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  content: {
    type: String,
    required: true
  },
  tags: [{
    type: String
  }],
  // ADDED CATEGORY FIELD
  category: {
    type: String,
    default: ''
  },
  slug: {
    type: String,
    required: true,
    unique: true
  },
  author: {
    type: String,
    required: true
  },
  featuredImage: {
    type: String,
    default: ''
  },
  isPublished: {
    type: Boolean,
    default: true
  },
  isFeatured: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Blog', BlogSchema);