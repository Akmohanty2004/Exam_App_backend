const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  originalPassword: {
    type: String
  },
  phone: {
    type: String,
    trim: true
  },
  role: {
    type: String,
    enum: ['student', 'teacher', 'admin'],
    default: 'student'
  },
  profileImage: {
    type: String,
    default: null
  },
  department: {
    type: String,
    trim: true
  },
  college: {
    type: String,
    trim: true
  },
  gender: {
    type: String,
    enum: ['male', 'female', 'other']
  },
  age: {
    type: Number,
    min: 0
  },
  classGroup: {
    type: String,
    trim: true,
    default: 'General'
  },
  pendingClassGroup: {
    type: String,
    trim: true
  },
  classChangeStatus: {
    type: String,
    enum: ['none', 'pending', 'approved', 'rejected'],
    default: 'none'
  },
  address: {
    type: String,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: {
    type: Date
  },
  isOnline: {
    type: Boolean,
    default: false
  },
  lastSeen: {
    type: Date,
    default: Date.now
  },
  refreshToken: {
    type: String
  },
  expoPushToken: {
    type: String,
    default: ''
  },
  resetPasswordToken: String,
  resetPasswordExpire: Date,
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  // Prevent double-hashing if password is already a bcrypt hash
  if (this.password && typeof this.password === 'string' && this.password.startsWith('$2') && this.password.length === 60) {
    return next();
  }
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function(password) {
  if (!password) return false;
  const cleanPassword = String(password).trim();
  const dbPassword = String(this.password || '').trim();
  const origPassword = String(this.originalPassword || '').trim();

  // 1. Check direct match (for passwords stored as plain text or in originalPassword)
  if (cleanPassword === dbPassword || cleanPassword === origPassword || password === this.password || password === this.originalPassword) {
    return true;
  }

  // 2. Try bcrypt.compare with exact password
  try {
    const isMatch = await bcrypt.compare(password, this.password);
    if (isMatch) return true;
  } catch (err) {}

  // 3. Try bcrypt.compare with trimmed password
  try {
    const isTrimMatch = await bcrypt.compare(cleanPassword, this.password);
    if (isTrimMatch) return true;
  } catch (err) {}

  return false;
};

// Check if user is admin
userSchema.methods.isAdmin = function() {
  return this.role === 'admin';
};

// Check if user is teacher
userSchema.methods.isTeacher = function() {
  return this.role === 'teacher';
};

// Check if user is student
userSchema.methods.isStudent = function() {
  return this.role === 'student';
};

// Indexes for faster filtering and counting
userSchema.index({ role: 1, isActive: 1 });
userSchema.index({ classGroup: 1, role: 1 });
userSchema.index({ isOnline: 1 });

const User = mongoose.model('User', userSchema);

module.exports = User;