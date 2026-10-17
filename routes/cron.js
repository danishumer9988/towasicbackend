const express = require('express');
const router = express.Router();
const { getBackupData, runBackupEmail } = require('../utils/backup');
const { protect } = require('../middleware/auth');

// 1. Automated Cron Job (Emails the file)
router.get('/run-backup', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await runBackupEmail();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Admin Manual Download (Streams the file to browser)
router.get('/download', protect, async (req, res) => {
  try {
    const { zipBuffer, filename } = await getBackupData();

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.send(zipBuffer);
  } catch (err) {
    console.error('Download Error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;