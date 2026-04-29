const mongoose = require('mongoose');

const memberSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    membershipDay: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      enum: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
    },
    qrToken: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['active', 'invalid'],
      default: 'active',
    },
    lastVisitedAt: {
      type: Date,
      default: null,
    },
    missedWeekStreak: {
      type: Number,
      default: 0,
      min: 0,
    },
    reactivatedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model('Member', memberSchema);
