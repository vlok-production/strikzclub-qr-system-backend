const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

const Attendance = require('./models/Attendance');
const Counter = require('./models/Counter');
const Member = require('./models/Member');
const { createQrToken, getConfiguredAdmin, issueAdminToken, safeEqual, verifyToken } = require('./utils/auth');
const {
  WEEKDAY_NAMES,
  getStatusMessage,
  isMemberAllowedToday,
  normalizeMembershipDay,
  serializeMember,
  startOfDay,
  syncMemberStatus,
} = require('./utils/membership');

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 5001;
const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/StrikzClub';
const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', clientUrl);
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  return next();
});

app.use(express.json());

function sendError(res, status, message) {
  return res.status(status).json({ message });
}

function normalizeMembershipType(value) {
  return `${value || 'weekday'}`.trim().toLowerCase();
}

function validateMemberPayload(payload) {
  const fullName = `${payload.fullName || ''}`.trim();
  const phone = `${payload.phone || ''}`.trim();
  const membershipType = normalizeMembershipType(payload.membershipType);
  const membershipDay = normalizeMembershipDay(payload.membershipDay);

  if (!fullName) {
    return 'Full name is required';
  }

  if (!phone) {
    return 'Phone is required';
  }

  if (!['weekday', 'weekly', 'premium'].includes(membershipType)) {
    return 'Membership type must be weekday, weekly, or premium';
  }

  if (membershipType === 'weekday' && !WEEKDAY_NAMES.includes(membershipDay)) {
    return 'Membership day must be a valid weekday';
  }

  return null;
}

