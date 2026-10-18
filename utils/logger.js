const SystemLog = require('../models/SystemLog');

async function logEvent(action, user = 'System', details = '', ip = '') {
  try {
    await SystemLog.create({ action, user, details, ip });
    console.log(`[SystemLog] ${action} by ${user}: ${details}`);
  } catch (err) {
    console.error('Failed to write system log:', err);
  }
}

module.exports = { logEvent };