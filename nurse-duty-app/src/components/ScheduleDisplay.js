// ScheduleDisplay.js

import React, { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { getThaiMonth, getThaiDayOfWeek, getDaysArrayFromStrings, getDisplayDateInfo } from '../utils/dateUtils';

const SHIFT_MORNING = 1;
const SHIFT_AFTERNOON = 2;
const SHIFT_NIGHT = 3;


const ScheduleDisplay = ({
    schedule,
    nurses,
    onSaveSchedule,
    isHistoryView = false,
    isSaveDisabled = false,
    nextCarryOverFlags
}) => {
    const [isSaving, setIsSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [saveError, setSaveError] = useState(null);
    const [showCarryOverSummary, setShowCarryOverSummary] = useState(false);

    const sortedNurses = useMemo(() => {
        if (!nurses || !Array.isArray(nurses)) {
            return [];
        }

        if (isHistoryView && schedule?.nurseDisplayOrder && Array.isArray(schedule.nurseDisplayOrder)) {
            const orderedNurses = [];
            for (const nurseId of schedule.nurseDisplayOrder) {
                const nurse = nurses.find(n => n.id === nurseId);
                if (nurse) {
                    orderedNurses.push(nurse);
                }
            }

            for (const nurse of nurses) {
                if (!orderedNurses.find(n => n.id === nurse.id)) {
                    orderedNurses.push(nurse);
                }
            }
            return orderedNurses;
        }

        return [...nurses].sort((a, b) => {
            const orderA = a.order !== undefined && a.order !== null ? a.order : Infinity;
            const orderB = b.order !== undefined && b.order !== null ? b.order : Infinity;

            if (orderA === Infinity && orderB === Infinity) {
                const nameA = `${a.prefix ?? ''} ${a.firstName ?? ''} ${a.lastName ?? ''}`.trim();
                const nameB = `${b.prefix ?? ''} ${b.firstName ?? ''} ${b.lastName ?? ''}`.trim();
                return nameA.localeCompare(nameB, 'th');
            }
            return orderA - orderB;
        });
        }, [nurses, isHistoryView, schedule]);


    const handleSaveClick = async () => {
        if (!onSaveSchedule || !schedule || isHistoryView || isSaveDisabled) return;
        setIsSaving(true);
        setSaveSuccess(false);
        setSaveError(null);
        try {
            const result = await onSaveSchedule();
            if (result?.success) {
                setSaveSuccess(true); setTimeout(() => setSaveSuccess(false), 4000);
            } else if (result?.error) {
                setSaveError(result.error); setTimeout(() => setSaveError(null), 6000);
            } else { throw new Error("Save operation returned unexpected result."); }
        } catch (err) {
            console.error("Error saving schedule:", err);
            setSaveError(err.message || "ไม่สามารถบันทึกตารางเวรได้");
            setTimeout(() => setSaveError(null), 5000);
        } finally { setIsSaving(false); }
    };


    const handleDownloadExcel = () => {
        // Use sortedNurses instead of nurses prop
        if (!schedule || !schedule.nurseSchedules || !schedule.shiftsCount || !schedule.days || schedule.days.length === 0 || !sortedNurses || sortedNurses.length === 0) {
            alert("ไม่มีข้อมูลตารางเวรหรือข้อมูลพยาบาลสำหรับดาวน์โหลด"); return;
        }
        const daysAsDates = getDaysArrayFromStrings(schedule.days);
        if (daysAsDates.length !== schedule.days.length) {
            alert("เกิดข้อผิดพลาดในการแปลงข้อมูลวันสำหรับ Excel"); return;
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
        // Iterate over sortedNurses for correct order and data
        sortedNurses.forEach(nurse => { // MODIFIED HERE
            const nurseId = nurse.id;
            const nurseScheduleData = schedule.nurseSchedules[nurseId];

            if (!nurseScheduleData?.shifts) {
                console.warn(`Skip Excel: no schedule shift data for ${nurseId}`);
                return;
            }
            const counts = schedule.shiftsCount[nurseId];
            if (!counts || typeof counts.nightAfternoonDouble === 'undefined' || typeof counts.daysOff === 'undefined') {
                console.warn(`Skip Excel ${nurseId}: incomplete counts`);
                return;
            }

            const row = [`${nurse.prefix ?? ''} ${nurse.firstName ?? ''} ${nurse.lastName ?? ''}`.trim()];
            schedule.days.forEach(dateStr => {
                const shifts = nurseScheduleData.shifts?.[dateStr] || [];
                let shiftText = '-';
                if (shifts.length > 0) {
                    shifts.sort((a, b) => a - b);
                    const hasA = shifts.includes(SHIFT_AFTERNOON); const hasN = shifts.includes(SHIFT_NIGHT);
                    if (hasN && hasA) { shiftText = 'ด,บ'; }
                    else { shiftText = shifts.map(s => s === SHIFT_MORNING ? 'ช' : s === SHIFT_AFTERNOON ? 'บ' : s === SHIFT_NIGHT ? 'ด' : '?').join(','); }
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
            wb = XLSX.utils.book_new(); ws = XLSX.utils.aoa_to_sheet(wsData); if (!ws) throw new Error("Worksheet creation failed.");
            const colWidths = wsData[0].map((_, colIndex) => {
                const maxLength = wsData.reduce((max, row) => Math.max(max, String(row[colIndex] ?? '').length), 0);
                if (colIndex === 0) { return { wch: Math.max(25, maxLength) }; }
                else if (colIndex > 0 && colIndex <= schedule.days.length) { return { wch: Math.max(5, maxLength) }; }
                else { return { wch: Math.max(6, maxLength) }; }
            });
            ws['!cols'] = colWidths;
            XLSX.utils.book_append_sheet(wb, ws, 'ตารางเวร');
        } catch (sheetError) { console.error("Excel sheet error:", sheetError); alert("เกิดข้อผิดพลาดสร้าง Excel sheet: " + sheetError.message); return; }

        let filename = 'ตารางเวร.xlsx';
        if (schedule.startDate) {
            const { monthIndex: fileMonthIndex, year: fileYear } = getDisplayDateInfo(schedule.startDate);
            if (!isNaN(fileMonthIndex) && !isNaN(fileYear)) { filename = `ตารางเวร_${getThaiMonth(fileMonthIndex)}_${fileYear + 543}.xlsx`; }
            else { console.warn("Cannot generate specific filename:", schedule.startDate); }
        }

        try { if (!wb?.SheetNames?.length) throw new Error("Workbook empty."); XLSX.writeFile(wb, filename); }
        catch (writeError) { console.error("Excel write error:", writeError); alert("เกิดข้อผิดพลาดบันทึก Excel: " + writeError.message); }
    };


    if (!schedule || !schedule.nurseSchedules || !schedule.days || !schedule.shiftsCount) {
        return ( <div className="schedule-display card empty-state"> <p>ยังไม่มีตารางเวร</p> <p>กรุณาสร้างตารางเวร</p> </div> );
    }
    // Ensure sortedNurses (derived from nurses prop) is valid before proceeding
    // sortedNurses will be an empty array if the original nurses prop was null, undefined, or not an array.
    // If original nurses prop was an empty array, sortedNurses will also be an empty array.
    // No specific error needed here if sortedNurses is empty, as the map later will just render nothing.

    const daysAsDatesForRender = getDaysArrayFromStrings(schedule.days);
    const datesValidForRender = daysAsDatesForRender.length === schedule.days.length;
    const { monthIndex: displayMonthIndex, year: displayYear } = getDisplayDateInfo(schedule.startDate);
    const dateInfoValid = !isNaN(displayMonthIndex) && !isNaN(displayYear);
    const totalNADoubles = schedule?.fairnessReport?.totalNADoubles ?? 'N/A';
    const scheduleTitle = isHistoryView ? "ประวัติตารางเวร" : "ตารางเวรพยาบาล";
    const saveButtonText = isSaveDisabled ? 'มีข้อมูลเดือนนี้แล้ว' : (saveSuccess ? 'บันทึกแล้ว ✅' : '💾 บันทึกตารางนี้');

    const firstHeaderRowHeight = '35px';

    return (
        <div className="schedule-display card">
            <h2><span role="img" aria-label={isHistoryView ? "history" : "schedule"}> {isHistoryView ? '📜': '📋'} </span> {scheduleTitle}</h2>

            <div className="schedule-info">
                {dateInfoValid ? (
                    <p> ตารางเวรเดือน {getThaiMonth(displayMonthIndex)}{' '} {displayYear + 543}
                        {schedule.solverStatus && ` (สถานะ: ${schedule.solverStatus}, Penalty: ${schedule.penaltyValue?.toFixed(0)}, ด+บ: ${totalNADoubles})`} </p>
                ) : ( <p>ตารางเวร (ไม่สามารถระบุเดือน/ปี)</p> )}
            </div>

            <div className="shift-legend">
                <div style={{ display: 'flex', alignItems: 'center' }}><span className="shift-color shift-morning"></span> ช (เช้า)</div>
                <div style={{ display: 'flex', alignItems: 'center' }}><span className="shift-color shift-afternoon"></span> บ (บ่าย)</div>
                <div style={{ display: 'flex', alignItems: 'center' }}><span className="shift-color shift-night"></span> ด (ดึก)</div>
                <div style={{ display: 'flex', alignItems: 'center' }}><span className="shift-color shift-night-afternoon"></span> ด,บ (ดึกควบบ่าย)</div>
                <div style={{ display: 'flex', alignItems: 'center' }}><span className="shift-color day-off"></span> หยุด (-)</div>
            </div>

            <div className="table-container">
                <table className="schedule-table">
                    <thead>
                        <tr>
                            <th rowSpan="2" style={{ minWidth: '180px', textAlign: 'left', paddingLeft: '5px', verticalAlign: 'middle', position: 'sticky', left: 0, backgroundColor: 'var(--table-header-bg, #f8f9fa)', zIndex: 3 }}>ชื่อ-สกุล</th>
                            {datesValidForRender ? daysAsDatesForRender.map((day, index) => {
                                return <th key={`h-d-${index}`} style={{ minWidth: '35px', textAlign: 'center', position: 'sticky', top: 0, backgroundColor: 'var(--table-header-bg, #f8f9fa)', zIndex: 2 }}>{day.getUTCDate()}</th>;
                            }) : <th colSpan={schedule.days.length}>Error dates</th>}
                            <th colSpan="6" rowSpan="1" style={{ verticalAlign: 'middle', textAlign: 'center', position: 'sticky', top: 0, backgroundColor: 'var(--table-header-bg, #f8f9fa)', zIndex: 2 }}>รวม</th>
                        </tr>
                        <tr>
                            {datesValidForRender ? daysAsDatesForRender.map((day, index) => {
                                return <th key={`h-dow-${index}`} style={{ minWidth: '35px', textAlign: 'center', fontWeight: 'normal', position: 'sticky', top: firstHeaderRowHeight, backgroundColor: 'var(--table-header-bg, #f8f9fa)', zIndex: 2 }}>{getThaiDayOfWeek(day)}</th>;
                            }) : schedule.days.map((_, index) => <th key={`err-dow-${index}`}>?</th>)}
                            <th style={{ minWidth: '45px', fontWeight: 'normal', position: 'sticky', top: firstHeaderRowHeight, backgroundColor: 'var(--table-header-bg, #f8f9fa)', zIndex: 2 }}>เช้า</th>
                            <th style={{ minWidth: '45px', fontWeight: 'normal', position: 'sticky', top: firstHeaderRowHeight, backgroundColor: 'var(--table-header-bg, #f8f9fa)', zIndex: 2 }}>บ่าย</th>
                            <th style={{ minWidth: '45px', fontWeight: 'normal', position: 'sticky', top: firstHeaderRowHeight, backgroundColor: 'var(--table-header-bg, #f8f9fa)', zIndex: 2 }}>ดึก</th>
                            <th style={{ minWidth: '45px', fontWeight: 'normal', position: 'sticky', top: firstHeaderRowHeight, backgroundColor: 'var(--table-header-bg, #f8f9fa)', zIndex: 2 }}>รวม</th>
                            <th style={{ minWidth: '45px', fontWeight: 'normal', position: 'sticky', top: firstHeaderRowHeight, backgroundColor: 'var(--table-header-bg, #f8f9fa)', zIndex: 2 }}>ด+บ</th>
                            <th style={{ minWidth: '45px', fontWeight: 'normal', position: 'sticky', top: firstHeaderRowHeight, backgroundColor: 'var(--table-header-bg, #f8f9fa)', zIndex: 2 }}>หยุด</th>
                        </tr>
                    </thead>
                    <tbody>
                        {/* Use sortedNurses for row iteration */}
                        {sortedNurses.map((nurse) => { // MODIFIED HERE
                            const nurseId = nurse.id;
                            const nurseSchedule = schedule.nurseSchedules[nurseId];
                            const counts = schedule.shiftsCount[nurseId];
                            if (!nurseSchedule?.shifts || !counts) {
                                console.warn(`Missing schedule/count data for nurse ${nurseId} in display`); return (
                                    <tr key={`missing-${nurseId}`}>
                                        <td style={{ textAlign: 'left', paddingLeft: '5px', position: 'sticky', left: 0, backgroundColor: 'var(--table-body-bg, white)', zIndex: 1 }}> {`${nurse.prefix ?? ''} ${nurse.firstName ?? ''} ${nurse.lastName ?? ''}`.trim()} </td>
                                        <td colSpan={schedule.days.length + 6} style={{ fontStyle: 'italic', color: 'grey' }}> (ไม่พบข้อมูลในตารางเวรนี้) </td>
                                    </tr> );
                            }
                            return (
                                <tr key={`nurse-row-${nurseId}`}>
                                    <td style={{ textAlign: 'left', paddingLeft: '5px', position: 'sticky', left: 0, backgroundColor: 'var(--table-body-bg, white)', zIndex: 1 }}> {`${nurse.prefix ?? ''} ${nurse.firstName ?? ''} ${nurse.lastName ?? ''}`.trim()} </td>
                                    {schedule.days.map((dateStr, dayIndex) => {
                                        const shifts = nurseSchedule.shifts[dateStr] || []; let shiftText = '-'; let cellClassName = 'day-off';
                                        if (shifts.length > 0) {
                                            shifts.sort((a, b) => a - b); const hasM = shifts.includes(SHIFT_MORNING); const hasA = shifts.includes(SHIFT_AFTERNOON); const hasN = shifts.includes(SHIFT_NIGHT);
                                            if (hasN && hasA) { shiftText = 'ด,บ'; cellClassName = 'shift-night-afternoon'; }
                                            else if (hasM) { shiftText = 'ช'; cellClassName = 'shift-morning'; }
                                            else if (hasA) { shiftText = 'บ'; cellClassName = 'shift-afternoon'; }
                                            else if (hasN) { shiftText = 'ด'; cellClassName = 'shift-night'; }
                                            else { shiftText = shifts.join(','); cellClassName = ''; }
                                        }
                                        return <td key={`cell-${nurseId}-${dayIndex}`} className={cellClassName}>{shiftText}</td>;
                                    })}
                                    <td>{counts.morning ?? 0}</td> <td>{counts.afternoon ?? 0}</td> <td>{counts.night ?? 0}</td>
                                    <td>{counts.total ?? 0}</td> <td>{counts.nightAfternoonDouble ?? 0}</td> <td>{counts.daysOff ?? 0}</td>
                                </tr> );
                        })}
                    </tbody>
                </table>
            </div>

            <div className="action-buttons" style={{ marginTop: '20px', display: 'flex', justifyContent: 'center', gap: '15px', flexWrap: 'wrap' }}>
                <button className="download-button" onClick={handleDownloadExcel} disabled={!schedule || !sortedNurses || sortedNurses.length === 0}> <span role="img" aria-label="download"></span> ดาวน์โหลด Excel </button>

                {!isHistoryView && nextCarryOverFlags && Object.keys(nextCarryOverFlags).length > 0 && (
                    <button
                        className="secondary-button"
                        onClick={() => setShowCarryOverSummary(true)}
                        disabled={isSaving || saveSuccess}
                        title="แสดงสรุปว่าใครจะได้รับสิทธิพิเศษ หากบันทึกตารางนี้"
                    >
                        📝 ดูผลสิทธิพิเศษ (เดือนถัดไป)
                    </button>
                )}

                {!isHistoryView && onSaveSchedule && (
                    <button
                        className="primary-button"
                        onClick={handleSaveClick}
                        disabled={!schedule || isSaving || saveSuccess || isSaveDisabled}
                        style={{ minWidth: '180px' }}
                        title={isSaveDisabled ? 'มีตารางเดือนนี้บันทึกไว้แล้ว': ''}
                    >
                        {isSaving ? 'กำลังบันทึก...' : saveButtonText}
                    </button>
                )}
            </div>
            {saveError && <div className="error-inline" style={{ color: 'var(--danger)', textAlign: 'center', marginTop: '10px' }}>{saveError}</div>}

            {/* Modal for Carry-over Summary */}
            {showCarryOverSummary && !isHistoryView && nextCarryOverFlags && sortedNurses && ( // MODIFIED: check sortedNurses
                <div className="modal-overlay">
                    <div className="modal-content card">
                        <h3><span role="img" aria-label="flags">🚩</span> สรุปสถานะสิทธิพิเศษที่จะได้รับในเดือนหน้า</h3>
                        <p style={{fontSize: '0.9em', color: 'var(--gray-600)', marginBottom: '15px'}}>
                            หากคุณกด "บันทึกตารางนี้" พยาบาลต่อไปนี้จะถูกกำหนดสถานะ "สิทธิพิเศษ" สำหรับใช้ในการสร้างตารางในเดือนถัดไป
                        </p>
                        <ul style={{ listStyle: 'none', padding: 0, maxHeight: '300px', overflowY: 'auto', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', padding: '10px' }}>
                            {sortedNurses // MODIFIED HERE
                                .filter(nurse => !nurse.isGovernmentOfficial)
                                .map(nurse => { // 'nurse' is from sortedNurses
                                    const willGetFlag = nextCarryOverFlags[nurse.id] === true;
                                    return (
                                        <li key={`flag-${nurse.id}`} style={{ marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px dotted var(--gray-200)'}}>
                                            {`${nurse.prefix ?? ''} ${nurse.firstName ?? ''} ${nurse.lastName ?? ''}`.trim()}:
                                            <span style={{ fontWeight: 'bold', color: willGetFlag ? 'var(--success)' : 'var(--danger)', marginLeft: '5px' }}>
                                                {willGetFlag ? 'จะได้รับสิทธิ์' : 'จะไม่ได้รับสิทธิ์'}
                                            </span>
                                        </li>
                                    );
                                })}
                            {/* MODIFIED: check based on sortedNurses */}
                            {sortedNurses.filter(nurse => !nurse.isGovernmentOfficial).length === 0 && (
                                <li><em>ไม่มีพยาบาล (ที่ไม่ใช่ข้าราชการ) ที่จะพิจารณาสิทธิพิเศษนี้</em></li>
                            )}
                        </ul>
                        <p style={{fontSize: '0.8em', color: 'var(--gray-500)', marginTop: '10px'}}>
                            (หมายเหตุ: ข้าราชการจะไม่มีสิทธิพิเศษประเภทนี้)
                        </p>
                        <button
                            onClick={() => setShowCarryOverSummary(false)}
                            className="primary-button"
                            style={{marginTop: '20px', width: '100px', alignSelf: 'center'}}
                        >
                            ปิด
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ScheduleDisplay;