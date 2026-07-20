const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const { authMiddleware, roleMiddleware } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');
const Exam = require('../models/Exam.model');
const Question = require('../models/Question.model');
const Result = require('../models/Result.model');
const User = require('../models/User.model');
const Notification = require('../models/Notification.model');

// ==================== CREATE EXAM ====================
router.post('/create',
  authMiddleware,
  roleMiddleware('teacher'),
  validate([
    body('title').notEmpty().withMessage('Title is required'),
    body('subject').notEmpty().withMessage('Subject is required'),
    body('password').notEmpty().withMessage('Password is required'),
    body('date').isISO8601().withMessage('Invalid date'),
    body('startTime').notEmpty().withMessage('Start time is required'),
    body('endTime').notEmpty().withMessage('End time is required'),
    body('duration').isInt({ min: 1 }).withMessage('Duration must be at least 1 minute'),
    body('questions').isArray().withMessage('Questions must be an array')
  ]),
  async (req, res) => {
    try {
      const { questions, ...examData } = req.body;
      const classGroup = examData.classGroup || 'General';
      
      // Create exam
      const exam = new Exam({
        ...examData,
        classGroup,
        createdBy: req.userId,
        status: 'published',
        totalQuestions: questions.length
      });
      
      await exam.save();
      
      // Save questions
      const questionDocs = questions.map((q, index) => ({
        ...q,
        examId: exam._id,
        order: index
      }));
      
      try {
        await Question.insertMany(questionDocs);
      } catch (insertError) {
        await Exam.findByIdAndDelete(exam._id);
        throw insertError;
      }
      
      // Create notification for students
      const queryParams = { role: 'student', isActive: true };
      if (classGroup !== 'General') {
        queryParams.classGroup = classGroup;
      }
      const students = await User.find(queryParams);
      const notifications = students.map(student => ({
        userId: student._id,
        type: 'exam_created',
        title: 'New Exam Available',
        message: `New exam "${exam.title}" has been created`,
        data: { examId: exam._id }
      }));
      
      if (notifications.length > 0) {
        await Notification.insertMany(notifications);
      }
      
      // Notify Admins about new exam
      try {
        const admins = await User.find({ role: 'admin' });
        if (admins.length > 0) {
          const adminNotifs = admins.map(admin => ({
            userId: admin._id,
            type: 'exam_created',
            title: 'New Exam Created',
            message: `A new exam "${exam.title}" has been created.`,
            data: { examId: exam._id }
          }));
          await Notification.insertMany(adminNotifs);
        }
      } catch (notifErr) {
        console.error('Error sending admin notification on exam creation:', notifErr);
      }
      
      res.status(201).json({
        message: 'Exam created successfully',
        exam,
        questions: questionDocs
      });
    } catch (error) {
      console.error('Create exam error:', error);
      res.status(500).json({ message: 'Failed to create exam' });
    }
  }
);

// ==================== GET TEACHER EXAMS ====================
router.get('/teacher-exams',
  authMiddleware,
  roleMiddleware('teacher'),
  async (req, res) => {
    try {
      const { status, page = 1, limit = 10 } = req.query;
      const query = { createdBy: req.userId };
      
      if (status) query.status = status;
      
      const skip = (parseInt(page) - 1) * parseInt(limit);
      
      let exams = await Exam.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate('createdBy', 'name email');
        
      const now = new Date();
      for (let exam of exams) {
        if (exam.status === 'published' || exam.status === 'ongoing') {
          const examDate = new Date(exam.date);
          const [startHours, startMinutes] = exam.startTime.split(':');
          examDate.setHours(parseInt(startHours), parseInt(startMinutes), 0, 0);
          
          const endDateTime = new Date(exam.date);
          const [endHours, endMinutes] = exam.endTime.split(':');
          endDateTime.setHours(parseInt(endHours), parseInt(endMinutes), 0, 0);

          let newStatus = exam.status;
          if (now > endDateTime) {
            newStatus = 'completed';
          } else if (now >= examDate && now <= endDateTime) {
            newStatus = 'ongoing';
          }

          if (newStatus !== exam.status) {
            exam.status = newStatus;
            await exam.save();
          }
        }
      }
      
      const total = await Exam.countDocuments(query);
      
      // Fetch question counts
      const Question = require('../models/Question.model');
      const examsWithCounts = await Promise.all(exams.map(async (exam) => {
        const doc = exam.toObject ? exam.toObject() : exam;
        doc.totalQuestions = await Question.countDocuments({ examId: exam._id, isActive: true });
        return doc;
      }));
      
      res.json({
        exams: examsWithCounts,
        total,
        page: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit))
      });
    } catch (error) {
      console.error('Get teacher exams error:', error);
      res.status(500).json({ message: 'Failed to get exams' });
    }
  }
);

