const express = require('express');
const router = express.Router();
const Contact = require('../models/Contact');
const Estimate = require('../models/Estimate');
const Subscription = require('../models/Subscription');
const { protect } = require('../middleware/auth');

// @route   GET api/stats/unread
// @desc    Get counts of unread items for the admin sidebar
router.get('/unread', protect, async (req, res) => {
  try {
    const [contacts, estimates, subscriptions] = await Promise.all([
      Contact.countDocuments({ isRead: false }),
      Estimate.countDocuments({ isRead: false }),
      Subscription.countDocuments({ isRead: false }),
    ]);

    res.json({ contacts, estimates, subscriptions });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;