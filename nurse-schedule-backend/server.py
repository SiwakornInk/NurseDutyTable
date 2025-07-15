from flask import Flask, request, jsonify
from ortools.sat.python import cp_model
import datetime
import time
from flask_cors import CORS
import math
import traceback
import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud.firestore_v1.base_query import FieldFilter
import os

app = Flask(__name__)
CORS(app)

SHIFT_MORNING = 1
SHIFT_AFTERNOON = 2
SHIFT_NIGHT = 3
SHIFTS = [SHIFT_MORNING, SHIFT_AFTERNOON, SHIFT_NIGHT]
SHIFT_NAMES_TH = {SHIFT_MORNING: 'ช', SHIFT_AFTERNOON: 'บ', SHIFT_NIGHT: 'ด', 0: 'หยุด'}
SHIFT_NAMES_EN = {SHIFT_MORNING: 'Morning', SHIFT_AFTERNOON: 'Afternoon', SHIFT_NIGHT: 'Night', 0: 'Off'}
SHIFT_CODE_M_REQUEST = 1
SHIFT_CODE_A_REQUEST = 2
SHIFT_CODE_N_REQUEST = 3
SHIFT_CODE_NA_DOUBLE_REQUEST = 4

MAX_CONSECUTIVE_SAME_SHIFT = 2
MAX_CONSECUTIVE_OFF_DAYS = 2
MIN_OFF_DAYS_IN_WINDOW = 0
WINDOW_SIZE_FOR_MIN_OFF = 7

PENALTY_OFF_DAY_UNDER_TARGET = 50
PENALTY_ENDING_MONTH_AT_MAX_CONSECUTIVE = 35
PENALTY_TOTAL_SHIFT_IMBALANCE = 30
PENALTY_OFF_DAY_IMBALANCE = 30
PENALTY_SHIFT_TYPE_IMBALANCE = 15
PENALTY_PER_NA_DOUBLE = 10
PENALTY_NIGHT_TO_MORNING_TRANSITION = 5

PENALTY_BASE_SOFT_VIOLATION = 15
BONUS_HIGH_PRIORITY = 15
BONUS_CARRY_OVER = 5

db_admin = None
SERVICE_ACCOUNT_KEY_PATH = "serviceAccountKey.json"

try:
    if not os.path.exists(SERVICE_ACCOUNT_KEY_PATH):
        print(f"ERROR: Service account key file not found at '{SERVICE_ACCOUNT_KEY_PATH}'")
        db_admin = None
    elif not firebase_admin._apps:
        cred = credentials.Certificate(SERVICE_ACCOUNT_KEY_PATH)
        firebase_admin.initialize_app(cred)
        print("Firebase Admin SDK Initialized Successfully.")
        db_admin = firestore.client()
    else:
        db_admin = firestore.client()
        print("Firebase Admin SDK already initialized.")
except Exception as e:
    print(f"Error initializing Firebase Admin SDK: {e}. Carry-over flag updates and hard request fetching might fail.")
    db_admin = None


def get_days_array(start_str, end_str):
    days = []
    try:
        start_date = datetime.date.fromisoformat(start_str)
        end_date = datetime.date.fromisoformat(end_str)
        if start_date > end_date:
            raise ValueError("Start date cannot be after end date")
        current_date = start_date
        while current_date <= end_date:
            days.append(current_date)
            current_date += datetime.timedelta(days=1)
    except Exception as e:
        print(f"Date parsing error: Start='{start_str}', End='{end_str}'. Error: {e}")
        return None
    return days

def get_previous_month_state_shifts(nurse_id, previous_schedule_data):
    state = {'last_day_shifts': [], 'consecutive_shifts': 0, 'was_off_last_day': True, 'last_shift_types_count': {}}
    if not previous_schedule_data or 'nurseSchedules' not in previous_schedule_data or 'days' not in previous_schedule_data:
        return state
    nurse_schedules_prev = previous_schedule_data.get('nurseSchedules', {})
    prev_days_iso = previous_schedule_data.get('days', [])
    if not prev_days_iso or nurse_id not in nurse_schedules_prev:
        return state
    nurse_schedule_prev = nurse_schedules_prev.get(nurse_id)
    if not nurse_schedule_prev:
        return state
    last_day_iso = prev_days_iso[-1]
    shifts_on_last_day = nurse_schedule_prev.get('shifts', {}).get(last_day_iso, [])
    state['last_day_shifts'] = sorted(shifts_on_last_day)
    state['was_off_last_day'] = not bool(shifts_on_last_day)
    consecutive_shifts = 0
    for day_iso in reversed(prev_days_iso):
        shifts_on_day = nurse_schedule_prev.get('shifts', {}).get(day_iso, [])
        num_shifts_this_day = len(shifts_on_day)
        if num_shifts_this_day > 0:
            consecutive_shifts += num_shifts_this_day
        else:
            break
    state['consecutive_shifts'] = consecutive_shifts
    
    for s_type in SHIFTS:
        count = 0
        for day_iso in reversed(prev_days_iso):
            shifts_on_day = nurse_schedule_prev.get('shifts', {}).get(day_iso, [])
            if s_type in shifts_on_day:
                count += 1
            else:
                break
        state['last_shift_types_count'][s_type] = count
    
    return state


