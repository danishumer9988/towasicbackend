const express = require('express');
const router = express.Router();
const { runBackup } = require('../utils/backup');

// Vercel Cron jobs use GET requests
router.get('/run-backup', async (req, res) => {
  // Security Check
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await runBackup();
    res.json(result);
  } catch (err) {
    console.error('Cron Backup Error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;