const mongoose = require('mongoose');

const ProjectSchema = new mongoose.Schema({
  projectNumber: {
    type: Number,
    required: true
  },
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  images: [{
    type: String
  }]
}, {
  timestamps: true
});

module.exports = mongoose.model('Project', ProjectSchema);
