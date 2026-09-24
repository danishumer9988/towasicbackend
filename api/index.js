const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const connectDB = require('../config/db');

// Load environment variables
dotenv.config();

// Connect to Database
connectDB();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Database connection middleware for Serverless
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    res.status(500).json({ 
      message: 'Database connection failed. Please verify MONGODB_URI environment variable on Vercel.',
      error: err.message 
    });
  }
});

// Routes Mounting
app.use('/api/auth', require('../routes/auth'));
app.use('/api/blogs', require('../routes/blogs'));
app.use('/api/categories', require('../routes/categories'));
app.use('/api/contacts', require('../routes/contacts'));
app.use('/api/contact', require('../routes/contacts'));
app.use('/api/subscriptions', require('../routes/subscriptions'));
app.use('/api/upload', require('../routes/upload'));
app.use('/api/projects', require('../routes/projects'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Towasic Solutions Backend is running' });
});

// Database seed endpoint
app.get('/api/seed', async (req, res) => {
  try {
    const User = require('../models/User');
    const bcrypt = require('bcryptjs');
    
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('adminpassword123', salt);

    let user = await User.findOne({ email: 'admin@towasicsolutions.com' });

    if (user) {
      user.password = hashedPassword;
      await user.save();
      return res.json({
        success: true,
        message: 'Admin credentials reset successfully to admin@towasicsolutions.com / adminpassword123'
      });
    }

    user = await User.create({
      name: 'Towasic Admin',
      email: 'admin@towasicsolutions.com',
      password: hashedPassword,
      phone: '1234567890',
      profileImage: ''
    });

    res.status(201).json({
      success: true,
      message: 'Admin account created successfully!',
      user: {
        _id: user._id,
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
