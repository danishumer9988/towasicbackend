const express = require('express');
const router = express.Router();
const Blog = require('../models/Blog');
const { protect } = require('../middleware/auth');

const slugify = (text) => {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-');
};

const makeSlug = async (title, id = null) => {
  let baseSlug = slugify(title);
  let slug = baseSlug;
  let count = 1;
  while (true) {
    const query = { slug };
    if (id) query._id = { $ne: id };
    const exists = await Blog.findOne(query);
    if (!exists) break;
    slug = `${baseSlug}-${count}`;
    count++;
  }
  return slug;
};

// GET all blog posts
// Query params:
//   ?category=slug
//   ?published=true    → only published posts (for public pages)
router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.category) filter.category = req.query.category;

    // NEW: ?published=true returns only published posts.
    // Documents without the field (legacy) are treated as published.
    if (req.query.published === 'true') {
      filter.isPublished = { $ne: false };
    }

    const blogs = await Blog.find(filter).sort({ createdAt: -1 });
    res.json(blogs);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET single blog post by slug
router.get('/:slug', async (req, res) => {
  try {
    const blog = await Blog.findOne({ slug: req.params.slug });
    if (blog) res.json(blog);
    else res.status(404).json({ message: 'Blog post not found' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET single blog post by ObjectId ID
router.get('/id/:id', async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);
    if (blog) res.json(blog);
    else res.status(404).json({ message: 'Blog post not found' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST create
router.post('/new', async (req, res) => {
  const { title, content, tags, category, author, featuredImage, isPublished, isFeatured } = req.body;

  try {
    const slug = await makeSlug(title);

    let tagsArray = [];
    if (tags) {
      if (Array.isArray(tags)) tagsArray = tags;
      else tagsArray = tags.split(',').map(tag => tag.trim()).filter(Boolean);
    }

    const blog = await Blog.create({
      title,
      content,
      tags: tagsArray,
      category: category || '',
      slug,
      author: author || 'Admin',
      featuredImage: featuredImage || '',
      isPublished: isPublished !== undefined ? isPublished : true,
      isFeatured: isFeatured !== undefined ? isFeatured : false,
    });

    res.status(201).json(blog);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PUT update (also handles isPublished toggle from admin)
router.put('/:id', async (req, res) => {
  const { title, content, tags, category, author, featuredImage, isPublished, isFeatured } = req.body;

  try {
    const blog = await Blog.findById(req.params.id);
    if (!blog) return res.status(404).json({ message: 'Blog post not found' });

    if (title && title !== blog.title) {
      blog.title = title;
      blog.slug = await makeSlug(title, blog._id);
    }
    if (content !== undefined) blog.content = content;
    if (category !== undefined) blog.category = category;
    if (author !== undefined) blog.author = author;
    if (featuredImage !== undefined) blog.featuredImage = featuredImage;
    if (isPublished !== undefined) blog.isPublished = isPublished;
    if (isFeatured !== undefined) blog.isFeatured = isFeatured;

    if (tags !== undefined) {
      if (Array.isArray(tags)) blog.tags = tags;
      else blog.tags = tags.split(',').map(tag => tag.trim()).filter(Boolean);
    }

    const updated = await blog.save();
    res.json(updated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// DELETE
router.delete('/:id', async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);
    if (blog) {
      await Blog.deleteOne({ _id: req.params.id });
      res.json({ message: 'Blog post removed successfully' });
    } else {
      res.status(404).json({ message: 'Blog post not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;