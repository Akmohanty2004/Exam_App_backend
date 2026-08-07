require('dotenv').config();
const mongoose = require('mongoose');
const Result = require('./models/Result.model');
const Exam = require('./models/Exam.model');
const User = require('./models/User.model');

async function test() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected');

  // get a published exam
  const exams = await Exam.find({ status: 'published' }).sort({ date: -1 }).limit(10).lean();
  if (!exams.length) { console.log('No published exams'); process.exit(0); }
  const examIds = exams.map(e => e._id);
  const candidateResults = await Result.find({
    examId: { $in: examIds },
    status: { $in: ['submitted', 'published'] },
    isPassed: true
  })
    .sort({ percentage: -1, obtainedMarks: -1 })
    .populate('studentId', 'name profileImage classGroup department email college')
    .select('examId studentId percentage likes isPassed')
    .lean();

  const topByExam = {};
  candidateResults.forEach(res => {
    const eId = res.examId.toString();
    if (!topByExam[eId] && res.studentId) {
      topByExam[eId] = res;
    }
  });

  const toppersResults = exams.map(exam => {
    const topResult = topByExam[exam._id.toString()];
    if (topResult && topResult.studentId && topResult.isPassed === true) {
      return {
        examId: exam._id,
        examTitle: exam.title,
        examDate: exam.date,
        resultId: topResult._id,
        student: topResult.studentId,
        score: topResult.percentage,
        likes: topResult.likes || [],
      };
    }
    return null;
  });

  const toppers = toppersResults.filter(Boolean);
  console.log(JSON.stringify(toppers, null, 2));
  mongoose.disconnect();
}
test();
