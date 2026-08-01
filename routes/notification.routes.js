const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth.middleware');
const Notification = require('../models/Notification.model');
const User = require('../models/User.model');
const { sendPushNotification } = require('../utils/pushNotification');

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

      const cleanInput = email.trim().toLowerCase();

      if (cleanInput === 'all') {
        const targetUsers = await User.find({});
        const notifications = targetUsers.map(u => ({
          userId: u._id,
          title,
          message,
          type: req.body.type || 'system_alert',
          isRead: false
        }));
        if (notifications.length > 0) {
          await Notification.insertMany(notifications);
          sendPushNotification(targetUsers.map(u => u._id), title, message, {}, req.app.get('io'));
        }
        return res.status(201).json({ message: 'Broadcast notification sent successfully to all users' });
      }

      if (cleanInput.startsWith('class:')) {
        const className = email.trim().split(':')[1].trim();
        const regex = new RegExp('^' + className + '$', 'i');
        const query = className.toLowerCase() === 'general'
          ? { role: 'student', $or: [{ classGroup: regex }, { classGroup: { $exists: false } }, { classGroup: null }, { classGroup: '' }, { classGroup: 'General' }] }
          : { role: 'student', $or: [{ classGroup: regex }, { department: regex }, { college: regex }] };
        let targetUsers = await User.find(query);
        if (targetUsers.length === 0) {
          targetUsers = await User.find({ role: 'student' });
        }
        if (targetUsers.length === 0) {
          return res.status(404).json({ message: `No students found in the system` });
        }
        const notifications = targetUsers.map(u => ({
          userId: u._id,
          title,
          message,
          type: 'personal',
          isRead: false
        }));
        await Notification.insertMany(notifications);
        sendPushNotification(targetUsers.map(u => u._id), title, message, {}, req.app.get('io'));
        return res.status(201).json({ message: `Notification sent successfully to ${targetUsers.length} students in class ${className}` });
      }

      let targetUser = await User.findOne({ email: cleanInput });
      if (!targetUser) {
        // Fallback: try matching by classGroup or department if email wasn't found
        const regex = new RegExp('^' + email.trim() + '$', 'i');
        const classUsers = await User.find({ role: 'student', $or: [{ classGroup: regex }, { department: regex }, { college: regex }] });
        if (classUsers.length > 0) {
          const notifications = classUsers.map(u => ({
            userId: u._id,
            title,
            message,
            type: 'personal',
            isRead: false
          }));
          await Notification.insertMany(notifications);
          sendPushNotification(classUsers.map(u => u._id), title, message, {}, req.app.get('io'));
          return res.status(201).json({ message: `Notification sent successfully to ${classUsers.length} students` });
        }
        return res.status(404).json({ message: 'User not found with this email or class group' });
      }

      const notification = new Notification({
        userId: targetUser._id,
        title,
        message,
        type: 'personal',
        isRead: false
      });

      await notification.save();
      sendPushNotification([targetUser._id], title, message, {}, req.app.get('io'));
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

      const [notifications, total, unreadCount] = await Promise.all([
        Notification.find({ userId: req.userId })
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(parseInt(limit))
          .lean(),
        Notification.countDocuments({ userId: req.userId }),
        Notification.countDocuments({ 
          userId: req.userId, 
          isRead: false 
        })
      ]);

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