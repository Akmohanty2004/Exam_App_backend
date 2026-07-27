const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const { authMiddleware, roleMiddleware } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');
const Result = require('../models/Result.model');
const Exam = require('../models/Exam.model');
const Question = require('../models/Question.model');
const User = require('../models/User.model');
const Notification = require('../models/Notification.model');

// Submit exam
router.post('/submit',
  authMiddleware,
  roleMiddleware('student'),
  validate([
    body('examId').isMongoId().withMessage('Invalid exam ID'),
    body('answers').isArray().withMessage('Answers must be an array'),
    body('timeTaken').isInt({ min: 0 }).withMessage('Invalid time taken'),
    body('tabSwitches').optional().isInt({ min: 0 })
  ]),
  async (req, res) => {
    try {
      const { examId, answers, timeTaken, tabSwitches = 0, isCheated = false } = req.body;

      // Check if exam exists and is available
      const exam = await Exam.findById(examId);
      if (!exam) {
        return res.status(404).json({ message: 'Exam not found' });
      }

      // Check if student has already submitted
      const existingResult = await Result.findOne({
        examId,
        studentId: req.userId
      });

      if (existingResult && existingResult.status === 'submitted') {
        return res.status(400).json({ message: 'You have already submitted this exam' });
      }

      // Get all questions for this exam
      const questions = await Question.find({ examId, isActive: true });

      // Calculate results
      let totalMarks = 0;
      let obtainedMarks = 0;
      let correctAnswers = 0;
      let wrongAnswers = 0;
      let unattempted = 0;

      const processedAnswers = questions.map(question => {
        const studentAnswer = answers.find(a => a.questionId === question._id.toString());
        let isCorrect = false;
        if (studentAnswer) {
          if (question.type === 'mcq') {
            const correctOptIdx = parseInt(question.correctAnswer, 10);
            const correctOpt = question.options[correctOptIdx];
            if (correctOpt) {
              isCorrect = String(studentAnswer.selectedAnswer).trim() === String(correctOpt.text).trim();
            }
          } else {
            isCorrect = String(studentAnswer.selectedAnswer).trim() === String(question.correctAnswer).trim();
          }
        }
        
        let marksObtained = 0;
        if (studentAnswer) {
          if (isCorrect) {
            marksObtained = question.marks;
            correctAnswers++;
            obtainedMarks += question.marks;
          } else {
            if (exam.negativeMarking) {
              marksObtained = -(exam.negativeMarkValue || 0.25);
              obtainedMarks -= exam.negativeMarkValue || 0.25;
            }
            wrongAnswers++;
          }
        } else {
          unattempted++;
        }

        totalMarks += question.marks;

        return {
          questionId: question._id,
          selectedAnswer: studentAnswer ? studentAnswer.selectedAnswer : null,
          isCorrect,
          marksObtained
        };
      });

      // Calculate percentage and grade
      const percentage = (obtainedMarks / totalMarks) * 100;
      const isPassed = percentage >= exam.passingMarks;
      
      let grade = 'F';
      if (percentage >= 90) grade = 'A+';
      else if (percentage >= 80) grade = 'A';
      else if (percentage >= 70) grade = 'B+';
      else if (percentage >= 60) grade = 'B';
      else if (percentage >= 50) grade = 'C';
      else if (percentage >= 40) grade = 'D';

      // Create result
      const result = new Result({
        examId,
        studentId: req.userId,
        answers: processedAnswers,
        totalMarks,
        obtainedMarks,
        percentage,
        grade,
        isPassed,
        correctAnswers,
        wrongAnswers,
        unattempted,
        timeTaken,
        tabSwitches,
        isCheated,
        status: 'submitted',
        submittedAt: new Date()
      });

      await result.save();

      // Update exam statistics
      exam.totalSubmitted += 1;
      if (isPassed) {
        exam.totalPassed += 1;
      } else {
        exam.totalFailed += 1;
      }
      exam.averageScore = (exam.averageScore * (exam.totalSubmitted - 1) + obtainedMarks) / exam.totalSubmitted;
      exam.highestScore = Math.max(exam.highestScore, obtainedMarks);
      exam.lowestScore = exam.lowestScore === 0 ? obtainedMarks : Math.min(exam.lowestScore, obtainedMarks);
      await exam.save();

      // Notify teacher
      const teacher = await User.findById(exam.createdBy);
      await Notification.create({
        userId: exam.createdBy,
        type: 'exam_submitted',
        title: 'Exam Submitted',
        message: `Student ${req.user.name} has submitted the exam "${exam.title}"`,
        data: { examId: exam._id, studentId: req.userId }
      });

      res.json({
        message: 'Exam submitted successfully',
        result: {
          id: result._id,
          obtainedMarks,
          totalMarks,
          percentage,
          grade,
          isPassed,
          correctAnswers,
          wrongAnswers,
          unattempted,
          detailedAnswers: processedAnswers.map((pa, idx) => ({
            ...pa,
            questionText: questions[idx].question,
            correctAnswer: questions[idx].correctAnswer,
            options: questions[idx].options
          }))
        }
      });
    } catch (error) {
      console.error('Submit exam error:', error);
      res.status(500).json({ message: 'Failed to submit exam' });
    }
  }
);

