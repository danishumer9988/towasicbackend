const express = require('express');
const router = express.Router();
const Contact = require('../models/Contact');
const { protect } = require('../middleware/auth');

// @route   GET api/contacts
// @desc    Get all contact submissions
router.get('/', protect, async (req, res) => {
  try {
    const contacts = await Contact.find({}).sort({ createdAt: -1 });
    res.json(contacts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST api/contacts
// @desc    Create a new contact lead submission
router.post('/', async (req, res) => {
  const { name, email, phone, service, message, budget } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ message: 'Name, email, and message are required' });
  }

  try {
    const newContact = await Contact.create({
      name,
      email,
      phone: phone || '',
      service: service || '',
      message,
      budget: budget || ''
    });

    res.status(201).json({
      success: true,
      data: newContact,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   PUT api/contacts/mark-read
// @desc    Mark all contacts as read
router.put('/mark-read', protect, async (req, res) => {
  try {
    await Contact.updateMany({ isRead: false }, { $set: { isRead: true } });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   DELETE api/contacts/:id
// @desc    Delete a single contact submission
router.delete('/:id', protect, async (req, res) => {
  try {
    const result = await Contact.deleteOne({ _id: req.params.id });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'Contact not found' });
    }

    res.json({ message: 'Contact removed successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST api/contacts/bulk-delete
// @desc    Delete multiple contact submissions
// @body    { ids: ['id1', 'id2', ...] }
router.post('/bulk-delete', protect, async (req, res) => {
  const { ids } = req.body || {};

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ message: 'No contact IDs provided' });
  }

  try {
    const result = await Contact.deleteMany({ _id: { $in: ids } });
    res.json({
      success: true,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;