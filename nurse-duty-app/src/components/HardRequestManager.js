// HardRequestManager.js

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    doc, getDoc, setDoc, collection, query, where, getDocs, Timestamp,
    runTransaction, serverTimestamp, getCountFromServer, deleteDoc, orderBy
} from 'firebase/firestore';
import { getThaiMonth, formatDateToLocalYYYYMMDD } from '../utils/dateUtils';

const MAX_DAILY_HARD_REQUESTS = 3;
const YEARLY_QUOTA = 5;

const thaiMonths = [
    "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
];

const getEffectiveQuotaResetMonthIndex = (nurse, nurseCreatedAt) => {
    if (nurse && typeof nurse.quotaResetMonth === 'number' && nurse.quotaResetMonth >= 0 && nurse.quotaResetMonth <= 11) {
        return nurse.quotaResetMonth;
    }
    if (nurseCreatedAt && nurseCreatedAt.toDate) {
        try {
            return (nurseCreatedAt.toDate().getMonth() + 1) % 12;
        } catch (e) {
            console.warn("Error getting month from createdAt for reset index", e);
            return 5; // Default June (index 5) as a fallback
        }
    }
    return 5; // Default June (index 5) as a broad fallback
};


// Helper function to get current quota cycle dates
const getCurrentQuotaCycle = (explicitResetMonthIndex) => {
    let resetMonthIndex = typeof explicitResetMonthIndex === 'number' && explicitResetMonthIndex >= 0 && explicitResetMonthIndex <= 11
        ? explicitResetMonthIndex
        : 5; // Default to June (index 5) if not valid (should always be valid via getEffectiveQuotaResetMonthIndex)

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const currentYear = today.getFullYear();
    const resetDay = 1;

    const thisYearResetDate = new Date(Date.UTC(currentYear, resetMonthIndex, resetDay));
    const nextYearResetDate = new Date(Date.UTC(currentYear + 1, resetMonthIndex, resetDay));

    let cycleStartDate;
    let cycleEndDate; // Exclusive end date (start of next cycle)

    if (today >= thisYearResetDate) {
        cycleStartDate = thisYearResetDate;
        cycleEndDate = nextYearResetDate;
    } else {
        cycleStartDate = new Date(Date.UTC(currentYear - 1, resetMonthIndex, resetDay));
        cycleEndDate = thisYearResetDate;
    }

    return {
        start: cycleStartDate.toISOString().split('T')[0], // YYYY-MM-DD
        end: cycleEndDate.toISOString().split('T')[0],     // YYYY-MM-DD (exclusive)
        resetMonthName: getThaiMonth(resetMonthIndex)
    };
};

const calculateDisplayEndDate = (exclusiveEndDateString) => {
    if (!exclusiveEndDateString) return '...';
    try {
        const endDate = new Date(exclusiveEndDateString + 'T00:00:00Z'); // Ensure UTC context for consistency
        endDate.setUTCDate(endDate.getUTCDate() - 1);
        return endDate.toISOString().split('T')[0]; // YYYY-MM-DD
    } catch (e) {
        console.error("Error calculating display end date:", e);
        return 'Error';
    }
};


