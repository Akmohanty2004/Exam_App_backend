const mongoose = require('mongoose');

const examSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  subject: {
    type: String,
    required: true,
    trim: true
  },
  classGroup: {
    type: String,
    trim: true,
    default: 'General'
  },
  description: {
    type: String,
    trim: true
  },
  instructions: {
    type: String,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  startTime: {
    type: String,
    required: true
  },
  endTime: {
    type: String,
    required: true
  },
  duration: {
    type: Number, // in minutes
    required: true
  },
  entryTime: {
    type: Number, // minutes after start time allowed for entry
    default: 15
  },
  maxMarks: {
    type: Number,
    required: true,
    default: 100
  },
  passingMarks: {
    type: Number,
    required: true,
    default: 40
  },
  negativeMarking: {
    type: Boolean,
    default: false
  },
  negativeMarkValue: {
    type: Number,
    default: 0.25
  },
  randomQuestions: {
    type: Boolean,
    default: false
  },
  allowCalculator: {
    type: Boolean,
    default: false
  },
  fullscreenMode: {
    type: Boolean,
    default: true
  },
  enableCamera: {
    type: Boolean,
    default: true
  },
  enableMicrophone: {
    type: Boolean,
    default: true
  },
  maxAttempts: {
    type: Number,
    default: 1
  },
  plannedQuestions: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['draft', 'published', 'ongoing', 'completed', 'cancelled'],
    default: 'draft'
  },
  isResultPublished: {
    type: Boolean,
    default: false
  },
  totalQuestions: {
    type: Number,
    default: 0
  },
  totalStudents: {
    type: Number,
    default: 0
  },
  totalSubmitted: {
    type: Number,
    default: 0
  },
  totalPassed: {
    type: Number,
    default: 0
  },
  totalFailed: {
    type: Number,
    default: 0
  },
  averageScore: {
    type: Number,
    default: 0
  },
  highestScore: {
    type: Number,
    default: 0
  },
  lowestScore: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Index for faster queries
examSchema.index({ createdBy: 1, status: 1 });
examSchema.index({ date: 1, startTime: 1 });

const Exam = mongoose.model('Exam', examSchema);

module.exports = Exam;