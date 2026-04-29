const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function normalizeMembershipDay(value) {
  return `${value || ''}`.trim().toLowerCase();
}

function getDayIndex(dayName) {
  return WEEKDAY_NAMES.indexOf(normalizeMembershipDay(dayName));
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

function isScheduledToday(membershipDay, referenceDate = new Date()) {
  return getDayIndex(membershipDay) === referenceDate.getDay();
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

function getStatusMessage(status, membershipDay, isToday) {
  if (status === 'invalid') {
    return 'Membership invalid due to 2 missed weeks';
  }

  if (!isToday) {
    return `Member is active, but this pass is only valid on ${membershipDay}`;
  }

  return 'Valid member';
}

async function calculateMembershipState(member, AttendanceModel, referenceDate = new Date()) {
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

function serializeMember(member, options = {}) {
  const includeQrToken = options.includeQrToken ?? true;

  return {
    id: member._id.toString(),
    fullName: member.fullName,
    phone: member.phone,
    membershipDay: member.membershipDay,
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
  isScheduledToday,
  normalizeMembershipDay,
  serializeMember,
  startOfDay,
  syncMemberStatus,
};
