const mongoose = require('mongoose');

const resultSchema = new mongoose.Schema({
  examId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Exam',
    required: true
  },
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  answers: [{
    questionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Question'
    },
    selectedAnswer: mongoose.Schema.Types.Mixed,
    isCorrect: {
      type: Boolean,
      default: false
    },
    marksObtained: {
      type: Number,
      default: 0
    }
  }],
  totalMarks: {
    type: Number,
    default: 0
  },
  obtainedMarks: {
    type: Number,
    default: 0
  },
  percentage: {
    type: Number,
    default: 0
  },
  grade: {
    type: String,
    default: 'F'
  },
  isPassed: {
    type: Boolean,
    default: false
  },
  correctAnswers: {
    type: Number,
    default: 0
  },
  wrongAnswers: {
    type: Number,
    default: 0
  },
  unattempted: {
    type: Number,
    default: 0
  },
  tabSwitches: {
    type: Number,
    default: 0
  },
  ipAddress: String,
  deviceInfo: String,
  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  isCheated: {
    type: Boolean,
    default: false
  },
  timeTaken: {
    type: Number, // in minutes
    default: 0
  },
  submittedAt: {
    type: Date,
    default: Date.now
  },
  isChecked: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: ['pending', 'submitted', 'checked', 'published'],
    default: 'pending'
  }
}, {
  timestamps: true
});

// Compound index for unique exam-student combination
resultSchema.index({ examId: 1, studentId: 1 }, { unique: true });

// Index for faster queries
resultSchema.index({ studentId: 1, status: 1 });
resultSchema.index({ examId: 1, isPassed: 1 });

const Result = mongoose.model('Result', resultSchema);

module.exports = Result;