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

module.exports = router;
