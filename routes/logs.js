const express = require('express');
const router = express.Router();
const SystemLog = require('../models/SystemLog');
const { protect } = require('../middleware/auth');

router.get('/', protect, async (req, res) => {
  try {
    const logs = await SystemLog.find({}).sort({ timestamp: -1 }).limit(200);
    res.json(logs);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;