// ==================== GET EXAM BY ID ====================
router.get('/:examId',
  authMiddleware,
  validate([
    param('examId').isMongoId().withMessage('Invalid exam ID')
  ]),
  async (req, res) => {
    try {
      const exam = await Exam.findById(req.params.examId)
        .populate('createdBy', 'name email');
      
      if (!exam) {
        return res.status(404).json({ message: 'Exam not found' });
      }
      
      // Dynamic status update
      const now = new Date();
      if (exam.status === 'published' || exam.status === 'ongoing') {
        const examDate = new Date(exam.date);
        const [startHours, startMinutes] = exam.startTime.split(':');
        examDate.setHours(parseInt(startHours), parseInt(startMinutes), 0, 0);
        
        const endDateTime = new Date(exam.date);
        const [endHours, endMinutes] = exam.endTime.split(':');
        endDateTime.setHours(parseInt(endHours), parseInt(endMinutes), 0, 0);

        let newStatus = exam.status;
        if (now > endDateTime) {
          newStatus = 'completed';
        } else if (now >= examDate && now <= endDateTime) {
          newStatus = 'ongoing';
        }

        if (newStatus !== exam.status) {
          exam.status = newStatus;
          await exam.save();
        }
      }
      
      // Check permissions
      if (req.user.role === 'teacher' && exam.createdBy._id.toString() !== req.userId.toString()) {
        return res.status(403).json({ message: 'Access denied' });
      }
      
      // Get questions for this exam
      const questions = await Question.find({ 
        examId: exam._id, 
        isActive: true 
      }).sort({ order: 1 });
      
      const examDoc = exam.toObject ? exam.toObject() : exam;
      examDoc.totalQuestions = questions.length;
      
      res.json({
        exam: examDoc,
        questions
      });
    } catch (error) {
      console.error('Get exam error:', error);
      res.status(500).json({ message: 'Failed to get exam' });
    }
  }
);

// ==================== UPDATE EXAM ====================
router.put('/:examId',
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
      
      if (exam.status === 'ongoing' || exam.status === 'completed') {
        return res.status(400).json({ message: 'Cannot update exam that is ongoing or completed' });
      }
      
      const { questions, ...examData } = req.body;
      
      // Update exam
      const updatedExam = await Exam.findByIdAndUpdate(
        req.params.examId,
        examData,
        { new: true, runValidators: true }
      );
      
      // Update questions if provided
      if (questions && questions.length > 0) {
        // Remove old questions
        await Question.deleteMany({ examId: exam._id });
        
        // Add new questions
        const questionDocs = questions.map((q, index) => ({
          ...q,
          examId: exam._id,
          order: index
        }));
        
        await Question.insertMany(questionDocs);
        
        updatedExam.totalQuestions = questions.length;
        await updatedExam.save();
      }
      
      res.json({
        message: 'Exam updated successfully',
        exam: updatedExam
      });
    } catch (error) {
      console.error('Update exam error:', error);
      res.status(500).json({ message: 'Failed to update exam' });
    }
  }
);

