const mongoose = require('mongoose');
const User = require('./models/User.model');
const Exam = require('./models/Exam.model');
const Notification = require('./models/Notification.model');
require('dotenv').config();

async function backfill() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Connected to DB');

    const admins = await User.find({ role: 'admin' });
    if (admins.length === 0) {
      console.log('No admins found');
      return;
    }

    const exams = await Exam.find();
    console.log(`Found ${exams.length} exams`);

    for (const admin of admins) {
      for (const exam of exams) {
        // Create Exam Created Notification
        await Notification.updateOne(
          { userId: admin._id, 'data.examId': exam._id, type: 'exam_created' },
          {
            $setOnInsert: {
              userId: admin._id,
              type: 'exam_created',
              title: 'New Exam Created',
              message: `A new exam "${exam.title}" has been created.`,
              data: { examId: exam._id },
              createdAt: exam.createdAt,
              isRead: false
            }
          },
          { upsert: true }
        );

        // If published, create Result Published Notification
        if (exam.isResultPublished) {
          await Notification.updateOne(
            { userId: admin._id, 'data.examId': exam._id, type: 'result_published' },
            {
              $setOnInsert: {
                userId: admin._id,
                type: 'result_published',
                title: 'Exam Results Published',
                message: `Results for "${exam.title}" have been published.`,
                data: { examId: exam._id },
                createdAt: exam.updatedAt || exam.createdAt,
                isRead: false
              }
            },
            { upsert: true }
          );
        }
      }
    }
    
    console.log('Backfill complete!');
  } catch (error) {
    console.error(error);
  } finally {
    process.exit(0);
  }
}

backfill();
