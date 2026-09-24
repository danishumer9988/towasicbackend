const express = require('express');
const router = express.Router();
const Blog = require('../models/Blog');
const { protect } = require('../middleware/auth');

// Slugify helper
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
    if (id) {
      query._id = { $ne: id };
    }
    const exists = await Blog.findOne(query);
    if (!exists) {
      break;
    }
    slug = `${baseSlug}-${count}`;
    count++;
  }
  return slug;
};

// @route   GET api/blogs
// @desc    Get all blog posts
router.get('/', async (req, res) => {
  try {
    const blogs = await Blog.find({}).sort({ createdAt: -1 });
    res.json(blogs);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET api/blogs/:slug
// @desc    Get single blog post by slug
router.get('/:slug', async (req, res) => {
  try {
    const blog = await Blog.findOne({ slug: req.params.slug });
    if (blog) {
      res.json(blog);
    } else {
      res.status(404).json({ message: 'Blog post not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET api/blogs/id/:id
// @desc    Get single blog post by ObjectId ID
router.get('/id/:id', async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);
    if (blog) {
      res.json(blog);
    } else {
      res.status(404).json({ message: 'Blog post not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST api/blogs/new
// @desc    Create a new blog post
router.post('/new', async (req, res) => {
  const { title, content, tags, author, featuredImage, isPublished, isFeatured } = req.body;

  try {
    const slug = await makeSlug(title);
    
    // Parse tags if sent as comma-separated string
    let tagsArray = [];
    if (tags) {
      if (Array.isArray(tags)) {
        tagsArray = tags;
      } else {
        tagsArray = tags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
      }
    }

    const blog = await Blog.create({
      title,
      content,
      tags: tagsArray,
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

// @route   PUT api/blogs/:id
// @desc    Update blog post by ID
router.put('/:id', async (req, res) => {
  const { title, content, tags, author, featuredImage, isPublished, isFeatured } = req.body;

  try {
    const blog = await Blog.findById(req.params.id);

    if (blog) {
      if (title && title !== blog.title) {
        blog.title = title;
        blog.slug = await makeSlug(title, blog._id);
      }
      if (content !== undefined) blog.content = content;
      if (author !== undefined) blog.author = author;
      if (featuredImage !== undefined) blog.featuredImage = featuredImage;
      if (isPublished !== undefined) blog.isPublished = isPublished;
      if (isFeatured !== undefined) blog.isFeatured = isFeatured;
      
      if (tags !== undefined) {
        if (Array.isArray(tags)) {
          blog.tags = tags;
        } else {
          blog.tags = tags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
        }
      }

      const updatedBlog = await blog.save();
      res.json(updatedBlog);
    } else {
      res.status(404).json({ message: 'Blog post not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   DELETE api/blogs/:id
// @desc    Delete blog post by ID
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
