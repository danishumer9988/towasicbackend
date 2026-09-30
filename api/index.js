const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const connectDB = require('../config/db');

dotenv.config();
connectDB();

const app = express();

app.use(cors());
app.use(express.json());

/* Database connection middleware for Serverless */
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    res.status(500).json({
      message: 'Database connection failed. Please verify MONGODB_URI environment variable on Vercel.',
      error: err.message,
    });
  }
});

/* ---------- Routes ---------- */
app.use('/api/auth',          require('../routes/auth'));
app.use('/api/auth-otp',      require('../routes/authOtp'));
app.use('/api/blogs',         require('../routes/blogs'));
app.use('/api/categories',    require('../routes/categories'));
app.use('/api/contacts',      require('../routes/contacts'));
app.use('/api/contact',       require('../routes/contacts'));
app.use('/api/subscriptions', require('../routes/subscriptions'));
app.use('/api/upload',        require('../routes/upload'));
app.use('/api/projects',      require('../routes/projects'));
app.use('/api/industries',    require('../routes/industries'));
app.use('/api',               require('../routes/analytics'));

/* ---------- Health check ---------- */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Towasic Solutions Backend is running' });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;