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

// @route   PUT api/subscriptions/mark-read
// @desc    Mark all subscriptions as read
router.put('/mark-read', protect, async (req, res) => {
  try {
    await Subscription.updateMany({ isRead: false }, { $set: { isRead: true } });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   DELETE api/subscriptions/:id
// @desc    Delete a single subscription
router.delete('/:id', protect, async (req, res) => {
  try {
    const result = await Subscription.deleteOne({ _id: req.params.id });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'Subscription not found' });
    }

    res.json({ message: 'Subscription removed successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST api/subscriptions/bulk-delete
// @desc    Delete multiple subscriptions
// @body    { ids: ['id1', 'id2', ...] }
router.post('/bulk-delete', protect, async (req, res) => {
  const { ids } = req.body || {};

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ message: 'No subscription IDs provided' });
  }

  try {
    const result = await Subscription.deleteMany({ _id: { $in: ids } });
    res.json({
      success: true,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;