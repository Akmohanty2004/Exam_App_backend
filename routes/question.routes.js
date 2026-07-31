const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const { authMiddleware, roleMiddleware } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');
const Question = require('../models/Question.model');
const Exam = require('../models/Exam.model');

// Add question to exam
router.post('/add',
  authMiddleware,
  roleMiddleware('teacher'),
  validate([
    body('examId').isMongoId().withMessage('Invalid exam ID'),
    body('type').isIn(['mcq', 'truefalse', 'fillblank', 'multiple', 'text']).withMessage('Invalid question type'),
    body('question').notEmpty().withMessage('Question is required'),
    body('marks').isInt({ min: 1 }).withMessage('Marks must be at least 1'),
    body('options').isArray().withMessage('Options must be an array'),
    body('correctAnswer').notEmpty().withMessage('Correct answer is required')
  ]),
  async (req, res) => {
    try {
      const { examId, ...questionData } = req.body;

      // Check if exam exists and belongs to teacher
      const exam = await Exam.findById(examId);
      if (!exam) {
        return res.status(404).json({ message: 'Exam not found' });
      }

      if (exam.createdBy.toString() !== req.userId.toString()) {
        return res.status(403).json({ message: 'Access denied' });
      }

      if (exam.status === 'ongoing' || exam.status === 'completed') {
        return res.status(400).json({ message: 'Cannot modify exam that is ongoing or completed' });
      }

      // Get count of existing questions for order
      const count = await Question.countDocuments({ examId });
      questionData.examId = examId;
      questionData.order = count;

      const question = new Question(questionData);
      await question.save();

      // Update exam total questions
      exam.totalQuestions = await Question.countDocuments({ examId, isActive: true });
      await exam.save();

      res.status(201).json({
        message: 'Question added successfully',
        question
      });
    } catch (error) {
      console.error('Add question error:', error);
      res.status(500).json({ message: 'Failed to add question' });
    }
  }
);

// Add multiple questions
router.post('/add-multiple',
  authMiddleware,
  roleMiddleware('teacher'),
  validate([
    body('examId').isMongoId().withMessage('Invalid exam ID'),
    body('questions').isArray({ min: 1 }).withMessage('At least one question is required')
  ]),
  async (req, res) => {
    try {
      const { examId, questions } = req.body;

      const exam = await Exam.findById(examId);
      if (!exam) {
        return res.status(404).json({ message: 'Exam not found' });
      }

      if (exam.createdBy.toString() !== req.userId.toString()) {
        return res.status(403).json({ message: 'Access denied' });
      }

      if (exam.status === 'ongoing' || exam.status === 'completed') {
        return res.status(400).json({ message: 'Cannot modify exam that is ongoing or completed' });
      }

      const questionsWithExamId = questions.map((q, index) => ({
        ...q,
        examId,
        order: index
      }));

      const savedQuestions = await Question.insertMany(questionsWithExamId);

      // Update exam total questions
      exam.totalQuestions = await Question.countDocuments({ examId, isActive: true });
      await exam.save();

      res.status(201).json({
        message: `${savedQuestions.length} questions added successfully`,
        questions: savedQuestions
      });
    } catch (error) {
      console.error('Add multiple questions error:', error);
      res.status(500).json({ message: 'Failed to add questions' });
    }
  }
);

// Get questions for exam
router.get('/exam/:examId',
  authMiddleware,
  validate([
    param('examId').isMongoId().withMessage('Invalid exam ID')
  ]),
  async (req, res) => {
    try {
      const exam = await Exam.findById(req.params.examId);
      if (!exam) {
        return res.status(404).json({ message: 'Exam not found' });
      }

      // Check permissions
      if (req.user.role === 'teacher' && exam.createdBy.toString() !== req.userId.toString()) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const questions = await Question.find({ 
        examId: req.params.examId,
        isActive: true 
      }).sort({ order: 1 }).lean();

      res.json({ questions });
    } catch (error) {
      console.error('Get questions error:', error);
      res.status(500).json({ message: 'Failed to get questions' });
    }
  }
);

// Update question
router.put('/:questionId',
  authMiddleware,
  roleMiddleware('teacher'),
  validate([
    param('questionId').isMongoId().withMessage('Invalid question ID')
  ]),
  async (req, res) => {
    try {
      const question = await Question.findById(req.params.questionId);
      if (!question) {
        return res.status(404).json({ message: 'Question not found' });
      }

      const exam = await Exam.findById(question.examId);
      if (exam.createdBy.toString() !== req.userId.toString()) {
        return res.status(403).json({ message: 'Access denied' });
      }

      if (exam.status === 'ongoing' || exam.status === 'completed') {
        return res.status(400).json({ message: 'Cannot modify exam that is ongoing or completed' });
      }

      const updatedQuestion = await Question.findByIdAndUpdate(
        req.params.questionId,
        req.body,
        { new: true, runValidators: true }
      );

      res.json({
        message: 'Question updated successfully',
        question: updatedQuestion
      });
    } catch (error) {
      console.error('Update question error:', error);
      res.status(500).json({ message: 'Failed to update question' });
    }
  }
);

// Delete question
router.delete('/:questionId',
  authMiddleware,
  roleMiddleware('teacher'),
  validate([
    param('questionId').isMongoId().withMessage('Invalid question ID')
  ]),
  async (req, res) => {
    try {
      const question = await Question.findById(req.params.questionId);
      if (!question) {
        return res.status(404).json({ message: 'Question not found' });
      }

      const exam = await Exam.findById(question.examId);
      if (exam.createdBy.toString() !== req.userId.toString()) {
        return res.status(403).json({ message: 'Access denied' });
      }

      if (exam.status === 'ongoing' || exam.status === 'completed') {
        return res.status(400).json({ message: 'Cannot modify exam that is ongoing or completed' });
      }

      question.isActive = false;
      await question.save();

      // Update exam total questions
      exam.totalQuestions = await Question.countDocuments({ 
        examId: exam._id, 
        isActive: true 
      });
      await exam.save();

      res.json({ message: 'Question deleted successfully' });
    } catch (error) {
      console.error('Delete question error:', error);
      res.status(500).json({ message: 'Failed to delete question' });
    }
  }
);

module.exports = router;