// Get student results
router.get('/my-results',
  authMiddleware,
  roleMiddleware('student'),
  async (req, res) => {
    try {
      const results = await Result.find({ 
        studentId: req.userId,
        status: { $in: ['submitted', 'checked', 'published'] }
      })
      .populate('examId', 'title subject date startTime endTime duration maxMarks')
      .populate('answers.questionId', 'question options correctAnswer marks')
      .sort({ submittedAt: -1 });

      // Check if results are published and calculate rank
      const resultsWithPublishStatus = await Promise.all(results.map(async (result) => {
        const exam = await Exam.findById(result.examId);
        let rank = null;
        
        if (exam && exam.isResultPublished) {
          const allExamResults = await Result.find({ examId: result.examId, status: { $in: ['submitted', 'checked', 'published'] } }).sort({ obtainedMarks: -1 });
          rank = allExamResults.findIndex(r => r.studentId.toString() === result.studentId.toString()) + 1;
        }
        
        return {
          ...result.toObject(),
          isPublished: true,
          rank: rank
        };
      }));

      res.json({ results: resultsWithPublishStatus });
    } catch (error) {
      console.error('Get student results error:', error);
      res.status(500).json({ message: 'Error fetching results' });
    }
  }
);

// Get specific student results (for Teacher/Admin)
router.get('/student/:studentId',
  authMiddleware,
  async (req, res) => {
    try {
      const results = await Result.find({ 
        studentId: req.params.studentId,
        status: { $in: ['submitted', 'checked', 'published'] }
      })
        .populate('examId', 'title subject maxMarks passingMarks')
        .sort({ createdAt: -1 });

      const formattedResults = results.map(result => {
        let obtained = result.obtainedMarks || 0;
        let total = result.totalMarks || 1;
        return {
          ...result.toObject(),
          percentage: (obtained / total) * 100
        };
      });

      res.json({ results: formattedResults });
    } catch (error) {
      console.error('Get specific student results error:', error);
      res.status(500).json({ message: 'Server error' });
    }
});

// Get exam results for teacher/admin
router.get('/exam/:examId',
  authMiddleware,
  roleMiddleware('teacher', 'admin'),
  validate([
    param('examId').isMongoId().withMessage('Invalid exam ID')
  ]),
  async (req, res) => {
    try {
      const exam = await Exam.findById(req.params.examId);
      if (!exam) {
        return res.status(404).json({ message: 'Exam not found' });
      }

      if (exam.createdBy.toString() !== req.userId.toString() && req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Access denied' });
      }

      const results = await Result.find({ 
        examId: req.params.examId
      })
      .populate('studentId', 'name email profileImage department')
      .sort({ obtainedMarks: -1 });

      // Calculate statistics
      const stats = {
        totalStudents: results.length,
        passed: results.filter(r => r.isPassed).length,
        failed: results.filter(r => !r.isPassed).length,
        averageScore: results.reduce((sum, r) => sum + r.obtainedMarks, 0) / (results.length || 1),
        highestScore: results.length > 0 ? Math.max(...results.map(r => r.obtainedMarks)) : 0,
        lowestScore: results.length > 0 ? Math.min(...results.map(r => r.obtainedMarks)) : 0,
        gradeDistribution: {
          'A+': results.filter(r => r.grade === 'A+').length,
          'A': results.filter(r => r.grade === 'A').length,
          'B+': results.filter(r => r.grade === 'B+').length,
          'B': results.filter(r => r.grade === 'B').length,
          'C': results.filter(r => r.grade === 'C').length,
          'D': results.filter(r => r.grade === 'D').length,
          'F': results.filter(r => r.grade === 'F').length
        }
      };

      res.json({
        results,
        stats,
        isPublished: exam.isResultPublished
      });
    } catch (error) {
      console.error('Get exam results error:', error);
      res.status(500).json({ message: 'Failed to get results' });
    }
  }
);

// Publish results
router.put('/:examId/publish',
  authMiddleware,
  roleMiddleware('teacher'),
  validate([
    param('examId').isMongoId().withMessage('Invalid exam ID')
  ]),
  async (req, res) => {
    try {
      const exam = await Exam.findById(req.params.examId);
      if (!exam) {
        return res.status(404).json({ message: 'Exam not found' });
      }

      if (exam.createdBy.toString() !== req.userId.toString()) {
        return res.status(403).json({ message: 'Access denied' });
      }

      // Check if exam end time has passed
      const now = new Date();
      const endDateTime = new Date(exam.date);
      const [endHours, endMinutes] = exam.endTime.split(':');
      endDateTime.setHours(parseInt(endHours), parseInt(endMinutes), 0, 0);
      
      if (now < endDateTime) {
        return res.status(400).json({ message: 'Cannot publish results before the exam has ended.' });
      }

      exam.isResultPublished = true;
      await exam.save();

      // Notify all students who took the exam
      const results = await Result.find({ 
        examId: exam._id
      });

      const notifications = results.map(result => ({
        userId: result.studentId,
        type: 'result_published',
        title: 'Results Published',
        message: `Results for "${exam.title}" have been published`,
        data: { examId: exam._id, resultId: result._id }
      }));

      if (notifications.length > 0) {
        await Notification.insertMany(notifications);
      }
      
      // Notify Admins
      try {
        const admins = await User.find({ role: 'admin' });
        if (admins.length > 0) {
          const adminNotifs = admins.map(admin => ({
            userId: admin._id,
            type: 'result_published',
            title: 'Exam Results Published',
            message: `Results for "${exam.title}" have been published.`,
            data: { examId: exam._id }
          }));
          await Notification.insertMany(adminNotifs);
        }
      } catch (notifErr) {
        console.error('Error sending admin notification on result publish:', notifErr);
      }

      res.json({
        message: 'Results published successfully',
        isPublished: true
      });
    } catch (error) {
      console.error('Publish results error:', error);
      res.status(500).json({ message: 'Failed to publish results' });
    }
  }
);

