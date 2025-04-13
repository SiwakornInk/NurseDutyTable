// components/ScheduleDisplay.js
import React from 'react';
import * as XLSX from 'xlsx';

// Constants for Shift Types (Keep consistent with backend)
const SHIFT_MORNING = 1; // เช้า
const SHIFT_AFTERNOON = 2; // บ่าย
const SHIFT_NIGHT = 3; // ดึก

// --- Helper Functions --- (Keep existing helpers: getThaiMonth, getThaiDayOfWeek, getDaysArrayFromStrings, getDisplayDateInfo)
/**
 * Converts month index (0-11) to Thai month name.
 * @param {number} monthIndex - The month index (0 for January, 11 for December).
 * @returns {string} Thai month name or '??' if invalid.
 */
const getThaiMonth = (monthIndex) => {
    const thaiMonths = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
    if (typeof monthIndex === 'number' && monthIndex >= 0 && monthIndex <= 11) {
        return thaiMonths[monthIndex]; // Use the 0-11 index directly
    }
    // Fallback for potential non-number inputs (less ideal)
    const monthNum = parseInt(monthIndex, 10);
     if (!isNaN(monthNum) && monthNum >= 0 && monthNum <= 11) {
          console.warn("getThaiMonth received non-standard number:", monthIndex);
          return thaiMonths[monthNum];
     }
    console.error("Invalid month index received by getThaiMonth:", monthIndex);
    return "??";
};

/**
 * Converts JS Date object's day index (0-6) to short Thai day name.
 * @param {Date} date - The JavaScript Date object.
 * @returns {string} Short Thai day name ('อา', 'จ', ...) or '?'.
 */
const getThaiDayOfWeek = (date) => {
    if (!(date instanceof Date) || isNaN(date.getTime())) {
        return "?";
    }
    const thaiDays = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']; // 0 = Sunday
    return thaiDays[date.getDay()];
};

/**
 * Converts array of date strings ('YYYY-MM-DD') to array of JS Date objects.
 * Creates Date objects at local midnight for the given date string.
 * @param {string[]} dayStrings - Array of date strings in 'YYYY-MM-DD' format.
 * @returns {Date[]} Array of Date objects. Returns empty array if input is not an array.
 */
const getDaysArrayFromStrings = (dayStrings) => {
    if (!Array.isArray(dayStrings)) return [];
    return dayStrings.map(ds => {
        try {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) {
                 throw new Error(`Invalid date string format: "${ds}"`);
            }
            const date = new Date(ds + 'T00:00:00'); // Assume local midnight
            if (isNaN(date.getTime())) throw new Error(`Invalid Date created from "${ds}"`);
            return date;
        } catch (e) {
            console.error(`Error parsing date string "${ds}":`, e);
            return null;
        }
    }).filter(d => d instanceof Date); // Filter out null or invalid dates
};

/**
 * Safely parses 'YYYY-MM-DD' string into month index (0-11) and year.
 * ** This is the standard, correct version **
 * @param {string} dateString - The date string in 'YYYY-MM-DD' format.
 * @returns {{monthIndex: number, year: number}} Object with 0-based monthIndex and year. Returns NaN if invalid.
 */
const getDisplayDateInfo = (dateString) => {
    if (!dateString || typeof dateString !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        console.error("Invalid dateString format received:", dateString);
        return { monthIndex: NaN, year: NaN };
    }
    try {
        const parts = dateString.split('-'); // ["YYYY", "MM", "DD"]
        const year = parseInt(parts[0], 10);
        // Correct: Parse 1-based month (MM) and subtract 1 to get 0-based index
        const monthIndex = parseInt(parts[1], 10) - 1;
        // Validate parsed numbers
        if (isNaN(year) || isNaN(monthIndex) || monthIndex < 0 || monthIndex > 11) {
             console.error("Parsed date parts are invalid:", { year, monthIndex });
             return { monthIndex: NaN, year: NaN };
        }
        return { monthIndex, year }; // Return the 0-based month index
    } catch (e) {
         console.error("Error parsing date string:", dateString, e);
         return { monthIndex: NaN, year: NaN };
    }
};


