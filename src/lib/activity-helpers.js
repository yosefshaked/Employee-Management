const ENTRY_TYPE_DETAILS = Object.freeze({
  hours: {
    icon: 'BriefcaseBusiness',
    color: '#0F766E',
    label: 'שעות עבודה',
  },
  session: {
    icon: 'UserSquare',
    color: '#4338CA',
    label: 'מפגש שירות',
  },
  leave_employee_paid: {
    icon: 'CalendarCheck',
    color: '#047857',
    label: 'חופשה בתשלום',
  },
  leave_system_paid: {
    icon: 'CalendarCheck',
    color: '#047857',
    label: 'חופשה על חשבון המערכת',
  },
  leave_unpaid: {
    icon: 'CalendarX',
    color: '#D97706',
    label: 'חופשה ללא תשלום',
  },
  leave_half_day: {
    icon: 'CalendarRange',
    color: '#047857',
    label: 'חצי יום חופשה',
  },
});

const DEFAULT_ACTIVITY_DETAILS = Object.freeze({
  icon: 'Clock',
  color: '#6B7280',
  label: 'רישום פעילות',
});

function normalizeNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

export function getActivityTypeDetails(workSession) {
  const entryType = typeof workSession?.entry_type === 'string'
    ? workSession.entry_type.trim()
    : '';

  if (!entryType) {
    return { ...DEFAULT_ACTIVITY_DETAILS };
  }

  if (entryType === 'adjustment') {
    const payment = normalizeNumber(
      typeof workSession?.total_payment !== 'undefined'
        ? workSession.total_payment
        : workSession?.adjustment_amount,
    );
    if (payment > 0) {
      return {
        icon: 'PlusMinus',
        color: '#7C3AED',
        label: 'התאמה (זכות)',
      };
    }
    if (payment < 0) {
      return {
        icon: 'PlusMinus',
        color: '#DC2626',
        label: 'התאמה (חובה)',
      };
    }
    return {
      icon: 'PlusMinus',
      color: '#6B7280',
      label: 'התאמה',
    };
  }

  if (Object.prototype.hasOwnProperty.call(ENTRY_TYPE_DETAILS, entryType)) {
    const details = ENTRY_TYPE_DETAILS[entryType];
    return {
      icon: details.icon,
      color: details.color,
      label: details.label,
    };
  }

  return { ...DEFAULT_ACTIVITY_DETAILS };
}

export function listSupportedActivityTypes() {
  return Object.keys(ENTRY_TYPE_DETAILS);
}

export const ACTIVITY_TYPE_DETAILS = ENTRY_TYPE_DETAILS;
export const DEFAULT_ACTIVITY_TYPE_DETAILS = DEFAULT_ACTIVITY_DETAILS;