// Get student leaderboard (top scores globally or for a specific classGroup)
router.get('/leaderboard', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    const classGroup = user?.classGroup || 'General';

    // Find all results, populate student info, filter by classGroup and passing score
    const allResults = await Result.find({ status: { $in: ['submitted', 'checked', 'published'] } })
      .populate({
        path: 'studentId',
        select: 'name profileImage classGroup',
        match: { classGroup: { $in: [classGroup, 'General'] } }
      })
      .populate({
        path: 'examId',
        select: 'title subject'
      });

    // Filter out results where studentId is null (meaning they didn't match the classGroup)
    const validResults = allResults.filter(r => r.studentId != null);

    // Group by student to get their average score or total score
    const studentStats = {};
    validResults.forEach(r => {
      const sId = r.studentId._id.toString();
      if (!studentStats[sId]) {
        studentStats[sId] = {
          studentId: r.studentId,
          totalScore: 0,
          examsTaken: 0
        };
      }
      studentStats[sId].totalScore += r.percentage;
      studentStats[sId].examsTaken += 1;
    });

    // Calculate averages and format array
    const leaderboard = Object.values(studentStats).map(stat => ({
      ...stat,
      averageScore: stat.totalScore / stat.examsTaken
    }));

    // Sort descending by average score
    leaderboard.sort((a, b) => b.averageScore - a.averageScore);

    res.json({ leaderboard: leaderboard.slice(0, 10) }); // Top 10
  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({ message: 'Failed to fetch leaderboard' });
  }
});

// Get toppers for published exams
router.get('/toppers', authMiddleware, async (req, res) => {
  try {
    let query = { isResultPublished: true };
    if (req.user.role === 'teacher') {
      query.createdBy = req.user.id;
    } else if (req.user.role === 'admin') {
      // Admins see all
    } else {
      const userClass = req.user.classGroup || 'General';
      if (userClass !== 'General') {
        query.$or = [
          { classGroup: { $regex: new RegExp(userClass, 'i') } },
          { classGroup: 'General' },
          { classGroup: { $exists: false } }
        ];
      } else {
        query.$or = [{ classGroup: 'General' }, { classGroup: { $exists: false } }];
      }
    }

    // Find published exams
    const exams = await Exam.find(query).select('title date');

    const examIds = exams.map(e => e._id);
    
    // For each exam, find the highest result
    const toppers = [];
    for (const exam of exams) {
      const topResult = await Result.findOne({ examId: exam._id, status: { $ne: 'pending' }, isPassed: true })
        .sort('-percentage')
        .populate('studentId', 'name profileImage')
        .select('studentId percentage likes');
      
      if (topResult && topResult.studentId) {
        toppers.push({
          examId: exam._id,
          examTitle: exam.title,
          examDate: exam.date,
          resultId: topResult._id,
          student: topResult.studentId,
          score: topResult.percentage,
          likes: topResult.likes || [],
          likedByMe: topResult.likes?.map(id => id.toString()).includes(req.userId?.toString()) || false
        });
      }
    }
    
    // Sort toppers by exam date descending
    toppers.sort((a, b) => new Date(b.examDate) - new Date(a.examDate));

    res.json({ toppers });
  } catch (error) {
    console.error('Get toppers error:', error);
    res.status(500).json({ message: 'Failed to fetch toppers' });
  }
});

// Like/Unlike a topper's result
router.post('/:id/like', authMiddleware, async (req, res) => {
  try {
    const resultId = req.params.id;
    const result = await Result.findById(resultId);
    if (!result) return res.status(404).json({ message: 'Result not found' });

    const userId = req.userId.toString();
    const likeIndex = result.likes.findIndex(id => id.toString() === userId);
    
    if (likeIndex === -1) {
      // Like
      result.likes.push(userId);
    } else {
      // Unlike
      result.likes.splice(likeIndex, 1);
    }
    
    await result.save();
    
    res.json({ 
      message: likeIndex === -1 ? 'Liked' : 'Unliked',
      likes: result.likes,
      likedByMe: likeIndex === -1
    });
  } catch (error) {
    console.error('Like error:', error);
    res.status(500).json({ message: 'Failed to toggle like' });
  }
});

module.exports = router;