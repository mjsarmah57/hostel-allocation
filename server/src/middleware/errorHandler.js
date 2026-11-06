const multer = require('multer');
const { UniqueConstraintError, ForeignKeyConstraintError, DatabaseError } = require('sequelize');
const { AppError } = require('../lib/errors');
const logger = require('../lib/logger');

function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.originalUrl} not found`, requestId: req.id },
  });
}

// Centralised error handler: every error leaves the API in the same shape:
// { error: { code, message, details?, requestId } }
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong';
  let details;

  if (err instanceof AppError) {
    ({ status, code, message, details } = err);
  } else if (err instanceof multer.MulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    code = err.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR';
    message = err.code === 'LIMIT_FILE_SIZE' ? 'File exceeds the 2 MB limit' : err.message;
  } else if (err instanceof UniqueConstraintError) {
    status = 409;
    code = 'CONFLICT';
    message = 'This conflicts with an existing record';
    details = { constraint: err.parent?.constraint };
  } else if (err instanceof ForeignKeyConstraintError) {
    status = 409;
    code = 'CONFLICT';
    message = 'Referenced record does not exist or is still in use';
  } else if (err instanceof DatabaseError && err.parent?.code === '23514') {
    status = 422;
    code = 'VALIDATION_FAILED';
    message = 'Value violates a database check constraint';
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    code = 'BAD_REQUEST';
    message = 'Malformed JSON body';
  }

  if (status >= 500) logger.error({ err, requestId: req.id }, 'unhandled error');
  else logger.info({ requestId: req.id, status, code }, message);

  res.status(status).json({ error: { code, message, ...(details ? { details } : {}), requestId: req.id } });
}

module.exports = { errorHandler, notFoundHandler };
