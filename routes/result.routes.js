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
      if (totalMarks > 0 && (!exam.maxMarks || exam.maxMarks === 100)) {
        exam.maxMarks = totalMarks;
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
      sendPushNotification([exam.createdBy], 'Exam Submitted', `Student ${req.user.name} has submitted the exam "${exam.title}"`, { examId: exam._id, studentId: req.userId }, req.app.get('io'));

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
        status: 'submitted'
      })
      .populate('examId', 'title subject date startTime endTime duration maxMarks isResultPublished')
      .populate('answers.questionId', 'question options correctAnswer marks')
      .sort({ submittedAt: -1 })
      .lean();

      const publishedExamIds = [...new Set(results.filter(r => r.examId && r.examId.isResultPublished).map(r => r.examId._id || r.examId))];
      
      let ranksByExam = {};
      if (publishedExamIds.length > 0) {
        const allPublishedResults = await Result.find({
          examId: { $in: publishedExamIds },
          status: 'submitted'
        })
        .select('examId studentId obtainedMarks')
        .sort({ obtainedMarks: -1 })
        .lean();

        for (const examId of publishedExamIds) {
          const examResults = allPublishedResults.filter(r => r.examId.toString() === examId.toString());
          ranksByExam[examId.toString()] = examResults;
        }
      }

      const resultsWithPublishStatus = results.map((result) => {
        const isPublished = Boolean(result.examId && result.examId.isResultPublished);
        let rank = null;
        
        if (isPublished && result.examId) {
          const examIdStr = (result.examId._id || result.examId).toString();
          const examResults = ranksByExam[examIdStr] || [];
          const idx = examResults.findIndex(r => r.studentId.toString() === result.studentId.toString());
          if (idx !== -1) rank = idx + 1;
        }
        
        return {
          ...result,
          isPublished,
          rank
        };
      });

      res.json({ results: resultsWithPublishStatus });
    } catch (error) {
      console.error('Get student results error:', error);
      res.status(500).json({ message: 'Failed to get results' });
    }
  }
);