// ==================== DELETE EXAM ====================
router.delete('/:examId',
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
      
      if (exam.status === 'ongoing') {
        return res.status(400).json({ message: 'Cannot delete ongoing exam' });
      }
      
      // Delete all questions and results
      await Question.deleteMany({ examId: exam._id });
      await Result.deleteMany({ examId: exam._id });
      await exam.deleteOne();
      
      res.json({ message: 'Exam deleted successfully' });
    } catch (error) {
      console.error('Delete exam error:', error);
      res.status(500).json({ message: 'Failed to delete exam' });
    }
  }
);

// ==================== PUBLISH EXAM ====================
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
      
      const questions = await Question.find({ examId: exam._id, isActive: true });
      if (questions.length === 0) {
        return res.status(400).json({ message: 'Cannot publish exam without questions' });
      }
      
      exam.status = 'published';
      exam.totalQuestions = questions.length;
      await exam.save();
      
      // Notify students
      const students = await User.find({ role: 'student', isActive: true });
      const notifications = students.map(student => ({
        userId: student._id,
        type: 'exam_published',
        title: 'Exam Published',
        message: `Exam "${exam.title}" is now available for you`,
        data: { examId: exam._id }
      }));
      
      if (notifications.length > 0) {
        await Notification.insertMany(notifications);
      }
      
      res.json({
        message: 'Exam published successfully',
        exam
      });
    } catch (error) {
      console.error('Publish exam error:', error);
      res.status(500).json({ message: 'Failed to publish exam' });
    }
  }
);

// ==================== START EXAM (Mark as Ongoing) ====================
router.put('/:examId/start',
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
      
      if (exam.status !== 'published') {
        return res.status(400).json({ message: 'Exam must be published first' });
      }
      
      exam.status = 'ongoing';
      await exam.save();
      
      // Notify students
      const students = await User.find({ role: 'student', isActive: true });
      const notifications = students.map(student => ({
        userId: student._id,
        type: 'exam_starting',
        title: 'Exam Started',
        message: `Exam "${exam.title}" has started`,
        data: { examId: exam._id }
      }));
      
      if (notifications.length > 0) {
        await Notification.insertMany(notifications);
      }
      
      res.json({
        message: 'Exam started successfully',
        exam
      });
    } catch (error) {
      console.error('Start exam error:', error);
      res.status(500).json({ message: 'Failed to start exam' });
    }
  }
);

// ==================== END EXAM (Mark as Completed) ====================
router.put('/:examId/end',
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
      
      if (exam.status !== 'ongoing') {
        return res.status(400).json({ message: 'Exam is not ongoing' });
      }
      
      exam.status = 'completed';
      await exam.save();
      
      res.json({
        message: 'Exam ended successfully',
        exam
      });
    } catch (error) {
      console.error('End exam error:', error);
      res.status(500).json({ message: 'Failed to end exam' });
    }
  }
);

