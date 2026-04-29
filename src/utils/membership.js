const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function normalizeMembershipDay(value) {
  return `${value || ''}`.trim().toLowerCase();
}

function startOfDay(date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function addDays(date, amount) {
  const value = new Date(date);
  value.setDate(value.getDate() + amount);
  return value;
}

function startOfWeek(date) {
  const value = startOfDay(date);
  return addDays(value, -value.getDay());
}

function getDayIndex(dayName) {
  return WEEKDAY_NAMES.indexOf(normalizeMembershipDay(dayName));
}

function isScheduledToday(membershipDay, referenceDate = new Date()) {
  return getDayIndex(membershipDay) === referenceDate.getDay();
}

function isMemberAllowedToday(member, referenceDate = new Date()) {
  if (member.membershipType === 'weekly' || member.membershipType === 'premium') {
    return true;
  }

  return isScheduledToday(member.membershipDay, referenceDate);
}

function getLastCompletedOccurrence(membershipDay, referenceDate = new Date()) {
  const referenceStart = startOfDay(referenceDate);
  const dayIndex = getDayIndex(membershipDay);

  if (dayIndex < 0) {
    return null;
  }

  let daysSince = (referenceStart.getDay() - dayIndex + 7) % 7;

  if (daysSince === 0) {
    daysSince = 7;
  }

  return addDays(referenceStart, -daysSince);
}

function getStatusMessage(member, isToday) {
  if (member.membershipType === 'premium') {
    return 'Valid premium member';
  }

  if (member.status === 'invalid') {
    return 'Membership invalid due to 2 missed weeks';
  }

  if (member.membershipType === 'weekly') {
    return 'Valid weekly member';
  }

  if (!isToday) {
    return `Member is active, but this pass is only valid on ${member.membershipDay}`;
  }

  return 'Valid member';
}

async function calculateWeekdayMembershipState(member, AttendanceModel, referenceDate = new Date()) {
  const anchorDate = startOfDay(member.reactivatedAt || member.createdAt);
  const lastCompletedOccurrence = getLastCompletedOccurrence(member.membershipDay, referenceDate);
  let missedWeekStreak = 0;

  if (lastCompletedOccurrence) {
    for (let offset = 0; offset < 2; offset += 1) {
      const scheduledDate = addDays(lastCompletedOccurrence, offset * -7);

      if (scheduledDate < anchorDate) {
        break;
      }

      const attendanceExists = await AttendanceModel.exists({
        memberId: member._id,
        sessionDate: scheduledDate,
      });

      if (attendanceExists) {
        break;
      }

      missedWeekStreak += 1;
    }
  }

  return {
    missedWeekStreak,
    status: missedWeekStreak >= 2 ? 'invalid' : 'active',
  };
}

async function calculateWeeklyMembershipState(member, AttendanceModel, referenceDate = new Date()) {
  const anchorWeek = startOfWeek(member.reactivatedAt || member.createdAt);
  const currentWeek = startOfWeek(referenceDate);
  const lastCompletedWeek = addDays(currentWeek, -7);
  let missedWeekStreak = 0;

  for (let offset = 0; offset < 2; offset += 1) {
    const weekStart = addDays(lastCompletedWeek, offset * -7);

    if (weekStart < anchorWeek) {
      break;
    }

    const weekEnd = addDays(weekStart, 7);
    const attendanceExists = await AttendanceModel.exists({
      memberId: member._id,
      visitedAt: {
        $gte: weekStart,
        $lt: weekEnd,
      },
    });

    if (attendanceExists) {
      break;
    }

    missedWeekStreak += 1;
  }

  return {
    missedWeekStreak,
    status: missedWeekStreak >= 2 ? 'invalid' : 'active',
  };
}

async function calculateMembershipState(member, AttendanceModel, referenceDate = new Date()) {
  if (member.membershipType === 'premium') {
    return {
      missedWeekStreak: 0,
      status: 'active',
    };
  }

  if (member.membershipType === 'weekly') {
    return calculateWeeklyMembershipState(member, AttendanceModel, referenceDate);
  }

  return calculateWeekdayMembershipState(member, AttendanceModel, referenceDate);
}

async function syncMemberStatus(member, AttendanceModel, referenceDate = new Date()) {
  const membershipState = await calculateMembershipState(member, AttendanceModel, referenceDate);
  let changed = false;

  if (member.missedWeekStreak !== membershipState.missedWeekStreak) {
    member.missedWeekStreak = membershipState.missedWeekStreak;
    changed = true;
  }

  if (member.status !== membershipState.status) {
    member.status = membershipState.status;
    changed = true;
  }

  if (changed) {
    await member.save();
  }

  return member;
}

function getMembershipLabel(member) {
  if (member.membershipType === 'weekly') {
    return 'Weekly Member';
  }

  if (member.membershipType === 'premium') {
    return 'Premium Member';
  }

  return member.membershipDay;
}

function serializeMember(member, options = {}) {
  const includeQrToken = options.includeQrToken ?? true;

  return {
    id: member._id.toString(),
    fullName: member.fullName,
    phone: member.phone,
    membershipType: member.membershipType,
    membershipDay: member.membershipDay,
    membershipLabel: getMembershipLabel(member),
    serialNumber: member.serialNumber || `STRIKZ-${member._id.toString().slice(-6).toUpperCase()}`,
    status: member.status,
    missedWeekStreak: member.missedWeekStreak,
    lastVisitedAt: member.lastVisitedAt,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
    ...(includeQrToken ? { qrToken: member.qrToken } : {}),
  };
}

module.exports = {
  WEEKDAY_NAMES,
  getStatusMessage,
  isMemberAllowedToday,
  normalizeMembershipDay,
  serializeMember,
  startOfDay,
  syncMemberStatus,
};
