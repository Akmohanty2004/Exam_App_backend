const mongoose = require('mongoose');

const classGroupSchema = new mongoose.Schema({
  name: { 
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

module.exports = mongoose.model('ClassGroup', classGroupSchema);
