// ScheduleGenerator.js

import React, { useState } from 'react';

// Helper function to get days in month (needed for validation)
const getDaysInMonth = (year, month) => {
    if (month === '' || year === '' || isNaN(year) || isNaN(month)) return 31; // Default to 31 for generic validation
    try {
        // Use month index (0-11)
        return new Date(Number(year), Number(month) + 1, 0).getDate();
    } catch (e) {
        console.error("Error getting days in month:", e);
        return 31;
    }
};


const ScheduleGenerator = ({ onPrepareSummary, selectedMonth, selectedYear }) => { // Added selectedMonth, selectedYear props
    // State for holiday input string
    const [holidayDatesInput, setHolidayDatesInput] = useState('');
    const [requiredMorning, setRequiredMorning] = useState(4);
    const [requiredAfternoon, setRequiredAfternoon] = useState(4);
    const [requiredNight, setRequiredNight] = useState(4);
    const [maxConsecShiftsWorked, setMaxConsecShiftsWorked] = useState(6);
    const [targetOff, setTargetOff] = useState(6);
    const [solverTime, setSolverTime] = useState(120);


    const handlePrepareSummaryClick = () => {
        if (requiredMorning < 0 || requiredAfternoon < 0 || requiredNight < 0) { alert('จำนวนพยาบาลต่อเวรต้องไม่ติดลบ'); return; }
        if (requiredMorning + requiredAfternoon + requiredNight === 0) { alert('ต้องมีจำนวนพยาบาลที่ต้องการอย่างน้อย 1 คน'); return; }
        if (maxConsecShiftsWorked < 1) { alert(`เวรติดต่อกันสูงสุดต้อง >= 1`); return; }
        if (targetOff < 0) { alert('วันหยุดขั้นต่ำต้อง >= 0'); return; }
        if (solverTime < 5) { alert('เวลาคำนวณ Solver >= 5 วิ'); return; }

        // --- Parse and Validate Holiday Dates ---
        const daysInMonth = getDaysInMonth(selectedYear, selectedMonth); // Get actual days in the selected month
        let parsedHolidayDates = [];
        let holidayError = null;

        if (holidayDatesInput.trim() !== '') {
            const parts = holidayDatesInput.split(',').map(d => d.trim()).filter(d => d !== '');
            const uniqueDates = new Set();

            for (const part of parts) {
                const dayNum = parseInt(part, 10);
                if (isNaN(dayNum) || dayNum < 1 || dayNum > daysInMonth) {
                    holidayError = `ข้อมูลวันหยุด '${part}' ไม่ถูกต้อง กรุณาระบุเป็นตัวเลขวันที่ 1-${daysInMonth} คั่นด้วยจุลภาค`;
                    break;
                }
                if (uniqueDates.has(dayNum)) {
                     holidayError = `ข้อมูลวันหยุด '${dayNum}' ซ้ำซ้อน`;
                     break;
                }
                uniqueDates.add(dayNum);
            }
            if (!holidayError) {
                 parsedHolidayDates = Array.from(uniqueDates).sort((a, b) => a - b);
            }
        }

        if (holidayError) {
            alert(`ข้อผิดพลาดในการระบุวันหยุดนักขัตฤกษ์:\n${holidayError}`);
            return;
        }
        // --- End Holiday Parsing ---


        onPrepareSummary({
            holidays: parsedHolidayDates, // Pass parsed array
            requiredNursesMorning: requiredMorning,
            requiredNursesAfternoon: requiredAfternoon,
            requiredNursesNight: requiredNight,
            maxConsecutiveShiftsWorked: maxConsecShiftsWorked,
            targetOffDays: targetOff,
            solverTimeLimit: solverTime,
        });
    };


    return (
        <div className="schedule-generator card" style={{marginTop: '20px'}}>
            <div className="card" style={{ backgroundColor: 'var(--gray-100)', marginBottom: '20px' }}>
                <h3><span role="img" aria-label="settings">⚙️</span> 3. ตั้งค่าทั่วไปสำหรับการจัดเวร</h3>

                 {/* *** ADDED: Holiday Input Section *** */}
                 <div className="form-group" style={{marginBottom: '20px', paddingBottom: '15px', borderBottom: '1px dashed var(--gray-300)'}}>
                     <label htmlFor="holidayDatesInput">
                         <span role="img" aria-label="holiday" style={{marginRight: '5px'}}>🎉</span>
                         วันหยุดนักขัตฤกษ์ (ถ้ามี)
                         <span style={{fontWeight: 'normal', color: 'var(--gray-600)', marginLeft: '5px'}}>
                             (ใส่เฉพาะเลขวันที่ คั่นด้วยจุลภาค , เช่น 5, 13, 28)
                         </span>
                     </label>
                     <input
                         type="text"
                         id="holidayDatesInput"
                         value={holidayDatesInput}
                         onChange={(e) => setHolidayDatesInput(e.target.value)}
                         className="form-input"
                         placeholder="เช่น 5, 13, 28"
                     />
                     <small style={{color: 'var(--info)', marginTop: '5px', display: 'block'}}>
                         ระบุเพื่อบังคับให้ข้าราชการหยุดในวันดังกล่าว (เพิ่มเติมจาก ส-อา)
                     </small>
                 </div>


                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px 20px' }}>
                    <div className="form-group"><label htmlFor="reqMorningGen">จำนวนคนที่ต้องการในเวรเช้า</label><input type="number" id="reqMorningGen" min="0" step="1" value={requiredMorning} onChange={(e) => setRequiredMorning(Math.max(0, parseInt(e.target.value) || 0))} className="form-input" /></div>
                    <div className="form-group"><label htmlFor="reqAfternoonGen">จำนวนคนที่ต้องการในเวรบ่าย</label><input type="number" id="reqAfternoonGen" min="0" step="1" value={requiredAfternoon} onChange={(e) => setRequiredAfternoon(Math.max(0, parseInt(e.target.value) || 0))} className="form-input" /></div>
                    <div className="form-group"><label htmlFor="reqNightGen">จำนวนคนที่ต้องการในเวรดึก</label><input type="number" id="reqNightGen" min="0" step="1" value={requiredNight} onChange={(e) => setRequiredNight(Math.max(0, parseInt(e.target.value) || 0))} className="form-input" /></div>
                    <div className="form-group"><label htmlFor="maxConsecShiftsWorkedGen">เวรติดต่อกันสูงสุด </label><input type="number" id="maxConsecShiftsWorkedGen" min="1" step="1" value={maxConsecShiftsWorked} onChange={(e) => setMaxConsecShiftsWorked(Math.max(1, parseInt(e.target.value) || 1))} className="form-input" /></div>
                    <div className="form-group"><label htmlFor="targetOffGen">วันหยุดขั้นต่ำ/เดือน</label><input type="number" id="targetOffGen" min="0" step="1" value={targetOff} onChange={(e) => setTargetOff(Math.max(0, parseInt(e.target.value) || 0))} className="form-input" /></div>
                    <div className="form-group"><label htmlFor="solverTimeGen">เวลาคำนวณสูงสุด (วิ)</label><input type="number" id="solverTimeGen" min="5" step="1" value={solverTime} onChange={(e) => setSolverTime(Math.max(5, parseInt(e.target.value) || 5))} className="form-input" /></div>
                </div>
            </div>

            <button className="primary-button" style={{ width: '100%', padding: '12px', fontSize: '16px', marginTop: '20px' }} onClick={handlePrepareSummaryClick} >
                <span role="img" aria-label="check"></span> 4. ตรวจสอบข้อมูลก่อนสร้างตาราง
            </button>
        </div>
    );
};
export default ScheduleGenerator;