const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth.middleware');
const User = require('../models/User.model');
const Exam = require('../models/Exam.model');
const Result = require('../models/Result.model');
const Notification = require('../models/Notification.model');

// Dashboard statistics
router.get('/dashboard-stats',
  authMiddleware,
  roleMiddleware('admin'),
  async (req, res) => {
    try {
      const currentYear = new Date().getFullYear();
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);

      const [
        totalUsers,
        totalTeachers,
        totalStudents,
        totalExams,
        activeExams,
        completedExams,
        totalResults,
        totalPassed,
        totalFailed,
        recentExams,
        recentResults,
        examStats,
        monthlyExams,
        monthlyResults,
        activeUsers
      ] = await Promise.all([
        User.countDocuments(),
        User.countDocuments({ role: 'teacher' }),
        User.countDocuments({ role: 'student' }),
        Exam.countDocuments(),
        Exam.countDocuments({ status: 'ongoing' }),
        Exam.countDocuments({ status: 'completed' }),
        Result.countDocuments({ status: 'submitted' }),
        Result.countDocuments({ status: 'submitted', isPassed: true }),
        Result.countDocuments({ status: 'submitted', isPassed: false }),
        Exam.find()
          .sort({ createdAt: -1 })
          .limit(5)
          .populate('createdBy', 'name')
          .lean(),
        Result.find()
          .sort({ createdAt: -1 })
          .limit(5)
          .populate('studentId', 'name')
          .populate('examId', 'title')
          .lean(),
        Exam.aggregate([
          {
            $group: {
              _id: '$subject',
              count: { $sum: 1 },
              totalStudents: { $sum: '$totalStudents' },
              averageScore: { $avg: '$averageScore' }
            }
          }
        ]),
        Exam.aggregate([
          {
            $match: {
              createdAt: {
                $gte: new Date(`${currentYear}-01-01`),
                $lt: new Date(`${currentYear + 1}-01-01`)
              }
            }
          },
          { $group: { _id: { $month: "$createdAt" }, count: { $sum: 1 } } }
        ]),
        Result.aggregate([
          {
            $match: {
              createdAt: {
                $gte: new Date(`${currentYear}-01-01`),
                $lt: new Date(`${currentYear + 1}-01-01`)
              },
              status: 'submitted'
            }
          },
          { $group: { _id: { $month: "$createdAt" }, count: { $sum: 1 }, passed: { $sum: { $cond: ["$isPassed", 1, 0] } } } }
        ]),
        User.countDocuments({ lastLogin: { $gte: oneDayAgo } })
      ]);

      const memoryUsage = Math.round((process.memoryUsage().heapUsed / process.memoryUsage().heapTotal) * 100);

      res.json({
        stats: {
          totalUsers,
          totalTeachers,
          totalStudents,
          totalExams,
          activeExams,
          completedExams,
          totalResults,
          totalPassed,
          totalFailed
        },
        recentExams,
        recentResults,
        examStats,
        monthlyExams,
        monthlyResults,
        memoryUsage,
        activeUsers
      });
    } catch (error) {
      console.error('Admin dashboard stats error:', error);
      res.status(500).json({ message: 'Failed to get dashboard statistics' });
    }
  }
);

// Get all users with filters
router.get('/users',
  authMiddleware,
  roleMiddleware('admin'),
  async (req, res) => {
    try {
      const { role, page = 1, limit = 10, search } = req.query;
      const query = {};

      if (role) query.role = role;
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } }
        ];
      }

      const [users, total] = await Promise.all([
        User.find(query)
          .select('-password -refreshToken -resetPasswordToken -resetPasswordExpire')
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(parseInt(limit))
          .lean(),
        User.countDocuments(query)
      ]);

      res.json({
        users,
        total,
        page: parseInt(page),
        totalPages: Math.ceil(total / limit)
      });
    } catch (error) {
      console.error('Get users error:', error);
      res.status(500).json({ message: 'Failed to get users' });
    }
  }
);

// Manage user status
router.put('/users/:userId/status',
  authMiddleware,
  roleMiddleware('admin'),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { isActive } = req.body;

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      if (user.role === 'admin') {
        return res.status(403).json({ message: 'Cannot modify admin status' });
      }

      user.isActive = isActive;
      await user.save();

      res.json({
        message: `User ${isActive ? 'activated' : 'deactivated'} successfully`,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          isActive: user.isActive
        }
      });
    } catch (error) {
      console.error('Update user status error:', error);
      res.status(500).json({ message: 'Failed to update user status' });
    }
  }
);

// Delete user permanently
router.delete('/users/:userId',
  authMiddleware,
  roleMiddleware('admin'),
  async (req, res) => {
    try {
      const { userId } = req.params;
      
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      if (user.role === 'admin' || userId === req.user._id.toString()) {
        return res.status(403).json({ message: 'Cannot delete admin account or your own account' });
      }
      
      // Delete user's results
      await Result.deleteMany({ studentId: userId });
      
      // Delete user's exams (if teacher)
      await Exam.deleteMany({ createdBy: userId });
      
      // Delete user
      await User.findByIdAndDelete(userId);
      
      res.json({ message: 'User deleted successfully' });
    } catch (error) {
      console.error('Delete user error:', error);
      res.status(500).json({ message: 'Failed to delete user' });
    }
  }
);

// Get all exams with filters
router.get('/exams',
  authMiddleware,
  roleMiddleware('admin'),
  async (req, res) => {
    try {
      const { status, page = 1, limit = 10 } = req.query;
      const query = {};

      if (status) query.status = status;

      const [exams, total] = await Promise.all([
        Exam.find(query)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(parseInt(limit))
          .populate('createdBy', 'name email')
          .lean(),
        Exam.countDocuments(query)
      ]);

      res.json({
        exams,
        total,
        page: parseInt(page),
        totalPages: Math.ceil(total / limit)
      });
    } catch (error) {
      console.error('Get exams error:', error);
      res.status(500).json({ message: 'Failed to get exams' });
    }
  }
);

// Get system logs
router.get('/logs',
  authMiddleware,
  roleMiddleware('admin'),
  async (req, res) => {
    try {
      const { page = 1, limit = 20 } = req.query;
      
      // This would typically come from a Log model
      // For now, return sample data
      res.json({
        logs: [],
        message: 'Logs feature coming soon'
      });
    } catch (error) {
      console.error('Get logs error:', error);
      res.status(500).json({ message: 'Failed to get logs' });
    }
  }
);

module.exports = router;