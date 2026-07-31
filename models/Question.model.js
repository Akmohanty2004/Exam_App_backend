const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
  examId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Exam',
    required: true
  },
  type: {
    type: String,
    enum: ['mcq', 'truefalse', 'fillblank', 'multiple', 'text'],
    required: true,
    default: 'mcq'
  },
  question: {
    type: String,
    required: true,
    trim: true
  },
  image: {
    type: String,
    default: null
  },
  options: [{
    text: {
      type: String,
      trim: true
    },
    image: {
      type: String,
      default: null
    }
  }],
  correctAnswer: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  marks: {
    type: Number,
    required: true,
    default: 1
  },
  explanation: {
    type: String,
    trim: true
  },
  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard'],
    default: 'medium'
  },
  order: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Index for faster queries
questionSchema.index({ examId: 1, order: 1 });
questionSchema.index({ examId: 1, isActive: 1 });

const Question = mongoose.model('Question', questionSchema);

module.exports = Question;