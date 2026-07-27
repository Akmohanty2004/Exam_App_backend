const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure uploads directory exists (use /tmp/uploads in Vercel serverless environment)
const uploadDir = process.env.VERCEL ? '/tmp/uploads' : 'uploads';
try {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
} catch (err) {
  console.log('Uploads directory creation skipped (read-only filesystem):', err.message);
}

// Local storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = process.env.VERCEL ? '/tmp/uploads/' : 'uploads/';
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
    'audio/m4a', 'audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/mp3', 'audio/x-m4a', 'audio/3gpp', 'audio/x-caf', 'audio/caf', 'audio/x-m4a'
  ];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only images and audio are allowed.'), false);
  }
};

// Multer configuration for single image upload
const uploadSingle = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
}).single('image');

// Multer configuration for chat files (image or audio)
const chatFileUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit for chat files
  }
}).fields([{ name: 'image', maxCount: 1 }, { name: 'audio', maxCount: 1 }]);

// Multer configuration for multiple images
const uploadMultiple = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit per file
  }
}).array('images', 10);

// Memory storage for profile images (to save as base64 in MongoDB)
const memoryStorage = multer.memoryStorage();

// Multer configuration for profile image
const uploadProfileImage = multer({
  storage: memoryStorage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 2 * 1024 * 1024 // 2MB limit
  }
}).single('profileImage');

// Error handling middleware for uploads
const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'FILE_TOO_LARGE') {
      return res.status(400).json({ message: 'File too large. Max size is 5MB.' });
    }
    return res.status(400).json({ message: err.message });
  }
  if (err) {
    return res.status(400).json({ message: err.message });
  }
  next();
};

module.exports = {
  uploadSingle,
  uploadMultiple,
  uploadProfileImage,
  chatFileUpload,
  handleUploadError,
  cloudinary: null // Not using cloudinary in this version
};