@app.route('/generate-schedule', methods=['POST'])
def generate_schedule_api():
    global db_admin
    start_time = time.time()
    print("\n--- Received schedule generation request ---")
    try:
        data = request.get_json()
        if not data: return jsonify({"error": "Invalid JSON payload"}), 400

        try:
            nurses_data = data['nurses']
            schedule_info = data['schedule']
            previous_month_schedule = data.get('previousMonthSchedule')
            monthly_soft_requests_input = data.get('monthly_soft_requests', {})
            carry_over_flags_input = data.get('carry_over_flags', {})
            holidays_input = data.get('holidays', [])

            start_date_str = schedule_info['startDate'].split('T')[0]
            end_date_str = schedule_info['endDate'].split('T')[0]
            REQ_MORNING = int(data.get('requiredNursesMorning', 2))
            REQ_AFTERNOON = int(data.get('requiredNursesAfternoon', 3))
            REQ_NIGHT = int(data.get('requiredNursesNight', 2))
            required_nurses_by_shift = { SHIFT_MORNING: REQ_MORNING, SHIFT_AFTERNOON: REQ_AFTERNOON, SHIFT_NIGHT: REQ_NIGHT }
            MAX_CONSECUTIVE_SHIFTS_WORKED = int(data.get('maxConsecutiveShiftsWorked', 6))
            TARGET_OFF_DAYS = int(data.get('targetOffDays', 8))
            SOLVER_TIME_LIMIT = float(data.get('solverTimeLimit', 60.0))

            if not isinstance(nurses_data, list) or not nurses_data: raise ValueError("Invalid or empty 'nurses' data")
            if not all('id' in n for n in nurses_data): raise ValueError("Missing 'id' in nurse data")
            if not all('isGovernmentOfficial' in n for n in nurses_data): raise ValueError("Missing 'isGovernmentOfficial' in nurse data")
            if not isinstance(monthly_soft_requests_input, dict): raise ValueError("Invalid 'monthly_soft_requests' format")
            if not isinstance(carry_over_flags_input, dict): raise ValueError("Invalid 'carry_over_flags' format")
            if not isinstance(holidays_input, list): raise ValueError("Invalid 'holidays' format, expected a list")
            try:
                holiday_day_numbers = set(int(h) for h in holidays_input)
            except (ValueError, TypeError):
                raise ValueError("Invalid day number found in 'holidays' list")

            if REQ_MORNING < 0 or REQ_AFTERNOON < 0 or REQ_NIGHT < 0: raise ValueError("Required nurses cannot be negative")
            if MAX_CONSECUTIVE_SHIFTS_WORKED < 1: raise ValueError(f"Max consecutive SHIFTS worked must be >= 1")
            if TARGET_OFF_DAYS < 0: raise ValueError("Target off days cannot be negative")
            if MAX_CONSECUTIVE_SAME_SHIFT < 1: raise ValueError("Internal Error: MAX_CONSECUTIVE_SAME_SHIFT")
            if MAX_CONSECUTIVE_OFF_DAYS < 1: raise ValueError("Internal Error: MAX_CONSECUTIVE_OFF_DAYS")
            
            total_nurses_available = len(nurses_data)
            max_required = max(REQ_MORNING, REQ_AFTERNOON, REQ_NIGHT)
            if total_nurses_available < max_required:
                raise ValueError(f"จำนวนพยาบาลไม่เพียงพอ: มี {total_nurses_available} คน แต่ต้องการอย่างน้อย {max_required} คนต่อเวร")

        except (KeyError, TypeError, ValueError) as e:
            print(f"Data extraction/validation error: {e}\n{traceback.format_exc()}")
            return jsonify({"error": f"ข้อมูล Input ไม่ถูกต้อง หรือไม่ครบถ้วน: {e}"}), 400
        except Exception as e:
            print(f"Unexpected error during data extraction: {e}\n{traceback.format_exc()}")
            return jsonify({"error": f"เกิดข้อผิดพลาดในการประมวลผลข้อมูล Input: {e}"}), 400

        days = get_days_array(start_date_str, end_date_str)
        if days is None: return jsonify({"error": "รูปแบบวันที่เริ่มต้น/สิ้นสุดไม่ถูกต้อง"}), 400
        num_nurses = len(nurses_data)
        num_days = len(days)
        if num_days == 0: return jsonify({"error": "ช่วงวันที่ที่เลือกไม่ถูกต้อง"}), 400
        nurse_indices = range(num_nurses)
        day_indices = range(num_days)
        days_iso = [day.isoformat() for day in days]
        nurse_id_map = {n: nurses_data[n]['id'] for n in nurse_indices}
        nurse_id_to_index = {v: k for k, v in nurse_id_map.items()}
        is_gov_official_map = {n: nurses_data[n].get('isGovernmentOfficial', False) for n in nurse_indices}
        non_gov_indices = [n for n in nurse_indices if not is_gov_official_map.get(n, False)]
        num_non_gov = len(non_gov_indices)

        print(f"Processing schedule: {num_nurses} nurses ({num_nurses - num_non_gov} Gov / {num_non_gov} Non-Gov), {num_days} days ({start_date_str} to {end_date_str}).")
        print(f"Input holidays (day numbers): {holiday_day_numbers}")
        print(f"Non-Government Nurse Indices: {non_gov_indices}")
        print(f"Max Consecutive Shifts Worked (for Non-Gov): {MAX_CONSECUTIVE_SHIFTS_WORKED}")

        nurse_permanent_constraints = { nurses_data[n]['id']: nurses_data[n].get('constraints', []) for n in nurse_indices }
        previous_states = {}
        if previous_month_schedule:
            for n_idx in non_gov_indices:
                nurse_id = nurse_id_map[n_idx]
                previous_states[n_idx] = get_previous_month_state_shifts(nurse_id, previous_month_schedule)
            for n_idx in nurse_indices:
                if n_idx not in non_gov_indices:
                    previous_states[n_idx] = {'last_day_shifts': [], 'consecutive_shifts': 0, 'was_off_last_day': True, 'last_shift_types_count': {}}
        else:
            for n_idx in nurse_indices:
                previous_states[n_idx] = {'last_day_shifts': [], 'consecutive_shifts': 0, 'was_off_last_day': True, 'last_shift_types_count': {}}


        model = cp_model.CpModel()
        shifts = {}
        for n in nurse_indices:
            for d in day_indices:
                for s_val in SHIFTS: shifts[(n, d, s_val)] = model.NewBoolVar(f's_n{n}_d{d}_s{s_val}')

        is_off = {}
        is_working = {}
        for n in nurse_indices:
            for d in day_indices:
                is_off[(n, d)] = model.NewBoolVar(f'off_n{n}_d{d}')
                is_working[(n, d)] = is_off[(n, d)].Not()

        num_shifts_on_day = {}
        for n in nurse_indices:
            for d in day_indices:
                num_shifts_on_day[n, d] = model.NewIntVar(0, 2, f'nshifts_n{n}_d{d}')
                model.Add(num_shifts_on_day[n, d] == sum(shifts[(n, d, s)] for s in SHIFTS))
                model.Add(num_shifts_on_day[n, d] >= 1).OnlyEnforceIf(is_working[(n, d)])
                model.Add(num_shifts_on_day[n, d] == 0).OnlyEnforceIf(is_off[(n, d)])

        for n in non_gov_indices:
            for d in day_indices:
                model.Add(shifts[(n, d, SHIFT_MORNING)] + shifts[(n, d, SHIFT_AFTERNOON)] <= 1)
                model.Add(shifts[(n, d, SHIFT_MORNING)] + shifts[(n, d, SHIFT_NIGHT)] <= 1)

        for d in day_indices:
            for s in SHIFTS:
                req = required_nurses_by_shift.get(s, 0)
                model.Add(sum(shifts[(n, d, s)] for n in nurse_indices) == req)

        print("--- Applying Government Official Fixed Schedule Constraints (Weekends & Holidays) ---")
        gov_constraints_applied_count = 0
        for n in nurse_indices:
            if is_gov_official_map.get(n, False):
                for d in day_indices:
                    day_object = days[d]; day_of_week = day_object.weekday(); day_number = day_object.day
                    is_weekend = day_of_week == 5 or day_of_week == 6
                    is_holiday = day_number in holiday_day_numbers
                    try:
                        if is_weekend or is_holiday:
                            model.Add(is_off[(n, d)] == 1)
                            model.Add(shifts[(n, d, SHIFT_MORNING)] == 0)
                            model.Add(shifts[(n, d, SHIFT_AFTERNOON)] == 0)
                            model.Add(shifts[(n, d, SHIFT_NIGHT)] == 0)
                            gov_constraints_applied_count += 4
                        else:
                            model.Add(is_off[(n, d)] == 0)
                            model.Add(shifts[(n, d, SHIFT_AFTERNOON)] == 0)
                            model.Add(shifts[(n, d, SHIFT_NIGHT)] == 0)
                            gov_constraints_applied_count += 3
                    except Exception as gov_err:
                        print(f"!!! ERROR setting constraints for Gov Official {nurse_id_map[n]} on day {d}: {gov_err}")
        print(f"Applied {gov_constraints_applied_count} fixed schedule constraints for Government Officials.")


        print("--- Applying Transitions & Consecutive Constraints (Non-Gov Only) ---")
        nm_transition_penalties = []
        consecutive_constraints_applied_count = 0

        consecutive_shift_count_ending_day = {}
        for n in non_gov_indices:
            for d in day_indices:
                consecutive_shift_count_ending_day[n, d] = model.NewIntVar(0, MAX_CONSECUTIVE_SHIFTS_WORKED, f'csh_n{n}_d{d}')


        for n in non_gov_indices:
            prev_state = previous_states.get(n, {'last_day_shifts': [], 'consecutive_shifts': 0, 'was_off_last_day': True, 'last_shift_types_count': {}})
            last_day_prev_shifts = prev_state.get('last_day_shifts', [])
            last_shift_types_count = prev_state.get('last_shift_types_count', {})

            if SHIFT_AFTERNOON in last_day_prev_shifts:
                 model.Add(shifts[(n, 0, SHIFT_NIGHT)] == 0); consecutive_constraints_applied_count +=1
            
            if SHIFT_NIGHT in last_day_prev_shifts and SHIFT_AFTERNOON in last_day_prev_shifts:
                model.Add(shifts[(n, 0, SHIFT_NIGHT)] == 0); consecutive_constraints_applied_count +=1
                if PENALTY_NIGHT_TO_MORNING_TRANSITION > 0:
                    nm_transition_penalties.append(shifts[(n, 0, SHIFT_MORNING)])

            if MAX_CONSECUTIVE_SAME_SHIFT > 0:
                for s_type in SHIFTS:
                    prev_count = last_shift_types_count.get(s_type, 0)
                    if prev_count >= MAX_CONSECUTIVE_SAME_SHIFT:
                        model.Add(shifts[(n, 0, s_type)] == 0)
                        consecutive_constraints_applied_count += 1
                    elif prev_count == MAX_CONSECUTIVE_SAME_SHIFT - 1:
                        if num_days >= 2:
                            model.Add(shifts[(n, 0, s_type)] + shifts[(n, 1, s_type)] <= 1)
                            consecutive_constraints_applied_count += 1
                    elif prev_count == MAX_CONSECUTIVE_SAME_SHIFT - 2:
                        if num_days >= 3:
                            model.Add(shifts[(n, 0, s_type)] + shifts[(n, 1, s_type)] + shifts[(n, 2, s_type)] <= MAX_CONSECUTIVE_SAME_SHIFT - prev_count)
                            consecutive_constraints_applied_count += 1

            if num_days > 1:
                for d in range(num_days - 1):
                    model.Add(shifts[(n, d, SHIFT_AFTERNOON)] + shifts[(n, d + 1, SHIFT_NIGHT)] <= 1); consecutive_constraints_applied_count +=1
                    
                    na_double_d_indicator = model.NewBoolVar(f'na_d_n{n}_d{d}')
                    model.AddMultiplicationEquality(na_double_d_indicator, [shifts[(n, d, SHIFT_NIGHT)], shifts[(n, d, SHIFT_AFTERNOON)]])
                    model.AddImplication(na_double_d_indicator, shifts[(n, d+1, SHIFT_NIGHT)].Not()); consecutive_constraints_applied_count +=1

                    if PENALTY_NIGHT_TO_MORNING_TRANSITION > 0:
                        temp_m_indicator = model.NewBoolVar(f'nm_t_n{n}_d{d}')
                        model.AddBoolAnd([na_double_d_indicator, shifts[(n, d + 1, SHIFT_MORNING)]]).OnlyEnforceIf(temp_m_indicator)
                        model.AddImplication(temp_m_indicator, na_double_d_indicator)
                        model.AddImplication(temp_m_indicator, shifts[(n, d + 1, SHIFT_MORNING)])
                        nm_transition_penalties.append(temp_m_indicator)

            if MAX_CONSECUTIVE_SHIFTS_WORKED > 0:
                prev_consecutive_shifts = prev_state['consecutive_shifts']
                prev_was_off = prev_state['was_off_last_day']

                model.Add(consecutive_shift_count_ending_day[n, 0] == 0).OnlyEnforceIf(is_off[n, 0])
                
                was_off_var_d0 = model.NewConstant(1 if prev_was_off else 0)
                was_working_var_d0 = model.NewConstant(0 if prev_was_off else 1)

                model.Add(consecutive_shift_count_ending_day[n, 0] == num_shifts_on_day[n, 0]).OnlyEnforceIf(is_working[n, 0]).OnlyEnforceIf(was_off_var_d0)
                model.Add(consecutive_shift_count_ending_day[n, 0] == prev_consecutive_shifts + num_shifts_on_day[n, 0]).OnlyEnforceIf(is_working[n, 0]).OnlyEnforceIf(was_working_var_d0)
                
                model.Add(consecutive_shift_count_ending_day[n, 0] <= MAX_CONSECUTIVE_SHIFTS_WORKED)


                if num_days > 1:
                    for d in range(1, num_days):
                        model.Add(consecutive_shift_count_ending_day[n, d] == 0).OnlyEnforceIf(is_off[n, d])
                        model.Add(consecutive_shift_count_ending_day[n, d] == num_shifts_on_day[n, d]).OnlyEnforceIf(is_working[n, d]).OnlyEnforceIf(is_off[n, d-1])
                        model.Add(consecutive_shift_count_ending_day[n, d] == consecutive_shift_count_ending_day[n, d-1] + num_shifts_on_day[n, d]).OnlyEnforceIf(is_working[n, d]).OnlyEnforceIf(is_working[n, d-1])
                        
                        model.Add(consecutive_shift_count_ending_day[n, d] <= MAX_CONSECUTIVE_SHIFTS_WORKED)
                        consecutive_constraints_applied_count +=1


            if MAX_CONSECUTIVE_SAME_SHIFT > 0:
                for s_type in SHIFTS:
                    if num_days > MAX_CONSECUTIVE_SAME_SHIFT:
                        for d_start in range(num_days - MAX_CONSECUTIVE_SAME_SHIFT):
                            model.Add(sum(shifts[(n, d_start + k, s_type)] for k in range(MAX_CONSECUTIVE_SAME_SHIFT + 1)) <= MAX_CONSECUTIVE_SAME_SHIFT); consecutive_constraints_applied_count +=1
            
            if MAX_CONSECUTIVE_OFF_DAYS > 0:
                if num_days > MAX_CONSECUTIVE_OFF_DAYS:
                    for d_start in range(num_days - MAX_CONSECUTIVE_OFF_DAYS):
                        model.Add(sum(is_off[(n, d_start + k)] for k in range(MAX_CONSECUTIVE_OFF_DAYS + 1)) <= MAX_CONSECUTIVE_OFF_DAYS); consecutive_constraints_applied_count +=1

            if num_days >= WINDOW_SIZE_FOR_MIN_OFF and MIN_OFF_DAYS_IN_WINDOW > 0:
                for d_start in range(num_days - WINDOW_SIZE_FOR_MIN_OFF + 1):
                    model.Add(sum(is_off[(n, d_start + k)] for k in range(WINDOW_SIZE_FOR_MIN_OFF)) >= MIN_OFF_DAYS_IN_WINDOW); consecutive_constraints_applied_count +=1
        print(f"Applied {consecutive_constraints_applied_count} transition/consecutive constraints for Non-Gov officials.")

        print("--- Applying Approved Hard Requests (Non-Gov Only) ---")
        approved_hard_requests_applied_count = 0
        date_to_day_index = {day.isoformat(): d for d, day in enumerate(days)}
        non_gov_ids = [nurse_id_map[n] for n in non_gov_indices]
        if db_admin and non_gov_ids:
            try:
                hard_requests_ref = db_admin.collection('approvedHardRequests')
                query = hard_requests_ref.where(filter=FieldFilter('date', '>=', start_date_str)) \
                                     .where(filter=FieldFilter('date', '<=', end_date_str)) \
                                     .where(filter=FieldFilter('nurseId', 'in', non_gov_ids))
                approved_requests = query.stream()
                for req_doc in approved_requests:
                    req_data = req_doc.to_dict()
                    req_nurse_id = req_data.get('nurseId')
                    req_date_str = req_data.get('date')
                    if req_nurse_id in nurse_id_to_index and req_date_str in date_to_day_index:
                        n = nurse_id_to_index[req_nurse_id]
                        if n in non_gov_indices:
                            d = date_to_day_index[req_date_str]
                            try:
                                model.Add(is_off[(n, d)] == 1)
                                approved_hard_requests_applied_count += 1
                            except Exception as apply_err:
                                print(f"!!! ERROR applying hard request constraint for non-gov nurse {req_nurse_id} on day {d}: {apply_err}")
            except Exception as firestore_err:
                print(f"!!! ERROR fetching approved hard requests from Firestore: {firestore_err}")
        elif not non_gov_ids:
            print("No non-government nurses, skipping Firestore Hard Request check.")
        else:
            print("Firestore Admin not initialized, skipping Hard Request check.")
        print(f"Applied/Accounted for {approved_hard_requests_applied_count} Approved Hard Requests for Non-Gov officials.")


        print("--- Applying Permanent Profile Constraints (Non-Gov Only) ---")
        applied_permanent_constraints_count = 0
        objective_penalty_terms = []
        day_of_week_map_local_pc = {'no_mondays': 0, 'no_tuesdays': 1, 'no_wednesdays': 2, 'no_thursdays': 3, 'no_fridays': 4, 'no_saturdays': 5, 'no_sundays': 6}
        for n in non_gov_indices:
            nurse_id = nurse_id_map[n]
            permanent_constraints = nurse_permanent_constraints.get(nurse_id, [])
            for constraint in permanent_constraints:
                ctype, cval, cstr = constraint.get('type'), constraint.get('value'), constraint.get('strength', 'hard')
                if not ctype: continue
                try:
                    vvars, is_hard = [], (cstr == 'hard')
                    if is_hard:
                        if ctype in day_of_week_map_local_pc:
                            target_wd = day_of_week_map_local_pc[ctype];
                            for d in day_indices:
                                if days[d].weekday() == target_wd: model.Add(is_off[(n, d)] == 1); applied_permanent_constraints_count += 1
                        elif ctype == 'no_morning_shifts':
                            for d in day_indices: model.Add(shifts[(n, d, SHIFT_MORNING)] == 0); applied_permanent_constraints_count += 1
                        elif ctype == 'no_afternoon_shifts':
                            for d in day_indices: model.Add(shifts[(n, d, SHIFT_AFTERNOON)] == 0); applied_permanent_constraints_count += 1
                        elif ctype == 'no_night_shifts':
                            for d in day_indices: model.Add(shifts[(n, d, SHIFT_NIGHT)] == 0); applied_permanent_constraints_count += 1
                        elif ctype == 'no_night_afternoon_double':
                            for d in day_indices: model.Add(shifts[(n, d, SHIFT_NIGHT)] + shifts[(n, d, SHIFT_AFTERNOON)] <= 1); applied_permanent_constraints_count += 1
                        elif ctype == 'no_specific_days' and isinstance(cval, list):
                            try:
                                f_days = [int(dn) for dn in cval if isinstance(dn, (str, int)) and str(dn).isdigit()]
                                for d in day_indices:
                                    if days[d].day in f_days: model.Add(is_off[(n, d)] == 1); applied_permanent_constraints_count += 1
                            except (ValueError, TypeError): pass
                    else:
                        if ctype in day_of_week_map_local_pc:
                            target_wd = day_of_week_map_local_pc[ctype];
                            for d in day_indices:
                                if days[d].weekday() == target_wd: vvars.append(is_working[(n, d)])
                        elif ctype == 'no_morning_shifts':
                            for d in day_indices: vvars.append(shifts[(n, d, SHIFT_MORNING)])
                        elif ctype == 'no_afternoon_shifts':
                            for d in day_indices: vvars.append(shifts[(n, d, SHIFT_AFTERNOON)])
                        elif ctype == 'no_night_shifts':
                            for d in day_indices: vvars.append(shifts[(n, d, SHIFT_NIGHT)])
                        elif ctype == 'no_night_afternoon_double':
                            for d in day_indices:
                                na_dv = model.NewBoolVar(f'pna_n{n}_d{d}'); model.AddMultiplicationEquality(na_dv,[shifts[(n,d,SHIFT_NIGHT)],shifts[(n,d,SHIFT_AFTERNOON)]]); vvars.append(na_dv)
                        elif ctype == 'no_specific_days' and isinstance(cval, list):
                            try:
                                f_days = [int(dn) for dn in cval if isinstance(dn, (str, int)) and str(dn).isdigit()]
                                for d in day_indices:
                                    if days[d].day in f_days: vvars.append(is_working[(n, d)])
                            except (ValueError, TypeError): pass
                    if vvars:
                        for var in vvars: objective_penalty_terms.append((PENALTY_BASE_SOFT_VIOLATION, var))
                except Exception as pce:
                    print(f"!ERR processing permanent constraint '{ctype}' for non-gov nurse {nurse_id}: {pce}")
        print(f"Applied {applied_permanent_constraints_count} hard permanent constraints and {len([p for p_val,v in objective_penalty_terms if p_val == PENALTY_BASE_SOFT_VIOLATION])} soft permanent penalty terms for Non-Gov officials.")


        print("--- Applying Monthly Soft Requests (Non-Gov Only) For Penalties ---")
        monthly_soft_penalties_count = 0
        day_of_week_map_local_msr = {'no_mondays': 0, 'no_tuesdays': 1, 'no_wednesdays': 2, 'no_thursdays': 3, 'no_fridays': 4, 'no_saturdays': 5, 'no_sundays': 6}
        REQUEST_TYPE_SPECIFIC_SHIFTS = 'request_specific_shifts_on_days'

        for n in non_gov_indices:
            nurse_id = nurse_id_map[n]
            monthly_requests = monthly_soft_requests_input.get(nurse_id, [])
            
            for req_idx, req in enumerate(monthly_requests):
                rtype, rval, is_hp = req.get('type'), req.get('value'), req.get('is_high_priority', False)
                if not rtype: continue
                try:
                    penalty_weight = PENALTY_BASE_SOFT_VIOLATION
                    if is_hp: penalty_weight += BONUS_HIGH_PRIORITY
                    if is_hp and carry_over_flags_input.get(nurse_id, False):
                        penalty_weight += BONUS_CARRY_OVER
                    
                    curr_vvars_for_penalty_sum = []
                    
                    if rtype == REQUEST_TYPE_SPECIFIC_SHIFTS and isinstance(rval, list) and rval:
                        violation_triggers_for_this_request = []
                        for sub_req_item_idx, sub_req_data in enumerate(rval):
                            req_day_num = sub_req_data.get('day')
                            req_shift_code = sub_req_data.get('shift_type')

                            d_idx_for_req = -1
                            for d_lookup, day_obj_lookup in enumerate(days):
                                if day_obj_lookup.day == req_day_num:
                                    d_idx_for_req = d_lookup
                                    break
                            
                            if d_idx_for_req != -1 and req_shift_code is not None:
                                d_s = d_idx_for_req
                                part_not_met_var = model.NewBoolVar(f'srs_part_notmet_n{n}_req{req_idx}_item{sub_req_item_idx}')

                                if req_shift_code == SHIFT_CODE_M_REQUEST:
                                    model.Add(shifts[(n, d_s, SHIFT_MORNING)] == 0).OnlyEnforceIf(part_not_met_var)
                                    model.Add(shifts[(n, d_s, SHIFT_MORNING)] == 1).OnlyEnforceIf(part_not_met_var.Not())
                                elif req_shift_code == SHIFT_CODE_A_REQUEST:
                                    model.Add(shifts[(n, d_s, SHIFT_AFTERNOON)] == 0).OnlyEnforceIf(part_not_met_var)
                                    model.Add(shifts[(n, d_s, SHIFT_AFTERNOON)] == 1).OnlyEnforceIf(part_not_met_var.Not())
                                elif req_shift_code == SHIFT_CODE_N_REQUEST:
                                    model.Add(shifts[(n, d_s, SHIFT_NIGHT)] == 0).OnlyEnforceIf(part_not_met_var)
                                    model.Add(shifts[(n, d_s, SHIFT_NIGHT)] == 1).OnlyEnforceIf(part_not_met_var.Not())
                                elif req_shift_code == SHIFT_CODE_NA_DOUBLE_REQUEST:
                                    got_na_double_for_part = model.NewBoolVar(f'srs_got_na_n{n}_d{d_s}_req{req_idx}_item{sub_req_item_idx}')
                                    model.AddBoolAnd([shifts[(n, d_s, SHIFT_NIGHT)], shifts[(n, d_s, SHIFT_AFTERNOON)]]).OnlyEnforceIf(got_na_double_for_part)
                                    model.AddBoolOr([shifts[(n, d_s, SHIFT_NIGHT)].Not(), shifts[(n, d_s, SHIFT_AFTERNOON)].Not()]).OnlyEnforceIf(got_na_double_for_part.Not())
                                    model.Add(part_not_met_var == got_na_double_for_part.Not())
                                else:
                                    model.Add(part_not_met_var == 1) 
                                violation_triggers_for_this_request.append(part_not_met_var)
                        
                        if violation_triggers_for_this_request:
                            overall_request_violated_indicator = model.NewBoolVar(f'srs_overall_violated_n{n}_req{req_idx}')
                            model.AddMaxEquality(overall_request_violated_indicator, violation_triggers_for_this_request)
                            objective_penalty_terms.append((penalty_weight, overall_request_violated_indicator))
                            monthly_soft_penalties_count += 1
                    
                    elif rtype in day_of_week_map_local_msr:
                        twd = day_of_week_map_local_msr[rtype];
                        for d in day_indices:
                            if days[d].weekday() == twd: curr_vvars_for_penalty_sum.append(is_working[(n, d)])
                    elif rtype == 'no_morning_shifts':
                        for d in day_indices: curr_vvars_for_penalty_sum.append(shifts[(n, d, SHIFT_MORNING)])
                    elif rtype == 'no_afternoon_shifts':
                        for d in day_indices: curr_vvars_for_penalty_sum.append(shifts[(n, d, SHIFT_AFTERNOON)])
                    elif rtype == 'no_night_shifts':
                        for d in day_indices: curr_vvars_for_penalty_sum.append(shifts[(n, d, SHIFT_NIGHT)])
                    elif rtype == 'no_night_afternoon_double':
                        for d in day_indices: mna_dv=model.NewBoolVar(f'mna_n{n}_d{d}_r{req_idx}'); model.AddMultiplicationEquality(mna_dv,[shifts[(n,d,SHIFT_NIGHT)],shifts[(n,d,SHIFT_AFTERNOON)]]); curr_vvars_for_penalty_sum.append(mna_dv)
                    elif rtype == 'no_specific_days' and isinstance(rval, list):
                        try:
                            f_days_req = [int(dn_str) for dn_str in rval if isinstance(dn_str, (str, int)) and str(dn_str).isdigit() and 1 <= int(dn_str) <= 31]
                            for d in day_indices:
                                if days[d].day in f_days_req: curr_vvars_for_penalty_sum.append(is_working[(n, d)])
                        except (ValueError, TypeError):
                            print(f"WARN: Invalid value '{rval}' for 'no_specific_days' (monthly) for nurse {nurse_id}")
                    
                    if curr_vvars_for_penalty_sum:
                        for var_penalty in curr_vvars_for_penalty_sum:
                            objective_penalty_terms.append((penalty_weight, var_penalty))
                            monthly_soft_penalties_count += 1

                except Exception as mce:
                    print(f"!ERR processing monthly request '{rtype}' for non-gov nurse {nurse_id} for penalty: {mce}\n{traceback.format_exc()}")
        print(f"Applied {monthly_soft_penalties_count} monthly soft request penalty terms for Non-Gov officials.")


        print("--- Defining Objective Function (Non-Gov Penalties) ---")
        if num_non_gov > 0:
            total_off_non_gov = [model.NewIntVar(0, num_days, f'toff_n{i}') for i in range(num_non_gov)]
            total_shifts_non_gov_model_vars = [model.NewIntVar(0, num_days * 2, f'tsh_n{i}') for i in range(num_non_gov)]
            total_m_non_gov_model_vars = [model.NewIntVar(0, num_days, f'tm_n{i}') for i in range(num_non_gov)]
            total_a_non_gov_model_vars = [model.NewIntVar(0, num_days, f'ta_n{i}') for i in range(num_non_gov)]
            total_n_non_gov_model_vars = [model.NewIntVar(0, num_days, f'tn_n{i}') for i in range(num_non_gov)]

            for i, n_ng_idx in enumerate(non_gov_indices):
                model.Add(total_off_non_gov[i] == sum(is_off[(n_ng_idx, d)] for d in day_indices))
                model.Add(total_m_non_gov_model_vars[i] == sum(shifts[(n_ng_idx, d, SHIFT_MORNING)] for d in day_indices))
                model.Add(total_a_non_gov_model_vars[i] == sum(shifts[(n_ng_idx, d, SHIFT_AFTERNOON)] for d in day_indices))
                model.Add(total_n_non_gov_model_vars[i] == sum(shifts[(n_ng_idx, d, SHIFT_NIGHT)] for d in day_indices))
                model.Add(total_shifts_non_gov_model_vars[i] == sum(num_shifts_on_day[n_ng_idx, d] for d in day_indices))

            if TARGET_OFF_DAYS >= 0 and PENALTY_OFF_DAY_UNDER_TARGET > 0:
                off_under_non_gov = [model.NewIntVar(0, num_days, f'offu_n{i}') for i in range(num_non_gov)];
                for i in range(num_non_gov): model.Add(off_under_non_gov[i] >= TARGET_OFF_DAYS - total_off_non_gov[i]); model.Add(off_under_non_gov[i] >= 0)
                total_under_non_gov = model.NewIntVar(0, num_non_gov * num_days, 'tot_under_ng'); model.Add(total_under_non_gov == sum(off_under_non_gov)); objective_penalty_terms.append((PENALTY_OFF_DAY_UNDER_TARGET, total_under_non_gov))
                print(f"Added Target Off Day penalty term ({PENALTY_OFF_DAY_UNDER_TARGET}) for non-gov.")

            if num_non_gov > 1:
                if PENALTY_OFF_DAY_IMBALANCE > 0:
                    min_off_ng, max_off_ng = model.NewIntVar(0,num_days,'minoff_ng'), model.NewIntVar(0,num_days,'maxoff_ng'); model.AddMinEquality(min_off_ng, total_off_non_gov); model.AddMaxEquality(max_off_ng, total_off_non_gov); objective_penalty_terms.append((PENALTY_OFF_DAY_IMBALANCE, max_off_ng - min_off_ng))
                    print(f"Added Off Day Imbalance penalty term ({PENALTY_OFF_DAY_IMBALANCE}) for non-gov.")
                if PENALTY_TOTAL_SHIFT_IMBALANCE > 0:
                    min_tsh_ng, max_tsh_ng = model.NewIntVar(0,num_days*2,'mintsh_ng'), model.NewIntVar(0,num_days*2,'maxtsh_ng'); model.AddMinEquality(min_tsh_ng, total_shifts_non_gov_model_vars); model.AddMaxEquality(max_tsh_ng, total_shifts_non_gov_model_vars); objective_penalty_terms.append((PENALTY_TOTAL_SHIFT_IMBALANCE, max_tsh_ng - min_tsh_ng))
                    print(f"Added Total Shift Imbalance penalty term ({PENALTY_TOTAL_SHIFT_IMBALANCE}) for non-gov.")
                if PENALTY_SHIFT_TYPE_IMBALANCE > 0:
                    min_m_ng, max_m_ng = model.NewIntVar(0,num_days,'minm_ng'), model.NewIntVar(0,num_days,'maxm_ng'); model.AddMinEquality(min_m_ng, total_m_non_gov_model_vars); model.AddMaxEquality(max_m_ng, total_m_non_gov_model_vars); objective_penalty_terms.append((PENALTY_SHIFT_TYPE_IMBALANCE, max_m_ng - min_m_ng))
                    min_a_ng, max_a_ng = model.NewIntVar(0,num_days,'mina_ng'), model.NewIntVar(0,num_days,'maxa_ng'); model.AddMinEquality(min_a_ng, total_a_non_gov_model_vars); model.AddMaxEquality(max_a_ng, total_a_non_gov_model_vars); objective_penalty_terms.append((PENALTY_SHIFT_TYPE_IMBALANCE, max_a_ng - min_a_ng))
                    min_n_sh_ng, max_n_sh_ng = model.NewIntVar(0,num_days,'minn_ng'), model.NewIntVar(0,num_days,'maxn_ng'); model.AddMinEquality(min_n_sh_ng, total_n_non_gov_model_vars); model.AddMaxEquality(max_n_sh_ng, total_n_non_gov_model_vars); objective_penalty_terms.append((PENALTY_SHIFT_TYPE_IMBALANCE, max_n_sh_ng - min_n_sh_ng))
                    print(f"Added Shift Type Imbalance penalty term ({PENALTY_SHIFT_TYPE_IMBALANCE}) for non-gov.")
            
            if PENALTY_PER_NA_DOUBLE > 0:
                na_double_terms_non_gov = [];
                for n_ng_idx in non_gov_indices:
                    for d in day_indices: na_ind=model.NewBoolVar(f'nad_n{n_ng_idx}_d{d}'); model.AddMultiplicationEquality(na_ind,[shifts[(n_ng_idx,d,SHIFT_NIGHT)],shifts[(n_ng_idx,d,SHIFT_AFTERNOON)]]); na_double_terms_non_gov.append(na_ind)
                if na_double_terms_non_gov: objective_penalty_terms.append((PENALTY_PER_NA_DOUBLE, sum(na_double_terms_non_gov)))
                print(f"Added N/A Double penalty term ({PENALTY_PER_NA_DOUBLE}) for non-gov.")

            if nm_transition_penalties and PENALTY_NIGHT_TO_MORNING_TRANSITION > 0:
                objective_penalty_terms.append((PENALTY_NIGHT_TO_MORNING_TRANSITION, sum(nm_transition_penalties)))
                print(f"Added N/A->Morning Transition penalty term ({PENALTY_NIGHT_TO_MORNING_TRANSITION}) for non-gov.")
            
            if num_days > 0 and MAX_CONSECUTIVE_SHIFTS_WORKED > 0 and PENALTY_ENDING_MONTH_AT_MAX_CONSECUTIVE > 0:
                ends_month_at_max_vars = []
                last_day_idx = num_days - 1
                for i, n_ng_idx in enumerate(non_gov_indices):
                    ends_at_max_var = model.NewBoolVar(f'ends_max_n{n_ng_idx}')
                    model.Add(consecutive_shift_count_ending_day[n_ng_idx, last_day_idx] == MAX_CONSECUTIVE_SHIFTS_WORKED).OnlyEnforceIf(ends_at_max_var)
                    model.Add(consecutive_shift_count_ending_day[n_ng_idx, last_day_idx] < MAX_CONSECUTIVE_SHIFTS_WORKED).OnlyEnforceIf(ends_at_max_var.Not())
                    ends_month_at_max_vars.append(ends_at_max_var)
                
                if ends_month_at_max_vars:
                    objective_penalty_terms.append((PENALTY_ENDING_MONTH_AT_MAX_CONSECUTIVE, sum(ends_month_at_max_vars)))
                    print(f"Added Penalty for ending month at max consecutive shifts ({PENALTY_ENDING_MONTH_AT_MAX_CONSECUTIVE}) for non-gov.")

        if objective_penalty_terms:
            print(f"Total objective penalty terms: {len(objective_penalty_terms)}")
            model.Minimize(sum(penalty * var for penalty, var in objective_penalty_terms))
        else:
            print("No penalties defined in objective function (either no non-gov nurses or no penalty terms applicable).")

        solver = cp_model.CpSolver(); solver.parameters.max_time_in_seconds = SOLVER_TIME_LIMIT; solver.parameters.log_search_progress = True; solver.parameters.num_workers = 8
        print(f"\n--- Starting Solver (Time Limit: {SOLVER_TIME_LIMIT}s, Workers: {solver.parameters.num_workers}) ---")
        solve_start_time = time.time(); status = solver.Solve(model); solve_end_time = time.time()
        print(f"--- Solver Finished --- Status: {solver.StatusName(status)}, Time: {solve_end_time - solve_start_time:.2f}s")

        if status == cp_model.OPTIMAL or status == cp_model.FEASIBLE:
            objective_value = solver.ObjectiveValue() if objective_penalty_terms else 0
            print(f"Solution found (Status: {solver.StatusName(status)}). Objective Value: {objective_value:.2f}")
            
            nurse_next_carry_over_status = {}
            print("--- Calculating Potential Next Carry-over Flags (Non-Gov Only) based on New Logic ---")

            day_of_week_map_carry_over = {'no_mondays': 0, 'no_tuesdays': 1, 'no_wednesdays': 2, 'no_thursdays': 3, 'no_fridays': 4, 'no_saturdays': 5, 'no_sundays': 6}

            solved_total_shifts_for_carry_over = {}
            if num_non_gov > 0:
                for i, n_ng_idx_co in enumerate(non_gov_indices):
                    nurse_id_co = nurse_id_map[n_ng_idx_co]
                    solved_total_shifts_for_carry_over[nurse_id_co] = {
                        'm': 0, 'a': 0, 'n': 0, 'na_double': 0
                    }
                    try:
                        solved_total_shifts_for_carry_over[nurse_id_co]['m'] = solver.Value(total_m_non_gov_model_vars[i])
                        solved_total_shifts_for_carry_over[nurse_id_co]['a'] = solver.Value(total_a_non_gov_model_vars[i])
                        solved_total_shifts_for_carry_over[nurse_id_co]['n'] = solver.Value(total_n_non_gov_model_vars[i])
                        
                        current_nad_count = 0
                        for d_co in day_indices:
                            if solver.Value(shifts[(n_ng_idx_co, d_co, SHIFT_NIGHT)]) == 1 and \
                               solver.Value(shifts[(n_ng_idx_co, d_co, SHIFT_AFTERNOON)]) == 1:
                                current_nad_count += 1
                        solved_total_shifts_for_carry_over[nurse_id_co]['na_double'] = current_nad_count
                    except Exception as e:
                        print(f"WARN: Could not get solved total shifts for nurse {nurse_id_co} for carry-over logic: {e}. Defaulting to 0 counts.")


            for n_idx_main in nurse_indices:
                nurse_id_main = nurse_id_map[n_idx_main]
                is_gov_main = is_gov_official_map.get(n_idx_main, False)

                if is_gov_main:
                    nurse_next_carry_over_status[nurse_id_main] = False
                    continue

                unmet_hp_request_overall = False
                nurse_monthly_requests = monthly_soft_requests_input.get(nurse_id_main, [])
                high_priority_requests = [req for req in nurse_monthly_requests if req.get('is_high_priority', False)]

                if not high_priority_requests:
                    nurse_next_carry_over_status[nurse_id_main] = False
                    continue
                
                for hp_req in high_priority_requests:
                    if unmet_hp_request_overall: break

                    rtype = hp_req.get('type')
                    rval = hp_req.get('value')

                    if rtype == REQUEST_TYPE_SPECIFIC_SHIFTS and isinstance(rval, list) and rval:
                        request_fully_met_specific_shifts = True
                        for sub_req_item in rval:
                            req_day_num_co = sub_req_item.get('day')
                            req_shift_code_co = sub_req_item.get('shift_type')
                            
                            d_idx_for_req_co = -1
                            for d_lookup_co, day_obj_lookup_co in enumerate(days):
                                if day_obj_lookup_co.day == req_day_num_co:
                                    d_idx_for_req_co = d_lookup_co
                                    break
                            
                            if d_idx_for_req_co != -1 and req_shift_code_co is not None:
                                d_s_co = d_idx_for_req_co
                                got_this_part = False
                                if req_shift_code_co == SHIFT_CODE_M_REQUEST:
                                    if solver.Value(shifts[(n_idx_main, d_s_co, SHIFT_MORNING)]) == 1: got_this_part = True
                                elif req_shift_code_co == SHIFT_CODE_A_REQUEST:
                                    if solver.Value(shifts[(n_idx_main, d_s_co, SHIFT_AFTERNOON)]) == 1: got_this_part = True
                                elif req_shift_code_co == SHIFT_CODE_N_REQUEST:
                                    if solver.Value(shifts[(n_idx_main, d_s_co, SHIFT_NIGHT)]) == 1: got_this_part = True
                                elif req_shift_code_co == SHIFT_CODE_NA_DOUBLE_REQUEST:
                                    if solver.Value(shifts[(n_idx_main, d_s_co, SHIFT_NIGHT)]) == 1 and \
                                       solver.Value(shifts[(n_idx_main, d_s_co, SHIFT_AFTERNOON)]) == 1:
                                        got_this_part = True
                                
                                if not got_this_part:
                                    request_fully_met_specific_shifts = False
                                    break
                            else:
                                request_fully_met_specific_shifts = False 
                                break
                        
                        if not request_fully_met_specific_shifts:
                            unmet_hp_request_overall = True


                    elif rtype in day_of_week_map_carry_over:
                        target_weekday = day_of_week_map_carry_over[rtype]
                        requested_day_occurrences_in_month = 0
                        days_off_on_requested_weekday = 0
                        for d_idx, day_obj in enumerate(days):
                            if day_obj.weekday() == target_weekday:
                                requested_day_occurrences_in_month += 1
                                if solver.Value(is_off[(n_idx_main, d_idx)]) == 1:
                                    days_off_on_requested_weekday += 1
                        
                        if requested_day_occurrences_in_month > 0:
                            min_required_off = 0
                            if requested_day_occurrences_in_month == 1: min_required_off = 1
                            elif requested_day_occurrences_in_month == 2: min_required_off = 2
                            elif requested_day_occurrences_in_month == 3: min_required_off = 2
                            elif requested_day_occurrences_in_month == 4: min_required_off = 3
                            elif requested_day_occurrences_in_month >= 5: min_required_off = 4
                            
                            if days_off_on_requested_weekday < min_required_off:
                                unmet_hp_request_overall = True
                    
                    elif rtype == 'no_specific_days':
                        parsed_specific_days_req = []
                        if isinstance(rval, list):
                            for dn_str in rval:
                                try: parsed_specific_days_req.append(int(dn_str))
                                except (ValueError, TypeError): pass
                        
                        if not 1 <= len(parsed_specific_days_req) <= 2:
                            continue

                        if len(parsed_specific_days_req) == 1:
                            day_num_requested = parsed_specific_days_req[0]
                            worked_on_requested_day = False
                            for d_idx, day_obj in enumerate(days):
                                if day_obj.day == day_num_requested:
                                    if solver.Value(is_off[(n_idx_main, d_idx)]) == 0:
                                        worked_on_requested_day = True
                                    break
                            if worked_on_requested_day:
                                unmet_hp_request_overall = True
                        
                        elif len(parsed_specific_days_req) == 2:
                            got_both_days_off = True
                            for day_num_req_val in parsed_specific_days_req:
                                worked_this_specific_day = False
                                for d_idx, day_obj in enumerate(days):
                                    if day_obj.day == day_num_req_val:
                                        if solver.Value(is_off[(n_idx_main, d_idx)]) == 0:
                                            worked_this_specific_day = True
                                        break
                                if worked_this_specific_day:
                                    got_both_days_off = False
                                    break
                            if not got_both_days_off:
                                unmet_hp_request_overall = True

                    elif rtype in ['no_morning_shifts', 'no_afternoon_shifts', 'no_night_shifts', 'no_night_afternoon_double']:
                        actual_shifts_of_type_for_nurse_n = 0
                        shift_key_for_solved_counts = ''
                        if rtype == 'no_morning_shifts': shift_key_for_solved_counts = 'm'
                        elif rtype == 'no_afternoon_shifts': shift_key_for_solved_counts = 'a'
                        elif rtype == 'no_night_shifts': shift_key_for_solved_counts = 'n'
                        elif rtype == 'no_night_afternoon_double': shift_key_for_solved_counts = 'na_double'
                        
                        actual_shifts_of_type_for_nurse_n = solved_total_shifts_for_carry_over.get(nurse_id_main, {}).get(shift_key_for_solved_counts, 0)

                        if num_non_gov == 1:
                            if actual_shifts_of_type_for_nurse_n > 0:
                                unmet_hp_request_overall = True
                        else:
                            sum_shifts_other_nurses = 0
                            count_other_nurses = 0
                            for other_n_idx in non_gov_indices:
                                if other_n_idx == n_idx_main: continue
                                other_nurse_id = nurse_id_map[other_n_idx]
                                sum_shifts_other_nurses += solved_total_shifts_for_carry_over.get(other_nurse_id, {}).get(shift_key_for_solved_counts, 0)
                                count_other_nurses += 1
                            
                            if count_other_nurses > 0:
                                average_shifts_of_type_others = sum_shifts_other_nurses / count_other_nurses
                                if average_shifts_of_type_others == 0:
                                    if actual_shifts_of_type_for_nurse_n > 0:
                                        unmet_hp_request_overall = True
                                else:
                                    percentage_of_average = (actual_shifts_of_type_for_nurse_n / average_shifts_of_type_others) * 100
                                    if percentage_of_average > 50.0:
                                        unmet_hp_request_overall = True
                
                nurse_next_carry_over_status[nurse_id_main] = unmet_hp_request_overall

            nurse_schedules, shifts_count = {}, {}
            try:
                for n_result_idx in nurse_indices:
                    nurse_id_result = nurse_id_map[n_result_idx]
                    nurse_info = next((item for item in nurses_data if item["id"] == nurse_id_result), None)
                    if not nurse_info: continue
                    
                    nurse_schedule_result = {"nurse": {k: nurse_info.get(k) for k in ['id', 'prefix', 'firstName', 'lastName', 'isGovernmentOfficial']}, "shifts": {day_iso: [] for day_iso in days_iso}}
                    off_c, m_c, a_c, n_c, tot_c, nad_c = 0, 0, 0, 0, 0, 0
                    
                    for d_result_idx, day_iso_val in enumerate(days_iso):
                        d_shifts_list = []; has_m, has_a, has_n = False, False, False
                        try: has_m = solver.Value(shifts[(n_result_idx, d_result_idx, SHIFT_MORNING)]) == 1
                        except: pass
                        try: has_a = solver.Value(shifts[(n_result_idx, d_result_idx, SHIFT_AFTERNOON)]) == 1
                        except: pass
                        try: has_n = solver.Value(shifts[(n_result_idx, d_result_idx, SHIFT_NIGHT)]) == 1
                        except: pass

                        if has_m: d_shifts_list.append(SHIFT_MORNING); m_c += 1; tot_c += 1
                        if has_a: d_shifts_list.append(SHIFT_AFTERNOON); a_c += 1; tot_c += 1
                        if has_n: d_shifts_list.append(SHIFT_NIGHT); n_c += 1; tot_c += 1
                        
                        nurse_schedule_result["shifts"][day_iso_val] = sorted(d_shifts_list)
                        if not d_shifts_list: off_c += 1
                        if has_n and has_a: nad_c += 1
                            
                    nurse_schedules[nurse_id_result] = nurse_schedule_result
                    shifts_count[nurse_id_result] = {"morning": m_c, "afternoon": a_c, "night": n_c, "total": tot_c, "nightAfternoonDouble": nad_c, "daysOff": off_c}
                
                
                non_gov_counts = [count for nid, count in shifts_count.items() if not is_gov_official_map.get(nurse_id_to_index.get(nid), True)]

                min_off, max_off = 0, 0
                min_sh, max_sh = 0, 0
                min_m, max_m = 0, 0
                min_a, max_a = 0, 0
                min_n, max_n = 0, 0
                tot_nad = 0

                if non_gov_counts:
                    min_off = min(c['daysOff'] for c in non_gov_counts)
                    max_off = max(c['daysOff'] for c in non_gov_counts)
                    min_sh = min(c['total'] for c in non_gov_counts)
                    max_sh = max(c['total'] for c in non_gov_counts)
                    min_m = min(c['morning'] for c in non_gov_counts)
                    max_m = max(c['morning'] for c in non_gov_counts)
                    min_a = min(c['afternoon'] for c in non_gov_counts)
                    max_a = max(c['afternoon'] for c in non_gov_counts)
                    min_n = min(c['night'] for c in non_gov_counts)
                    max_n = max(c['night'] for c in non_gov_counts)
                    tot_nad = sum(c['nightAfternoonDouble'] for c in non_gov_counts)

                total_time_taken = time.time() - start_time
                print(f"Schedule generation successful. Total time: {total_time_taken:.2f}s")
                return jsonify({
                    "nurseSchedules": nurse_schedules, 
                    "shiftsCount": shifts_count, 
                    "days": days_iso, 
                    "startDate": start_date_str, 
                    "endDate": end_date_str, 
                    "solverStatus": solver.StatusName(status), 
                    "penaltyValue": objective_value, 
                    "fairnessReport": {
                        "offDaysMin": min_off, "offDaysMax": max_off, 
                        "totalShiftsMin": min_sh, "totalShiftsMax": max_sh, 
                        "morningMin": min_m, "morningMax": max_m, 
                        "afternoonMin": min_a, "afternoonMax": max_a, 
                        "nightMin": min_n, "nightMax": max_n, 
                        "totalNADoubles": tot_nad 
                    }, 
                    "nextCarryOverFlags": nurse_next_carry_over_status 
                }), 200
            except Exception as res_err:
                print(f"!!! ERROR DURING RESULT PROCESSING !!!\n{traceback.format_exc()}"); 
                return jsonify({"error": f"เกิดข้อผิดพลาดในการประมวลผลผลลัพธ์: {res_err}"}), 500
        else:
            error_message = f"ไม่สามารถสร้างตารางเวรได้ (Solver Status: {solver.StatusName(status)}). ";
            if status == cp_model.INFEASIBLE: error_message += "ข้อจำกัด Hard Constraints ขัดแย้งกัน (อาจเกิดจากจำนวนพยาบาลไม่พอ, Hard Request, หรือข้อกำหนดข้าราชการ)"
            elif status == cp_model.UNKNOWN: error_message += f"อาจหมดเวลา ({SOLVER_TIME_LIMIT}s) ลองเพิ่มเวลาคำนวณ"
            elif status == cp_model.MODEL_INVALID: error_message += "โครงสร้าง Model ไม่ถูกต้อง (ตรวจสอบ Backend Log)"
            else: error_message += "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุระหว่างการ Solve"
            print(f"Schedule generation failed. Status: {solver.StatusName(status)}")
            return jsonify({"error": error_message}), 500

    except Exception as e:
        print(f"!!! UNEXPECTED ERROR IN generate_schedule_api !!!\n{traceback.format_exc()}")
        return jsonify({"error": f"เกิดข้อผิดพลาดไม่คาดคิดใน Server: {e}"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)