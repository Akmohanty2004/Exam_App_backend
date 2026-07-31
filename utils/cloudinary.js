const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const path = require('path');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  timeout: 15000,
  secure: true
});

/**
 * Saves file buffer locally when Cloudinary API is unreachable or times out
 */
const saveLocally = (fileBuffer, folder, resourceType) => {
  const baseUploadDir = process.env.VERCEL ? '/tmp/uploads' : path.join(__dirname, '..', 'uploads');
  const targetDir = path.join(baseUploadDir, folder);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  let ext = '.jpg';
  if (resourceType === 'video' || resourceType === 'audio') {
    ext = '.mp4';
  } else if (fileBuffer.length > 3 && fileBuffer[0] === 0xFF && fileBuffer[1] === 0xD8) {
    ext = '.jpg';
  } else if (fileBuffer.length > 4 && fileBuffer[0] === 0x89 && fileBuffer[1] === 0x50) {
    ext = '.png';
  } else if (fileBuffer.length > 4 && fileBuffer[0] === 0x47 && fileBuffer[1] === 0x49) {
    ext = '.gif';
  } else if (resourceType === 'image') {
    ext = '.jpg';
  }

  const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
  const filePath = path.join(targetDir, filename);
  fs.writeFileSync(filePath, fileBuffer);

  const relativePath = `uploads/${folder}/${filename}`.replace(/\\/g, '/');
  return `/${relativePath}`;
};

/**
 * Uploads a file buffer to Cloudinary with automatic local server storage fallback on Timeout/ETIMEDOUT
 * @param {Buffer} fileBuffer - The file buffer to upload
 * @param {string} folder - Folder name in Cloudinary
 * @param {string} resourceType - 'image', 'video' (used for audio), 'raw', or 'auto'
 * @returns {Promise<string>} - The secure URL of the uploaded file or local fallback URL
 */
const uploadToCloudinary = async (fileBuffer, folder, resourceType = 'auto') => {
  if (!fileBuffer) {
    throw new Error('File buffer is empty');
  }

  let resolvedResourceType = resourceType;
  if (resolvedResourceType === 'audio') {
    resolvedResourceType = 'video';
  }

  let mimeType = 'application/octet-stream';
  if (resolvedResourceType === 'image') {
    mimeType = 'image/jpeg';
  } else if (resolvedResourceType === 'video') {
    mimeType = 'video/mp4';
  } else if (resolvedResourceType === 'auto') {
    if (fileBuffer.length > 3 && fileBuffer[0] === 0xFF && fileBuffer[1] === 0xD8) {
      mimeType = 'image/jpeg';
    } else if (fileBuffer.length > 4 && fileBuffer[0] === 0x89 && fileBuffer[1] === 0x50) {
      mimeType = 'image/png';
    } else {
      mimeType = 'video/mp4';
    }
  }

  const base64Data = fileBuffer.toString('base64');
  const dataUri = `data:${mimeType};base64,${base64Data}`;

  try {
    const result = await cloudinary.uploader.upload(dataUri, {
      folder: `online-exam/${folder}`,
      resource_type: resolvedResourceType,
      timeout: 15000
    });
    return result.secure_url;
  } catch (error) {
    console.log('Cloudinary upload timed out or unreachable. Automatically saving to local server storage:', error.message || error);
    try {
      const localUrl = saveLocally(fileBuffer, folder, resolvedResourceType);
      return localUrl;
    } catch (localError) {
      console.error('Local storage fallback error:', localError);
      throw error;
    }
  }
};

module.exports = {
  cloudinary,
  uploadToCloudinary
};
