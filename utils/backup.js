const AdmZip = require('adm-zip');
const nodemailer = require('nodemailer');

// Import your models
const User = require('../models/User');
const Blog = require('../models/Blog');
const Category = require('../models/Category');
const Contact = require('../models/Contact');
const Estimate = require('../models/Estimate');
const Industry = require('../models/Industry');
const Project = require('../models/Project');
const Subscription = require('../models/Subscription');
const LegalPage = require('../models/LegalPage');
// If you have other models, import them here too

const runBackup = async () => {
  console.log('[Backup] Starting weekly email backup...');

  try {
    // 1. Fetch Data
    const data = {
      users: await User.find({}).lean(),
      blogs: await Blog.find({}).lean(),
      categories: await Category.find({}).lean(),
      contacts: await Contact.find({}).lean(),
      estimates: await Estimate.find({}).lean(),
      industries: await Industry.find({}).lean(),
      projects: await Project.find({}).lean(),
      subscriptions: await Subscription.find({}).lean(),
      legalPages: await LegalPage.find({}).lean(),
    };

    // 2. Create ZIP
    const zip = new AdmZip();
    const dateStr = new Date().toISOString().split('T')[0];
    const zipFilename = `towasic-backup-${dateStr}.zip`;

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