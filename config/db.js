const mongoose = require('mongoose');

let isConnected = false;

const connectDB = async () => {
  if (isConnected && mongoose.connection.readyState === 1) {
    return;
  }

  try {
    const db = await mongoose.connect(
      process.env.MONGODB_URI || 'mongodb://localhost:27017/towasic',
      { serverSelectionTimeoutMS: 5000 }
    );
    isConnected = db.connections[0].readyState;
    console.log('MongoDB Connected');
  } catch (error) {
    console.error(`Error connecting to MongoDB: ${error.message}`);
    throw error;
  }
};

module.exports = connectDB;