// ==================== PUBLISH EXAM RESULTS ====================
router.put('/:examId/publish-results',
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
      
      // Notify students
      const results = await Result.find({ examId: exam._id, status: 'submitted' });
      const notifications = results.map(result => ({
        userId: result.studentId,
        type: 'result_published',
        title: 'Exam Results Published',
        message: `Results for "${exam.title}" have been published by the teacher.`,
        data: { examId: exam._id }
      }));
      
      if (notifications.length > 0) {
        await Notification.insertMany(notifications);
      }
      
      res.json({
        message: 'Exam results published successfully',
        exam
      });
    } catch (error) {
      console.error('Publish results error:', error);
      res.status(500).json({ message: 'Failed to publish results' });
    }
  }
);
router.get('/student/exams',
  authMiddleware,
  roleMiddleware('student'),
  async (req, res) => {
    try {
      const user = await User.findById(req.userId);
      const studentClassGroup = user?.classGroup || 'General';
      const now = new Date();
      
      let filterQuery = { status: { $in: ['published', 'ongoing', 'completed'] } };
      
      // If student is NOT in 'General' class, they only see their class's exams and exams meant for 'General'
      if (studentClassGroup !== 'General') {
        filterQuery.$or = [
          { classGroup: { $regex: new RegExp(studentClassGroup, 'i') } },
          { classGroup: { $regex: new RegExp('General', 'i') } },
          { classGroup: { $exists: false } }
        ];
      }
      
      // Get exams
      const exams = await Exam.find(filterQuery)
      .sort({ date: 1, startTime: 1 })
      .populate('createdBy', 'name email');
      
      // Get student results to check which exams are taken
      const studentResults = await Result.find({
        studentId: req.userId,
        examId: { $in: exams.map(e => e._id) }
      });
      
      const examIdsTaken = studentResults.map(r => r.examId.toString());
      
      // Add status to each exam
      const examsWithStatus = exams.map(exam => {
        const examObj = exam.toObject();
        const isTaken = examIdsTaken.includes(exam._id.toString());
        const result = studentResults.find(r => r.examId.toString() === exam._id.toString());
        
        // Check if exam is available
        const examDate = new Date(exam.date);
        const [startHours, startMinutes] = exam.startTime.split(':');
        examDate.setHours(parseInt(startHours), parseInt(startMinutes), 0, 0);
        
        const endDateTime = new Date(exam.date);
        const [endHours, endMinutes] = exam.endTime.split(':');
        endDateTime.setHours(parseInt(endHours), parseInt(endMinutes), 0, 0);
        
        const isAvailable = now >= examDate && now <= endDateTime;
        const isUpcoming = now < examDate;
        const isExpired = now > endDateTime;
        
        return {
          ...examObj,
          isTaken,
          isAvailable,
          isUpcoming,
          isExpired,
          result: result || null
        };
      });
      
      res.json({ exams: examsWithStatus });
    } catch (error) {
      console.error('Get student exams error:', error);
      res.status(500).json({ message: 'Failed to get exams' });
    }
  }
);

// ==================== GET EXAM FOR STUDENT (With Questions) ====================
router.get('/:examId/student',
  authMiddleware,
  roleMiddleware('student'),
  validate([
    param('examId').isMongoId().withMessage('Invalid exam ID')
  ]),
  async (req, res) => {
    try {
      const exam = await Exam.findById(req.params.examId)
        .populate('createdBy', 'name email');
      
      if (!exam) {
        return res.status(404).json({ message: 'Exam not found' });
      }
      
      // Check if exam is published or ongoing
      if (exam.status !== 'published' && exam.status !== 'ongoing') {
        return res.status(400).json({ message: 'Exam is not available' });
      }
      
      // Check if student has already taken this exam
      const existingResult = await Result.findOne({
        examId: exam._id,
        studentId: req.userId
      });
      
      if (existingResult && existingResult.status === 'submitted') {
        return res.status(400).json({ message: 'You have already taken this exam' });
      }
      
      // Check if exam is available
      const now = new Date();
      const examDateTime = new Date(exam.date);
      const [startHours, startMinutes] = exam.startTime.split(':');
      examDateTime.setHours(parseInt(startHours), parseInt(startMinutes), 0, 0);
      
      const endDateTime = new Date(exam.date);
      const [endHours, endMinutes] = exam.endTime.split(':');
      endDateTime.setHours(parseInt(endHours), parseInt(endMinutes), 0, 0);
      
      if (now < examDateTime) {
        return res.status(400).json({ 
          message: 'Exam has not started yet',
          startTime: examDateTime
        });
      }
      
      if (now > endDateTime) {
        return res.status(400).json({ 
          message: 'Exam time has ended.',
          endTime: endDateTime
        });
      }
      
      // Enforce late entry limit
      const entryTimeLimit = new Date(examDateTime.getTime() + (exam.entryTime || 15) * 60000);
      if (now > entryTimeLimit) {
        return res.status(400).json({
          message: `Sorry, you are late. You are only allowed to join up to ${exam.entryTime || 15} minutes after the start time.`,
          entryTimeLimit
        });
      }
      
      // Get questions (hide correct answers)
      let questions = await Question.find({ 
        examId: exam._id, 
        isActive: true 
      }).sort({ order: 1 });
      
      // Randomize if enabled
      if (exam.randomQuestions) {
        questions = questions.sort(() => Math.random() - 0.5);
      }
      
      // Hide correct answers
      const questionsWithHiddenAnswers = questions.map(q => {
        const qObj = q.toObject();
        delete qObj.correctAnswer;
        return qObj;
      });
      
      const endTime = new Date(examDateTime.getTime() + exam.duration * 60000);
      
      res.json({
        exam,
        questions: questionsWithHiddenAnswers,
        startTime: examDateTime,
        endTime: endTime,
        totalQuestions: questions.length
      });
    } catch (error) {
      console.error('Get student exam error:', error);
      res.status(500).json({ message: 'Failed to get exam' });
    }
  }
);

