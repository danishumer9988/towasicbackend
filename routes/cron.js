const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { getBackupData, runBackupEmail } = require('../utils/backup');
const { protect } = require('../middleware/auth');
const { logEvent } = require('../utils/logger');

// 1. Automated Cron Job (Emails the file)
router.get('/run-backup', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await runBackupEmail();
    await logEvent('BACKUP_RUN', 'System', 'Weekly backup generated and emailed.');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Admin Manual Download (Streams the file to browser)
router.get('/download', protect, async (req, res) => {
  try {
    const { zipBuffer, filename } = await getBackupData();
    await logEvent('BACKUP_DOWNLOAD', req.user?.email || 'Admin', 'Manual backup downloaded.');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.send(zipBuffer);
  } catch (err) {
    console.error('Download Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. Anonymize IPs older than 90 days (Keep consent record for 12 months, but remove IP)
router.get('/cleanup-ips', async (req, res) => {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).send('Unauthorized');

  try {
    // Dynamically retrieve the model (guaranteed to be registered by analytics.js by the time this runs)
    const SecurityLog = mongoose.model('SecurityLog');

    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    // Find logs older than 90 days and remove the IP
    const result = await SecurityLog.updateMany(
      { endTime: { $lt: ninetyDaysAgo }, ip: { $ne: 'Anonymized' } },
      { $set: { ip: 'Anonymized' } }
    );

    await logEvent('CLEANUP_IPS', 'System', `Anonymized ${result.modifiedCount} IPs in Security Log.`);
    res.json({ success: true, anonymizedCount: result.modifiedCount });
  } catch (err) {
    console.error('Cleanup Error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;