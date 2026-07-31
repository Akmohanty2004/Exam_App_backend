const User = require('../models/User.model');

/**
 * Sends both real-time Socket.IO notification AND Expo Push Notification (works when app is closed/not open)
 * @param {Array|string} userIds - User ID(s) to notify
 * @param {string} title - Notification title
 * @param {string} message - Notification body/message
 * @param {Object} data - Custom metadata
 * @param {Object} io - Socket.IO server instance
 */
const sendPushNotification = async (userIds, title, message, data = {}, io = null) => {
  try {
    const idList = (Array.isArray(userIds) ? userIds : [userIds]).map(id => String(id));

    // 1. Emit real-time Socket.IO event to apps currently open
    if (io) {
      idList.forEach(id => {
        try {
          io.to(id).emit('new_notification', {
            title: title || 'ExamHub Notification',
            message: message || 'You have a new notification',
            data: data || {},
            createdAt: new Date()
          });
        } catch (e) {}
      });
    }

    // 2. Send Expo Push Notification to phones (shows phone notification even when app is closed/killed)
    const users = await User.find({
      _id: { $in: idList },
      expoPushToken: { $exists: true, $ne: '' }
    });

    const pushMessages = [];
    users.forEach(user => {
      if (user.expoPushToken && user.expoPushToken.startsWith('ExponentPushToken')) {
        pushMessages.push({
          to: user.expoPushToken,
          sound: 'default',
          title: title || 'ExamHub Notification',
          body: message || 'You have a new notification',
          data: data || {},
          priority: 'high',
          channelId: 'default'
        });
      }
    });

    if (pushMessages.length > 0) {
      for (let i = 0; i < pushMessages.length; i += 100) {
        const chunk = pushMessages.slice(i, i + 100);
        await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip, deflate',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(chunk)
        }).catch(err => {
          console.log('Expo push notification send error:', err.message);
        });
      }
    }
  } catch (error) {
    console.log('Push notification helper error:', error.message);
  }
};

module.exports = {
  sendPushNotification
};
