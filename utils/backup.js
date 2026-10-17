const AdmZip = require('adm-zip');
const XLSX = require('xlsx');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');

// Helper to generate the ZIP buffer
const generateBackupZip = async () => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('Database connection not ready.');

  const collections = await db.listCollections().toArray();
  const zip = new AdmZip();

  for (const col of collections) {
    if (col.name.startsWith('system.')) continue;

    const data = await db.collection(col.name).find({}).toArray();
    if (data.length === 0) continue;

    const cleanData = data.map(row => {
      const flat = {};
      for (const [key, val] of Object.entries(row)) {
        if (val instanceof Date) flat[key] = val.toISOString();
        else if (val && typeof val === 'object') {
          if (val._bsontype === 'ObjectID' || val._bsontype === 'ObjectId') flat[key] = val.toString();
          else flat[key] = JSON.stringify(val);
        } else flat[key] = val;
      }
      return flat;
    });

    const ws = XLSX.utils.json_to_sheet(cleanData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, col.name.substring(0, 31));
    const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    zip.addFile(`${col.name}.xlsx`, excelBuffer);
  }

  const zipBuffer = zip.toBuffer();
  const dateStr = new Date().toISOString().split('T')[0];
  const filename = `towasic-backup-${dateStr}.zip`;

  return { zipBuffer, filename };
};

// 1. Function for the Admin Dashboard Download Button
const getBackupData = async () => {
  return await generateBackupZip();
};

// 2. Function for the Weekly Automated Email
const runBackupEmail = async () => {
  console.log('[Backup] Starting weekly email backup...');
  try {
    const { zipBuffer, filename } = await generateBackupZip();
    console.log(`[Backup] ZIP created (${(zipBuffer.length / 1024).toFixed(2)} KB)`);

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_APP_PASSWORD },
    });

    await transporter.sendMail({
      from: `"Towasic Backups" <${process.env.SMTP_USER}>`,
      to: process.env.BACKUP_EMAIL_TO,
      subject: `Weekly Database Backup - ${filename}`,
      html: `
        <h2>Weekly Database Backup</h2>
        <p>Your automated backup is complete.</p>
        <p><strong>File:</strong> ${filename}</p>
        <p><strong>Size:</strong> ${(zipBuffer.length / 1024).toFixed(2)} KB</p>
      `,
      attachments: [{ filename: filename, content: zipBuffer }],
    });

    return { success: true, message: 'Backup emailed successfully' };
  } catch (error) {
    console.error('[Backup] Error:', error);
    throw error;
  }
};

module.exports = { getBackupData, runBackupEmail };