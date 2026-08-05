const mongoose = require('mongoose');
require('dotenv').config();
const User = require('./models/User.model');
const ClassGroup = require('./models/ClassGroup.model');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const classes = await ClassGroup.find({});
  for (const cls of classes) {
    const regex = new RegExp(`(^|,)\\s*${cls.name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*(,|$)`, 'i');
    console.log(`Class: ${cls.name}, Regex: ${regex}`);
    const count = await User.countDocuments({ role: 'student', classGroup: regex });
    console.log(`Count with regex: ${count}`);
    
    // Test exact match just in case
    const exactCount = await User.countDocuments({ role: 'student', classGroup: cls.name });
    console.log(`Count exact: ${exactCount}`);
  }
  
  // Look at all students
  const students = await User.find({ role: 'student' }).select('name classGroup');
  console.log('Students:', students);
  
  mongoose.disconnect();
}
run();
