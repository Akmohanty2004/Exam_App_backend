const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth.middleware');
const User = require('../models/User.model');
const Result = require('../models/Result.model');
const { uploadProfileImage, handleUploadError } = require('../middleware/upload.middleware');

// Get current user profile
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password -refreshToken -resetPasswordToken -resetPasswordExpire');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({ user });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ message: 'Failed to get profile' });
  }
});

// Update user profile
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const { name, phone, department, address, college, age, gender, classGroup, profileImage } = req.body;
    
    const updateData = {};
    if (name) updateData.name = name;
    if (phone) updateData.phone = phone;
    if (department) updateData.department = department;
    if (address) updateData.address = address;
    if (college) updateData.college = college;
    if (age) updateData.age = age;
    if (gender) updateData.gender = gender;
    if (classGroup) updateData.classGroup = classGroup;
    if (profileImage) updateData.profileImage = profileImage;

    const user = await User.findByIdAndUpdate(
      req.userId,
      updateData,
      { new: true, runValidators: true }
    ).select('-password -refreshToken -resetPasswordToken -resetPasswordExpire');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      message: 'Profile updated successfully',
      user
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: 'Failed to update profile' });
  }
});

// Upload profile image
router.post('/upload-profile-image', 
  authMiddleware,
  uploadProfileImage,
  handleUploadError,
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No image uploaded' });
      }

      // Convert buffer to Base64 string
      const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

      const user = await User.findByIdAndUpdate(
        req.userId,
        { profileImage: base64Image },
        { new: true }
      ).select('-password -refreshToken -resetPasswordToken -resetPasswordExpire');

      res.json({
        message: 'Profile image uploaded successfully',
        user,
        imageUrl: base64Image
      });
    } catch (error) {
      console.error('Upload profile image error:', error);
      res.status(500).json({ message: 'Failed to upload profile image' });
    }
  }
);

// Change password
router.put('/change-password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current password and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const isPasswordValid = await user.comparePassword(currentPassword);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }

    user.password = newPassword;
    await user.save();

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ message: 'Failed to change password' });
  }
});

// Get all students and their performance (teacher only)
router.get('/students-performance', authMiddleware, roleMiddleware('teacher'), async (req, res) => {
  try {
    // Get all students
    const students = await User.find({ role: 'student' }).select('name email classGroup profileImage');
    
    // Get all results to calculate average scores
    const results = await Result.find({ status: { $ne: 'pending' } });
    
    // Calculate stats per student
    const studentStats = students.map(student => {
      const studentResults = results.filter(r => r.studentId.toString() === student._id.toString());
      const totalScore = studentResults.reduce((acc, curr) => acc + (curr.percentage || 0), 0);
      const averageScore = studentResults.length > 0 ? totalScore / studentResults.length : 0;
      
      return {
        _id: student._id,
        name: student.name,
        email: student.email,
        classGroup: student.classGroup || 'General',
        profileImage: student.profileImage,
        averageScore: Number(averageScore.toFixed(1)),
        examsTaken: studentResults.length
      };
    });
    
    res.json({ students: studentStats });
  } catch (error) {
    console.error('Get students performance error:', error);
    res.status(500).json({ message: 'Failed to get students performance' });
  }
});

// Get all users (admin only)
router.get('/all', authMiddleware, async (req, res) => {
  try {
    const currentUser = await User.findById(req.userId);
    if (currentUser.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin only.' });
    }

    const users = await User.find()
      .select('-password -refreshToken -resetPasswordToken -resetPasswordExpire')
      .sort({ createdAt: -1 });

    res.json({ users });
  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({ message: 'Failed to get users' });
  }
});

// Get user by ID (admin only)
router.get('/:userId', authMiddleware, async (req, res) => {
  try {
    const currentUser = await User.findById(req.userId);
    if (currentUser.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin only.' });
    }

    const user = await User.findById(req.params.userId)
      .select('-password -refreshToken -resetPasswordToken -resetPasswordExpire');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Failed to get user' });
  }
});

// Request a class change (Student)
router.post('/request-class-change', authMiddleware, async (req, res) => {
  try {
    const { requestedClass } = req.body;
    if (!requestedClass) return res.status(400).json({ message: 'Requested class is required' });

    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.role !== 'student') return res.status(403).json({ message: 'Only students can request class changes' });

    user.pendingClassGroup = requestedClass;
    user.classChangeStatus = 'pending';
    await user.save();

    res.json({ message: 'Class change requested successfully. Waiting for teacher verification.', user });
  } catch (error) {
    console.error('Class change request error:', error);
    res.status(500).json({ message: 'Failed to request class change' });
  }
});

// Get pending class change requests (Teacher)
router.get('/class-requests/pending', authMiddleware, roleMiddleware('teacher'), async (req, res) => {
  try {
    const students = await User.find({ role: 'student', classChangeStatus: 'pending' })
      .select('name email classGroup pendingClassGroup');
    res.json({ requests: students });
  } catch (error) {
    console.error('Get class requests error:', error);
    res.status(500).json({ message: 'Failed to get class requests' });
  }
});

// Verify (approve/reject) class change (Teacher)
router.put('/verify-class-change/:studentId', authMiddleware, roleMiddleware('teacher'), async (req, res) => {
  try {
    const { status } = req.body; // 'approved' or 'rejected'
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const student = await User.findById(req.params.studentId);
    if (!student || student.role !== 'student') {
      return res.status(404).json({ message: 'Student not found' });
    }

    if (status === 'approved') {
      student.classGroup = student.pendingClassGroup;
    }
    
    student.pendingClassGroup = null;
    student.classChangeStatus = 'none';
    await student.save();

    res.json({ message: `Class change ${status} successfully` });
  } catch (error) {
    console.error('Verify class change error:', error);
    res.status(500).json({ message: 'Failed to verify class change' });
  }
});

module.exports = router;