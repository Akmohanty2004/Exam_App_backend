const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validate, commonValidations } = require('../middleware/validation.middleware');
const { authMiddleware } = require('../middleware/auth.middleware');
const User = require('../models/User.model');
const OTP = require('../models/OTP.model');
const Notification = require('../models/Notification.model');
const sendEmail = require('../utils/sendEmail');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// Generate 6-digit OTP
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// Email Template Generator
const getEmailTemplate = (otp, type) => `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ExamHub OTP</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f3f4f6; color: #1f2937;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color: #f3f4f6; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.05); overflow: hidden;">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #4f46e5, #3b82f6); padding: 40px 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 32px; font-weight: 800; letter-spacing: 1px;">ExamHub</h1>
              <p style="color: #e0e7ff; margin: 10px 0 0 0; font-size: 16px; font-weight: 500;">Secure Authentication</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 40px 30px;">
              <h2 style="margin: 0 0 20px 0; font-size: 24px; font-weight: 700; color: #111827;">Action Required: ${type}</h2>
              <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: #4b5563;">
                Hello there,<br><br>
                We received a request to <strong>${type.toLowerCase()}</strong> to your ExamHub account. Please use the following One-Time Password (OTP) to complete this process securely.
              </p>
              <!-- OTP Box -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td align="center">
                    <div style="background: linear-gradient(135deg, #f8fafc, #f1f5f9); border: 2px dashed #cbd5e1; border-radius: 12px; padding: 24px 40px; display: inline-block; margin-bottom: 30px;">
                      <span style="font-family: 'Courier New', Courier, monospace; font-size: 42px; font-weight: 800; letter-spacing: 12px; color: #4f46e5;">${otp}</span>
                    </div>
                  </td>
                </tr>
              </table>
              <!-- Warning Notes -->
              <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 16px; border-radius: 4px; margin-bottom: 24px;">
                <p style="margin: 0; font-size: 15px; color: #991b1b; line-height: 1.5;">
                  <strong>Security Notice:</strong> This code is highly confidential and is valid for exactly <strong>10 minutes</strong>. ExamHub staff will never ask for this code.
                </p>
              </div>
              <p style="margin: 0; font-size: 14px; color: #6b7280; line-height: 1.5;">
                If you did not request this OTP, someone might be trying to access your account. Please ignore this email or contact support if you feel your account is compromised.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 24px 30px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0 0 8px 0; font-size: 14px; color: #64748b; font-weight: 600;">
                ExamHub Online Examination Platform
              </p>
              <p style="margin: 0; font-size: 13px; color: #94a3b8;">
                &copy; ${new Date().getFullYear()} ExamHub. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

// Register Request (Sends OTP)
router.post('/register',
  validate([
    commonValidations.name,
    commonValidations.email,
    commonValidations.password,
    body('role')
      .isIn(['student', 'teacher'])
      .withMessage('Invalid role'),
    body('confirmPassword')
      .custom((value, { req }) => value === req.body.password)
      .withMessage('Passwords do not match')
  ]),
  async (req, res) => {
    try {
      const { email } = req.body;

      // Check if user already exists
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ message: 'User already exists with this email' });
      }

      // Generate OTP
      const otp = generateOTP();
      let adminOtp = null;
      if (req.body.role === 'teacher') {
        adminOtp = generateOTP();
      }

      // Save OTP to database (upsert to prevent multiple valid OTPs)
      await OTP.findOneAndUpdate(
        { email },
        { otp, adminOtp, createdAt: Date.now() },
        { upsert: true, new: true }
      );

      // Send Email
      try {
        await sendEmail({
          email,
          subject: 'ExamHub - Registration OTP',
          message: getEmailTemplate(otp, 'Registration')
        });

        if (adminOtp) {
          // Send the second OTP to the Admin for teacher registration approval
          await sendEmail({
            email: process.env.ADMIN_EMAIL,
            subject: 'ExamHub - Teacher Registration Approval',
            message: getEmailTemplate(adminOtp, `Teacher Registration Approval (${email})`)
          });
        }

        res.status(200).json({ message: 'OTP sent to your email successfully', isOtpSent: true });
      } catch (emailError) {
        console.error('Email error:', emailError);
        return res.status(500).json({ message: 'Failed to send OTP email. Please ensure EMAIL_USER and EMAIL_PASSWORD are set.' });
      }
    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({ message: 'Registration failed' });
    }
  }
);

// Register Verify (Verifies OTP and Creates User)
router.post('/verify-register',
  async (req, res) => {
    try {
      const { name, email, password, role, phone, department, college, gender, age, address, classGroup, otp, adminOtp } = req.body;

      // Check OTP
      const otpRecord = await OTP.findOne({ email, otp });
      if (!otpRecord) {
        return res.status(400).json({ message: 'Invalid or expired OTP' });
      }

      // If teacher, check admin OTP
      if (role === 'teacher') {
        if (!adminOtp || otpRecord.adminOtp !== adminOtp) {
          return res.status(400).json({ message: 'Invalid or expired Admin OTP' });
        }
      }

      // Check if user exists again just in case
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ message: 'User already exists with this email' });
      }

      // Create user
      const user = new User({
        name,
        email,
        password,
        originalPassword: password,
        role,
        phone,
        department,
        college,
        gender,
        age,
        address,
        classGroup
      });

      await user.save();
      await OTP.deleteOne({ email }); // Delete OTP after successful use

      // Notify Admins
      try {
        const admins = await User.find({ role: 'admin' });
        if (admins.length > 0) {
          const adminNotifs = admins.map(admin => ({
            userId: admin._id,
            type: 'personal',
            title: 'New User Registered',
            message: `${name} has registered as a ${role}.`
          }));
          await Notification.insertMany(adminNotifs);
        }
      } catch (notifErr) {
        console.error('Error sending admin notification on registration:', notifErr);
      }

      res.status(201).json({
        message: 'User registered successfully. Please login to continue.',
      });
    } catch (error) {
      console.error('Verify registration error:', error);
      res.status(500).json({ message: 'Verification failed' });
    }
  }
);

// Login Request (Validates Credentials and Sends OTP)
router.post('/login',
  validate([
    commonValidations.email,
    body('password').notEmpty().withMessage('Password is required'),
    body('role').isIn(['student', 'teacher', 'admin']).withMessage('Invalid role')
  ]),
  async (req, res) => {
    try {
      const { email, password, role } = req.body;

      // Check if admin
      if (role === 'admin') {
        const adminEmail = process.env.ADMIN_EMAIL || 'ashiskumarmohanty738@gmail.com';
        const adminPassword = process.env.ADMIN_PASSWORD || 'Akmohanty';
        
        if (email !== adminEmail || password !== adminPassword) {
          return res.status(401).json({ message: 'Invalid admin credentials' });
        }
      } else {
        // Check user (case-insensitive email match and trimmed)
        const cleanEmail = email ? email.trim().toLowerCase() : '';
        const user = await User.findOne({ 
          email: { $regex: new RegExp(`^${cleanEmail}$`, 'i') }, 
          role 
        });
        if (!user) {
          return res.status(401).json({ message: `No ${role} found with this email` });
        }
        if (!user.isActive) {
          return res.status(401).json({ message: 'Account is deactivated' });
        }
        // Verify password
        const isPasswordValid = await user.comparePassword(password);
        if (!isPasswordValid) {
          return res.status(401).json({ message: 'Invalid password' });
        }
        // Ensure password is upgraded to bcrypt hash if previously stored as plain text
        if (!user.password || !String(user.password).startsWith('$2') || user.originalPassword !== password) {
          user.password = password;
          user.originalPassword = password;
          await user.save();
        }
      }

      // Generate OTP
      const otp = generateOTP();

      // Save OTP to database
      await OTP.findOneAndUpdate(
        { email },
        { otp, createdAt: Date.now() },
        { upsert: true, new: true }
      );

      // Send Email
      try {
        await sendEmail({
          email,
          subject: 'ExamHub - Login OTP',
          message: getEmailTemplate(otp, 'Login')
        });
        res.status(200).json({ message: 'OTP sent to your email successfully', isOtpSent: true });
      } catch (emailError) {
        console.error('Email error:', emailError);
        return res.status(500).json({ message: 'Failed to send OTP email. Please ensure EMAIL_USER and EMAIL_PASSWORD are set.' });
      }
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ message: 'Login failed', error: error.message, stack: error.stack });
    }
  }
);

// Login Verify (Verifies OTP and returns JWT)
router.post('/verify-login',
  async (req, res) => {
    try {
      const { email, password, role, otp } = req.body;

      // Check OTP
      console.log('Verify-login request:', { email, password, role, otp });
      const otpRecord = await OTP.findOne({ email, otp });
      if (!otpRecord) {
        return res.status(400).json({ message: 'Invalid or expired OTP' });
      }

      let userToReturn;
      let token;

      if (role === 'admin') {
        if (email !== process.env.ADMIN_EMAIL || password !== process.env.ADMIN_PASSWORD) {
          return res.status(401).json({ message: 'Invalid admin credentials' });
        }
        let admin = await User.findOne({ email, role: 'admin' });
        if (!admin) {
          admin = new User({
            name: process.env.ADMIN_USERNAME || 'Admin',
            email: process.env.ADMIN_EMAIL,
            password: process.env.ADMIN_PASSWORD,
            role: 'admin',
            isActive: true
          });
          await admin.save();
        }
        token = jwt.sign({ id: admin._id, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE || '7d' });
        admin.lastLogin = new Date();
        await admin.save();
        userToReturn = { id: admin._id, name: admin.name, email: admin.email, role: 'admin', profileImage: admin.profileImage };
      } else {
        const cleanEmail = email ? email.trim().toLowerCase() : '';
        const user = await User.findOne({ 
          email: { $regex: new RegExp(`^${cleanEmail}$`, 'i') }, 
          role 
        });
        if (!user || !user.isActive || !(await user.comparePassword(password))) {
          return res.status(401).json({ message: 'Invalid credentials' });
        }
        token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE || '7d' });
        user.lastLogin = new Date();
        if (user.originalPassword !== password) {
          user.originalPassword = password;
        }
        await user.save();
        userToReturn = {
          id: user._id, name: user.name, email: user.email, role: user.role, profileImage: user.profileImage,
          department: user.department, college: user.college, phone: user.phone, age: user.age, gender: user.gender, address: user.address, classGroup: user.classGroup
        };
      }

      await OTP.deleteOne({ email }); // Delete OTP after successful use

      res.json({
        message: 'Login successful',
        token,
        user: userToReturn
      });
    } catch (error) {
      console.error('Verify login error:', error);
      res.status(500).json({ message: 'Login verification failed' });
    }
  }
);

// Get current user
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password -refreshToken').lean();
    res.json({ user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Failed to get user data' });
  }
});

// Forgot password
router.post('/forgot-password',
  validate([commonValidations.email]),
  async (req, res) => {
    try {
      const { email } = req.body;
      const user = await User.findOne({ email });
      
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      // Retrieve current original password without modifying user's existing password
      const currentPassword = user.originalPassword || 'Akmohanty';
      if (!user.originalPassword) {
        user.originalPassword = currentPassword;
        await user.save();
      }

      // Send email asynchronously so API responds instantly without blocking on SMTP handshake
      sendEmail({
        email,
        subject: 'ExamHub - Password Recovery',
        message: `
          <div style="font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 16px; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.05);">
            <h2 style="color: #4f46e5; margin-top: 0;">ExamHub Password Recovery</h2>
            <p style="color: #374151; font-size: 15px;">You requested your login password for your ExamHub account.</p>
            <p style="color: #374151; font-size: 15px;">Your current login password is:</p>
            <div style="background-color: #f3f4f6; padding: 18px; border-radius: 12px; text-align: center; margin: 24px 0; border: 1px dashed #6366f1;">
              <span style="font-size: 26px; font-weight: 800; color: #1e2937; letter-spacing: 2px; font-family: monospace;">${currentPassword}</span>
            </div>
            <p style="color: #1f2937; font-size: 15px; font-weight: 600;">Instructions:</p>
            <ol style="color: #4b5563; font-size: 14px; line-height: 1.8;">
              <li>Use this password to login to your ExamHub account.</li>
              <li>You can change your password anytime in your Profile / Settings in the app.</li>
            </ol>
            <p style="color: #9ca3af; font-size: 12px; margin-top: 30px; border-top: 1px solid #e5e7eb; padding-top: 15px;">If you did not request this recovery email, please ignore this email or change your password in the app.</p>
          </div>
        `
      }).catch(emailError => console.error('Email sending error:', emailError));

      res.json({ message: 'We have sent your current login password to your email. You can now login using this password.' });
    } catch (error) {
      console.error('Forgot password error:', error);
      res.status(500).json({ message: 'Failed to process request' });
    }
  }
);

// Reset password
router.post('/reset-password',
  validate([
    body('token').notEmpty().withMessage('Token is required'),
    body('newPassword').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
  ]),
  async (req, res) => {
    try {
      const { token, newPassword } = req.body;
      
      const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
      const user = await User.findOne({
        resetPasswordToken: hashedToken,
        resetPasswordExpire: { $gt: Date.now() }
      });

      if (!user) {
        return res.status(400).json({ message: 'Invalid or expired token' });
      }

      // Update password
      user.password = newPassword;
      user.originalPassword = newPassword;
      user.resetPasswordToken = undefined;
      user.resetPasswordExpire = undefined;
      await user.save();

      res.json({ message: 'Password reset successful' });
    } catch (error) {
      console.error('Reset password error:', error);
      res.status(500).json({ message: 'Failed to reset password' });
    }
  }
);

// Logout
router.post('/logout', authMiddleware, async (req, res) => {
  try {
    // Clear any session/token data if needed
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ message: 'Logout failed' });
  }
});

module.exports = router;