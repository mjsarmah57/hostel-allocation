const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const env = require('../config/env');
const { AppError } = require('../lib/errors');

const dir = path.resolve(env.UPLOAD_DIR, 'receipts');
fs.mkdirSync(dir, { recursive: true });

const ALLOWED = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' };
const MAX_BYTES = 2 * 1024 * 1024;

const storage = multer.diskStorage({
  destination: dir,
  // Never trust the client's filename: random name + extension derived from the MIME type.
  filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ALLOWED[file.mimetype]}`),
});

const receiptUpload = multer({
  storage,
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED[file.mimetype]) {
      return cb(new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Receipt must be a PDF, JPEG or PNG'));
    }
    return cb(null, true);
  },
}).single('receipt');

// Magic-byte check after upload: the MIME header is client-controlled, so verify the content too.
function verifyMagicBytes(req, res, next) {
  if (!req.file) return next(new AppError(422, 'VALIDATION_FAILED', 'A receipt file is required (field name: receipt)'));
  const fd = fs.openSync(req.file.path, 'r');
  const buf = Buffer.alloc(8);
  fs.readSync(fd, buf, 0, 8, 0);
  fs.closeSync(fd);
  const hex = buf.toString('hex');
  const ok =
    (req.file.mimetype === 'application/pdf' && buf.toString('ascii', 0, 5) === '%PDF-') ||
    (req.file.mimetype === 'image/png' && hex.startsWith('89504e47')) ||
    (req.file.mimetype === 'image/jpeg' && hex.startsWith('ffd8ff'));
  if (!ok) {
    fs.unlink(req.file.path, () => {});
    return next(new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'File content does not match its declared type'));
  }
  return next();
}

module.exports = { receiptUpload, verifyMagicBytes, RECEIPT_DIR: dir };
