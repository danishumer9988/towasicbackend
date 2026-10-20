const express = require('express');
const router = express.Router();
const BlogCategory = require('../models/BlogCategory');
const Blog = require('../models/Blog');
const { protect } = require('../middleware/auth');

const slugify = (text) =>
  text.toString().toLowerCase().trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-');

/* GET /api/blog-categories — public list with blog counts */
router.get('/', async (req, res) => {
  try {
    const categories = await BlogCategory.find({}).sort({ order: 1, name: 1 }).lean();

    const counts = await Blog.aggregate([
      { $match: { isPublished: true, category: { $ne: '' } } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ]);
    const countMap = counts.reduce((m, c) => {
      m[c._id] = c.count;
      return m;
    }, {});

    res.json(
      categories.map((c) => ({ ...c, blogCount: countMap[c.slug] || 0 }))
    );
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/* POST /api/blog-categories — create */
router.post('/', protect, async (req, res) => {
  const { name, order = 0 } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ message: 'Name is required' });
  }

  try {
    const slug = slugify(name);
    const exists = await BlogCategory.findOne({ $or: [{ name: name.trim() }, { slug }] });
    if (exists) return res.status(400).json({ message: 'Category already exists' });

    const category = await BlogCategory.create({
      name: name.trim(),
      slug,
      order: Number(order) || 0,
    });
    res.status(201).json({ ...category.toObject(), blogCount: 0 });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/* PUT /api/blog-categories/:id — update */
router.put('/:id', protect, async (req, res) => {
  const { name, order } = req.body;

  try {
    const category = await BlogCategory.findById(req.params.id);
    if (!category) return res.status(404).json({ message: 'Category not found' });

    if (name && name.trim() !== category.name) {
      const newName = name.trim();
      const newSlug = slugify(newName);

      const dup = await BlogCategory.findOne({
        _id: { $ne: category._id },
        $or: [{ name: newName }, { slug: newSlug }],
      });
      if (dup) return res.status(400).json({ message: 'Name or slug already in use' });

      // Update slug on all blogs using the old slug
      await Blog.updateMany({ category: category.slug }, { $set: { category: newSlug } });

      category.name = newName;
      category.slug = newSlug;
    }

    if (order !== undefined) category.order = Number(order) || 0;

    const updated = await category.save();
    res.json(updated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/* DELETE /api/blog-categories/:id — delete if unused */
router.delete('/:id', protect, async (req, res) => {
  try {
    const category = await BlogCategory.findById(req.params.id);
    if (!category) return res.status(404).json({ message: 'Category not found' });

    const usedBy = await Blog.countDocuments({ category: category.slug });
    if (usedBy > 0) {
      return res.status(400).json({
        message: `Cannot delete — ${usedBy} blog${usedBy === 1 ? '' : 's'} still use this category. Reassign them first.`,
      });
    }

    await BlogCategory.deleteOne({ _id: category._id });
    res.json({ message: 'Category removed successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;