const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth.middleware');
const ClassGroup = require('../models/ClassGroup.model');

// Get all active classes (Available to everyone authenticated)
router.get('/', async (req, res) => {
  try {
    const classes = await ClassGroup.find({}).sort({ name: 1 });
    res.json({ classes });
  } catch (error) {
    console.error('Get classes error:', error);
    res.status(500).json({ message: 'Failed to fetch classes' });
  }
});

// Create a new class (Admin only)
router.post('/', authMiddleware, roleMiddleware('admin'), async (req, res) => {
  try {
    const { name } = req.body;
    
    if (!name) {
      return res.status(400).json({ message: 'Class name is required' });
    }

    const existingClass = await ClassGroup.findOne({ name: { $regex: new RegExp(`^${name}$`, 'i') } });
    if (existingClass) {
      return res.status(400).json({ message: 'A class with this name already exists' });
    }

    const newClass = new ClassGroup({
      name,
      createdBy: req.userId
    });

    await newClass.save();
    res.status(201).json({ message: 'Class created successfully', classGroup: newClass });
  } catch (error) {
    console.error('Create class error:', error);
    res.status(500).json({ message: 'Failed to create class' });
  }
});

// Delete a class (Admin only)
router.delete('/:id', authMiddleware, roleMiddleware('admin'), async (req, res) => {
  try {
    const classGroup = await ClassGroup.findById(req.params.id);
    if (!classGroup) {
      return res.status(404).json({ message: 'Class not found' });
    }

    await ClassGroup.findByIdAndDelete(req.params.id);
    res.json({ message: 'Class deleted successfully' });
  } catch (error) {
    console.error('Delete class error:', error);
    res.status(500).json({ message: 'Failed to delete class' });
  }
});

module.exports = router;
