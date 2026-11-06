const { Sequelize } = require('sequelize');
const env = require('../config/env');
const logger = require('./logger');

const sequelize = new Sequelize(env.DATABASE_URL, {
  dialect: 'postgres',
  logging: env.LOG_LEVEL === 'debug' ? (sql) => logger.debug(sql) : false,
  pool: { max: 20, min: 0, idle: 10000, acquire: 30000 },
  dialectOptions: env.DATABASE_SSL === 'true' ? { ssl: { require: true, rejectUnauthorized: false } } : {},
  define: { underscored: true, timestamps: false, freezeTableName: true },
});

module.exports = sequelize;