// ==================== VERIFY EXAM PASSWORD ====================
router.post('/:examId/verify-password',
  authMiddleware,
  roleMiddleware('student'),
  validate([
    param('examId').isMongoId().withMessage('Invalid exam ID'),
    body('password').notEmpty().withMessage('Password is required')
  ]),
  async (req, res) => {
    try {
      const exam = await Exam.findById(req.params.examId);
      
      if (!exam) {
        return res.status(404).json({ message: 'Exam not found' });
      }
      
      if (exam.password !== req.body.password) {
        return res.status(401).json({ message: 'Incorrect password' });
      }
      
      res.json({ 
        message: 'Password verified successfully',
        valid: true
      });
    } catch (error) {
      console.error('Verify password error:', error);
      res.status(500).json({ message: 'Failed to verify password' });
    }
  }
);

// ==================== GET EXAM STATISTICS (Teacher/Admin) ====================
router.get('/:examId/statistics',
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
      
      // Get all results for this exam
      const results = await Result.find({ 
        examId: exam._id,
        status: 'submitted'
      }).populate('studentId', 'name email');
      
      // Calculate statistics
      const totalStudents = results.length;
      const passed = results.filter(r => r.isPassed).length;
      const failed = totalStudents - passed;
      const scores = results.map(r => r.obtainedMarks || 0);
      const percentages = results.map(r => r.percentage || 0);
      
      const averageScore = scores.length > 0 
        ? scores.reduce((a, b) => a + b, 0) / scores.length 
        : 0;
      
      const averagePercentage = percentages.length > 0 
        ? percentages.reduce((a, b) => a + b, 0) / percentages.length 
        : 0;
      
      const highestScore = scores.length > 0 ? Math.max(...scores) : 0;
      const lowestScore = scores.length > 0 ? Math.min(...scores) : 0;
      
      // Grade distribution
      const gradeDistribution = {
        'A+': results.filter(r => r.grade === 'A+').length,
        'A': results.filter(r => r.grade === 'A').length,
        'B+': results.filter(r => r.grade === 'B+').length,
        'B': results.filter(r => r.grade === 'B').length,
        'C': results.filter(r => r.grade === 'C').length,
        'D': results.filter(r => r.grade === 'D').length,
        'F': results.filter(r => r.grade === 'F').length
      };
      
      res.json({
        exam,
        statistics: {
          totalStudents,
          passed,
          failed,
          passRate: totalStudents > 0 ? (passed / totalStudents) * 100 : 0,
          averageScore,
          averagePercentage,
          highestScore,
          lowestScore,
          gradeDistribution
        },
        results
      });
    } catch (error) {
      console.error('Get exam statistics error:', error);
      res.status(500).json({ message: 'Failed to get statistics' });
    }
  }
);

module.exports = router;
