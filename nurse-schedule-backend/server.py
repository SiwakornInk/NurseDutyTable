# server.py

from flask import Flask, request, jsonify
from ortools.sat.python import cp_model
import datetime
import time
from flask_cors import CORS
import math
import traceback

app = Flask(__name__)
CORS(app)

SHIFT_MORNING = 1
SHIFT_AFTERNOON = 2
SHIFT_NIGHT = 3
SHIFTS = [SHIFT_MORNING, SHIFT_AFTERNOON, SHIFT_NIGHT]
SHIFT_NAMES_TH = {SHIFT_MORNING: 'ช', SHIFT_AFTERNOON: 'บ', SHIFT_NIGHT: 'ด', 0: 'หยุด'}
SHIFT_NAMES_EN = {SHIFT_MORNING: 'Morning', SHIFT_AFTERNOON: 'Afternoon', SHIFT_NIGHT: 'Night', 0: 'Off'}

PENALTY_OFF_DAY_UNDER_TARGET = 30
PENALTY_TOTAL_SHIFT_IMBALANCE = 15
PENALTY_SHIFT_TYPE_IMBALANCE = 10
PENALTY_OFF_DAY_IMBALANCE = 5
PENALTY_PER_NA_DOUBLE = 3
PENALTY_SOFT_CONSTRAINT_VIOLATION = 2
PENALTY_NIGHT_TO_MORNING_TRANSITION = 1

MAX_CONSECUTIVE_SAME_SHIFT = 2
MAX_CONSECUTIVE_OFF_DAYS = 2
MIN_OFF_DAYS_IN_WINDOW = 0
WINDOW_SIZE_FOR_MIN_OFF = 7

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

