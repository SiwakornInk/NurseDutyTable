// ScheduleDisplay.js
import React from 'react';
import * as XLSX from 'xlsx';


const SHIFT_MORNING = 1;
const SHIFT_AFTERNOON = 2;
const SHIFT_NIGHT = 3;


const getThaiMonth = (monthIndex) => {
    const thaiMonths = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
    if (typeof monthIndex === 'number' && monthIndex >= 0 && monthIndex <= 11) {
        return thaiMonths[monthIndex];
    }
    const monthNum = parseInt(monthIndex, 10);
     if (!isNaN(monthNum) && monthNum >= 0 && monthNum <= 11) {
         console.warn("getThaiMonth received non-standard number:", monthIndex);
         return thaiMonths[monthNum];
     }
    console.error("Invalid month index received by getThaiMonth:", monthIndex);
    return "??";
};

const getThaiDayOfWeek = (date) => {
    if (!(date instanceof Date) || isNaN(date.getTime())) {
        return "?";
    }
    const thaiDays = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
    return thaiDays[date.getDay()];
};

const getDaysArrayFromStrings = (dayStrings) => {
    if (!Array.isArray(dayStrings)) return [];
    return dayStrings.map(ds => {
        try {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) {
                 throw new Error(`Invalid date string format: "${ds}"`);
            }

            const date = new Date(ds + 'T00:00:00Z');
            if (isNaN(date.getTime())) throw new Error(`Invalid Date created from "${ds}"`);
            return date;
        } catch (e) {
            console.error(`Error parsing date string "${ds}":`, e);
            return null;
        }
    }).filter(d => d instanceof Date);
};

const getDisplayDateInfo = (dateString) => {
    if (!dateString || typeof dateString !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        console.error("Invalid dateString format received:", dateString);
        return { monthIndex: NaN, year: NaN };
    }
    try {
        const parts = dateString.split('-');
        const year = parseInt(parts[0], 10);
        const monthIndex = parseInt(parts[1], 10) - 1;
        if (isNaN(year) || isNaN(monthIndex) || monthIndex < 0 || monthIndex > 11) {
             console.error("Parsed date parts are invalid:", { year, monthIndex });
             return { monthIndex: NaN, year: NaN };
        }
        return { monthIndex, year };
    } catch (e) {
         console.error("Error parsing date string:", dateString, e);
         return { monthIndex: NaN, year: NaN };
    }
};