async function getNextSerialNumber() {
  const counter = await Counter.findOneAndUpdate(
    { key: 'memberSerialNumber' },
    { $inc: { value: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  return `STRIKZ-${String(counter.value).padStart(5, '0')}`;
}

async function requireAdmin(req, res, next) {
  try {
    const authorization = req.headers.authorization || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const payload = verifyToken(token);

    if (payload.role !== 'admin') {
      return sendError(res, 401, 'Unauthorized');
    }

    req.admin = { username: payload.sub };
    return next();
  } catch (error) {
    return sendError(res, 401, 'Unauthorized');
  }
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.post('/api/auth/login', (req, res) => {
  const { username = '', password = '' } = req.body || {};
  const configuredAdmin = getConfiguredAdmin();

  if (!safeEqual(username, configuredAdmin.username) || !safeEqual(password, configuredAdmin.password)) {
    return sendError(res, 401, 'Invalid username or password');
  }

  const token = issueAdminToken(configuredAdmin.username);

  return res.json({
    token,
    admin: {
      username: configuredAdmin.username,
    },
  });
});

app.get('/api/auth/me', requireAdmin, (req, res) => {
  res.json({
    admin: {
      username: req.admin.username,
    },
  });
});

app.get('/api/members', requireAdmin, async (req, res, next) => {
  try {
    const members = await Member.find().sort({ createdAt: -1 });
    const syncedMembers = await Promise.all(members.map((member) => syncMemberStatus(member, Attendance)));

    return res.json({
      members: syncedMembers.map((member) => serializeMember(member)),
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/members/:id', requireAdmin, async (req, res, next) => {
  try {
    const member = await Member.findById(req.params.id);

    if (!member) {
      return sendError(res, 404, 'Member not found');
    }

    await syncMemberStatus(member, Attendance);

    return res.json({
      member: serializeMember(member),
    });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/members', requireAdmin, async (req, res, next) => {
  try {
    const validationError = validateMemberPayload(req.body || {});

    if (validationError) {
      return sendError(res, 400, validationError);
    }

    const membershipType = normalizeMembershipType(req.body.membershipType);
    const member = await Member.create({
      fullName: req.body.fullName.trim(),
      phone: req.body.phone.trim(),
      membershipType,
      membershipDay: membershipType === 'weekday' ? normalizeMembershipDay(req.body.membershipDay) : null,
      serialNumber: await getNextSerialNumber(),
      qrToken: createQrToken(),
      status: 'active',
      missedWeekStreak: 0,
    });

    return res.status(201).json({
      member: serializeMember(member),
      message: 'Member created successfully',
    });
  } catch (error) {
    return next(error);
  }
});

app.patch('/api/members/:id', requireAdmin, async (req, res, next) => {
  try {
    const member = await Member.findById(req.params.id);

    if (!member) {
      return sendError(res, 404, 'Member not found');
    }

    const validationError = validateMemberPayload({
      fullName: req.body.fullName ?? member.fullName,
      phone: req.body.phone ?? member.phone,
      membershipType: req.body.membershipType ?? member.membershipType,
      membershipDay: req.body.membershipDay ?? member.membershipDay,
    });

    if (validationError) {
      return sendError(res, 400, validationError);
    }

    member.fullName = (req.body.fullName ?? member.fullName).trim();
    member.phone = (req.body.phone ?? member.phone).trim();
    member.membershipType = normalizeMembershipType(req.body.membershipType ?? member.membershipType);
    member.membershipDay =
      member.membershipType === 'weekday' ? normalizeMembershipDay(req.body.membershipDay ?? member.membershipDay) : null;

    if (req.body.status === 'active') {
      member.status = 'active';
      member.missedWeekStreak = 0;
      member.reactivatedAt = new Date();
    }

    if (req.body.status === 'invalid') {
      member.status = 'invalid';
    }

    await member.save();
    await syncMemberStatus(member, Attendance);

    return res.json({
      member: serializeMember(member),
      message: 'Member updated successfully',
    });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/members/:id/renew', requireAdmin, async (req, res, next) => {
  try {
    const member = await Member.findById(req.params.id);

    if (!member) {
      return sendError(res, 404, 'Member not found');
    }

    member.status = 'active';
    member.missedWeekStreak = 0;
    member.reactivatedAt = new Date();
    await member.save();

    return res.json({
      member: serializeMember(member),
      message: 'Member renewed successfully',
    });
  } catch (error) {
    return next(error);
  }
});

app.delete('/api/members/:id', requireAdmin, async (req, res, next) => {
  try {
    const member = await Member.findById(req.params.id);

    if (!member) {
      return sendError(res, 404, 'Member not found');
    }

    await Attendance.deleteMany({ memberId: member._id });
    await Member.deleteOne({ _id: member._id });

    return res.json({
      message: 'Member deleted successfully',
    });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/scan/verify', async (req, res, next) => {
  try {
    const qrToken = `${req.body?.qrToken || ''}`.trim();

    if (!qrToken) {
      return sendError(res, 400, 'QR token is required');
    }

    const member = await Member.findOne({ qrToken });

    if (!member) {
      return res.status(404).json({
        isValid: false,
        attendanceMarked: false,
        message: 'Member not found for this QR code',
      });
    }

    await syncMemberStatus(member, Attendance);

    const allowedToday = isMemberAllowedToday(member);
    const memberPayload = serializeMember(member, { includeQrToken: false });

    if (member.status === 'invalid') {
      return res.json({
        isValid: false,
        attendanceMarked: false,
        member: memberPayload,
        message: getStatusMessage(member, allowedToday),
      });
    }

    if (!allowedToday) {
      return res.json({
        isValid: false,
        attendanceMarked: false,
        member: memberPayload,
        message: getStatusMessage(member, allowedToday),
      });
    }

    const sessionDate = startOfDay(new Date());
    let attendanceMarked = false;
    const existingAttendance = await Attendance.findOne({
      memberId: member._id,
      sessionDate,
    });

    if (!existingAttendance) {
      try {
        await Attendance.create({
          memberId: member._id,
          visitedAt: new Date(),
          scheduledDay: member.membershipType === 'weekday' ? member.membershipDay : WEEKDAY_NAMES[new Date().getDay()],
          sessionDate,
        });
        attendanceMarked = true;
      } catch (error) {
        if (error.code !== 11000) {
          throw error;
        }
      }
    }

    if (attendanceMarked) {
      member.lastVisitedAt = new Date();
      member.missedWeekStreak = 0;
      member.status = 'active';
      await member.save();
    }

    return res.json({
      isValid: true,
      attendanceMarked,
      member: serializeMember(member, { includeQrToken: false }),
      message: attendanceMarked ? 'Valid member. Attendance recorded.' : 'Valid member. Attendance already recorded today.',
    });
  } catch (error) {
    return next(error);
  }
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({
    message: 'Something went wrong on the server',
  });
});

mongoose
  .connect(mongoUri)
  .then(() => {
    app.listen(port, () => {
      console.log(`Strikz Club API running on port ${port}`);
    });
  })
  .catch((error) => {
    console.error('Failed to connect to MongoDB', error);
    process.exit(1);
  });
