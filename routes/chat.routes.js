const express = require('express');
const fs = require('fs');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const Message = require('../models/Message.model');
const User = require('../models/User.model');
const { uploadSingle, chatFileUpload } = require('../middleware/upload.middleware');
const { uploadToCloudinary } = require('../utils/cloudinary');
const { sendPushNotification } = require('../utils/pushNotification');

// Fetch chat history between logged in user and another user
router.get('/history/:userId', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.id;

    const messages = await Message.find({
      $or: [
        { sender: currentUserId, receiver: userId },
        { sender: userId, receiver: currentUserId }
      ]
    }).sort({ createdAt: 1 });

    // Mark messages as read
    await Message.updateMany(
      { sender: userId, receiver: currentUserId, isRead: false },
      { $set: { isRead: true } }
    );

    res.json(messages);
  } catch (error) {
    console.error('Fetch history error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Send a message
router.post('/send', authMiddleware, chatFileUpload, async (req, res) => {
  try {
    const { receiverId, content, messageType, meetingLink } = req.body;
    const senderId = req.user.id;
    let imageUrl = '';
    let audioUrl = '';

    if (req.files) {
      if (req.files.image && req.files.image.length > 0) {
        const fileObj = req.files.image[0];
        try {
          const imgBuffer = fileObj.buffer || (fileObj.path ? fs.readFileSync(fileObj.path) : null);
          if (imgBuffer) {
            imageUrl = await uploadToCloudinary(imgBuffer, 'chat/images', 'image');
          }
        } catch (err) {
          console.error('Image Cloudinary upload error:', err);
        }
      }
      if (req.files.audio && req.files.audio.length > 0) {
        const fileObj = req.files.audio[0];
        try {
          const audioBuffer = fileObj.buffer || (fileObj.path ? fs.readFileSync(fileObj.path) : null);
          if (audioBuffer) {
            audioUrl = await uploadToCloudinary(audioBuffer, 'chat/audio', 'video');
          }
        } catch (err) {
          console.error('Audio Cloudinary upload error:', err);
        }
      }
    }

    const newMessage = new Message({
      sender: senderId,
      receiver: receiverId,
      content,
      messageType: messageType || (audioUrl ? 'audio' : (imageUrl ? 'image' : 'text')),
      imageUrl,
      audioUrl,
      meetingLink
    });

    await newMessage.save();

    const populatedMessage = await Message.findById(newMessage._id)
      .populate('sender', 'name avatar')
      .populate('receiver', 'name avatar');

    // Emit via socket
    const io = req.app.get('io');
    if (io) {
      io.to(String(receiverId)).emit('receive_message', populatedMessage);
      io.to(String(senderId)).emit('receive_message', populatedMessage);
      io.emit('receive_message', populatedMessage);
    }

    sendPushNotification(
      receiverId,
      'New Message',
      messageType === 'text' ? (message || 'New chat message') : `Sent a new ${messageType}`,
      { messageId: newMessage._id, senderId },
      io
    );

    res.status(201).json(populatedMessage);
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get Contacts (Users you can chat with)
router.get('/contacts', authMiddleware, async (req, res) => {
  try {
    const role = req.user.role;
    let query = {};
    if (role === 'student') query.role = 'teacher';
    else if (role === 'teacher') query.role = 'student';
    // Admins can see everyone
    
    const users = await User.find(query).select('name email role profileImage isOnline lastSeen').lean();
    
    const contactsWithUnread = await Promise.all(users.map(async (u) => {
      const unreadCount = await Message.countDocuments({
        sender: u._id,
        receiver: req.user.id,
        isRead: false
      });
      return { ...u, unreadCount };
    }));
    
    res.json(contactsWithUnread);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete a message
router.delete('/message/:id', authMiddleware, async (req, res) => {
  try {
    const message = await Message.findById(req.params.id);
    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }
    // Only the sender can delete the message
    if (message.sender.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Unauthorized to delete this message' });
    }
    
    await Message.deleteOne({ _id: req.params.id });
    
    // Optionally emit a delete event via socket if we want real-time deletion
    const io = req.app.get('io');
    if (io) {
      io.to(message.receiver.toString()).emit('delete_message', req.params.id);
    }
    
    res.json({ message: 'Message deleted successfully', messageId: req.params.id });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
