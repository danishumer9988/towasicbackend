const express = require('express');
const router = express.Router();
const Project = require('../models/Project');
const { protect } = require('../middleware/auth');

// @route   GET api/projects
// @desc    Get all portfolio projects
router.get('/', async (req, res) => {
  try {
    const projects = await Project.find({}).sort({ projectNumber: 1 });
    res.json(projects);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET api/projects/:id
// @desc    Get single project by ID
router.get('/:id', async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (project) {
      res.json(project);
    } else {
      res.status(404).json({ message: 'Project not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST api/projects
// @desc    Create a new project
router.post('/', protect, async (req, res) => {
  const { projectNumber, title, description, images } = req.body;

  if (projectNumber === undefined || !title || !description) {
    return res.status(400).json({ message: 'Project number, title, and description are required' });
  }

  try {
    const project = await Project.create({
      projectNumber: Number(projectNumber),
      title,
      description,
      images: images || []
    });

    res.status(201).json(project);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   PUT api/projects/:id
// @desc    Update project by ID
router.put('/:id', protect, async (req, res) => {
  const { projectNumber, title, description, images } = req.body;

  try {
    const project = await Project.findById(req.params.id);

    if (project) {
      if (projectNumber !== undefined) project.projectNumber = Number(projectNumber);
      if (title !== undefined) project.title = title;
      if (description !== undefined) project.description = description;
      if (images !== undefined) project.images = images;

      const updatedProject = await project.save();
      res.json(updatedProject);
    } else {
      res.status(404).json({ message: 'Project not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   DELETE api/projects/:id
// @desc    Delete project by ID
router.delete('/:id', protect, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);

    if (project) {
      await Project.deleteOne({ _id: req.params.id });
      res.json({ message: 'Project removed successfully' });
    } else {
      res.status(404).json({ message: 'Project not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
