const express = require('express');
const router = express.Router();
const Industry = require('../models/Industry');
const Project = require('../models/Project');
const { protect } = require('../middleware/auth');

const slugify = (text) =>
  text.toString().toLowerCase().trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-');

/* GET /api/industries — public list with project counts */
router.get('/', async (req, res) => {
  try {
    const industries = await Industry.find({}).sort({ order: 1, name: 1 }).lean();

    const counts = await Project.aggregate([
      { $match: { industry: { $ne: '' } } },
      { $group: { _id: '$industry', count: { $sum: 1 } } },
    ]);
    const countMap = counts.reduce((m, c) => {
      m[c._id] = c.count;
      return m;
    }, {});

    res.json(
      industries.map((i) => ({ ...i, projectCount: countMap[i.slug] || 0 }))
    );
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/* POST /api/industries — create (protected) */
router.post('/', protect, async (req, res) => {
  const { name, order = 0 } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ message: 'Name is required' });
  }

  try {
    const slug = slugify(name);
    const exists = await Industry.findOne({
      $or: [{ name: name.trim() }, { slug }],
    });
    if (exists) return res.status(400).json({ message: 'Industry already exists' });

    const industry = await Industry.create({
      name: name.trim(),
      slug,
      order: Number(order) || 0,
    });
    res.status(201).json({ ...industry.toObject(), projectCount: 0 });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/* PUT /api/industries/:id — update (protected) */
router.put('/:id', protect, async (req, res) => {
  const { name, order } = req.body;

  try {
    const industry = await Industry.findById(req.params.id);
    if (!industry) return res.status(404).json({ message: 'Industry not found' });

    if (name && name.trim() !== industry.name) {
      const newName = name.trim();
      const newSlug = slugify(newName);

      const dup = await Industry.findOne({
        _id: { $ne: industry._id },
        $or: [{ name: newName }, { slug: newSlug }],
      });
      if (dup) return res.status(400).json({ message: 'Name or slug already in use' });

      // Rename slug on all projects using old slug
      await Project.updateMany(
        { industry: industry.slug },
        { $set: { industry: newSlug } }
      );

      industry.name = newName;
      industry.slug = newSlug;
    }

    if (order !== undefined) industry.order = Number(order) || 0;

    const updated = await industry.save();
    res.json(updated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/* DELETE /api/industries/:id — delete if unused (protected) */
router.delete('/:id', protect, async (req, res) => {
  try {
    const industry = await Industry.findById(req.params.id);
    if (!industry) return res.status(404).json({ message: 'Industry not found' });

    const usedBy = await Project.countDocuments({ industry: industry.slug });
    if (usedBy > 0) {
      return res.status(400).json({
        message: `Cannot delete — ${usedBy} project${usedBy === 1 ? '' : 's'} still use this industry. Reassign them first.`,
      });
    }

    await Industry.deleteOne({ _id: industry._id });
    res.json({ message: 'Industry removed successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;