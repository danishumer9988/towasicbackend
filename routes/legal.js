const express = require('express');
const router = express.Router();
const LegalPage = require('../models/LegalPage');
const { protect } = require('../middleware/auth');

const ALLOWED_SLUGS = ['privacy-policy', 'terms-of-service'];

/* @route   GET /api/legal/:slug
   @desc    Public — fetch a legal page by slug */
router.get('/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    if (!ALLOWED_SLUGS.includes(slug)) {
      return res.status(400).json({ message: 'Invalid slug' });
    }

    const doc = await LegalPage.findOne({ slug });
    if (!doc) return res.status(404).json({ message: 'Not found' });

    res.json(doc);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/* @route   PUT /api/legal/:slug
   @desc    Protected — upsert a legal page by slug */
router.put('/:slug', protect, async (req, res) => {
  try {
    const { slug } = req.params;
    if (!ALLOWED_SLUGS.includes(slug)) {
      return res.status(400).json({ message: 'Invalid slug' });
    }

    const { title, effectiveDate, content } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ message: 'Title is required' });
    }
    if (!content || !content.trim()) {
      return res.status(400).json({ message: 'Content is required' });
    }

    const doc = await LegalPage.findOneAndUpdate(
      { slug },
      {
        slug,
        title: title.trim(),
        effectiveDate: (effectiveDate || '').trim(),
        content,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json(doc);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;