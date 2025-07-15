// src/utils/constraintUtils.js

export const constraintRuleTypes = [
    { value: '', label: '-- ไม่มี --' },
    { value: 'no_sundays', label: 'ไม่ขึ้นเวรวันอาทิตย์' },
    { value: 'no_mondays', label: 'ไม่ขึ้นเวรวันจันทร์' },
    { value: 'no_tuesdays', label: 'ไม่ขึ้นเวรวันอังคาร' },
    { value: 'no_wednesdays', label: 'ไม่ขึ้นเวรวันพุธ' },
    { value: 'no_thursdays', label: 'ไม่ขึ้นเวรวันพฤหัสบดี' },
    { value: 'no_fridays', label: 'ไม่ขึ้นเวรวันศุกร์' },
    { value: 'no_saturdays', label: 'ไม่ขึ้นเวรวันเสาร์' },
    { value: 'no_morning_shifts', label: 'ไม่ขึ้นเวรเช้า' },
    { value: 'no_afternoon_shifts', label: 'ไม่ขึ้นเวรบ่าย' },
    { value: 'no_night_shifts', label: 'ไม่ขึ้นเวรดึก' },
    { value: 'no_night_afternoon_double', label: 'ไม่ขึ้นเวรดึกควบบ่าย' },
    { value: 'no_specific_days', label: 'ไม่ขึ้นเวรวันที่ระบุ...' },
    { value: 'request_specific_shifts_on_days', label: 'ขอขึ้นเวรที่ระบุในวันที่กำหนด...' },
];