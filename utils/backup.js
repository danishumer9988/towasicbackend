const AdmZip = require('adm-zip');
const XLSX = require('xlsx');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');

const runBackup = async () => {
  console.log('[Backup] Starting weekly Excel ZIP backup...');

  try {
    if (mongoose.connection.readyState !== 1) {
      throw new Error('MongoDB is not connected. Cannot run backup.');
    }

    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();

    // Create a new ZIP archive
    const zip = new AdmZip();

    for (const col of collections) {
      if (col.name.startsWith('system.')) continue;

      console.log(`[Backup] Fetching collection: ${col.name}`);
      const data = await db.collection(col.name).find({}).toArray();

      // Skip empty collections to keep the zip clean
      if (data.length === 0) continue;

      // Clean up MongoDB objects (ObjectIDs, Dates) so Excel can read them
      const cleanData = data.map(row => {
        const flat = {};
        for (const [key, val] of Object.entries(row)) {
          if (val instanceof Date) {
            flat[key] = val.toISOString();
          } else if (val && typeof val === 'object') {
            if (val._bsontype === 'ObjectID' || val._bsontype === 'ObjectId') {
              flat[key] = val.toString();
            } else {
              flat[key] = JSON.stringify(val);
            }
          } else {
            flat[key] = val;
          }
        }
        return flat;
      });

      // Create an Excel workbook for THIS specific collection
      const ws = XLSX.utils.json_to_sheet(cleanData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, col.name.substring(0, 31));

      // Convert Excel workbook to buffer
      const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      // Add this Excel file to the ZIP archive
      zip.addFile(`${col.name}.xlsx`, excelBuffer);
    }

    // Generate the final ZIP buffer
    const zipBuffer = zip.toBuffer();
    const dateStr = new Date().toISOString().split('T')[0];
    const zipFilename = `towasic-backup-${dateStr}.zip`;

    console.log(`[Backup] ZIP file created in memory (${(zipBuffer.length / 1024).toFixed(2)} KB)`);

    // Send Email
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
        <p>When you extract the attached ZIP file, you will find a separate Excel file for each table in your database.</p>
      `,
      attachments: [
        {
          filename: zipFilename,
          content: zipBuffer,
        },
      ],
    });

    console.log('[Backup] Email sent successfully.');
    return { success: true, message: 'ZIP of Excel files emailed successfully' };

  } catch (error) {
    console.error('[Backup] Error:', error);
    throw error;
  }
};

module.exports = { runBackup };