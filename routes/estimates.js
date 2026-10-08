const express = require('express');
const router = express.Router();
const Estimate = require('../models/Estimate');
const { protect } = require('../middleware/auth');

// @route   GET api/estimates
// @desc    Get all estimate requests
router.get('/', protect, async (req, res) => {
  try {
    const estimates = await Estimate.find({}).sort({ createdAt: -1 });
    res.json(estimates);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST api/estimates
// @desc    Create a new estimate request (public — called by the popup)
router.post('/', async (req, res) => {
  const { name, email, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ message: 'Name, email, and message are required' });
  }

  try {
    const newEstimate = await Estimate.create({
      name,
      email,
      message
    });

    res.status(201).json({
      success: true,
      data: newEstimate,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   DELETE api/estimates/:id
// @desc    Delete a single estimate request
router.delete('/:id', protect, async (req, res) => {
  try {
    const estimate = await Estimate.findById(req.params.id);
    if (!estimate) {
      return res.status(404).json({ message: 'Estimate not found' });
    }
    await Estimate.deleteOne({ _id: req.params.id });
    res.json({ message: 'Estimate removed successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST api/estimates/bulk-delete
// @desc    Delete multiple estimate requests
// @body    { ids: ['id1', 'id2', ...] }
router.post('/bulk-delete', protect, async (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ message: 'No estimate IDs provided' });
  }

  try {
    const result = await Estimate.deleteMany({ _id: { $in: ids } });
    res.json({
      success: true,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;