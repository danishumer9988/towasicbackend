const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

let isConnected = false;

const seedAdminUser = async () => {
  try {
    const User = require('../models/User');
    const adminExists = await User.countDocuments();
    if (adminExists === 0) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('Anas@6677#', salt);
      
      await User.create({
        name: 'Towasic Admin',
        email: 'admin@towasicsolutions.com',
        password: hashedPassword,
        phone: '1234567890',
        profileImage: ''
      });
      console.log('Seeded default admin credentials: admin@towasicsolutions.com / Anas@6677#');
    }
  } catch (error) {
    console.error('Error seeding admin user:', error);
  }
};

const connectDB = async () => {
  if (isConnected && mongoose.connection.readyState === 1) {
    return;
  }

  try {
    const db = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/towasic', {
      serverSelectionTimeoutMS: 5000,
    });
    isConnected = db.connections[0].readyState;
    console.log('MongoDB Connected');
    
    await seedAdminUser();
  } catch (error) {
    console.error(`Error connecting to MongoDB: ${error.message}`);
    throw error;
  }
};

module.exports = connectDB;