// Get specific student results (for Teacher/Admin)
router.get('/student/:studentId',
  authMiddleware,
  roleMiddleware('teacher', 'admin'),
  async (req, res) => {
    try {
      const results = await Result.find({ 
        studentId: req.params.studentId,
        status: 'published' 
      })
        .populate('examId', 'title subject maxMarks passingMarks')
        .sort({ createdAt: -1 })
        .lean();

      const formattedResults = results.map(result => {
        let obtained = result.obtainedMarks || 0;
        let total = result.totalMarks || 1;
        return {
          ...result,
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
      const [exam, results] = await Promise.all([
        Exam.findById(req.params.examId).lean(),
        Result.find({ 
          examId: req.params.examId
        })
        .populate('studentId', 'name email profileImage department')
        .sort({ obtainedMarks: -1 })
        .lean()
      ]);
      if (!exam) {
        return res.status(404).json({ message: 'Exam not found' });
      }

      if (exam.createdBy.toString() !== req.userId.toString() && req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Access denied' });
      }

      // Calculate statistics
      const stats = {
        totalStudents: results.length,
        passed: results.filter(r => r.isPassed).length,
        failed: results.filter(r => !r.isPassed).length,
        averageScore: results.reduce((sum, r) => sum + r.obtainedMarks, 0) / (results.length || 1),
        highestScore: results.length > 0 ? Math.max(...results.map(r => r.obtainedMarks)) : 0,
        lowestScore: results.length > 0 ? Math.min(...results.map(r => r.obtainedMarks)) : 0,
        averageCorrect: results.reduce((sum, r) => sum + (r.correctAnswers || 0), 0) / (results.length || 1),
        averageWrong: results.reduce((sum, r) => sum + (r.wrongAnswers || 0), 0) / (results.length || 1),
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

      // Determine missing students
      const classQuery = { role: 'student', isActive: true };
      if (exam.classGroup && exam.classGroup !== 'General') {
        classQuery.classGroup = exam.classGroup;
      }
      
      const assignedStudents = await User.find(classQuery).select('name email profileImage').lean();
      
      const missingStudents = assignedStudents.filter(student => 
        !results.some(r => r.studentId && r.studentId._id.toString() === student._id.toString())
      );

      res.json({
        results,
        stats,
        missingStudents,
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
    const [user, allResults] = await Promise.all([
      User.findById(req.userId).select('classGroup').lean(),
      Result.find({ status: { $in: ['submitted', 'published'] } })
        .select('studentId percentage')
        .lean()
    ]);
    const classGroup = user?.classGroup || 'General';

    // Group by studentId in memory
    const studentStats = {};
    allResults.forEach(r => {
      if (!r.studentId) return;
      const sId = r.studentId.toString();
      if (!studentStats[sId]) {
        studentStats[sId] = {
          studentId: sId,
          totalScore: 0,
          examsTaken: 0
        };
      }
      studentStats[sId].totalScore += r.percentage || 0;
      studentStats[sId].examsTaken += 1;
    });

    const leaderboardList = Object.values(studentStats).map(stat => ({
      ...stat,
      averageScore: stat.totalScore / stat.examsTaken
    }));

    leaderboardList.sort((a, b) => b.averageScore - a.averageScore);
    const top10 = leaderboardList.slice(0, 10);
    const topStudentIds = top10.map(s => s.studentId);

    const users = await User.find({ _id: { $in: topStudentIds } })
      .select('name profileImage classGroup')
      .lean();

    const userMap = {};
    users.forEach(u => {
      userMap[u._id.toString()] = u;
    });

    const filteredLeaderboard = top10
      .map(item => {
        const studentObj = userMap[item.studentId];
        if (!studentObj) return null;
        const sClass = studentObj.classGroup || 'General';
        if (classGroup !== 'General' && sClass !== classGroup && sClass !== 'General') {
          return null;
        }
        return {
          ...item,
          studentId: studentObj
        };
      })
      .filter(Boolean);

    res.json({ leaderboard: filteredLeaderboard });
  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({ message: 'Failed to fetch leaderboard' });
  }
});

// Get toppers for published exams
router.get('/toppers', authMiddleware, async (req, res) => {
  try {
    let examIds = [];
    let exams = [];

    if (req.user.role === 'teacher') {
      const query = { status: { $in: ['published', 'ongoing', 'completed'] }, createdBy: req.user._id || req.user.id };
      exams = await Exam.find(query).select('title date').sort({ createdAt: -1 }).limit(10).lean();
      examIds = exams.map(e => e._id);
    } else if (req.user.role === 'admin') {
      const query = { status: { $in: ['published', 'ongoing', 'completed'] } };
      exams = await Exam.find(query).select('title date').sort({ createdAt: -1 }).limit(10).lean();
      examIds = exams.map(e => e._id);
    } else {
      // For students, fetch the 10 most recent exams they are eligible for, EXACTLY like their Dashboard exam list.
      const query = { status: { $in: ['published', 'ongoing', 'completed'] } };
      const userClass = req.user.classGroup || 'General';
      if (userClass !== 'General') {
        query.$or = [
          { classGroup: { $regex: new RegExp(userClass, 'i') } },
          { classGroup: { $regex: new RegExp('General', 'i') } },
          { classGroup: { $exists: false } }
        ];
      }
      
      exams = await Exam.find(query).select('title date').sort({ createdAt: -1 }).limit(10).lean();
      examIds = exams.map(e => e._id);
    }

    if (examIds.length === 0) {
      return res.json({ toppers: [] });
    }
    
    // Batch query highest results for these exams at once
    const candidateResults = await Result.find({
      examId: { $in: examIds },
      isPassed: true
    })
      .sort({ percentage: -1, obtainedMarks: -1 })
      .populate('studentId', 'name profileImage classGroup department email college')
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
      if (topResult && topResult.studentId) {
        const studentObj = {
          _id: topResult.studentId._id || topResult.studentId,
          name: topResult.studentId.name || 'Unknown',
          profileImage: topResult.studentId.profileImage || null
        };
        
        return {
          examId: exam._id,
          examTitle: exam.title,
          examDate: exam.date,
          resultId: topResult._id,
          student: studentObj,
          score: topResult.percentage,
          likes: topResult.likes || [],
          likedByMe: topResult.likes?.map(id => id.toString()).includes(req.userId?.toString()) || false
        };
      }
      return null;
    });

    const toppers = toppersResults.filter(Boolean);
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