const HardRequestManager = ({ nurses, db, showErrorPopup, onUpdateNurseInApp }) => {
    const [selectedNurseId, setSelectedNurseId] = useState('');
    const [selectedDate, setSelectedDate] = useState('');
    const [currentCycleInfo, setCurrentCycleInfo] = useState(null);
    const [isLoadingCycleUsage, setIsLoadingCycleUsage] = useState(false);
    const [isLoadingDailyCount, setIsLoadingDailyCount] = useState(false);
    const [isLoadingApprovedList, setIsLoadingApprovedList] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isCancelling, setIsCancelling] = useState(false);
    const [dailyUsage, setDailyUsage] = useState(0);
    const [approvedRequests, setApprovedRequests] = useState([]);
    const [selectedNurseCreatedAt, setSelectedNurseCreatedAt] = useState(null);

    const [isEditingQuotaMonth, setIsEditingQuotaMonth] = useState(false);
    const [newQuotaResetMonth, setNewQuotaResetMonth] = useState(5); // Default to June (index 5)
    const [isSavingQuotaMonth, setIsSavingQuotaMonth] = useState(false);


    const selectedNurse = nurses.find(n => n.id === selectedNurseId);
    const isSelectedNurseGovOfficial = selectedNurse?.isGovernmentOfficial === true;

    const effectiveResetMonthIndex = useMemo(() => {
        return getEffectiveQuotaResetMonthIndex(selectedNurse, selectedNurseCreatedAt);
    }, [selectedNurse, selectedNurseCreatedAt]);

    useEffect(() => {
        if (selectedNurse) {
            setSelectedNurseCreatedAt(selectedNurse.createdAt || null);
            // setNewQuotaResetMonth(effectiveResetMonthIndex); // Update editor if nurse changes
        } else {
            setSelectedNurseCreatedAt(null);
            setCurrentCycleInfo(null);
        }
        setSelectedDate('');
        setIsEditingQuotaMonth(false); // Close editor when nurse changes
    }, [selectedNurse]);


    const fetchCurrentCycleUsage = useCallback(async () => {
        if (!selectedNurseId || !db || selectedNurseCreatedAt === undefined || isSelectedNurseGovOfficial) {
            setCurrentCycleInfo(null);
            setIsLoadingCycleUsage(false);
            return;
        }
        setIsLoadingCycleUsage(true);
        setCurrentCycleInfo(null);

        try {
            const { start, end, resetMonthName } = getCurrentQuotaCycle(effectiveResetMonthIndex);

            const cycleQuery = query(collection(db, "approvedHardRequests"),
                where("nurseId", "==", selectedNurseId),
                where("date", ">=", start),
                where("date", "<", end)
            );
            const cycleSnapshot = await getCountFromServer(cycleQuery);
            const usedCount = cycleSnapshot.data().count;

            setCurrentCycleInfo({
                used: usedCount,
                total: YEARLY_QUOTA,
                start: start,
                end: end, // exclusive end
                resetMonthName: resetMonthName
            });

        } catch (error) {
            console.error("Error fetching current cycle usage:", error);
            showErrorPopup(`เกิดข้อผิดพลาดในการโหลดโควต้าปัจจุบัน: ${error.message}`);
            setCurrentCycleInfo(null);
        } finally {
            setIsLoadingCycleUsage(false);
        }
    }, [selectedNurseId, db, showErrorPopup, selectedNurseCreatedAt, isSelectedNurseGovOfficial, effectiveResetMonthIndex]);

    useEffect(() => {
        fetchCurrentCycleUsage();
    }, [fetchCurrentCycleUsage]);

    const fetchDailyUsage = useCallback(async () => {
        if (!selectedDate || !db) { setDailyUsage(0); return; }
        setIsLoadingDailyCount(true);
        try {
            const q = query(collection(db, "approvedHardRequests"), where("date", "==", selectedDate));
            const snapshot = await getCountFromServer(q);
            setDailyUsage(snapshot.data().count);
        } catch (error) {
            console.error("Error fetching daily count:", error);
            showErrorPopup(`เกิดข้อผิดพลาดโหลดจำนวนวัน: ${error.message}`); setDailyUsage(0);
        } finally { setIsLoadingDailyCount(false); }
    }, [selectedDate, db, showErrorPopup]);

    useEffect(() => { fetchDailyUsage(); }, [fetchDailyUsage]);

    const fetchApprovedRequests = useCallback(async () => {
        if (!selectedNurseId || !db) { setApprovedRequests([]); return; }
        setIsLoadingApprovedList(true); setApprovedRequests([]);
        try {
            const q = query(collection(db, "approvedHardRequests"), where("nurseId", "==", selectedNurseId), orderBy("date", "asc"));
            const querySnapshot = await getDocs(q);
            const requests = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setApprovedRequests(requests);
        } catch (error) {
            console.error("Error fetching approved list:", error);
            showErrorPopup(`เกิดข้อผิดพลาดโหลดรายการอนุมัติ: ${error.message}`); setApprovedRequests([]);
        } finally { setIsLoadingApprovedList(false); }
    }, [selectedNurseId, db, showErrorPopup]);

    useEffect(() => { fetchApprovedRequests(); }, [fetchApprovedRequests]);


    const handleNurseSelect = (e) => {
        setSelectedNurseId(e.target.value);
        setSelectedDate('');
        setApprovedRequests([]);
        // selectedNurseCreatedAt will be updated by useEffect on selectedNurse
        setCurrentCycleInfo(null);
        setIsEditingQuotaMonth(false); // Close editor
    };
    const handleDateChange = (e) => { setSelectedDate(e.target.value); };

    const handleRequestSubmit = async () => {
        if (isSelectedNurseGovOfficial) {
            showErrorPopup("พยาบาลข้าราชการไม่สามารถใช้ระบบ Hard Request นี้ได้");
            return;
        }
        if (!selectedNurseId || !selectedDate || !db || !selectedNurse) {
            showErrorPopup("กรุณาเลือกพยาบาลและวันที่"); return;
        }
        if (isSubmitting || isCancelling || isSavingQuotaMonth) return;
        setIsSubmitting(true); showErrorPopup(null);

        try {
            const currentResetMonthIndex = effectiveResetMonthIndex; // Use the memoized value

            let requestedDateObj;
            let cycleStartDateStr, nextCycleStartDateStr;
            try {
                requestedDateObj = new Date(selectedDate + 'T00:00:00Z');
                if (isNaN(requestedDateObj.getTime())) throw new Error("Invalid selected date");
                const requestedYear = requestedDateObj.getUTCFullYear();
                const requestedMonth = requestedDateObj.getUTCMonth();
                let cycleStartYear = requestedYear;
                if (requestedMonth < currentResetMonthIndex) { cycleStartYear = requestedYear - 1; }
                cycleStartDateStr = `${cycleStartYear}-${String(currentResetMonthIndex + 1).padStart(2, '0')}-01`;
                nextCycleStartDateStr = `${cycleStartYear + 1}-${String(currentResetMonthIndex + 1).padStart(2, '0')}-01`;
            } catch (e) { throw new Error("ไม่สามารถคำนวณรอบโควต้าได้: " + e.message); }

            await runTransaction(db, async (transaction) => {
                const cycleQuery = query(collection(db, "approvedHardRequests"),
                    where("nurseId", "==", selectedNurseId),
                    where("date", ">=", cycleStartDateStr),
                    where("date", "<", nextCycleStartDateStr)
                );
                const cycleSnapshot = await getDocs(cycleQuery);
                const cycleCount = cycleSnapshot.size;

                if (cycleCount >= YEARLY_QUOTA) {
                    throw new Error(`โควต้า Hard Request ของ ${selectedNurse.firstName} ในรอบปี (${cycleStartDateStr} ถึงก่อน ${nextCycleStartDateStr}) หมดแล้ว (${cycleCount}/${YEARLY_QUOTA})`);
                }

                const dailyQuery = query(collection(db, "approvedHardRequests"), where("date", "==", selectedDate));
                const dailySnapshot = await getDocs(dailyQuery);
                const currentDailyCount = dailySnapshot.size;
                if (currentDailyCount >= MAX_DAILY_HARD_REQUESTS) throw new Error(`โควต้า Hard Request วันที่ ${selectedDate} เต็มแล้ว (${currentDailyCount}/${MAX_DAILY_HARD_REQUESTS})`);

                const existingRequestQuery = query(collection(db, "approvedHardRequests"), where("date", "==", selectedDate), where("nurseId", "==", selectedNurseId));
                const existingSnapshot = await getDocs(existingRequestQuery);
                if (!existingSnapshot.empty) throw new Error(`พยาบาลท่านนี้ได้ขอ Hard Request ในวันที่ ${selectedDate} ไปแล้ว`);

                const newRequestRef = doc(collection(db, "approvedHardRequests"));
                transaction.set(newRequestRef, {
                    nurseId: selectedNurseId, date: selectedDate, approvedAt: serverTimestamp(),
                    quotaCycleStartDate: cycleStartDateStr
                });
            });

            alert(`อนุมัติ Hard Request สำหรับ ${selectedNurse.firstName} วันที่ ${selectedDate} เรียบร้อยแล้ว`);
            fetchDailyUsage();
            fetchApprovedRequests();
            fetchCurrentCycleUsage(); // This will use the updated effectiveResetMonthIndex if it changed
            setSelectedDate('');

        } catch (error) {
            console.error("Error submitting hard request:", error);
            showErrorPopup(`ส่งคำขอไม่สำเร็จ: ${error.message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleCancelRequest = async (requestId, requestDate) => {
        if (isSelectedNurseGovOfficial) {
            showErrorPopup("ไม่สามารถยกเลิก Hard Request ของพยาบาลข้าราชการผ่านระบบนี้ได้");
            return;
        }
        if (!requestId || !requestDate || !selectedNurseId || !db) return;
        if (isSubmitting || isCancelling || isSavingQuotaMonth) return;
        const nurseName = selectedNurse?.firstName || 'พยาบาลที่เลือก';
        if (!window.confirm(`ยืนยันยกเลิก Hard Request ของ ${nurseName} ในวันที่ ${requestDate}?`)) return;

        setIsCancelling(true); showErrorPopup(null);
        try {
            const requestRef = doc(db, "approvedHardRequests", requestId);
            await deleteDoc(requestRef);
            alert(`ยกเลิก Hard Request วันที่ ${requestDate} เรียบร้อยแล้ว`);
            fetchDailyUsage();
            fetchApprovedRequests();
            fetchCurrentCycleUsage();
        } catch (error) {
            console.error("Error cancelling hard request:", error);
            showErrorPopup(`ยกเลิกคำขอไม่สำเร็จ: ${error.message}`);
        } finally {
            setIsCancelling(false);
        }
    };

    const handleSaveQuotaResetMonth = async () => {
        if (!selectedNurse || !onUpdateNurseInApp || typeof newQuotaResetMonth !== 'number') {
            showErrorPopup("ข้อมูลไม่ถูกต้องสำหรับบันทึกรอบโควต้า");
            return;
        }
        setIsSavingQuotaMonth(true);
        showErrorPopup(null);
        try {
            const success = await onUpdateNurseInApp(selectedNurse.id, { quotaResetMonth: newQuotaResetMonth });
            if (success) {
                alert(`บันทึกรอบรีเซ็ตโควต้าสำหรับ ${selectedNurse.firstName} เป็นเดือน ${getThaiMonth(newQuotaResetMonth)} เรียบร้อยแล้ว`);
                setIsEditingQuotaMonth(false);
                // selectedNurse object will be updated via props, triggering re-calculation of effectiveResetMonthIndex and fetchCurrentCycleUsage
            } else {
                showErrorPopup("ไม่สามารถบันทึกรอบรีเซ็ตโควต้าได้");
            }
        } catch (error) {
            console.error("Error saving quota reset month:", error);
            showErrorPopup(`เกิดข้อผิดพลาดในการบันทึกรอบโควต้า: ${error.message}`);
        } finally {
            setIsSavingQuotaMonth(false);
        }
    };


    const isLoading = isLoadingDailyCount || isLoadingApprovedList || isLoadingCycleUsage || isSavingQuotaMonth;
    const canSubmitDaily = dailyUsage < MAX_DAILY_HARD_REQUESTS;
    const disableActionsForGov = isSelectedNurseGovOfficial;


    return (
        <div className="hard-request-manager card" style={{ marginTop: '20px' }}>
            <h3><span role="img" aria-label="stop" style={{ marginRight: '10px' }}>🛑</span>จัดการ Hard Request (ขอวันหยุดล่วงหน้า)</h3>

            <div className="form-group">
                <label htmlFor="hrNurseSelect">เลือกพยาบาล</label>
                <select id="hrNurseSelect" value={selectedNurseId} onChange={handleNurseSelect} className="form-select" disabled={isSubmitting || isLoading || isCancelling}>
                    <option value="">-- เลือกพยาบาล --</option>
                    {nurses.sort((a, b) => `${a?.firstName ?? ''} ${a?.lastName ?? ''}`.localeCompare(`${b?.firstName ?? ''} ${b?.lastName ?? ''}`)).map(nurse => (
                        <option key={nurse.id} value={nurse.id}>{`${nurse.prefix ?? ''} ${nurse.firstName ?? ''} ${nurse.lastName ?? ''}`.trim()} {nurse.isGovernmentOfficial ? '(ข้าราชการ)' : ''}</option>
                    ))}
                </select>
            </div>

            {selectedNurse && isSelectedNurseGovOfficial && (
                <div style={{ marginTop: '15px', padding: '10px', backgroundColor: 'var(--gray-100)', borderRadius: 'var(--radius-sm)', textAlign: 'center', fontStyle: 'italic', color: 'var(--gray-600)' }}>
                    <p>พยาบาลข้าราชการมีการจัดการวันหยุด/วันลาตามระเบียบของหน่วยงาน ไม่ต้องใช้ระบบ Hard Request นี้</p>
                </div>
            )}

            {selectedNurse && !isSelectedNurseGovOfficial && (
                <>
                    <div style={{ margin: '15px 0', padding: '10px', backgroundColor: '#f0f0f0', borderRadius: '4px' }}>
                        <p>
                            <strong>โควต้า Hard Request (รอบปีปัจจุบัน):</strong> {' '}
                            {isLoadingCycleUsage ? 'กำลังโหลด...' : currentCycleInfo ?
                                `${currentCycleInfo.used} / ${currentCycleInfo.total} ครั้ง` : 'N/A'}
                        </p>
                        <p><small>
                            (รอบปี: {isLoadingCycleUsage ? '...' : currentCycleInfo ?
                                `${currentCycleInfo.start} ถึง ${calculateDisplayEndDate(currentCycleInfo.end)} (รีเซ็ตทุกวันที่ 1 ${currentCycleInfo.resetMonthName})`
                                : '...'})
                        </small></p>
                    </div>

                    <div style={{ marginTop: '10px', marginBottom: '15px', padding: '10px', border: '1px dashed var(--gray-300)', borderRadius: 'var(--radius-sm)' }}>
                        <p style={{ marginBottom: '5px' }}>
                            ปัจจุบันรอบโควต้าจะรีเซ็ตทุกวันที่ 1 เดือน <strong>{getThaiMonth(effectiveResetMonthIndex)}</strong>
                            <button
                                onClick={() => { setIsEditingQuotaMonth(true); setNewQuotaResetMonth(effectiveResetMonthIndex); }}
                                style={{ marginLeft: '10px' }}
                                className="secondary-button-small"
                                disabled={isSubmitting || isCancelling || isLoadingCycleUsage || isSavingQuotaMonth || isEditingQuotaMonth}
                            >
                                แก้ไขรอบโควต้า
                            </button>
                        </p>
                        {isEditingQuotaMonth && (
                            <div style={{ borderTop: '1px solid #ccc', paddingTop: '10px', marginTop: '10px' }}>
                                <label htmlFor="quotaMonthSelect" style={{ display: 'block', marginBottom: '5px' }}>
                                    เลือกรอบรีเซ็ตโควต้าใหม่ (โควต้าจะเริ่มนับใหม่ทุกวันที่ 1 ของเดือนที่เลือก):
                                </label>
                                <select
                                    id="quotaMonthSelect"
                                    value={newQuotaResetMonth}
                                    onChange={(e) => setNewQuotaResetMonth(parseInt(e.target.value))}
                                    disabled={isSavingQuotaMonth}
                                    className="form-select"
                                    style={{maxWidth: '200px', display: 'inline-block', marginRight: '10px'}}
                                >
                                    {thaiMonths.map((month, index) => (
                                        <option key={index} value={index}>{month}</option>
                                    ))}
                                </select>
                                <button onClick={handleSaveQuotaResetMonth} disabled={isSavingQuotaMonth} className="primary-button-small" style={{ marginRight: '5px' }}>
                                    {isSavingQuotaMonth ? 'กำลังบันทึก...' : 'บันทึก'}
                                </button>
                                <button onClick={() => setIsEditingQuotaMonth(false)} disabled={isSavingQuotaMonth} className="cancel-button-small">
                                    ยกเลิก
                                </button>
                            </div>
                        )}
                    </div>
                </>
            )}


            <div className="form-group">
                <label htmlFor="hrDateSelect">เลือกวันที่ต้องการหยุด</label>
                <input
                    type="date"
                    id="hrDateSelect"
                    value={selectedDate}
                    onChange={handleDateChange}
                    className="form-input"
                    disabled={!selectedNurseId || isSubmitting || isLoading || isCancelling || disableActionsForGov || isEditingQuotaMonth}
                    title={disableActionsForGov ? "ข้าราชการไม่ต้องใช้ระบบนี้" : isEditingQuotaMonth ? "กำลังแก้ไขรอบโควต้า" : ""}
                />
            </div>

            {selectedDate && (
                <div style={{ margin: '10px 0' }}>
                    <p><small>จำนวน Hard Request ที่อนุมัติแล้วในวันที่ {selectedDate}: {' '}
                        {isLoadingDailyCount ? '...' : `${dailyUsage} / ${MAX_DAILY_HARD_REQUESTS}`}
                    </small></p>
                </div>
            )}

            <button
                type="button"
                onClick={handleRequestSubmit}
                className="primary-button" style={{ marginTop: '15px', width: '100%' }}
                disabled={
                    !selectedNurseId || !selectedDate || isSubmitting || isLoading || isCancelling || !canSubmitDaily || disableActionsForGov || isEditingQuotaMonth
                }
                title={
                    disableActionsForGov ? "ข้าราชการไม่ต้องใช้ระบบนี้" :
                    isEditingQuotaMonth ? "กรุณาบันทึกหรือยกเลิกการแก้ไขรอบโควต้าก่อน" :
                    !canSubmitDaily ? `โควต้ารายวัน (${MAX_DAILY_HARD_REQUESTS}) เต็มแล้ว` :
                    (isLoadingCycleUsage && !isSelectedNurseGovOfficial) ? "กำลังโหลดโควต้า..." :
                    (!isSelectedNurseGovOfficial && currentCycleInfo && currentCycleInfo.used >= currentCycleInfo.total) ? "โควต้ารอบปีเต็มแล้ว" :
                    ''
                }>
                {isSubmitting ? 'กำลังส่งคำขอ...' : 'ส่งคำขอ Hard Request'}
            </button>

            <div style={{ marginTop: '25px', borderTop: '1px solid #ccc', paddingTop: '15px' }}>
                <h4>Hard Requests ที่อนุมัติแล้ว (สำหรับพยาบาลที่เลือก)</h4>
                {isLoadingApprovedList ? <p>กำลังโหลด...</p> : (
                    approvedRequests.length === 0 ? <p style={{ fontStyle: 'italic' }}>(ไม่มี)</p> : (
                        <ul style={{ listStyle: 'none', paddingLeft: 0, maxHeight: '200px', overflowY: 'auto' }}>
                            {approvedRequests.map(req => (
                                <li key={req.id} style={{ marginBottom: '5px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderBottom: '1px dotted #eee' }}>
                                    <span>{req.date}</span>
                                    <button
                                        onClick={() => handleCancelRequest(req.id, req.date)}
                                        className="danger-button-small"
                                        disabled={isCancelling || isSubmitting || disableActionsForGov || isEditingQuotaMonth}
                                        style={{ padding: '2px 6px', fontSize: '11px', marginLeft: '10px' }}
                                        title={disableActionsForGov ? "ไม่สามารถยกเลิกของข้าราชการได้" : isEditingQuotaMonth ? "กำลังแก้ไขรอบโควต้า": "ยกเลิกคำขอ"}
                                    >
                                        ยกเลิก
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )
                )}
            </div>
        </div>
    );
};

export default HardRequestManager;