const AdmZip = require('adm-zip');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');

const runBackup = async () => {
  console.log('[Backup] Starting weekly email backup...');

  try {
    // 1. Fetch ALL collections dynamically directly from MongoDB
    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    const data = {};

    for (const col of collections) {
      // Skip system collections if any exist
      if (col.name.startsWith('system.')) continue;

      console.log(`[Backup] Fetching collection: ${col.name}`);
      data[col.name] = await db.collection(col.name).find({}).toArray();
    }

    // 2. Create ZIP
    const zip = new AdmZip();
    const dateStr = new Date().toISOString().split('T')[0];
    const zipFilename = `towasic-backup-${dateStr}.zip`;

    // Add each collection as a JSON file inside the ZIP
    Object.keys(data).forEach((key) => {
      zip.addFile(`${key}.json`, Buffer.from(JSON.stringify(data[key], null, 2)));
    });

    const zipBuffer = zip.toBuffer();
    console.log(`[Backup] ZIP created in memory (${(zipBuffer.length / 1024).toFixed(2)} KB)`);

    // 3. Send Email
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_APP_PASSWORD,
      },
    });

    await transporter.sendMail({
      from: `"Towasic Backups" <${process.env.SMTP_USER}>`,
      to: process.env.BACKUP_EMAIL_TO,
      subject: `Weekly Database Backup - ${dateStr}`,
      html: `
        <h2>Weekly Database Backup</h2>
        <p>Your automated database backup for <strong>${dateStr}</strong> is complete.</p>
        <p><strong>File Name:</strong> ${zipFilename}</p>
        <p><strong>Size:</strong> ${(zipBuffer.length / 1024).toFixed(2)} KB</p>
        <p>The backup file is attached to this email. Please download and store it safely.</p>
      `,
      attachments: [
        {
          filename: zipFilename,
          content: zipBuffer,
        },
      ],
    });

    console.log('[Backup] Email sent successfully.');
    return { success: true, message: 'Backup emailed successfully' };

  } catch (error) {
    console.error('[Backup] Error:', error);
    throw error;
  }
};

module.exports = { runBackup };