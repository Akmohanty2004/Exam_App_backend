process.env.TZ = 'Asia/Kolkata'; // Force IST timezone for all Date operations
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const dns = require('dns');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();
const User = require('./models/User.model');

// No DNS override needed for standard seedlist
// Import routes
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const examRoutes = require('./routes/exam.routes');
const questionRoutes = require('./routes/question.routes');
const resultRoutes = require('./routes/result.routes');
const adminRoutes = require('./routes/admin.routes');
const notificationRoutes = require('./routes/notification.routes');
const chatRoutes = require('./routes/chat.routes');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});
app.set('io', io);

// Socket connection logic
// Socket connection logic
const connectedUsers = new Map();
const userSocketCounts = new Map();

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('join_room', async (userId) => {
    const room = String(userId);
    socket.join(room);
    connectedUsers.set(socket.id, room);
    const count = (userSocketCounts.get(room) || 0) + 1;
    userSocketCounts.set(room, count);
    
    try {
      await User.findByIdAndUpdate(userId, { isOnline: true });
      io.emit('user_online', room);
    } catch (err) {
      console.error('Error updating online status:', err);
    }
    console.log(`User ${userId} joined their personal room (active sockets: ${count})`);
  });

  socket.on('set_status', async (data) => {
    try {
      const roomStr = data?.userId ? String(data.userId) : connectedUsers.get(socket.id);
      if (roomStr) {
        const isOnline = Boolean(data.isOnline);
        await User.findByIdAndUpdate(roomStr, { isOnline, lastSeen: new Date() });
        io.emit(isOnline ? 'user_online' : 'user_offline', roomStr);
      }
    } catch (err) {
      console.error('Error in set_status:', err);
    }
  });

  socket.on('check_online_status', async (targetUserId) => {
    try {
      const roomStr = String(targetUserId);
      const isSocketConnected = (userSocketCounts.get(roomStr) || 0) > 0 || (io.sockets.adapter.rooms.get(roomStr)?.size || 0) > 0;
      let isOnline = isSocketConnected;
      let lastSeen = null;
      
      if (!isOnline) {
        const targetUser = await User.findById(targetUserId);
        if (targetUser) {
          lastSeen = targetUser.lastSeen;
          if (targetUser.isOnline) {
            // Self-heal stale online status
            await User.findByIdAndUpdate(targetUserId, { isOnline: false, lastSeen: new Date() });
            lastSeen = new Date();
          }
        }
      }
      socket.emit('user_status_response', { userId: targetUserId, isOnline, lastSeen });
    } catch (err) {
      console.error('Error checking user status:', err);
    }
  });

  socket.on('typing', (data) => {
    // data should contain { receiverId, senderId }
    socket.to(data.receiverId).emit('typing', { senderId: data.senderId });
  });

  socket.on('stop_typing', (data) => {
    socket.to(data.receiverId).emit('stop_typing', { senderId: data.senderId });
  });

  socket.on('disconnect', async () => {
    const userId = connectedUsers.get(socket.id); 
    if (userId) {
      connectedUsers.delete(socket.id);
      const count = Math.max(0, (userSocketCounts.get(userId) || 1) - 1);
      if (count === 0) {
        userSocketCounts.delete(userId);
        try {
          await User.findByIdAndUpdate(userId, { isOnline: false, lastSeen: new Date() });
          io.emit('user_offline', String(userId));
        } catch (err) {
          console.error('Error updating offline status:', err);
        }
      } else {
        userSocketCounts.set(userId, count);
      }
    }
    console.log('User disconnected:', socket.id);
  });
});

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// CORS (Must be before rate limiter so 429 errors get CORS headers)
app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    const allowedOrigins = ['http://localhost:5173'];
    if (allowedOrigins.indexOf(origin) !== -1 || origin.endsWith('.vercel.app') || origin.endsWith('.netlify.app')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

// HTTP Security headers (XSS protection, MIME sniffing protection, clickjacking defense)
app.use(helmet({ 
  contentSecurityPolicy: false, 
  crossOriginResourcePolicy: { policy: "cross-origin" } 
}));
app.disable('x-powered-by');

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Increased from 100 to 1000 to prevent false positives during active dev
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api', limiter);

// Body parser
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Logging
app.use(morgan('dev'));

// Static files
const uploadPath = process.env.VERCEL ? '/tmp/uploads' : path.join(__dirname, 'uploads');
app.use('/uploads', express.static(uploadPath));

// Database connection
let dbConnectPromise = null;
const connectDB = async () => {
  if (mongoose.connection.readyState === 1) {
    return;
  }
  if (dbConnectPromise) {
    return dbConnectPromise;
  }
  dbConnectPromise = (async () => {
    try {
      await mongoose.connect(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 30000, // increased from 10000
        connectTimeoutMS: 30000,         // increased from 10000
        socketTimeoutMS: 45000,
        maxPoolSize: 20,
        family: 4,                       // Force IPv4 to avoid DNS/IPv6 related Atlas timeouts
      });
      console.log('Connected to MongoDB Atlas');
    } catch (error) {
      console.error('MongoDB Atlas connection error:', error.message);
    } finally {
      dbConnectPromise = null;
    }
  })();
  return dbConnectPromise;
};

connectDB();

// Health check & ping (before DB check for immediate response)
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Server is running' });
});
app.get('/api/ping', (req, res) => res.status(200).json({ status: 'OK' }));
app.head('/api/ping', (req, res) => res.status(200).end());

app.use('/api', async (req, res, next) => {
  if (req.path === '/ping' || req.path === '/health') return next();
  if (mongoose.connection.readyState !== 1) {
    await connectDB();
  }
  next();
});


// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/questions', questionRoutes);
app.use('/api/results', resultRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/classes', require('./routes/classGroup.routes'));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Create uploads directory if it doesn't exist (use /tmp/uploads in Vercel serverless environment)
const fs = require('fs');
try {
  const uploadDir = process.env.VERCEL ? '/tmp/uploads' : 'uploads';
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
} catch (err) {
  console.log('Uploads directory creation skipped (read-only filesystem):', err.message);
}

const PORT = process.env.PORT || 5000;

if (!process.env.VERCEL) {
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

// Export Express app for Vercel Serverless Function compatibility (@vercel/node)
app.server = server;
app.io = io;
module.exports = app;