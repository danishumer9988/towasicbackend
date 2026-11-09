const express = require('express');
const router = express.Router();
const Project = require('../models/Project');
const { protect } = require('../middleware/auth');

const clamp = (v, min, max) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
};

const normalizeImage = (item) => {
  if (!item) return null;
  if (typeof item === 'string') {
    const url = item.trim();
    return url ? { url, effects: null } : null;
  }

  const url = typeof item.url === 'string' ? item.url.trim() : '';
  if (!url) return null;

  let effects = null;
  if (item.effects && typeof item.effects === 'object') {
    effects = {
      enabled:    !!item.effects.enabled,
      type:       item.effects.type === 'pixelate' ? 'pixelate' : 'box',
      radius:     clamp(item.effects.radius     ?? 4,   0,   40),    // Updated
      brightness: clamp(item.effects.brightness ?? 100, 50,  150),
      contrast:   clamp(item.effects.contrast   ?? 100, 50,  150),
      saturation: clamp(item.effects.saturation ?? 100, 0,   200),
      sharpness:  clamp(item.effects.sharpness  ?? 80,  0,   100),   // Updated
    };
  }

  return { url, effects };
};
// ... rest of the file stays exactly the same as before

const normalizeImages = (raw) => {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeImage).filter(Boolean);
};

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

/* ---------- routes ---------- */

// GET all projects
router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.industry) filter.industry = req.query.industry;

    if (req.query.featured !== undefined) {
      if (req.query.featured === 'true') filter.featured = true;
      else filter.featured = { $ne: true };
    }

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
      isActive: isActive !== undefined ? !!isActive : true,
      images: normalizeImages(images),
    });
    res.status(201).json(project);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PUT update project (also handles isActive / per-image effects toggles from admin)
router.put('/:id', protect, async (req, res) => {
  const {
    projectNumber, title, descriptions, description,
    images, link, videoLink, industry, blurImage, featured, isActive,
  } = req.body;

  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    if (projectNumber !== undefined) project.projectNumber = Number(projectNumber);
    if (title !== undefined)         project.title = title;
    if (link !== undefined)          project.link = link;
    if (videoLink !== undefined)     project.videoLink = videoLink;
    if (industry !== undefined)      project.industry = industry;
    if (featured !== undefined)      project.featured = !!featured;
    if (isActive !== undefined)      project.isActive = !!isActive;
    if (blurImage !== undefined)     project.blurImage = !!blurImage;

    if (descriptions !== undefined) {
      const blocks = normalizeDescriptions(descriptions);
      if (!blocks || blocks.length === 0) {
        return res.status(400).json({ message: 'At least one description block is required' });
      }
      project.descriptions = blocks;
      project.description = htmlToText(blocks[0].content);
    } else if (description !== undefined) {
      const text = String(description).trim();
      if (!text) return res.status(400).json({ message: 'Description cannot be empty' });
      project.descriptions = [{ heading: '', content: text }];
      project.description = htmlToText(text);
    }

    if (images !== undefined) {
      project.images = normalizeImages(images);
    }

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