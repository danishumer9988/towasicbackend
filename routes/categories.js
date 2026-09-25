const express = require('express');
const router = express.Router();
const Category = require('../models/Category');
const { protect } = require('../middleware/auth');

// @route   GET api/categories
// @desc    Get all FAQ categories and nested faqs
router.get('/', async (req, res) => {
  try {
    const categories = await Category.find({});
    res.json(categories);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST api/categories
// @desc    Create a new FAQ category
router.post('/', async (req, res) => {
  const { category } = req.body;

  if (!category) {
    return res.status(400).json({ message: 'Category name is required' });
  }

  try {
    const categoryExists = await Category.findOne({ category });
    if (categoryExists) {
      return res.status(400).json({ message: 'Category already exists' });
    }

    const newCategory = await Category.create({
      category,
      faqs: [],
    });

    res.status(201).json(newCategory);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST api/categories/:categoryId/faqs
// @desc    Create a new FAQ under a category
router.post('/:categoryId/faqs', async (req, res) => {
  const { question, answer } = req.body;

  if (!question || !answer) {
    return res.status(400).json({ message: 'Question and answer are required' });
  }

  try {
    const category = await Category.findById(req.params.categoryId);

    if (category) {
      category.faqs.push({ question, answer });
      const updatedCategory = await category.save();

      const createdFaq = updatedCategory.faqs[updatedCategory.faqs.length - 1];
      res.status(201).json(createdFaq);
    } else {
      res.status(404).json({ message: 'Category not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   PUT api/categories/:categoryId/faqs/:faqId
// @desc    Update a FAQ inside a category
router.put('/:categoryId/faqs/:faqId', async (req, res) => {
  const { question, answer } = req.body;

  if (!question || !answer) {
    return res.status(400).json({ message: 'Question and answer are required' });
  }

  try {
    const category = await Category.findById(req.params.categoryId);
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }

    const faq = category.faqs.id(req.params.faqId);
    if (!faq) {
      return res.status(404).json({ message: 'FAQ not found' });
    }

    faq.question = question;
    faq.answer = answer;
    await category.save();

    res.json(faq);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   DELETE api/categories/:categoryId/faqs/:faqId
// @desc    Delete a FAQ inside a category
router.delete('/:categoryId/faqs/:faqId', async (req, res) => {
  try {
    const category = await Category.findById(req.params.categoryId);
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }

    const faq = category.faqs.id(req.params.faqId);
    if (!faq) {
      return res.status(404).json({ message: 'FAQ not found' });
    }

    faq.deleteOne();
    await category.save();

    res.json({ message: 'FAQ deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;