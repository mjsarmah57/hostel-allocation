const mongoose = require('mongoose');
const env = require('../config/env');
const logger = require('./logger');

let connected = false;

async function connectMongo() {
  if (!env.MONGO_URI) {
    logger.warn('MONGO_URI not set: audit logs and notifications will be skipped');
    return;
  }
  try {
    await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    connected = true;
    logger.info('MongoDB connected');
  } catch (err) {
    logger.error({ err }, 'MongoDB connection failed: audit logs disabled');
  }
}

module.exports = { connectMongo, isMongoReady: () => connected && mongoose.connection.readyState === 1 };
