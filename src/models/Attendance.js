const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema(
  {
    memberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Member',
      required: true,
      index: true,
    },
    visitedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    scheduledDay: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      enum: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
    },
    sessionDate: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

attendanceSchema.index({ memberId: 1, sessionDate: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', attendanceSchema);
