import { HOLIDAY_TYPE_LABELS, inferLeaveType, isLeaveEntryType } from '@/lib/leave.js';

const DEFAULT_ACTIVITY_LABEL = 'שעות עבודה';
const ADJUSTMENT_LABEL = 'התאמה';
const FALLBACK_LEAVE_LABEL = 'חופשה';

export function getActivityDisplayDetails(workSession) {
  if (!workSession || typeof workSession !== 'object') {
    return { label: DEFAULT_ACTIVITY_LABEL };
  }

  const entryType = workSession.entry_type;

  if (isLeaveEntryType(entryType)) {
    const leaveType = inferLeaveType(workSession);
    const leaveLabel = leaveType ? HOLIDAY_TYPE_LABELS[leaveType] : null;
    return { label: leaveLabel || FALLBACK_LEAVE_LABEL };
  }

  if (entryType === 'adjustment') {
    return { label: ADJUSTMENT_LABEL };
  }

  const employeeType = workSession.employee?.employee_type || workSession.employee_type;

  if (employeeType === 'instructor') {
    const serviceName = workSession.service?.name || workSession.service_name;
    if (serviceName) {
      return { label: serviceName };
    }
  }

  return { label: DEFAULT_ACTIVITY_LABEL };
}