const ScheduleDisplay = ({ schedule, nurses }) => {

    const handleDownloadExcel = () => {
        if (!schedule || !schedule.nurseSchedules || !schedule.shiftsCount || !schedule.days || schedule.days.length === 0) {
            alert("ไม่มีข้อมูลตารางเวรสำหรับดาวน์โหลด");
            return;
        }
        const daysAsDates = getDaysArrayFromStrings(schedule.days);
        if (daysAsDates.length !== schedule.days.length) {
            alert("เกิดข้อผิดพลาดในการแปลงข้อมูลวันสำหรับ Excel");
            return;
        }

        const wsData = [];
        const headerRow1 = ['ชื่อ-สกุล'];
        const headerRow2 = [''];
        daysAsDates.forEach(day => {

             headerRow1.push(day.getUTCDate().toString());
             headerRow2.push(getThaiDayOfWeek(day));
        });
        headerRow1.push('เช้า', 'บ่าย', 'ดึก', 'รวม', 'ด+บ', 'หยุด');
        headerRow2.push('', '', '', '', '', '');
        wsData.push(headerRow1);
        wsData.push(headerRow2);


        let dataRowsAdded = 0;
        nurses.forEach(nurse => {
             const nurseId = nurse.id;
             const nurseSchedule = schedule.nurseSchedules[nurseId];


             if (!nurseSchedule || !nurseSchedule.nurse?.id) {
                 console.warn(`Skipping Excel row: missing schedule data for nurse ID ${nurseId}`);
                 return;
            }

             const counts = schedule.shiftsCount[nurseId];
             if (!counts || typeof counts.nightAfternoonDouble === 'undefined' || typeof counts.daysOff === 'undefined') {
                 console.warn(`Skipping Excel row for ${nurseId}: missing or incomplete counts`);
                 return;
             }

            const row = [`${nurse.prefix ?? ''} ${nurse.firstName ?? ''} ${nurse.lastName ?? ''}`.trim()];
            schedule.days.forEach(dateStr => {
                const shifts = nurseSchedule.shifts?.[dateStr] || [];
                let shiftText = '-';
                if (shifts.length > 0) {
                    shifts.sort((a, b) => a - b);
                    const hasA = shifts.includes(SHIFT_AFTERNOON);
                    const hasN = shifts.includes(SHIFT_NIGHT);

                    if (hasN && hasA) {
                        shiftText = 'ด,บ';
                    } else {
                        shiftText = shifts.map(shift =>
                            shift === SHIFT_MORNING ? 'ช' :
                            shift === SHIFT_AFTERNOON ? 'บ' :
                            shift === SHIFT_NIGHT ? 'ด' : '?'
                        ).join(',');
                    }
                }
                row.push(shiftText);
            });
            row.push(counts.morning ?? 0, counts.afternoon ?? 0, counts.night ?? 0, counts.total ?? 0, counts.nightAfternoonDouble ?? 0, counts.daysOff ?? 0);
            wsData.push(row);
            dataRowsAdded++;
        });


        if (dataRowsAdded === 0) { alert("ไม่มีข้อมูลพยาบาลที่ถูกต้องให้ดาวน์โหลด"); return; }

        let ws, wb;
        try {
            wb = XLSX.utils.book_new();
            ws = XLSX.utils.aoa_to_sheet(wsData);
            if (!ws) throw new Error("Worksheet creation failed.");

             const colWidths = wsData[0].map((_, i) => ({ wch: wsData.reduce((max, row) => Math.max(max, String(row[i] ?? '').length), i === 0 ? 25 : 8) }));
             if (colWidths.length > 0) colWidths[0].wch = Math.max(25, colWidths[0].wch);
            ws['!cols'] = colWidths;
            XLSX.utils.book_append_sheet(wb, ws, 'ตารางเวร');
        } catch (sheetError) {
            console.error("Error creating Excel sheet:", sheetError);
            alert("เกิดข้อผิดพลาดในการสร้างไฟล์ Excel (sheet): " + sheetError.message);
            return;
        }

        let filename = 'ตารางเวร.xlsx';
        if (schedule.startDate) {
            const { monthIndex: fileMonthIndex, year: fileYear } = getDisplayDateInfo(schedule.startDate);
            if (!isNaN(fileMonthIndex) && !isNaN(fileYear)) {
                filename = `ตารางเวร_${getThaiMonth(fileMonthIndex)}_${fileYear + 543}.xlsx`;
            } else {
                console.warn("Could not generate specific filename due to invalid startDate:", schedule.startDate);
            }
        }

        try {
            if (!wb?.SheetNames?.length) throw new Error("Workbook is empty.");
            XLSX.writeFile(wb, filename);
        } catch (writeError) {
            console.error("Error writing/saving Excel file:", writeError);
            alert("เกิดข้อผิดพลาดในการบันทึกไฟล์ Excel: " + writeError.message);
        }
    };


    if (!schedule || !schedule.nurseSchedules || !schedule.days || !schedule.shiftsCount) {
        return (
            <div className="schedule-display card empty-state">
                <p>ยังไม่มีตารางเวรให้แสดงผล</p>
                <p>กรุณาสร้างตารางเวรในหน้า 'สร้างตารางเวร'</p>
            </div>
        );
    }

    const daysAsDatesForRender = getDaysArrayFromStrings(schedule.days);
    const datesValidForRender = daysAsDatesForRender.length === schedule.days.length;
    const { monthIndex: displayMonthIndex, year: displayYear } = getDisplayDateInfo(schedule.startDate);
    const dateInfoValid = !isNaN(displayMonthIndex) && !isNaN(displayYear);

    const totalNADoubles = schedule?.fairnessReport?.totalNADoubles ?? 'N/A';


    return (
        <div className="schedule-display card">
            <h2><span role="img" aria-label="schedule">📋</span> ตารางเวรพยาบาล</h2>

            <div className="schedule-info">
                {dateInfoValid ? (
                    <p>
                        ตารางเวรเดือน {getThaiMonth(displayMonthIndex)}{' '}
                        {displayYear + 543}
                         {schedule.solverStatus && ` (สถานะ: ${schedule.solverStatus}, Penalty: ${schedule.penaltyValue?.toFixed(0)}, ด+บ ทั้งหมด: ${totalNADoubles})`}
                    </p>
                 ) : (
                      <p>ตารางเวร (ไม่สามารถระบุเดือน/ปีได้)</p>
                  )}
            </div>

            <div className="shift-legend">

                 <div style={{ display: 'flex', alignItems: 'center' }}><span className="shift-color shift-morning"></span> ช (เช้า)</div>
                 <div style={{ display: 'flex', alignItems: 'center' }}><span className="shift-color shift-afternoon"></span> บ (บ่าย)</div>
                 <div style={{ display: 'flex', alignItems: 'center' }}><span className="shift-color shift-night"></span> ด (ดึก)</div>
                 <div style={{ display: 'flex', alignItems: 'center' }}><span className="shift-color shift-night-afternoon"></span> ด,บ (ดึกควบบ่าย)</div>
                 <div style={{ display: 'flex', alignItems: 'center' }}><span className="shift-color day-off"></span> หยุด (-)</div>
                 <div style={{ display: 'flex', alignItems: 'center' }}><span className="shift-color holiday"></span> วันหยุด<span style={{ color: '#D32F2F' }}>(นักขัตฤกษ์)</span></div>
            </div>

            <div className="table-container">

                 <table className="schedule-table" style={{ minWidth: `calc(${35 * (schedule.days.length)}px + 180px + 270px)` }}>
                    <thead>
                        <tr>

                             <th rowSpan="2" style={{ minWidth: '180px', textAlign: 'left', paddingLeft: '5px', verticalAlign: 'middle', position: 'sticky', left: 0, backgroundColor: 'var(--table-header-bg, #f8f9fa)', zIndex: 1 }}>ชื่อ-สกุล</th>
                            {datesValidForRender ? daysAsDatesForRender.map((day, index) => {

                                 const isHoliday = Array.isArray(schedule.holidays) && schedule.holidays.includes(day.getUTCDate());
                                return <th key={`h-d-${index}`} className={isHoliday ? 'holiday' : ''} style={{ minWidth: '35px', textAlign: 'center' }}>{day.getUTCDate()}</th>;
                            }) : <th colSpan={schedule.days.length}>Error dates</th>}
                             <th colSpan="6" rowSpan="1" style={{ verticalAlign: 'middle', textAlign: 'center' }}>รวม</th>
                        </tr>
                        <tr>

                             {datesValidForRender ? daysAsDatesForRender.map((day, index) => {
                                 const isHoliday = Array.isArray(schedule.holidays) && schedule.holidays.includes(day.getUTCDate());
                                 return <th key={`h-dow-${index}`} className={isHoliday ? 'holiday' : ''} style={{ minWidth: '35px', textAlign: 'center', fontWeight: 'normal' }}>{getThaiDayOfWeek(day)}</th>;
                             }) : schedule.days.map((_, index) => <th key={`err-dow-${index}`}>?</th>)}
                             <th style={{ minWidth: '45px', fontWeight: 'normal' }}>เช้า</th>
                             <th style={{ minWidth: '45px', fontWeight: 'normal' }}>บ่าย</th>
                             <th style={{ minWidth: '45px', fontWeight: 'normal' }}>ดึก</th>
                             <th style={{ minWidth: '45px', fontWeight: 'normal' }}>รวม</th>
                             <th style={{ minWidth: '45px', fontWeight: 'normal' }}>ด+บ</th>
                             <th style={{ minWidth: '45px', fontWeight: 'normal' }}>หยุด</th>
                        </tr>
                    </thead>
                    <tbody>

                         {nurses.map((nurse) => {
                             const nurseId = nurse.id;
                             const nurseSchedule = schedule.nurseSchedules[nurseId];
                             const counts = schedule.shiftsCount[nurseId];


                             if (!nurseSchedule || !counts) {
                                 console.warn(`Missing schedule data or counts for nurse ${nurseId}`);
                                 return (
                                     <tr key={`missing-data-${nurseId}`}>
                                         <td style={{ textAlign: 'left', paddingLeft: '5px', position: 'sticky', left: 0, backgroundColor: 'var(--table-body-bg, white)', zIndex: 0 }}>
                                             {`${nurse.prefix ?? ''} ${nurse.firstName ?? ''} ${nurse.lastName ?? ''}`.trim()}
                                         </td>
                                         <td colSpan={schedule.days.length + 6} style={{ fontStyle: 'italic', color: 'grey' }}>
                                             ไม่พบข้อมูลในตารางเวรที่สร้าง
                                         </td>
                                     </tr>
                                 );
                             }

                             return (
                                <tr key={`nurse-row-${nurseId}`}>
                                    <td style={{ textAlign: 'left', paddingLeft: '5px', position: 'sticky', left: 0, backgroundColor: 'var(--table-body-bg, white)', zIndex: 0 }}>
                                         {`${nurse.prefix ?? ''} ${nurse.firstName ?? ''} ${nurse.lastName ?? ''}`.trim()}
                                    </td>
                                     {schedule.days.map((dateStr, dayIndex) => {
                                         const shifts = nurseSchedule.shifts[dateStr] || [];
                                         let shiftText = '-';
                                         let cellClassName = 'day-off';

                                         if (shifts.length > 0) {
                                              shifts.sort((a, b) => a - b);
                                             const hasM = shifts.includes(SHIFT_MORNING);
                                             const hasA = shifts.includes(SHIFT_AFTERNOON);
                                             const hasN = shifts.includes(SHIFT_NIGHT);

                                             if (hasN && hasA) {
                                                 shiftText = 'ด,บ';
                                                 cellClassName = 'shift-night-afternoon';
                                             } else if (hasM) {
                                                 shiftText = 'ช';
                                                 cellClassName = 'shift-morning';
                                             } else if (hasA) {
                                                 shiftText = 'บ';
                                                 cellClassName = 'shift-afternoon';
                                             } else if (hasN) {
                                                 shiftText = 'ด';
                                                 cellClassName = 'shift-night';
                                             } else {

                                                 shiftText = shifts.join(',');
                                                 cellClassName = '';
                                             }
                                         }

                                         return <td key={`cell-${nurseId}-${dayIndex}`} className={cellClassName}>{shiftText}</td>;
                                     })}

                                     <td>{counts.morning ?? 0}</td>
                                     <td>{counts.afternoon ?? 0}</td>
                                     <td>{counts.night ?? 0}</td>
                                     <td>{counts.total ?? 0}</td>
                                     <td>{counts.nightAfternoonDouble ?? 0}</td>
                                     <td>{counts.daysOff ?? 0}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <div className="download-options">
                <button className="download-button" onClick={handleDownloadExcel} disabled={!schedule}>
                    <span role="img" aria-label="download">💾</span> ดาวน์โหลด Excel
                </button>
            </div>
        </div>
    );
};

export default ScheduleDisplay;