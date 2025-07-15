// MonthlyRequestManager.js

import React, { useState, useEffect, useCallback } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { constraintRuleTypes } from '../utils/constraintUtils';
import { getThaiMonth } from '../utils/dateUtils';

const getDaysInMonth = (year, month) => {
    if (month === '' || year === '' || isNaN(year) || isNaN(month)) return 0;
    try {
        return new Date(Number(year), Number(month) + 1, 0).getDate();
    } catch (e) {
        console.error("Error getting days in month:", e);
        return 0;
    }
};

// Shift type options for the new request type
const SHIFT_REQUEST_OPTIONS = [
    { value: '', label: '-- เลือกเวร --' },
    { value: 1, label: 'เวรเช้า' },
    { value: 2, label: 'เวรบ่าย' },
    { value: 3, label: 'เวรดึก' },
    { value: 4, label: 'เวรดึกควบบ่าย' },
];

const NEW_REQUEST_TYPE_SPECIFIC_SHIFTS = 'request_specific_shifts_on_days';

// Helper to create initial value for the new request type
const createInitialSpecificShiftsValue = () => [
    { day: '', shift_type: '' },
    { day: '', shift_type: '' }
];

const MonthlyRequestManager = ({
    nurses,
    selectedMonth,
    selectedYear,
    db,
    showErrorPopup
}) => {
    const [selectedNurseId, setSelectedNurseId] = useState('');
    const [softReq1, setSoftReq1] = useState({ type: '', value: '', is_high_priority: false });
    const [softReq2, setSoftReq2] = useState({ type: '', value: '', is_high_priority: false });
    const [isLoadingData, setIsLoadingData] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const selectedNurse = nurses.find(n => n.id === selectedNurseId);
    const daysInSelectedMonth = getDaysInMonth(selectedYear, selectedMonth);
    const isSelectedNurseGovOfficial = selectedNurse?.isGovernmentOfficial === true;

    const resetSoftReqState = useCallback(() => {
        setSoftReq1({ type: '', value: '', is_high_priority: false });
        setSoftReq2({ type: '', value: '', is_high_priority: false });
    }, []);

    useEffect(() => {
        const loadRequests = async () => {
            if (!selectedNurseId || selectedMonth === '' || selectedYear === '' || !db) {
                resetSoftReqState();
                return;
            }

            if (isSelectedNurseGovOfficial) {
                resetSoftReqState();
                setIsLoadingData(false);
                return;
            }

            setIsLoadingData(true);
            const monthYearString = `${selectedYear}-${String(parseInt(selectedMonth) + 1).padStart(2, '0')}`;
            const docId = `${selectedNurseId}_${monthYearString}`;
            const docRef = doc(db, "monthlyNurseRequests", docId);

            const defaultReq = { type: '', value: '', is_high_priority: false };
            let loadedSoft1 = { ...defaultReq };
            let loadedSoft2 = { ...defaultReq };

            try {
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    const savedSoft = data.softRequests || [];
                    
                    if (savedSoft[0]) {
                        loadedSoft1 = { ...savedSoft[0] };
                        if (savedSoft[0].type === NEW_REQUEST_TYPE_SPECIFIC_SHIFTS) {
                            // Ensure value is an array of 2 for UI consistency
                            const valArray = Array.isArray(savedSoft[0].value) ? savedSoft[0].value : [];
                            loadedSoft1.value = [
                                valArray[0] || { day: '', shift_type: '' },
                                valArray[1] || { day: '', shift_type: '' }
                            ];
                        }
                    }
                    if (savedSoft[1]) {
                        loadedSoft2 = { ...savedSoft[1] };
                        if (savedSoft[1].type === NEW_REQUEST_TYPE_SPECIFIC_SHIFTS) {
                            const valArray = Array.isArray(savedSoft[1].value) ? savedSoft[1].value : [];
                            loadedSoft2.value = [
                                valArray[0] || { day: '', shift_type: '' },
                                valArray[1] || { day: '', shift_type: '' }
                            ];
                        }
                    }
                } else {
                     // Try loading defaults from previous month for non-gov only
                    const prevMonthDate = new Date(selectedYear, parseInt(selectedMonth), 1);
                    prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
                    const prevYear = prevMonthDate.getFullYear();
                    const prevMonthIndex = String(prevMonthDate.getMonth());

                    if (getDaysInMonth(prevYear, prevMonthIndex) > 0) {
                        const prevMonthYearString = `${prevYear}-${String(parseInt(prevMonthIndex) + 1).padStart(2, '0')}`;
                        const prevDocId = `${selectedNurseId}_${prevMonthYearString}`;
                        const prevDocRef = doc(db, "monthlyNurseRequests", prevDocId);
                        const prevDocSnap = await getDoc(prevDocRef);
                        if (prevDocSnap.exists()) {
                            const prevData = prevDocSnap.data();
                            const prevSoft = prevData.softRequests || [];
                            if (prevSoft[0]) {
                                loadedSoft1 = { ...prevSoft[0] };
                                if (prevSoft[0].type === NEW_REQUEST_TYPE_SPECIFIC_SHIFTS) {
                                    loadedSoft1.value = createInitialSpecificShiftsValue(); // Reset day/shift values, keep type
                                } else {
                                     loadedSoft1.value = ''; // Clear value for other types if carried over
                                }
                            }
                            if (prevSoft[1]) {
                                loadedSoft2 = { ...prevSoft[1] };
                                if (prevSoft[1].type === NEW_REQUEST_TYPE_SPECIFIC_SHIFTS) {
                                    loadedSoft2.value = createInitialSpecificShiftsValue();
                                } else {
                                    loadedSoft2.value = '';
                                }
                            }
                            // Carry over high priority only if the type is NOT for specific days/shifts
                            if(loadedSoft1.type === NEW_REQUEST_TYPE_SPECIFIC_SHIFTS || loadedSoft1.type === 'no_specific_days') loadedSoft1.is_high_priority = false;
                            if(loadedSoft2.type === NEW_REQUEST_TYPE_SPECIFIC_SHIFTS || loadedSoft2.type === 'no_specific_days') loadedSoft2.is_high_priority = false;

                            console.log(`Loaded default soft request types from previous month (${prevMonthYearString}) for ${selectedNurseId}, values reset.`);
                        }
                    }
                }
                setSoftReq1(loadedSoft1);
                setSoftReq2(loadedSoft2);
            } catch (error) {
                console.error("Error loading monthly requests:", error);
                if (showErrorPopup) showErrorPopup("เกิดข้อผิดพลาดในการโหลดข้อมูลคำขอรายเดือน");
                resetSoftReqState();
            } finally {
                setIsLoadingData(false);
            }
        };
        loadRequests();
    }, [selectedNurseId, selectedMonth, selectedYear, db, showErrorPopup, isSelectedNurseGovOfficial, resetSoftReqState]);

    const handleNurseSelect = (e) => {
        setSelectedNurseId(e.target.value);
    };

    const handleSoftReqChange = (reqIndex, field, fieldValue, subRequestIndex = null, subRequestField = null) => {
        if (isSelectedNurseGovOfficial) return;

        const setter = reqIndex === 1 ? setSoftReq1 : setSoftReq2;
        const otherSetter = reqIndex === 1 ? setSoftReq2 : setSoftReq1;

        setter(prev => {
            let newState = { ...prev };

            if (field === 'type') {
                newState.type = fieldValue;
                newState.is_high_priority = false; // Reset HP when type changes
                if (fieldValue === NEW_REQUEST_TYPE_SPECIFIC_SHIFTS) {
                    newState.value = createInitialSpecificShiftsValue();
                } else if (fieldValue === 'no_specific_days') {
                    newState.value = ''; // Expects comma-separated string
                } else {
                    newState.value = ''; // Other types don't use 'value' input or it's implicitly true
                }
                 if(fieldValue === '') newState.is_high_priority = false;

            } else if (field === 'is_high_priority') {
                newState.is_high_priority = fieldValue;
                if (fieldValue === true) { // if current req is HP, the other cannot be
                    otherSetter(p => ({ ...p, is_high_priority: false }));
                }
            } else if (field === 'value_specific_days_string') { // For no_specific_days type
                 newState.value = fieldValue;
            } else if (field === 'sub_request_value' && newState.type === NEW_REQUEST_TYPE_SPECIFIC_SHIFTS) {
                const newSubRequests = [...(Array.isArray(newState.value) ? newState.value : createInitialSpecificShiftsValue())];
                if (subRequestIndex !== null && subRequestField !== null) {
                    newSubRequests[subRequestIndex] = {
                        ...newSubRequests[subRequestIndex],
                        [subRequestField]: fieldValue
                    };
                     // If day is cleared, clear shift_type too for that sub-request
                    if (subRequestField === 'day' && fieldValue === '') {
                        newSubRequests[subRequestIndex].shift_type = '';
                    }
                }
                newState.value = newSubRequests;
            }
            return newState;
        });
    };
    
    const validateSpecificDaysString = (valueString) => { // For 'no_specific_days' (OFF days)
        if (typeof valueString !== 'string' || !valueString.trim()) return { valid: true, parsed: [] }; // Allow empty
        const parts = valueString.split(',').map(d => d.trim()).filter(d => d !== '');
        if (parts.length === 0 && valueString.trim() !== '') return { valid: false, error: `กรุณาระบุวันที่ให้ถูกต้อง หรือเว้นว่าง`};
        if (parts.length > 2) return { valid: false, error: 'ระบุได้สูงสุด 2 วัน' };
        
        const parsedDays = [];
        for (const part of parts) {
            const dayNum = parseInt(part, 10);
            if (isNaN(dayNum) || dayNum < 1 || dayNum > daysInSelectedMonth) {
                return { valid: false, error: `ระบุวันที่ 1-${daysInSelectedMonth} คั่นด้วยจุลภาค (สูงสุด 2 วัน)` };
            }
            if (parsedDays.includes(dayNum)) return { valid: false, error: 'ระบุวันที่ซ้ำกัน' };
            parsedDays.push(dayNum);
        }
        return { valid: true, parsed: parsedDays.sort((a, b) => a - b) };
    };

    const validateRequestedSpecificShifts = (subRequestsValue) => { // For NEW_REQUEST_TYPE_SPECIFIC_SHIFTS
        if (!Array.isArray(subRequestsValue)) return { valid: false, error: "ข้อมูลรูปแบบไม่ถูกต้อง" };
        
        const parsedSubRequests = [];
        const usedDays = new Set();

        for (const subReq of subRequestsValue) {
            const dayStr = subReq.day;
            const shiftTypeVal = subReq.shift_type;

            if (dayStr === '' && shiftTypeVal === '') continue; // Empty sub-request slot is fine

            if (dayStr === '' || shiftTypeVal === '') {
                return { valid: false, error: "กรุณากรอกทั้งวันที่และประเภทเวรให้ครบถ้วนสำหรับรายการที่เลือก" };
            }

            const dayNum = parseInt(dayStr, 10);
            if (isNaN(dayNum) || dayNum < 1 || dayNum > daysInSelectedMonth) {
                return { valid: false, error: `ระบุวันที่ (1-${daysInSelectedMonth}) ไม่ถูกต้อง: '${dayStr}'` };
            }
            if (usedDays.has(dayNum)) {
                return { valid: false, error: `วันที่ ${dayNum} ถูกระบุซ้ำ` };
            }
            
            const shiftNum = parseInt(shiftTypeVal, 10);
             if (isNaN(shiftNum) || !SHIFT_REQUEST_OPTIONS.find(opt => opt.value === shiftNum && opt.value !== '')) {
                 return { valid: false, error: `ประเภทเวรไม่ถูกต้องสำหรับวันที่ ${dayNum}` };
             }

            parsedSubRequests.push({ day: dayNum, shift_type: shiftNum });
            usedDays.add(dayNum);
        }
        if (parsedSubRequests.length > 2) return { valid: false, error: "สามารถขอเวรที่ระบุได้สูงสุด 2 วันต่อ 1 คำขอ" }; // Should be prevented by UI structure

        return { valid: true, parsed: parsedSubRequests.sort((a,b) => a.day - b.day) };
    };


    const handleSaveSoftRequests = async () => {
        if (!selectedNurseId || isSaving || isSelectedNurseGovOfficial) {
            if (!selectedNurseId) alert("กรุณาเลือกพยาบาลก่อนบันทึก Soft Request");
            if (isSelectedNurseGovOfficial) alert("ข้าราชการไม่ต้องระบุ Soft Request รายเดือน");
            return;
        }

        // Prevent identical non-empty request types
        if (softReq1.type && softReq1.type === softReq2.type) {
            alert("ไม่สามารถเลือกประเภท Soft Request ซ้ำกันได้"); return;
        }

        setIsSaving(true);
        const requestsToSave = [];
        let validationError = null;

        const processRequest = (req, reqNumStr) => {
            if (!req.type) return true; // No type selected, skip this request slot

            let validatedValue;
            let isValid = true;

            if (req.type === 'no_specific_days') {
                const validation = validateSpecificDaysString(typeof req.value === 'string' ? req.value : '');
                if (!validation.valid) {
                    validationError = `Soft Request ${reqNumStr}: ${validation.error}`;
                    isValid = false;
                } else {
                    validatedValue = validation.parsed; // Array of day numbers
                    if (validatedValue.length === 0) return true; // Empty but valid, means no specific days for this type
                }
            } else if (req.type === NEW_REQUEST_TYPE_SPECIFIC_SHIFTS) {
                const validation = validateRequestedSpecificShifts(Array.isArray(req.value) ? req.value : []);
                if (!validation.valid) {
                    validationError = `Soft Request ${reqNumStr}: ${validation.error}`;
                    isValid = false;
                } else {
                    validatedValue = validation.parsed; // Array of {day, shift_type} objects
                    if (validatedValue.length === 0) return true; // No actual shifts requested in this slot
                }
            } else {
                // For other types, value is implicitly true or not directly user-input in the same way
                validatedValue = true; 
            }
            
            if (isValid) {
                requestsToSave.push({ type: req.type, value: validatedValue, is_high_priority: req.is_high_priority });
            }
            return isValid;
        };

        if (!processRequest(softReq1, "1")) {
            alert(validationError); setIsSaving(false); return;
        }
        if (!processRequest(softReq2, "2")) {
            alert(validationError); setIsSaving(false); return;
        }
        
        const monthYearString = `${selectedYear}-${String(parseInt(selectedMonth) + 1).padStart(2, '0')}`;
        const docId = `${selectedNurseId}_${monthYearString}`;
        const docRef = doc(db, "monthlyNurseRequests", docId);

        try {
            await setDoc(docRef, {
                nurseId: selectedNurseId, monthYear: monthYearString, softRequests: requestsToSave
            }, { merge: true });
            alert(`บันทึก Soft Requests สำหรับ ${selectedNurse.firstName} เรียบร้อยแล้ว`);
            console.log(`Soft requests saved for ${selectedNurseId} for ${monthYearString}:`, requestsToSave);
        } catch (error) {
            console.error("Error saving soft requests:", error);
            if (showErrorPopup) showErrorPopup("เกิดข้อผิดพลาดในการบันทึก Soft Request");
            else alert("เกิดข้อผิดพลาดในการบันทึก Soft Request");
        } finally {
            setIsSaving(false);
        }
    };

    const renderSpecificShiftInputs = (reqNumber, reqState) => {
        const reqValueArray = Array.isArray(reqState.value) ? reqState.value : createInitialSpecificShiftsValue();
        
        return reqValueArray.map((subReq, subIndex) => (
            <div key={subIndex} className="specific-shift-sub-request" style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '5px' }}>
                <span style={{minWidth: '40px'}}>วันที่:</span>
                <input
                    type="number"
                    min="1"
                    max={daysInSelectedMonth}
                    value={subReq.day}
                    onChange={(e) => handleSoftReqChange(reqNumber, 'sub_request_value', e.target.value, subIndex, 'day')}
                    className="form-input"
                    placeholder={`1-${daysInSelectedMonth}`}
                    style={{ width: '80px' }}
                    disabled={isSaving}
                />
                <label htmlFor={`shiftTypeReq${reqNumber}Sub${subIndex}`} style={{minWidth: '60px'}}> ประเภทเวร:</label>
                <select
                    id={`shiftTypeReq${reqNumber}Sub${subIndex}`}
                    value={subReq.shift_type}
                    onChange={(e) => handleSoftReqChange(reqNumber, 'sub_request_value', e.target.value, subIndex, 'shift_type')}
                    className="form-select"
                    style={{ minWidth: '150px' }}
                    disabled={isSaving || !subReq.day} // Disable if day is not set
                >
                    {SHIFT_REQUEST_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                </select>
            </div>
        ));
    };


    return (
        <div className="monthly-requests-manager card" style={{ marginTop: '20px' }}>
            <h3><span role="img" aria-label="pencil" style={{marginRight: '10px'}}>✏️</span>2. จัดการ Soft Request รายเดือน</h3>
            <div className="form-group">
                <label htmlFor="nurseSelectReq">เลือกพยาบาล</label>
                <select id="nurseSelectReq" value={selectedNurseId} onChange={handleNurseSelect} className="form-select" disabled={isLoadingData || isSaving}>
                    <option value="">-- เลือกพยาบาล --</option>
                    {nurses.sort((a, b) => `${a?.firstName ?? ''} ${a?.lastName ?? ''}`.localeCompare(`${b?.firstName ?? ''} ${b?.lastName ?? ''}`)).map(nurse => (<option key={nurse.id} value={nurse.id}> {`${nurse.prefix ?? ''} ${nurse.firstName ?? ''} ${nurse.lastName ?? ''}`.trim()} {nurse.isGovernmentOfficial ? '(ข้าราชการ)' : ''} </option>))}
                </select>
            </div>

            {isLoadingData && <div className="loading">กำลังโหลดข้อมูลคำขอ...</div>}

            {!isLoadingData && selectedNurse && (
                <div style={{ marginTop: '15px', padding: '15px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-md)' }}>
                    <h4>ข้อมูลสำหรับ: {`${selectedNurse.prefix ?? ''} ${selectedNurse.firstName ?? ''} ${selectedNurse.lastName ?? ''}`} {isSelectedNurseGovOfficial && <span style={{color:'blue', fontWeight:'bold'}}>(ข้าราชการ)</span>}</h4>
                    <p style={{ margin: '5px 0' }}>สถานะสิทธิพิเศษ <small>(สำหรับผู้ที่ไม่ค่อยได้รับการตอบสนอง Soft Request ที่ระบุเป็นสำคัญมากของตนเองในเดือนที่แล้ว)</small>:
                        <span style={{ fontWeight: 'bold', color: selectedNurse.carry_over_priority_flag && !isSelectedNurseGovOfficial ? 'var(--success)' : 'var(--danger)', marginLeft: '5px' }}>
                            {selectedNurse.carry_over_priority_flag && !isSelectedNurseGovOfficial ? 'Active (มี)' : 'Inactive (ไม่มี)'}
                        </span>
                    </p>

                    {isSelectedNurseGovOfficial ? (
                        <div style={{ marginTop: '20px', borderTop: '1px solid var(--gray-200)', paddingTop: '15px', backgroundColor: 'var(--gray-100)', padding: '10px', borderRadius: 'var(--radius-sm)', textAlign: 'center', fontStyle: 'italic', color: 'var(--gray-600)' }}>
                            <p>พยาบาลข้าราชการมีตารางเวรค่อนข้างคงที่ (เวรเช้า จ-ศ, หยุด ส-อา และวันหยุดนักขัตฤกษ์) จึงไม่ต้องระบุ Soft Request รายเดือน</p>
                        </div>
                    ) : (
                        <div className="soft-requests-section" style={{ marginTop: '20px', borderTop: '1px solid var(--gray-200)', paddingTop: '15px' }}>
                            <h5> <span role="img" aria-label="prefer" style={{marginRight: '5px'}}>👍</span> เพิ่ม/แก้ไข Soft Request (สูงสุด 2 รายการ, ระบุเป็น สำคัญมาก ได้เพียง 1 รายการ) </h5>
                            {[softReq1, softReq2].map((reqState, index) => {
                                const reqNumber = index + 1;
                                return (
                                    <div key={reqNumber} className="soft-request-item" style={{ marginBottom: '15px', padding: '10px', backgroundColor: 'var(--gray-50)', borderRadius: 'var(--radius-sm)' }}>
                                        <strong>Soft Request {reqNumber}:</strong>
                                        <div className="form-group">
                                            <label>ประเภท:</label>
                                            <select value={reqState.type} onChange={(e) => handleSoftReqChange(reqNumber, 'type', e.target.value)} className="form-select" disabled={isSaving}>
                                                {constraintRuleTypes.map(type => (<option key={`s${reqNumber}-${type.value}`} value={type.value}>{type.label}</option>))}
                                            </select>
                                        </div>
                                        
                                        {reqState.type === 'no_specific_days' && (
                                            <div className="form-group">
                                                <label>วันที่ (1-{daysInSelectedMonth}, คั่นด้วย , สูงสุด 2 วัน):</label>
                                                <input type="text" value={typeof reqState.value === 'string' ? reqState.value : ''} onChange={(e) => handleSoftReqChange(reqNumber, 'value_specific_days_string', e.target.value)} className="form-input" placeholder="เช่น 10, 15" disabled={isSaving}/>
                                            </div>
                                        )}

                                        {reqState.type === NEW_REQUEST_TYPE_SPECIFIC_SHIFTS && (
                                            <div className="form-group" style={{marginTop:'10px'}}>
                                                <label style={{marginBottom:'5px', display:'block'}}>ระบุเวรที่ต้องการ (สูงสุด 2 วัน):</label>
                                                {renderSpecificShiftInputs(reqNumber, reqState)}
                                            </div>
                                        )}

                                        <div className="form-group-checkbox">
                                            <input type="checkbox" id={`s${reqNumber}-hp`} checked={reqState.is_high_priority} onChange={(e) => handleSoftReqChange(reqNumber, 'is_high_priority', e.target.checked)} disabled={isSaving || !reqState.type}/>
                                            <label htmlFor={`s${reqNumber}-hp`} style={{marginLeft: '5px'}}> ระบุเป็น "สำคัญมาก"</label>
                                        </div>
                                    </div>
                                );
                            })}
                            <button type="button" onClick={handleSaveSoftRequests} className="primary-button" style={{ marginTop: '15px' }} disabled={isSaving || !selectedNurseId}>
                                {isSaving ? 'กำลังบันทึก...' : 'บันทึก Soft Requests สำหรับพยาบาลคนนี้'}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default MonthlyRequestManager;