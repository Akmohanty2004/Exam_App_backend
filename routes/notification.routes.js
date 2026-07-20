const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth.middleware');
const Notification = require('../models/Notification.model');
const User = require('../models/User.model');

// Send custom personal notification (Teacher/Admin only)
router.post('/send',
  authMiddleware,
  roleMiddleware('teacher', 'admin'),
  async (req, res) => {
    try {
      const { email, title, message } = req.body;
      if (!email || !title || !message) {
        return res.status(400).json({ message: 'Email, title, and message are required' });
      }

      if (email.toLowerCase() === 'all') {
        const targetUsers = await User.find({ role: 'student' });
        const notifications = targetUsers.map(u => ({
          userId: u._id,
          title,
          message,
          type: 'personal',
          isRead: false
        }));
        await Notification.insertMany(notifications);
        return res.status(201).json({ message: 'Broadcast notification sent successfully to all students' });
      }

      if (email.toLowerCase().startsWith('class:')) {
        const className = email.split(':')[1].trim();
        // Since class group isn't case-sensitive in query, we can use a regex or just direct match.
        // Assuming exact match since front-end dropdown will provide exact match.
        const targetUsers = await User.find({ role: 'student', classGroup: new RegExp('^' + className + '$', 'i') });
        if (targetUsers.length === 0) {
          return res.status(404).json({ message: `No students found in class ${className}` });
        }
        const notifications = targetUsers.map(u => ({
          userId: u._id,
          title,
          message,
          type: 'personal',
          isRead: false
        }));
        await Notification.insertMany(notifications);
        return res.status(201).json({ message: `Notification sent successfully to ${targetUsers.length} students in class ${className}` });
      }

      const targetUser = await User.findOne({ email: email.toLowerCase() });
      if (!targetUser) {
        return res.status(404).json({ message: 'User not found with this email' });
      }

      const notification = new Notification({
        userId: targetUser._id,
        title,
        message,
        type: 'personal',
        isRead: false
      });

      await notification.save();
      res.status(201).json({ message: 'Notification sent successfully', notification });
    } catch (error) {
      console.error('Send custom notification error:', error);
      res.status(500).json({ message: 'Failed to send notification' });
    }
  }
);

// Get user notifications
router.get('/',
  authMiddleware,
  async (req, res) => {
    try {
      const { page = 1, limit = 10 } = req.query;

      const notifications = await Notification.find({ userId: req.userId })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit));

      const total = await Notification.countDocuments({ userId: req.userId });
      const unreadCount = await Notification.countDocuments({ 
        userId: req.userId, 
        isRead: false 
      });

      res.json({
        notifications,
        total,
        unreadCount,
        page: parseInt(page),
        totalPages: Math.ceil(total / limit)
      });
    } catch (error) {
      console.error('Get notifications error:', error);
      res.status(500).json({ message: 'Failed to get notifications' });
    }
  }
);

// Mark notification as read
router.put('/:notificationId/read',
  authMiddleware,
  async (req, res) => {
    try {
      const notification = await Notification.findOne({
        _id: req.params.notificationId,
        userId: req.userId
      });

      if (!notification) {
        return res.status(404).json({ message: 'Notification not found' });
      }

      notification.isRead = true;
      notification.readAt = new Date();
      await notification.save();

      res.json({ message: 'Notification marked as read' });
    } catch (error) {
      console.error('Mark notification read error:', error);
      res.status(500).json({ message: 'Failed to update notification' });
    }
  }
);

// Mark all notifications as read
router.put('/mark-all-read',
  authMiddleware,
  async (req, res) => {
    try {
      await Notification.updateMany(
        { userId: req.userId, isRead: false },
        { isRead: true, readAt: new Date() }
      );

      res.json({ message: 'All notifications marked as read' });
    } catch (error) {
      console.error('Mark all notifications read error:', error);
      res.status(500).json({ message: 'Failed to update notifications' });
    }
  }
);

// Delete notification
router.delete('/:notificationId',
  authMiddleware,
  async (req, res) => {
    try {
      const notification = await Notification.findOne({
        _id: req.params.notificationId,
        userId: req.userId
      });

      if (!notification) {
        return res.status(404).json({ message: 'Notification not found' });
      }

      await notification.deleteOne();
      res.json({ message: 'Notification deleted' });
    } catch (error) {
      console.error('Delete notification error:', error);
      res.status(500).json({ message: 'Failed to delete notification' });
    }
  }
);

module.exports = router;