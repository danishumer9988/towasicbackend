const express = require('express');
const router = express.Router();
const Subscription = require('../models/Subscription');
const { protect } = require('../middleware/auth');

// @route   GET api/subscriptions
// @desc    Get all subscriptions
router.get('/', protect, async (req, res) => {
  try {
    const subscriptions = await Subscription.find({}).sort({ createdAt: -1 });
    res.json(subscriptions);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST api/subscriptions
// @desc    Create a new email subscription
router.post('/', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: 'Email is required' });
  }

  try {
    const emailExists = await Subscription.findOne({ email });
    if (emailExists) {
      return res.status(400).json({ message: 'Email already subscribed' });
    }

    const subscription = await Subscription.create({ email });
    res.status(201).json(subscription);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
