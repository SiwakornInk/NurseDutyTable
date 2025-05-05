// ScheduleGenerator.js

import React, { useState, useEffect } from 'react';

const ScheduleGenerator = ({ nurses, onGenerateSchedule, updateNurse }) => {
    const [selectedMonth, setSelectedMonth] = useState('');
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
    const [holidayDates, setHolidayDates] = useState('');

    const [selectedNurseId, setSelectedNurseId] = useState('');
    const [constraintStrength, setConstraintStrength] = useState('hard');
    const [constraintType, setConstraintType] = useState('no_sundays');
    const [specificDates, setSpecificDates] = useState('');
    const [nurseConstraintsMap, setNurseConstraintsMap] = useState({});

    const [requiredMorning, setRequiredMorning] = useState(4);
    const [requiredAfternoon, setRequiredAfternoon] = useState(4);
    const [requiredNight, setRequiredNight] = useState(4);
    const [maxConsecShiftsWorked, setMaxConsecShiftsWorked] = useState(6);
    const [targetOff, setTargetOff] = useState(6);

    useEffect(() => {
        const newMap = {};
        if (Array.isArray(nurses)) {
             nurses.forEach(nurse => {
                 if (nurse && nurse.id) {
                     newMap[nurse.id] = (nurse.constraints || []).map(c => ({
                         type: c.type,
                         value: c.value,
                         strength: c.strength || 'hard'
                     }));
                 }
             });
        }
        setNurseConstraintsMap(newMap);
    }, [nurses]);

    const months = [
        { value: '0', label: 'มกราคม' }, { value: '1', label: 'กุมภาพันธ์' },
        { value: '2', label: 'มีนาคม' }, { value: '3', label: 'เมษายน' },
        { value: '4', label: 'พฤษภาคม' }, { value: '5', label: 'มิถุนายน' },
        { value: '6', label: 'กรกฎาคม' }, { value: '7', label: 'สิงหาคม' },
        { value: '8', label: 'กันยายน' }, { value: '9', label: 'ตุลาคม' },
        { value: '10', label: 'พฤศจิกายน' }, { value: '11', label: 'ธันวาคม' }
    ];

    const constraintRuleTypes = [
        { value: 'no_sundays', label: 'ไม่ขึ้นเวรวันอาทิตย์' }, { value: 'no_mondays', label: 'ไม่ขึ้นเวรวันจันทร์' },
        { value: 'no_tuesdays', label: 'ไม่ขึ้นเวรวันอังคาร' }, { value: 'no_wednesdays', label: 'ไม่ขึ้นเวรวันพุธ' },
        { value: 'no_thursdays', label: 'ไม่ขึ้นเวรวันพฤหัสบดี' }, { value: 'no_fridays', label: 'ไม่ขึ้นเวรวันศุกร์' },
        { value: 'no_saturdays', label: 'ไม่ขึ้นเวรวันเสาร์' }, { value: 'no_morning_shifts', label: 'ไม่ขึ้นเวรเช้า' },
        { value: 'no_afternoon_shifts', label: 'ไม่ขึ้นเวรบ่าย' }, { value: 'no_night_shifts', label: 'ไม่ขึ้นเวรดึก' },
        { value: 'no_night_afternoon_double', label: 'ไม่ขึ้นเวรดึกควบบ่าย' },
        { value: 'no_specific_days', label: 'ไม่ขึ้นเวรวันที่ระบุ...' },
    ];

    const getConstraintLabel = (constraint) => {
        const ruleInfo = constraintRuleTypes.find(t => t.value === constraint?.type);
        let label = ruleInfo ? ruleInfo.label : constraint?.type || 'Unknown';
        if (constraint?.type === 'no_specific_days' && Array.isArray(constraint.value)) {
            label = `ไม่ขึ้นเวรวันที่ ${constraint.value.join(', ')}`;
        }
        const strengthLabel = constraint?.strength === 'soft' ? '(ถ้าเป็นไปได้)' : '(ต้องเป็นแบบนี้เท่านั้น)';
        return `${label} ${strengthLabel}`;
    };

    const getDaysInMonth = (year, month) => {
        if (month === '' || year === '' || isNaN(year) || isNaN(month)) return 0;
        try {
            return new Date(Number(year), Number(month) + 1, 0).getDate();
        } catch (e) {
            return 0;
        }
    };

    const handleAddConstraint = async () => {
        if (!selectedNurseId) { alert("กรุณาเลือกพยาบาล"); return; }
        const nurse = nurses.find(n => n.id === selectedNurseId);
        if (!nurse) { alert("ไม่พบข้อมูลพยาบาล"); return; }

        let constraintValue;
        let daysInSelectedMonth = 31;
         if (selectedMonth !== '' && selectedYear) {
             daysInSelectedMonth = getDaysInMonth(selectedYear, selectedMonth);
             if (daysInSelectedMonth === 0) {
                 alert("ไม่สามารถระบุจำนวนวันในเดือนที่เลือกได้ กรุณาเลือกเดือน/ปีให้ถูกต้อง");
                 return;
             }
         }

        if (constraintType === 'no_specific_days') {
            constraintValue = specificDates.split(',').map(d => d.trim())
                 .filter(d => { const dayNum = parseInt(d); return !isNaN(dayNum) && dayNum > 0 && dayNum <= daysInSelectedMonth; })
                 .map(d => parseInt(d)).sort((a, b) => a - b);
            if (constraintValue.length === 0 && specificDates.trim() !== '') { alert(`กรุณาระบุวันที่ให้ถูกต้อง (1-${daysInSelectedMonth})`); return; }
            if (constraintValue.length === 0 && specificDates.trim() === '') { alert("กรุณาระบุวันที่"); return; }
        } else {
            constraintValue = true;
        }

        const newConstraint = {
            type: constraintType,
            value: constraintValue,
            strength: constraintStrength
        };

        const currentConstraints = nurseConstraintsMap[selectedNurseId] || [];
        const constraintExists = currentConstraints.some(c =>
            c.type === newConstraint.type &&
            c.strength === newConstraint.strength &&
            (c.type !== 'no_specific_days' || JSON.stringify(c.value) === JSON.stringify(newConstraint.value))
        );

        if (constraintExists) { alert("ข้อจำกัดแบบเดียวกันและความเข้มงวดนี้มีอยู่แล้วสำหรับพยาบาลคนนี้"); return; }

        const updatedConstraints = [...currentConstraints, newConstraint];
        try {
            const success = await updateNurse(nurse.id, { constraints: updatedConstraints });
            if (success) {
                setNurseConstraintsMap(prevMap => ({ ...prevMap, [selectedNurseId]: updatedConstraints }));
                setSpecificDates('');
            } else {
                throw new Error("Update operation returned false");
            }
        } catch (error) {
            console.error("Error adding constraint:", error);
            alert("เกิดข้อผิดพลาดในการบันทึกข้อจำกัด กรุณาลองใหม่อีกครั้ง");
        }
    };

    const handleRemoveConstraint = async (nurseIdToRemove, indexToRemove) => {
        const currentConstraints = nurseConstraintsMap[nurseIdToRemove] || [];
        if (!currentConstraints[indexToRemove]) return;

        const updatedConstraints = currentConstraints.filter((_, index) => index !== indexToRemove);
         try {
             const success = await updateNurse(nurseIdToRemove, { constraints: updatedConstraints });
            if (success) {
                 setNurseConstraintsMap(prevMap => ({ ...prevMap, [nurseIdToRemove]: updatedConstraints }));
            } else {
                 throw new Error("Update operation returned false");
            }
         } catch (error) {
             console.error("Error removing constraint:", error);
             alert("เกิดข้อผิดพลาดในการลบข้อจำกัด กรุณาลองใหม่อีกครั้ง");
         }
    };

    const handleGenerateSchedule = () => {
        if (selectedMonth === '') {
            alert('กรุณาเลือกเดือน');
            return;
        }
        if (isNaN(selectedYear) || selectedYear <= 0) {
             alert('กรุณากรอกปี พ.ศ. ให้ถูกต้อง');
             return;
        }

        if (requiredMorning < 1 || requiredAfternoon < 1 || requiredNight < 1) {
            alert('จำนวนพยาบาลต่อเวรต้องมีอย่างน้อย 1 คน'); return;
        }
        if (maxConsecShiftsWorked < 1) {
             alert(`จำนวนเวรติดต่อกันสูงสุดต้องมีอย่างน้อย 1 เวร`); return;
        }
        if (targetOff < 0) {
            alert('เป้าหมายวันหยุดขั้นต่ำต้องไม่ติดลบ'); return;
        }

        const jsMonth = parseInt(selectedMonth);
        const startDate = new Date(selectedYear, jsMonth, 1);
        const endDate = new Date(selectedYear, jsMonth + 1, 0);

        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            alert("เกิดข้อผิดพลาดในการคำนวณวันที่เริ่มต้น/สิ้นสุด กรุณาตรวจสอบปีที่เลือก");
            return;
        }

        const holidays = holidayDates.split(',')
                                         .map(d => d.trim())
                                         .filter(d => !isNaN(parseInt(d)) && parseInt(d) > 0 && parseInt(d) <= 31)
                                         .map(d => parseInt(d));

        onGenerateSchedule({
            startDate,
            endDate,
            holidays,
            requiredNursesMorning: requiredMorning,
            requiredNursesAfternoon: requiredAfternoon,
            requiredNursesNight: requiredNight,
            maxConsecutiveShiftsWorked: maxConsecShiftsWorked,
            targetOffDays: targetOff,
            solverTimeLimit: 10.0,
        });
    };

    const handleYearChange = (event) => {
        const beYearString = event.target.value;
        if (beYearString === '') {
            setSelectedYear('');
        } else {
            const beYear = parseInt(beYearString);
            if (!isNaN(beYear) && beYear > 0) {
                 setSelectedYear(beYear - 543);
            }
        }
    };
    const displayYear = selectedYear === '' || isNaN(selectedYear) ? '' : selectedYear + 543;

    return (
        <div className="schedule-generator card">
            <h2><span role="img" aria-label="calendar" style={{ marginRight: '10px' }}>🗓️</span> สร้างตารางเวร</h2>

             <div className="card" style={{ backgroundColor: 'var(--gray-100)', marginBottom: '20px' }}>
                 <h3><span role="img" aria-label="time">⏱️</span> 1. เลือกช่วงเวลาและวันหยุด</h3>
                 <div className="month-selector">
                     <div className="form-group">
                         <label htmlFor="monthSelect">เลือกเดือน / กรอกปี พ.ศ.</label>
                         <div style={{ display: 'flex', gap: '10px' }}>
                             <select
                                 id="monthSelect"
                                 value={selectedMonth}
                                 onChange={(e) => setSelectedMonth(e.target.value)}
                                 required
                                 className="form-select"
                             >
                                 <option value="" disabled>-- เดือนที่ต้องการ --</option>
                                 {months.map(month => (<option key={month.value} value={month.value}>{month.label}</option>))}
                             </select>
                             <input
                                type="number"
                                aria-label="Input Year (BE)"
                                value={displayYear}
                                onChange={handleYearChange}
                                placeholder="ปี พ.ศ."
                                min="1"
                                step="1"
                                required
                                className="form-input"
                                style={{ minWidth: '100px' }}
                             />
                         </div>
                     </div>
                 </div>
                 <div className="holiday-setting" style={{ marginTop: '15px' }}>
                     <div className="form-group">
                         <label htmlFor='holidayInput'>
                             <span role="img" aria-label="holiday">🏖️</span> กำหนดวันหยุดในเดือนนี้ (ไม่มีผลต่อการคำนวณตารางเวร)
                         </label>
                         <input
                             id='holidayInput'
                             type="text"
                             value={holidayDates}
                             onChange={(e) => setHolidayDates(e.target.value)}
                             placeholder="เช่น 1, 5, 13 คั่นด้วยจุลภาค"
                             className="form-input"
                         />
                         <div className="helper-text">
                              เดือน {months.find(m => m.value === selectedMonth)?.label ?? '...'} {displayYear || '...'} มี {getDaysInMonth(selectedYear, selectedMonth) || '...'} วัน
                         </div>
                     </div>
                 </div>
             </div>

             <div className="card" style={{ backgroundColor: 'var(--gray-100)', marginBottom: '20px' }}>
                 <h3><span role="img" aria-label="settings">⚙️</span> 2. ตั้งค่าทั่วไปสำหรับการจัดเวร</h3>
                 <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px 20px' }}>
                     <div className="form-group">
                         <label htmlFor="reqMorning">จำนวนพยาบาลเวรเช้า</label>
                         <input type="number" id="reqMorning" min="1" step="1" value={requiredMorning} onChange={(e) => setRequiredMorning(Math.max(1, parseInt(e.target.value) || 1))} className="form-input" />
                     </div>
                     <div className="form-group">
                         <label htmlFor="reqAfternoon">จำนวนพยาบาลเวรบ่าย</label>
                         <input type="number" id="reqAfternoon" min="1" step="1" value={requiredAfternoon} onChange={(e) => setRequiredAfternoon(Math.max(1, parseInt(e.target.value) || 1))} className="form-input" />
                     </div>
                     <div className="form-group">
                         <label htmlFor="reqNight">จำนวนพยาบาลเวรดึก</label>
                         <input type="number" id="reqNight" min="1" step="1" value={requiredNight} onChange={(e) => setRequiredNight(Math.max(1, parseInt(e.target.value) || 1))} className="form-input" />
                     </div>

                     <div className="form-group">
                         <label htmlFor="maxConsecShiftsWorked">จำนวนเวรติดต่อกันสูงสุด</label>
                         <input
                             type="number"
                             id="maxConsecShiftsWorked"
                             min="1"
                             step="1"
                             value={maxConsecShiftsWorked}
                             onChange={(e) => setMaxConsecShiftsWorked(Math.max(1, parseInt(e.target.value) || 1))}
                             className="form-input"
                         />
                         <div className="helper-text">จำนวนเวรสูงสุดที่ทำติดต่อกันได้ ก่อนที่จะต้องมีวันหยุด (รีเซ็ตหลังมีวันหยุด)</div>
                     </div>

                     <div className="form-group">
                         <label htmlFor="targetOff">วันหยุดขั้นต่ำ/เดือน</label>
                         <input
                             type="number"
                             id="targetOff"
                             min="0"
                             step="1"
                             value={targetOff}
                             onChange={(e) => setTargetOff(Math.max(0, parseInt(e.target.value) || 0))}
                             className="form-input"
                          />
                         <div className="helper-text">เป้าหมายวันหยุดขั้นต่ำที่ต้องการ</div>
                     </div>
                 </div>
             </div>

            <div className="constraints-container card" style={{ marginTop: '20px' }}>
                <h3><span role="img" aria-label="constraints">🚫</span> 3. ข้อจำกัดส่วนบุคคล (ถ้ามี)</h3>
                <div className="constraint-form" style={{ backgroundColor: 'var(--gray-100)', padding: '18px', borderRadius: 'var(--radius-md)', marginBottom: '20px' }}>
                    <h4>เพิ่ม/แก้ไขข้อจำกัด</h4>
                    <div className="form-group">
                        <label htmlFor="nurseSelectConst">เลือกพยาบาล</label>
                       <select
                            id="nurseSelectConst"
                            value={selectedNurseId}
                            onChange={(e) => setSelectedNurseId(e.target.value)}
                            className="form-select"
                        >
                            <option value="">-- เลือกพยาบาล --</option>
                             {Array.isArray(nurses) && nurses.length > 0 &&
                                 nurses
                                 .sort((a, b) => `${a?.firstName ?? ''} ${a?.lastName ?? ''}`.localeCompare(`${b?.firstName ?? ''} ${b?.lastName ?? ''}`))
                                 .map(nurse => (
                                 <option key={nurse.id} value={nurse.id}>
                                     {`${nurse.prefix ?? ''} ${nurse.firstName ?? ''} ${nurse.lastName ?? ''}`.trim()}
                                 </option>
                             ))}
                        </select>
                    </div>
                    <div className="form-group">
                        <label htmlFor="constraintStrengthSelect">ประเภทข้อจำกัด (ต้องเป็นแบบนี้เท่านั้น / ถ้าเป็นไปได้)</label>
                       <select
                            id="constraintStrengthSelect"
                            value={constraintStrength}
                            onChange={(e) => setConstraintStrength(e.target.value)}
                            className="form-select"
                        >
                            <option value="hard">ต้องเป็นแบบนี้เท่านั้น (Hard)</option>
                            <option value="soft">ถ้าเป็นไปได้ (Soft)</option>
                        </select>
                    </div>
                    <div className="form-group">
                        <label htmlFor="constraintTypeSelectConst">เลือกข้อจำกัด</label>
                       <select
                            id="constraintTypeSelectConst"
                            value={constraintType}
                            onChange={(e) => setConstraintType(e.target.value)}
                            className="form-select"
                        >
                           {constraintRuleTypes.map(type => (
                                <option key={type.value} value={type.value}>{type.label}</option>
                            ))}
                        </select>
                    </div>
                    {constraintType === 'no_specific_days' && (
                        <div className="form-group">
                            <label htmlFor="specificDatesInputConst">ระบุวันที่ (คั่นด้วยจุลภาค ,)</label>
                           <input
                                id="specificDatesInputConst"
                                type="text"
                                value={specificDates}
                                onChange={(e) => setSpecificDates(e.target.value)}
                                placeholder="เช่น 1, 5, 10"
                                className="form-input"
                            />
                        </div>
                    )}
                    <button
                        type="button"
                        onClick={handleAddConstraint}
                        disabled={!selectedNurseId}
                        className="primary-button"
                        style={{marginTop: '10px'}}
                    >
                        <span role="img" aria-label="add">➕</span> บันทึกข้อจำกัดนี้
                    </button>
                </div>

                <div className="constraints-list">
                    <h4>ข้อจำกัดที่บันทึกไว้ (ลบได้)</h4>
                     {!Array.isArray(nurses) || nurses.length === 0 ? (
                         <div className="empty-state"><p>ไม่มีข้อมูลพยาบาล</p></div>
                     ) : (
                         nurses
                         .sort((a, b) => `${a?.firstName ?? ''} ${a?.lastName ?? ''}`.localeCompare(`${b?.firstName ?? ''} ${b?.lastName ?? ''}`))
                         .map(nurse => {
                             const constraints = nurseConstraintsMap[nurse.id] || [];
                             if (constraints.length > 0) {
                                 return (
                                     <div key={`const-list-${nurse.id}`} style={{ marginBottom: '15px', paddingBottom: '10px', borderBottom: '1px solid var(--gray-200)' }}>
                                         <strong>{`${nurse.prefix ?? ''} ${nurse.firstName ?? ''} ${nurse.lastName ?? ''}`.trim()}:</strong>
                                         <ul className="constraints-items" style={{ marginTop: '5px', paddingLeft: '20px', listStyle: 'none' }}>
                                             {constraints.map((constraint, index) => (
                                                 <li key={`${nurse.id}-${index}-${constraint.strength}-${constraint.type}`} className="constraint-item" style={{justifyContent: 'space-between', display: 'flex', alignItems: 'center', marginBottom: '5px'}}>
                                                     <span>{getConstraintLabel(constraint)}</span>
                                                     <button
                                                         type="button"
                                                         onClick={() => handleRemoveConstraint(nurse.id, index)}
                                                         className="danger-button"
                                                         style={{ backgroundColor: 'var(--danger)', color: 'white', marginLeft: '10px', padding: '2px 8px', fontSize: '12px' }}
                                                     >
                                                          ลบ
                                                     </button>
                                                 </li>
                                             ))}
                                         </ul>
                                     </div>
                                 );
                             }
                             return null;
                         })
                     )}
                      {Array.isArray(nurses) && nurses.length > 0 && nurses.every(n => !nurseConstraintsMap[n.id] || nurseConstraintsMap[n.id].length === 0) && (
                          <div className="empty-state" style={{marginTop: '15px'}}>
                              <p>ยังไม่มีข้อจำกัดส่วนบุคคลที่บันทึกไว้สำหรับพยาบาลคนใด</p>
                          </div>
                      )}
                </div>
            </div>

             <button
                 className="generate-button"
                 style={{ width: '100%', padding: '15px', fontSize: '18px', marginTop: '20px' }}
                 onClick={handleGenerateSchedule}
                 disabled={!Array.isArray(nurses) || nurses.length === 0 || selectedMonth === '' || selectedYear === '' || isNaN(selectedYear) }
             >
                 <span role="img" aria-label="generate">🚀</span> 4. สร้างตารางเวรสำหรับเดือนที่เลือก
             </button>
        </div>
    );
};
export default ScheduleGenerator;