@app.route('/generate-schedule', methods=['POST'])
def generate_schedule_api():
    start_time = time.time()
    print("\n--- Received schedule generation request ---")
    try:
        data = request.get_json()

        if not data:
            return jsonify({"error": "Invalid JSON payload"}), 400
        try:
            nurses_data = data['nurses']
            schedule_info = data['schedule']

            start_date_str = schedule_info['startDate'].split('T')[0]
            end_date_str = schedule_info['endDate'].split('T')[0]

            holidays_input = schedule_info.get('holidays', [])

            REQ_MORNING = int(data.get('requiredNursesMorning', 2))
            REQ_AFTERNOON = int(data.get('requiredNursesAfternoon', 3))
            REQ_NIGHT = int(data.get('requiredNursesNight', 2))
            required_nurses_by_shift = {
                SHIFT_MORNING: REQ_MORNING, SHIFT_AFTERNOON: REQ_AFTERNOON, SHIFT_NIGHT: REQ_NIGHT
            }

            MAX_CONSECUTIVE_SHIFTS_WORKED = int(data.get('maxConsecutiveShiftsWorked', 6))

            TARGET_OFF_DAYS = int(data.get('targetOffDays', 8))
            SOLVER_TIME_LIMIT = float(data.get('solverTimeLimit', 60.0))

            if not isinstance(nurses_data, list) or not nurses_data: raise ValueError("Invalid or empty 'nurses' data")
            if not all('id' in n for n in nurses_data): raise ValueError("Missing 'id' in nurse data")
            if not isinstance(holidays_input, list) or not all(isinstance(h, int) and h > 0 and h < 32 for h in holidays_input): raise ValueError("Invalid 'holidays' list format")
            if REQ_MORNING < 0 or REQ_AFTERNOON < 0 or REQ_NIGHT < 0: raise ValueError("Required nurses cannot be negative")
            if MAX_CONSECUTIVE_SHIFTS_WORKED < 1: raise ValueError(f"Max consecutive shifts worked must be >= 1")
            if TARGET_OFF_DAYS < 0: raise ValueError("Target off days cannot be negative")
            if SOLVER_TIME_LIMIT < 5: print("Warning: Solver time limit < 5s is very short.")
            if MAX_CONSECUTIVE_SAME_SHIFT < 1: raise ValueError("Internal Error: MAX_CONSECUTIVE_SAME_SHIFT must be >= 1")
            if MAX_CONSECUTIVE_OFF_DAYS < 1: raise ValueError("Internal Error: MAX_CONSECUTIVE_OFF_DAYS must be >= 1")
            if MIN_OFF_DAYS_IN_WINDOW < 0: raise ValueError("Internal Error: MIN_OFF_DAYS_IN_WINDOW cannot be negative")
            if WINDOW_SIZE_FOR_MIN_OFF < 1: raise ValueError("Internal Error: WINDOW_SIZE_FOR_MIN_OFF must be >= 1")

        except (KeyError, TypeError, ValueError) as e:
            error_message = f"Data input error: {e}"
            print(f"Data extraction/validation error: {error_message}")
            print(traceback.format_exc())
            return jsonify({"error": f"ข้อมูล Input ไม่ถูกต้อง หรือไม่ครบถ้วน: {e}"}), 400
        except Exception as e:
            print(f"Unexpected error during data extraction: {e}")
            print(traceback.format_exc())
            return jsonify({"error": f"เกิดข้อผิดพลาดในการประมวลผลข้อมูล Input: {e}"}), 400


        days = get_days_array(start_date_str, end_date_str)
        if days is None:
            return jsonify({"error": "รูปแบบวันที่เริ่มต้น/สิ้นสุดไม่ถูกต้อง หรือไม่สามารถแปลงค่าได้"}), 400
        num_nurses = len(nurses_data)
        num_days = len(days)
        if num_days == 0:
             return jsonify({"error": "ช่วงวันที่ที่เลือกไม่ถูกต้อง ทำให้ไม่มีวันในตารางเวร"}), 400
        nurse_indices = range(num_nurses)
        day_indices = range(num_days)

        print(f"Processing schedule for {num_nurses} nurses over {num_days} days ({start_date_str} to {end_date_str}).")
        print(f"Requirements per shift (M/A/N): {REQ_MORNING}/{REQ_AFTERNOON}/{REQ_NIGHT}")
        print(f"Max Consecutive SHIFTS Worked (before off): {MAX_CONSECUTIVE_SHIFTS_WORKED}")
        print(f"USER TARGET Off Days (Min): {TARGET_OFF_DAYS}")
        print(f"Holidays (day numbers): {holidays_input}")
        print(f"Solver time limit: {SOLVER_TIME_LIMIT}s")
        print(f"Other Hard Constraints: MaxConsecSameShift={MAX_CONSECUTIVE_SAME_SHIFT}, MaxConsecOff={MAX_CONSECUTIVE_OFF_DAYS}, MinOffInWindow={MIN_OFF_DAYS_IN_WINDOW}/{WINDOW_SIZE_FOR_MIN_OFF} days")
        print(f"Penalty Weights: OffDayUnderTarget={PENALTY_OFF_DAY_UNDER_TARGET}, OffDayImbalance={PENALTY_OFF_DAY_IMBALANCE}, TotalShiftImbalance={PENALTY_TOTAL_SHIFT_IMBALANCE}, ShiftTypeImbalance={PENALTY_SHIFT_TYPE_IMBALANCE}, PerN+A={PENALTY_PER_NA_DOUBLE}, SoftConstraintViolation={PENALTY_SOFT_CONSTRAINT_VIOLATION}, N->M Transition={PENALTY_NIGHT_TO_MORNING_TRANSITION}")

        nurse_id_map = {n: nurses_data[n]['id'] for n in nurse_indices}
        nurse_constraints = {
            nurses_data[n]['id']: nurses_data[n].get('constraints', []) for n in nurse_indices
        }

        model = cp_model.CpModel()

        shifts = {}
        for n in nurse_indices:
            for d in day_indices:
                for s_val in SHIFTS:
                    shifts[(n, d, s_val)] = model.NewBoolVar(f'shift_n{n}_d{d}_s{s_val}')

        is_off = {}
        for n in nurse_indices:
            for d in day_indices:
                is_off[(n, d)] = model.NewBoolVar(f'is_off_n{n}_d{d}')

        print("--- Adding Hard Constraints ---")

        for n in nurse_indices:
            for d in day_indices:
                worked_shifts_today = [shifts[(n, d, s)] for s in SHIFTS]
                model.Add(sum(worked_shifts_today) == 0).OnlyEnforceIf(is_off[(n, d)])
                model.Add(sum(worked_shifts_today) >= 1).OnlyEnforceIf(is_off[(n, d)].Not())

        for n in nurse_indices:
             for d in day_indices:
                 model.Add(shifts[(n, d, SHIFT_MORNING)] + shifts[(n, d, SHIFT_AFTERNOON)] <= 1)
                 model.Add(shifts[(n, d, SHIFT_MORNING)] + shifts[(n, d, SHIFT_NIGHT)] <= 1)

        for d in day_indices:
            for s in SHIFTS:
                req = required_nurses_by_shift.get(s, 0)
                if req > 0:
                    model.Add(sum(shifts[(n, d, s)] for n in nurse_indices) == req)
                else:
                    model.Add(sum(shifts[(n, d, s)] for n in nurse_indices) == 0)


        print("NOTE: Hard constraint N(d) -> M(d+1) removed; using soft penalty instead.")

        for n in nurse_indices:
            if num_days > 1:
                for d in range(num_days - 1):
                    model.Add(shifts[(n, d, SHIFT_AFTERNOON)] + shifts[(n, d + 1, SHIFT_NIGHT)] <= 1)

        if MAX_CONSECUTIVE_SAME_SHIFT > 0:
            for n in nurse_indices:
                for s in SHIFTS:
                    if num_days > MAX_CONSECUTIVE_SAME_SHIFT:
                        for d_start in range(num_days - MAX_CONSECUTIVE_SAME_SHIFT):
                            model.Add(sum(shifts[(n, d_start + k, s)] for k in range(MAX_CONSECUTIVE_SAME_SHIFT + 1)) <= MAX_CONSECUTIVE_SAME_SHIFT)

        if MAX_CONSECUTIVE_OFF_DAYS > 0:
            for n in nurse_indices:
                if num_days > MAX_CONSECUTIVE_OFF_DAYS:
                    for d_start in range(num_days - MAX_CONSECUTIVE_OFF_DAYS):
                        model.Add(sum(is_off[(n, d_start + k)] for k in range(MAX_CONSECUTIVE_OFF_DAYS + 1)) <= MAX_CONSECUTIVE_OFF_DAYS)


        if num_days >= WINDOW_SIZE_FOR_MIN_OFF and MIN_OFF_DAYS_IN_WINDOW > 0:
            print(f"Applying Min Off Days Constraint: >= {MIN_OFF_DAYS_IN_WINDOW} in every {WINDOW_SIZE_FOR_MIN_OFF} days")
            for n in nurse_indices:
                for d_start in range(num_days - WINDOW_SIZE_FOR_MIN_OFF + 1):
                    window_off_days = [is_off[(n, d_start + k)] for k in range(WINDOW_SIZE_FOR_MIN_OFF)]
                    model.Add(sum(window_off_days) >= MIN_OFF_DAYS_IN_WINDOW)

        print("Applying individual nurse constraints...")
        applied_hard_constraints_count = 0
        applied_soft_constraints_count = 0
        soft_constraint_violation_terms = []

        day_of_week_map = {
             'no_mondays': 0, 'no_tuesdays': 1, 'no_wednesdays': 2,
             'no_thursdays': 3, 'no_fridays': 4, 'no_saturdays': 5, 'no_sundays': 6
        }

        for n in nurse_indices:
            nurse_id = nurse_id_map[n]
            constraints_for_nurse = nurse_constraints.get(nurse_id, [])
            if not constraints_for_nurse: continue

            for constraint_index, constraint in enumerate(constraints_for_nurse):
                constraint_type = constraint.get('type')
                constraint_value = constraint.get('value')
                constraint_strength = constraint.get('strength', 'hard')

                if not constraint_type:
                    print(f"Warning: Skipping constraint {constraint_index} for nurse {nurse_id} due to missing type.")
                    continue

                try:
                    if constraint_type in day_of_week_map:
                        target_weekday = day_of_week_map[constraint_type]
                        if constraint_strength == 'hard':
                             applied_hard_constraints_count += 1
                             for d in day_indices:
                                 if days[d].weekday() == target_weekday: model.Add(is_off[(n, d)] == 1)
                        elif constraint_strength == 'soft':
                            applied_soft_constraints_count += 1
                            for d in day_indices:
                                if days[d].weekday() == target_weekday: soft_constraint_violation_terms.append(is_off[(n, d)].Not())
                        else: print(f"Warning: Unknown strength '{constraint_strength}' for {constraint_type}")

                    elif constraint_type == 'no_morning_shifts':
                        if constraint_strength == 'hard':
                            applied_hard_constraints_count += 1
                            for d in day_indices: model.Add(shifts[(n, d, SHIFT_MORNING)] == 0)
                        elif constraint_strength == 'soft':
                            applied_soft_constraints_count += 1
                            for d in day_indices: soft_constraint_violation_terms.append(shifts[(n, d, SHIFT_MORNING)])
                        else: print(f"Warning: Unknown strength '{constraint_strength}' for {constraint_type}")
                    elif constraint_type == 'no_afternoon_shifts':
                         if constraint_strength == 'hard':
                            applied_hard_constraints_count += 1
                            for d in day_indices: model.Add(shifts[(n, d, SHIFT_AFTERNOON)] == 0)
                         elif constraint_strength == 'soft':
                            applied_soft_constraints_count += 1
                            for d in day_indices: soft_constraint_violation_terms.append(shifts[(n, d, SHIFT_AFTERNOON)])
                         else: print(f"Warning: Unknown strength '{constraint_strength}' for {constraint_type}")
                    elif constraint_type == 'no_night_shifts':
                        if constraint_strength == 'hard':
                            applied_hard_constraints_count += 1
                            for d in day_indices: model.Add(shifts[(n, d, SHIFT_NIGHT)] == 0)
                        elif constraint_strength == 'soft':
                            applied_soft_constraints_count += 1
                            for d in day_indices: soft_constraint_violation_terms.append(shifts[(n, d, SHIFT_NIGHT)])
                        else: print(f"Warning: Unknown strength '{constraint_strength}' for {constraint_type}")

                    elif constraint_type == 'no_night_afternoon_double':
                        if constraint_strength == 'hard':
                            applied_hard_constraints_count += 1
                            for d in day_indices:
                                model.Add(shifts[(n, d, SHIFT_NIGHT)] + shifts[(n, d, SHIFT_AFTERNOON)] <= 1)
                        elif constraint_strength == 'soft':
                            applied_soft_constraints_count += 1
                            for d in day_indices:
                                na_double_violation_indicator = model.NewBoolVar(f'soft_na_double_viol_n{n}_d{d}')
                                model.AddMultiplicationEquality(na_double_violation_indicator, [shifts[(n, d, SHIFT_NIGHT)], shifts[(n, d, SHIFT_AFTERNOON)]])
                                soft_constraint_violation_terms.append(na_double_violation_indicator)
                        else:
                            print(f"Warning: Unknown strength '{constraint_strength}' for {constraint_type}")

                    elif constraint_type == 'no_specific_days':
                        if isinstance(constraint_value, list):
                            try:
                                forbidden_day_numbers = [int(day_num) for day_num in constraint_value]
                                if constraint_strength == 'hard':
                                    applied_hard_constraints_count += 1
                                    for d in day_indices:
                                        if days[d].day in forbidden_day_numbers: model.Add(is_off[(n, d)] == 1)
                                elif constraint_strength == 'soft':
                                     applied_soft_constraints_count += 1
                                     for d in day_indices:
                                         if days[d].day in forbidden_day_numbers: soft_constraint_violation_terms.append(is_off[(n, d)].Not())
                                else: print(f"Warning: Unknown strength '{constraint_strength}' for {constraint_type}")
                            except (ValueError, TypeError) as specific_day_err:
                                print(f"Warning: Invalid 'no_specific_days' value '{constraint_value}' for nurse {nurse_id}. Skipping constraint {constraint_index}. Error: {specific_day_err}")
                        else:
                             print(f"Warning: Invalid value type for 'no_specific_days' for nurse {nurse_id}. Expected list, got {type(constraint_value)}. Skipping constraint {constraint_index}.")

                    else:
                        print(f"Warning: Unknown constraint type '{constraint_type}' encountered for nurse {nurse_id} (Constraint Index: {constraint_index}). Skipping.")

                except Exception as constraint_err:
                     print(f"!!! ERROR applying constraint {constraint_index} (Type: {constraint_type}, Strength: {constraint_strength}) for nurse {nurse_id}: {constraint_err}")
                     print(traceback.format_exc())

        print(f"Applied {applied_hard_constraints_count} hard & {applied_soft_constraints_count} soft individual constraints.")

        if MAX_CONSECUTIVE_SHIFTS_WORKED > 0:
            print(f"Applying Max Consecutive SHIFTS Constraint: <= {MAX_CONSECUTIVE_SHIFTS_WORKED} total shifts")
            num_shifts_today = {}
            for n in nurse_indices:
                for d in day_indices:
                    num_shifts_today[n, d] = (shifts[(n, d, SHIFT_MORNING)] +
                                              shifts[(n, d, SHIFT_AFTERNOON)] +
                                              shifts[(n, d, SHIFT_NIGHT)])

            consecutive_shift_count = {}
            for n in nurse_indices:
                for d in day_indices:
                    consecutive_shift_count[n, d] = model.NewIntVar(0, MAX_CONSECUTIVE_SHIFTS_WORKED, f'consec_shifts_n{n}_d{d}')

            for n in nurse_indices:
                model.Add(consecutive_shift_count[n, 0] == 0).OnlyEnforceIf(is_off[n, 0])
                model.Add(consecutive_shift_count[n, 0] == num_shifts_today[n, 0]).OnlyEnforceIf(is_off[n, 0].Not())
                if num_days > 1:
                    for d in range(1, num_days):
                        model.Add(consecutive_shift_count[n, d] == 0).OnlyEnforceIf(is_off[n, d])
                        model.Add(consecutive_shift_count[n, d] == consecutive_shift_count[n, d - 1] + num_shifts_today[n, d]).OnlyEnforceIf(is_off[n, d].Not())
        else:
             print("Max Consecutive SHIFTS constraint disabled (limit <= 0).")

        print("--- Defining Objective Function ---")
        objective_terms = []

        if soft_constraint_violation_terms and PENALTY_SOFT_CONSTRAINT_VIOLATION > 0:
             objective_terms.append(PENALTY_SOFT_CONSTRAINT_VIOLATION * sum(soft_constraint_violation_terms))
             print(f"Added penalty for {len(soft_constraint_violation_terms)} potential soft constraint violations (Weight per violation: {PENALTY_SOFT_CONSTRAINT_VIOLATION})")

        total_off_days_per_nurse = [model.NewIntVar(0, num_days, f'total_off_n{n}') for n in nurse_indices]
        total_shifts_per_nurse = [model.NewIntVar(0, num_days * 2, f'total_shifts_n{n}') for n in nurse_indices]
        total_morning_shifts = [model.NewIntVar(0, num_days, f'total_M_n{n}') for n in nurse_indices]
        total_afternoon_shifts = [model.NewIntVar(0, num_days, f'total_A_n{n}') for n in nurse_indices]
        total_night_shifts = [model.NewIntVar(0, num_days, f'total_N_n{n}') for n in nurse_indices]

        for n in nurse_indices:
            model.Add(total_off_days_per_nurse[n] == sum(is_off[(n, d)] for d in day_indices))
            model.Add(total_morning_shifts[n] == sum(shifts[(n, d, SHIFT_MORNING)] for d in day_indices))
            model.Add(total_afternoon_shifts[n] == sum(shifts[(n, d, SHIFT_AFTERNOON)] for d in day_indices))
            model.Add(total_night_shifts[n] == sum(shifts[(n, d, SHIFT_NIGHT)] for d in day_indices))
            model.Add(total_shifts_per_nurse[n] == total_morning_shifts[n] + total_afternoon_shifts[n] + total_night_shifts[n])

        if TARGET_OFF_DAYS >= 0 and PENALTY_OFF_DAY_UNDER_TARGET > 0:
            off_days_under_target_vars = []
            for n in nurse_indices:
                under_var = model.NewIntVar(0, num_days, f'off_under_target_n{n}')
                model.Add(under_var >= TARGET_OFF_DAYS - total_off_days_per_nurse[n])
                model.Add(under_var >= 0)
                off_days_under_target_vars.append(under_var)
            total_days_under = model.NewIntVar(0, num_nurses * num_days, 'total_days_under')
            model.Add(total_days_under == sum(off_days_under_target_vars))
            objective_terms.append(PENALTY_OFF_DAY_UNDER_TARGET * total_days_under)
            print(f"Added penalty for total days UNDER user target {TARGET_OFF_DAYS} (Weight: {PENALTY_OFF_DAY_UNDER_TARGET})")

        if num_nurses > 1 and PENALTY_OFF_DAY_IMBALANCE > 0:
            min_off_days = model.NewIntVar(0, num_days, 'min_off_days')
            max_off_days = model.NewIntVar(0, num_days, 'max_off_days')
            model.AddMinEquality(min_off_days, total_off_days_per_nurse)
            model.AddMaxEquality(max_off_days, total_off_days_per_nurse)
            objective_terms.append(PENALTY_OFF_DAY_IMBALANCE * (max_off_days - min_off_days))
            print(f"Added penalty for Off-Day imbalance (Range) (Weight: {PENALTY_OFF_DAY_IMBALANCE})")

        if num_nurses > 1 and PENALTY_SHIFT_TYPE_IMBALANCE > 0:
            min_M_shifts = model.NewIntVar(0, num_days, 'min_M_shifts')
            max_M_shifts = model.NewIntVar(0, num_days, 'max_M_shifts')
            model.AddMinEquality(min_M_shifts, total_morning_shifts)
            model.AddMaxEquality(max_M_shifts, total_morning_shifts)
            objective_terms.append(PENALTY_SHIFT_TYPE_IMBALANCE * (max_M_shifts - min_M_shifts))

            min_A_shifts = model.NewIntVar(0, num_days, 'min_A_shifts')
            max_A_shifts = model.NewIntVar(0, num_days, 'max_A_shifts')
            model.AddMinEquality(min_A_shifts, total_afternoon_shifts)
            model.AddMaxEquality(max_A_shifts, total_afternoon_shifts)
            objective_terms.append(PENALTY_SHIFT_TYPE_IMBALANCE * (max_A_shifts - min_A_shifts))

            min_N_shifts = model.NewIntVar(0, num_days, 'min_N_shifts')
            max_N_shifts = model.NewIntVar(0, num_days, 'max_N_shifts')
            model.AddMinEquality(min_N_shifts, total_night_shifts)
            model.AddMaxEquality(max_N_shifts, total_night_shifts)
            objective_terms.append(PENALTY_SHIFT_TYPE_IMBALANCE * (max_N_shifts - min_N_shifts))
            print(f"Added penalty for M/A/N Shift Type imbalance (Weight per type: {PENALTY_SHIFT_TYPE_IMBALANCE})")

        if num_nurses > 1 and PENALTY_TOTAL_SHIFT_IMBALANCE > 0:
            min_total_shifts = model.NewIntVar(0, num_days * 2, 'min_total_shifts')
            max_total_shifts = model.NewIntVar(0, num_days * 2, 'max_total_shifts')
            model.AddMinEquality(min_total_shifts, total_shifts_per_nurse)
            model.AddMaxEquality(max_total_shifts, total_shifts_per_nurse)
            objective_terms.append(PENALTY_TOTAL_SHIFT_IMBALANCE * (max_total_shifts - min_total_shifts))
            print(f"Added penalty for Total Shift imbalance (Range) (Weight: {PENALTY_TOTAL_SHIFT_IMBALANCE})")

        if PENALTY_PER_NA_DOUBLE > 0:
            all_na_double_terms = []
            for n in nurse_indices:
                for d in day_indices:
                    na_indicator = model.NewBoolVar(f'na_double_n{n}_d{d}')
                    model.AddMultiplicationEquality(na_indicator, [shifts[(n, d, SHIFT_NIGHT)], shifts[(n, d, SHIFT_AFTERNOON)]])
                    all_na_double_terms.append(na_indicator)
            if all_na_double_terms:
                objective_terms.append(PENALTY_PER_NA_DOUBLE * sum(all_na_double_terms))
                print(f"Added penalty for each N+A (ดึกควบบ่าย) double shift occurrence (Weight: {PENALTY_PER_NA_DOUBLE})")

        if PENALTY_NIGHT_TO_MORNING_TRANSITION > 0 and num_days > 1:
            nm_transition_penalties = []
            for n in nurse_indices:
                for d in range(num_days - 1):
                    nm_indicator = model.NewBoolVar(f'nm_transition_n{n}_d{d}')
                    model.AddMultiplicationEquality(nm_indicator, [shifts[(n, d, SHIFT_NIGHT)], shifts[(n, d + 1, SHIFT_MORNING)]])
                    nm_transition_penalties.append(nm_indicator)

            if nm_transition_penalties:
                objective_terms.append(PENALTY_NIGHT_TO_MORNING_TRANSITION * sum(nm_transition_penalties))
                print(f"Added penalty for each N(d) -> M(d+1) transition (Weight: {PENALTY_NIGHT_TO_MORNING_TRANSITION})")

        if objective_terms:
            model.Minimize(sum(objective_terms))
            print("Objective function set to minimize penalties.")
        else:
            print("No penalties defined, seeking any feasible solution.")

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = SOLVER_TIME_LIMIT
        solver.parameters.log_search_progress = True

        print(f"\n--- Starting Solver (Time Limit: {SOLVER_TIME_LIMIT}s) ---")
        solve_start_time = time.time()
        status = solver.Solve(model)
        solve_end_time = time.time()
        print(f"--- Solver Finished --- Status: {solver.StatusName(status)}, Time: {solve_end_time - solve_start_time:.2f}s")

        if status == cp_model.OPTIMAL or status == cp_model.FEASIBLE:
            objective_value = solver.ObjectiveValue() if objective_terms else 0
            print(f"Solution found (Status: {solver.StatusName(status)}). Objective Value: {objective_value:.2f}")

            nurse_schedules = {}
            shifts_count = {}
            days_iso = [day.isoformat() for day in days]

            all_off_counts, all_shift_counts = [], []
            all_m_counts, all_a_counts, all_n_counts = [], [], []
            all_na_double_counts = []

            try:
                for n in nurse_indices:
                    nurse_id = nurse_id_map[n]
                    nurse_info = next((item for item in nurses_data if item["id"] == nurse_id), None)
                    if not nurse_info:
                        print(f"Warning: Could not find nurse info for ID {nurse_id} during result processing.")
                        continue

                    nurse_schedules[nurse_id] = {
                        "nurse": nurse_info,
                        "shifts": {day_iso: [] for day_iso in days_iso}
                    }

                    current_nurse_off_count = solver.Value(total_off_days_per_nurse[n])
                    current_nurse_m_count = solver.Value(total_morning_shifts[n])
                    current_nurse_a_count = solver.Value(total_afternoon_shifts[n])
                    current_nurse_n_count = solver.Value(total_night_shifts[n])
                    current_nurse_total_shifts = solver.Value(total_shifts_per_nurse[n])
                    current_nurse_na_doubles = 0

                    for d, day_iso in enumerate(days_iso):
                        daily_shifts = []
                        has_m = solver.Value(shifts[(n, d, SHIFT_MORNING)]) == 1
                        has_a = solver.Value(shifts[(n, d, SHIFT_AFTERNOON)]) == 1
                        has_n = solver.Value(shifts[(n, d, SHIFT_NIGHT)]) == 1

                        if has_m: daily_shifts.append(SHIFT_MORNING)
                        if has_a: daily_shifts.append(SHIFT_AFTERNOON)
                        if has_n: daily_shifts.append(SHIFT_NIGHT)

                        nurse_schedules[nurse_id]["shifts"][day_iso] = sorted(daily_shifts)

                        if has_n and has_a:
                             current_nurse_na_doubles += 1

                    shifts_count[nurse_id] = {
                         "morning": current_nurse_m_count,
                         "afternoon": current_nurse_a_count,
                         "night": current_nurse_n_count,
                         "total": current_nurse_total_shifts,
                         "nightAfternoonDouble": current_nurse_na_doubles,
                         "daysOff": current_nurse_off_count
                    }

                    all_off_counts.append(current_nurse_off_count)
                    all_shift_counts.append(current_nurse_total_shifts)
                    all_m_counts.append(current_nurse_m_count)
                    all_a_counts.append(current_nurse_a_count)
                    all_n_counts.append(current_nurse_n_count)
                    all_na_double_counts.append(current_nurse_na_doubles)

                actual_min_off = min(all_off_counts) if all_off_counts else 0
                actual_max_off = max(all_off_counts) if all_off_counts else 0
                actual_min_shifts = min(all_shift_counts) if all_shift_counts else 0
                actual_max_shifts = max(all_shift_counts) if all_shift_counts else 0
                actual_min_m = min(all_m_counts) if all_m_counts else 0
                actual_max_m = max(all_m_counts) if all_m_counts else 0
                actual_min_a = min(all_a_counts) if all_a_counts else 0
                actual_max_a = max(all_a_counts) if all_a_counts else 0
                actual_min_n = min(all_n_counts) if all_n_counts else 0
                actual_max_n = max(all_n_counts) if all_n_counts else 0
                total_na_doubles_overall = sum(all_na_double_counts)

                print(f"Actual Off Days Range: {actual_min_off}-{actual_max_off} (Diff: {actual_max_off - actual_min_off})")
                print(f"Actual Total Shifts Range: {actual_min_shifts}-{actual_max_shifts} (Diff: {actual_max_shifts - actual_min_shifts})")
                print(f"Actual Morning Shifts Range: {actual_min_m}-{actual_max_m} (Diff: {actual_max_m - actual_min_m})")
                print(f"Actual Afternoon Shifts Range: {actual_min_a}-{actual_max_a} (Diff: {actual_max_a - actual_min_a})")
                print(f"Actual Night Shifts Range: {actual_min_n}-{actual_max_n} (Diff: {actual_max_n - actual_min_n})")
                print(f"Total N+A (ดึกควบบ่าย) double shifts assigned: {total_na_doubles_overall}")

                total_time = time.time() - start_time
                print(f"Schedule generation successful. Total time: {total_time:.2f}s")

                return jsonify({
                    "nurseSchedules": nurse_schedules,
                    "shiftsCount": shifts_count,
                    "days": days_iso,
                    "startDate": start_date_str,
                    "endDate": end_date_str,
                    "holidays": holidays_input,
                    "solverStatus": solver.StatusName(status),
                    "penaltyValue": objective_value,
                     "fairnessReport": {
                         "offDaysMin": actual_min_off, "offDaysMax": actual_max_off,
                         "totalShiftsMin": actual_min_shifts, "totalShiftsMax": actual_max_shifts,
                         "morningMin": actual_min_m, "morningMax": actual_max_m,
                         "afternoonMin": actual_min_a, "afternoonMax": actual_max_a,
                         "nightMin": actual_min_n, "nightMax": actual_max_n,
                         "totalNADoubles": total_na_doubles_overall
                     }
                }), 200
            except Exception as result_error:
                 print(f"!!! ERROR DURING RESULT PROCESSING !!!")
                 print(traceback.format_exc())
                 return jsonify({"error": f"เกิดข้อผิดพลาดในการประมวลผลผลลัพธ์: {result_error}"}), 500

        else:
            error_message = f"ไม่สามารถสร้างตารางเวรได้ (Solver Status: {solver.StatusName(status)}). "
            if status == cp_model.INFEASIBLE:
                error_message += "ข้อจำกัดที่ตั้งไว้แบบ 'ต้องเป็นแบบนี้เท่านั้น' (Hard Constraints) ขัดแย้งกันเอง หรืออาจเกิดจากข้อจำกัดส่วนบุคคล ลองตรวจสอบและผ่อนปรนข้อจำกัดแบบ Hard หรือเปลี่ยนบางข้อจำกัดส่วนบุคคลเป็นแบบ 'ถ้าเป็นไปได้' (Soft)"
                try:
                    print('\n--- Infeasibility Analysis ---')
                    assumptions = solver.SufficientAssumptionsForInfeasibility()
                    if assumptions: print('Sufficient assumptions for infeasibility (potential conflicts - variable indices):', assumptions)
                    else: print('Could not determine specific sufficient assumptions for infeasibility.')
                    print('----------------------------\n')
                except Exception as e: print(f"(Could not get infeasibility assumptions: {e})\n")
            elif status == cp_model.UNKNOWN: error_message += f"อาจหมดเวลา ({SOLVER_TIME_LIMIT}s) ก่อนหาคำตอบที่ดีที่สุดได้ ลองเพิ่มเวลาคำนวณ หรือลดความซับซ้อนของข้อจำกัด"
            elif status == cp_model.MODEL_INVALID: error_message += "Model ไม่ถูกต้อง กรุณาตรวจสอบ Backend Log"
            else: error_message += "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ"
            print(f"Schedule generation failed. Status: {solver.StatusName(status)}")
            return jsonify({"error": error_message}), 500

    except Exception as e:
        print("!!! UNEXPECTED ERROR IN generate_schedule_api !!!")
        print(traceback.format_exc())
        return jsonify({"error": f"เกิดข้อผิดพลาดที่ไม่คาดคิดใน Server: {e}"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)