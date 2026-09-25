const express = require('express');
const router = express.Router();
const Project = require('../models/Project');
const { protect } = require('../middleware/auth');

// @route   GET api/projects
router.get('/', async (req, res) => {
  try {
    const projects = await Project.find({}).sort({ projectNumber: 1 });
    res.json(projects);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET api/projects/:id
router.get('/:id', async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (project) res.json(project);
    else res.status(404).json({ message: 'Project not found' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST api/projects
router.post('/', protect, async (req, res) => {
  const { projectNumber, title, description, images, link } = req.body;

  if (projectNumber === undefined || !title || !description) {
    return res.status(400).json({ message: 'Project number, title, and description are required' });
  }

  try {
    const project = await Project.create({
      projectNumber: Number(projectNumber),
      title,
      description,
      link: link || '',
      images: images || []
    });
    res.status(201).json(project);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   PUT api/projects/:id
router.put('/:id', protect, async (req, res) => {
  const { projectNumber, title, description, images, link } = req.body;

  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    if (projectNumber !== undefined) project.projectNumber = Number(projectNumber);
    if (title !== undefined) project.title = title;
    if (description !== undefined) project.description = description;
    if (images !== undefined) project.images = images;
    if (link !== undefined) project.link = link;

    const updated = await project.save();
    res.json(updated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   DELETE api/projects/:id
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