// --- Main Component ---
const ScheduleDisplay = ({ schedule, nurses }) => {

    // --- Download Excel Function ---
    const handleDownloadExcel = () => {
        // 1. Validate data
        if (!schedule || !schedule.nurseSchedules || !schedule.shiftsCount || !schedule.days || schedule.days.length === 0) {
            alert("ไม่มีข้อมูลตารางเวรสำหรับดาวน์โหลด");
            return;
        }
        const daysAsDates = getDaysArrayFromStrings(schedule.days);
        if (daysAsDates.length !== schedule.days.length) {
            alert("เกิดข้อผิดพลาดในการแปลงข้อมูลวันสำหรับ Excel");
            return;
        }

        // 2. Prepare Headers
        const wsData = [];
        const headerRow1 = ['ชื่อ-สกุล'];
        const headerRow2 = [''];
        daysAsDates.forEach(day => {
            headerRow1.push(day.getDate().toString());
            headerRow2.push(getThaiDayOfWeek(day));
        });
        // ** MODIFIED: Header for N+A double **
        headerRow1.push('เช้า', 'บ่าย', 'ดึก', 'รวม', 'ด+บ', 'หยุด'); // Changed ช+ด to ด+บ
        headerRow2.push('', '', '', '', '', '');
        wsData.push(headerRow1);
        wsData.push(headerRow2);

        // 3. Prepare Data Rows (Sorted)
        const sortedNurseSchedules = Object.values(schedule.nurseSchedules).sort((a, b) => {
            const nameA = `${a?.nurse?.prefix || ''} ${a?.nurse?.firstName || ''} ${a?.nurse?.lastName || ''}`.trim();
            const nameB = `${b?.nurse?.prefix || ''} ${b?.nurse?.firstName || ''} ${b?.nurse?.lastName || ''}`.trim();
            return nameA.localeCompare(nameB, 'th');
        });

        let dataRowsAdded = 0;
        sortedNurseSchedules.forEach(nurseSchedule => {
            if (!nurseSchedule?.nurse?.id) { console.warn("Skipping Excel row: missing nurse ID"); return; }
            const nurseId = nurseSchedule.nurse.id;
            const { nurse } = nurseSchedule;
            const counts = schedule.shiftsCount[nurseId];
            // ** MODIFIED: Check for the renamed N+A count key **
            if (!counts || typeof counts.nightAfternoonDouble === 'undefined') { // Check existence of the new key
                console.warn(`Skipping Excel row for ${nurseId}: missing or incomplete counts (expected 'nightAfternoonDouble')`);
                return;
            }

            const row = [`${nurse.prefix || ''} ${nurse.firstName || ''} ${nurse.lastName || ''}`.trim()];
            schedule.days.forEach(dateStr => {
                const shifts = nurseSchedule.shifts?.[dateStr] || [];
                let shiftText = '-';
                if (shifts.length > 0) {
                    shifts.sort((a, b) => a - b); // Sorts numerically [2, 3] for A, N

                    // ** MODIFIED: Check for N+A specifically for display **
                    const hasA = shifts.includes(SHIFT_AFTERNOON);
                    const hasN = shifts.includes(SHIFT_NIGHT);

                    if (hasN && hasA) {
                        shiftText = 'ด,บ'; // Display ดึก, บ่าย
                    } else {
                        // Fallback for single shifts or other (unexpected) combinations
                        shiftText = shifts.map(shift =>
                            shift === SHIFT_MORNING ? 'ช' :
                            shift === SHIFT_AFTERNOON ? 'บ' :
                            shift === SHIFT_NIGHT ? 'ด' : '?'
                        ).join(',');
                    }
                }
                row.push(shiftText);
            });
            // ** MODIFIED: Push the correct count for N+A **
            row.push(counts.morning ?? 0, counts.afternoon ?? 0, counts.night ?? 0, counts.total ?? 0, counts.nightAfternoonDouble ?? 0, counts.daysOff ?? 0);
            wsData.push(row);
            dataRowsAdded++;
        });

        if (dataRowsAdded === 0) { alert("ไม่มีข้อมูลพยาบาลที่ถูกต้องให้ดาวน์โหลด"); return; }

        // 4. Create Workbook & Worksheet (Unchanged)
        let ws, wb;
        try {
            wb = XLSX.utils.book_new();
            ws = XLSX.utils.aoa_to_sheet(wsData);
            if (!ws) throw new Error("Worksheet creation failed.");
            // Basic column width setting
            const colWidths = wsData[0].map((_, i) => ({ wch: wsData.reduce((max, row) => Math.max(max, String(row[i] ?? '').length), i === 0 ? 25 : 8) }));
             if (colWidths.length > 0) colWidths[0].wch = Math.max(25, colWidths[0].wch);
            ws['!cols'] = colWidths;
            XLSX.utils.book_append_sheet(wb, ws, 'ตารางเวร');
        } catch (sheetError) {
            console.error("Error creating Excel sheet:", sheetError);
            alert("เกิดข้อผิดพลาดในการสร้างไฟล์ Excel (sheet): " + sheetError.message);
            return;
        }

        // 5. Generate Filename using standard date info (Unchanged)
        let filename = 'ตารางเวร.xlsx';
        if (schedule.startDate) {
            const { monthIndex: fileMonthIndex, year: fileYear } = getDisplayDateInfo(schedule.startDate); // Get 0-11 index
            if (!isNaN(fileMonthIndex) && !isNaN(fileYear)) {
                // Use 0-11 index with getThaiMonth
                filename = `ตารางเวร_${getThaiMonth(fileMonthIndex)}_${fileYear + 543}.xlsx`;
            } else {
                console.warn("Could not generate specific filename due to invalid startDate:", schedule.startDate);
            }
        }

        // 6. Trigger Download (Unchanged)
        try {
            if (!wb?.SheetNames?.length) throw new Error("Workbook is empty.");
            XLSX.writeFile(wb, filename);
        } catch (writeError) {
            console.error("Error writing/saving Excel file:", writeError);
            alert("เกิดข้อผิดพลาดในการบันทึกไฟล์ Excel: " + writeError.message);
        }
    };
    // --- End Download Excel Function ---


    // --- Component Render Logic ---

    if (!schedule || !schedule.nurseSchedules || !schedule.days || !schedule.shiftsCount) {
        return (
            <div className="schedule-display card empty-state">
                <p>ยังไม่มีตารางเวรให้แสดงผล</p>
                <p>กรุณาสร้างตารางเวรในหน้า 'สร้างตารางเวร'</p>
            </div>
        );
    }

    // Prepare data for rendering using standard functions (Unchanged)
    const daysAsDatesForRender = getDaysArrayFromStrings(schedule.days);
    const datesValidForRender = daysAsDatesForRender.length === schedule.days.length;
    const { monthIndex: displayMonthIndex, year: displayYear } = getDisplayDateInfo(schedule.startDate); // Get 0-11 index
    const dateInfoValid = !isNaN(displayMonthIndex) && !isNaN(displayYear);

    // ** Get the N+A count for display in header (optional, but good) **
    const totalNADoubles = schedule?.fairnessReport?.totalNADoubles ?? 'N/A';


    return (
        <div className="schedule-display card">
            <h2><span role="img" aria-label="schedule">📋</span> ตารางเวรพยาบาล</h2>

            {/* Schedule Info Header */}
            <div className="schedule-info">
                {dateInfoValid ? (
                    <p>
                        {/* Use 0-11 index with getThaiMonth - NO +1 HACK */}
                        ตารางเวรเดือน {getThaiMonth(displayMonthIndex)}{' '}
                        {displayYear + 543}
                        {/* Display solver status, penalty, and maybe N+A count */}
                        {schedule.solverStatus && ` (สถานะ: ${schedule.solverStatus}, Penalty: ${schedule.penaltyValue?.toFixed(0)}, ด+บ ทั้งหมด: ${totalNADoubles})`}
                    </p>
                 ) : (
                      <p>ตารางเวร (ไม่สามารถระบุเดือน/ปีได้)</p>
                 )}
            </div>

            {/* Legend */}
            <div className="shift-legend">
                 <div style={{ display: 'flex', alignItems: 'center' }}><span className="shift-color shift-morning"></span> ช (เช้า)</div>
                 <div style={{ display: 'flex', alignItems: 'center' }}><span className="shift-color shift-afternoon"></span> บ (บ่าย)</div>
                 <div style={{ display: 'flex', alignItems: 'center' }}><span className="shift-color shift-night"></span> ด (ดึก)</div>
                 {/* ** MODIFIED: Legend for N+A double ** */}
                 <div style={{ display: 'flex', alignItems: 'center' }}><span className="shift-color shift-night-afternoon"></span> ด,บ (ดึกควบบ่าย)</div>
                 <div style={{ display: 'flex', alignItems: 'center' }}><span className="shift-color day-off"></span> หยุด (-)</div>
                 <div style={{ display: 'flex', alignItems: 'center' }}><span className="shift-color holiday"></span> วันหยุด<span style={{ color: '#D32F2F' }}>(นักขัตฤกษ์)</span></div>
            </div>

            {/* Schedule Table */}
            <div className="table-container">
                 {/* ** MODIFIED: minWidth adjusted for new summary column header 'ด+บ' ** */}
                 <table className="schedule-table" style={{ minWidth: `calc(${35 * (schedule.days.length)}px + 180px + 270px)` }}>
                     <thead>
                         <tr>
                             {/* Sticky Nurse Name Header */}
                             <th rowSpan="2" style={{ minWidth: '180px', textAlign: 'left', paddingLeft: '5px', verticalAlign: 'middle', position: 'sticky', left: 0, backgroundColor: 'var(--table-header-bg, #f8f9fa)', zIndex: 1 }}>ชื่อ-สกุล</th>
                             {/* Date Number Headers */}
                              {datesValidForRender ? daysAsDatesForRender.map((day, index) => {
                                 const isHoliday = Array.isArray(schedule.holidays) && schedule.holidays.includes(day.getDate());
                                 return <th key={`h-d-${index}`} className={isHoliday ? 'holiday' : ''} style={{ minWidth: '35px', textAlign: 'center' }}>{day.getDate()}</th>;
                             }) : <th colSpan={schedule.days.length}>Error dates</th>}
                             {/* Summary Header */}
                             <th colSpan="6" rowSpan="1" style={{ verticalAlign: 'middle', textAlign: 'center' }}>รวม</th>
                         </tr>
                         <tr>
                             {/* Day of Week Headers */}
                              {datesValidForRender ? daysAsDatesForRender.map((day, index) => {
                                 const isHoliday = Array.isArray(schedule.holidays) && schedule.holidays.includes(day.getDate());
                                 return <th key={`h-dow-${index}`} className={isHoliday ? 'holiday' : ''} style={{ minWidth: '35px', textAlign: 'center', fontWeight: 'normal' }}>{getThaiDayOfWeek(day)}</th>;
                             }) : schedule.days.map((_, index) => <th key={`err-dow-${index}`}>?</th>)}
                             {/* Summary Labels */}
                             <th style={{ minWidth: '45px', fontWeight: 'normal' }}>เช้า</th>
                             <th style={{ minWidth: '45px', fontWeight: 'normal' }}>บ่าย</th>
                             <th style={{ minWidth: '45px', fontWeight: 'normal' }}>ดึก</th>
                             <th style={{ minWidth: '45px', fontWeight: 'normal' }}>รวม</th>
                             {/* ** MODIFIED: Summary label for N+A ** */}
                             <th style={{ minWidth: '45px', fontWeight: 'normal' }}>ด+บ</th>
                             <th style={{ minWidth: '45px', fontWeight: 'normal' }}>หยุด</th>
                         </tr>
                     </thead>
                     <tbody>
                         {/* Nurse Data Rows */}
                          {Object.values(schedule.nurseSchedules).sort((a, b) => { /* Sorting */
                             const nA = `${a?.nurse?.prefix || ''} ${a?.nurse?.firstName || ''} ${a?.nurse?.lastName || ''}`.trim();
                             const nB = `${b?.nurse?.prefix || ''} ${b?.nurse?.firstName || ''} ${b?.nurse?.lastName || ''}`.trim();
                             return nA.localeCompare(nB, 'th');
                         }).map((nurseSchedule) => {
                             if (!nurseSchedule?.nurse?.id) return <tr key={`err-${Math.random()}`}><td colSpan={schedule.days.length + 7}>ข้อมูลพยาบาลไม่สมบูรณ์</td></tr>;
                             const nurseId = nurseSchedule.nurse.id;
                             const counts = schedule.shiftsCount[nurseId];
                             // ** MODIFIED: Check for the N+A key again for robustness **
                             if (!counts || typeof counts.nightAfternoonDouble === 'undefined') {
                                 return <tr key={`err-c-${nurseId}`}><td colSpan={schedule.days.length + 7}>ข้อมูลสรุปเวรไม่สมบูรณ์ (รอ nightAfternoonDouble)</td></tr>;
                             }

                             return (
                                 <tr key={`nurse-row-${nurseId}`}>
                                     {/* Sticky Nurse Name Cell */}
                                     <td style={{ textAlign: 'left', paddingLeft: '5px', position: 'sticky', left: 0, backgroundColor: 'var(--table-body-bg, white)', zIndex: 0 }}>
                                         {`${nurseSchedule.nurse.prefix || ''} ${nurseSchedule.nurse.firstName || ''} ${nurseSchedule.nurse.lastName || ''}`.trim()}
                                     </td>
                                     {/* Daily Shift Cells */}
                                      {schedule.days.map((dateStr, dayIndex) => {
                                         const shifts = nurseSchedule.shifts[dateStr] || [];
                                         let shiftText = '-';
                                         let cellClassName = 'day-off'; // Default to off

                                         if (shifts.length > 0) {
                                             shifts.sort((a, b) => a - b); // Ensure consistent order [A, N] -> [2, 3]

                                             const hasM = shifts.includes(SHIFT_MORNING);
                                             const hasA = shifts.includes(SHIFT_AFTERNOON);
                                             const hasN = shifts.includes(SHIFT_NIGHT);

                                             // ** MODIFIED: Check for N+A first for display **
                                             if (hasN && hasA) {
                                                 shiftText = 'ด,บ'; // Display ดึก, บ่าย
                                                 cellClassName = 'shift-night-afternoon'; // Use the new CSS class
                                             } else if (hasM) { // Should not happen with N+A, but keep for robustness
                                                 shiftText = 'ช';
                                                 cellClassName = 'shift-morning';
                                             } else if (hasA) { // Single Afternoon
                                                 shiftText = 'บ';
                                                 cellClassName = 'shift-afternoon';
                                             } else if (hasN) { // Single Night
                                                 shiftText = 'ด';
                                                 cellClassName = 'shift-night';
                                             } else {
                                                 // Fallback if shifts array is not empty but doesn't match known patterns
                                                 shiftText = shifts.join(',');
                                                 cellClassName = ''; // Or a generic 'work' class
                                             }
                                         }
                                         // Add holiday background if applicable (Unchanged)
                                         const dayDate = datesValidForRender ? daysAsDatesForRender[dayIndex] : null;
                                         if (dayDate && Array.isArray(schedule.holidays) && schedule.holidays.includes(dayDate.getDate())) { cellClassName += ' holiday-cell-bg'; }

                                         return <td key={`cell-${nurseId}-${dayIndex}`} className={cellClassName}>{shiftText}</td>;
                                      })}
                                     {/* Summary Count Cells */}
                                     {/* ** MODIFIED: Use the N+A count key ** */}
                                     <td>{counts.morning ?? 0}</td><td>{counts.afternoon ?? 0}</td><td>{counts.night ?? 0}</td><td>{counts.total ?? 0}</td><td>{counts.nightAfternoonDouble ?? 0}</td><td>{counts.daysOff ?? 0}</td>
                                 </tr>
                             );
                         })}
                     </tbody>
                 </table>
            </div>

            {/* Download Button */}
            <div className="download-options">
                <button className="download-button" onClick={handleDownloadExcel} disabled={!schedule}>
                    <span role="img" aria-label="download">💾</span> ดาวน์โหลด Excel
                </button>
            </div>
        </div>
    );
};

export default ScheduleDisplay;