require('dotenv').config();
const mongoose = require('mongoose');
const Result = require('./models/Result.model');

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  const result = await Result.findOne({ isPassed: true }).lean();
  console.log('Result studentId type:', typeof result.studentId, 'value:', result.studentId);
  mongoose.disconnect();
}
check();
