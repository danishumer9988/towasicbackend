const express = require('express');
const router = express.Router();
const Project = require('../models/Project');
const { protect } = require('../middleware/auth');

// GET all projects
// Query params:
//   ?industry=slug
//   ?featured=true|false
//   ?active=true           → only active projects (for public pages)
//   ?all=true              → bypass isActive filter (for admin, though default includes all)
router.get('/', async (req, res) => {
  try {
    const filter = {};

    if (req.query.industry) filter.industry = req.query.industry;

    if (req.query.featured !== undefined) {
      if (req.query.featured === 'true') {
        filter.featured = true;
      } else {
        filter.featured = { $ne: true };
      }
    }

    // NEW: ?active=true returns only active projects.
    // Documents without the field (legacy) are treated as active.
    if (req.query.active === 'true') {
      filter.isActive = { $ne: false };
    }

    const projects = await Project.find(filter).sort({ projectNumber: 1 });
    res.json(projects);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET single project by ID
router.get('/:id', async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (project) res.json(project);
    else res.status(404).json({ message: 'Project not found' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Helper: normalize incoming descriptions (accept array of {heading, content})
const normalizeDescriptions = (raw) => {
  if (!Array.isArray(raw)) return null;
  return raw
    .map((b) => ({
      heading: typeof b?.heading === 'string' ? b.heading.trim() : '',
      content: typeof b?.content === 'string' ? b.content.trim() : '',
    }))
    .filter((b) => b.heading || b.content);
};

const htmlToText = (html = '') =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// POST create project
router.post('/', protect, async (req, res) => {
  const {
    projectNumber, title, descriptions, description,
    images, link, videoLink, industry, blurImage, featured, isActive,
  } = req.body;

  const blocks = normalizeDescriptions(descriptions);

  const hasBlocks = blocks && blocks.length > 0;
  const hasLegacy = typeof description === 'string' && description.trim().length > 0;

  if (projectNumber === undefined || !title || (!hasBlocks && !hasLegacy)) {
    return res.status(400).json({
      message: 'Project number, title, and at least one description block are required',
    });
  }

  const finalBlocks = hasBlocks
    ? blocks
    : [{ heading: '', content: String(description).trim() }];

  const legacyDescription = htmlToText(finalBlocks[0].content);

  try {
    const project = await Project.create({
      projectNumber: Number(projectNumber),
      title,
      descriptions: finalBlocks,
      description: legacyDescription,
      link: link || '',
      videoLink: videoLink || '',
      industry: industry || '',
      blurImage: !!blurImage,
      featured: !!featured,
      isActive: isActive !== undefined ? !!isActive : true,  // NEW
      images: images || [],
    });
    res.status(201).json(project);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PUT update project (also handles isActive toggle from admin)
router.put('/:id', protect, async (req, res) => {
  const {
    projectNumber, title, descriptions, description,
    images, link, videoLink, industry, blurImage, featured, isActive,
  } = req.body;

  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    if (projectNumber !== undefined) project.projectNumber = Number(projectNumber);
    if (title !== undefined) project.title = title;

    if (descriptions !== undefined) {
      const blocks = normalizeDescriptions(descriptions);
      if (!blocks || blocks.length === 0) {
        return res.status(400).json({ message: 'At least one description block is required' });
      }
      project.descriptions = blocks;
      project.description = htmlToText(blocks[0].content);
    } else if (description !== undefined) {
      const text = String(description).trim();
      if (!text) {
        return res.status(400).json({ message: 'Description cannot be empty' });
      }
      project.descriptions = [{ heading: '', content: text }];
      project.description = htmlToText(text);
    }

    if (images !== undefined) project.images = images;
    if (link !== undefined) project.link = link;
    if (videoLink !== undefined) project.videoLink = videoLink;
    if (industry !== undefined) project.industry = industry;
    if (blurImage !== undefined) project.blurImage = !!blurImage;
    if (featured !== undefined) project.featured = !!featured;
    if (isActive !== undefined) project.isActive = !!isActive;   // NEW

    const updated = await project.save();
    res.json(updated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// DELETE project
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