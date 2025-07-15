import React, { useState, useEffect, useCallback } from 'react';
import {
    collection, getDocs, addDoc, doc, updateDoc, deleteDoc, writeBatch,
    query, orderBy, Timestamp, getDoc, where, limit, serverTimestamp
} from 'firebase/firestore';
import { db } from './firebase';
import axios from 'axios';
import './App.css';
import NurseForm from './components/NurseForm';
import MonthlyRequestManager from './components/MonthlyRequestManager';
import ScheduleGenerator from './components/ScheduleGenerator';
import ScheduleDisplay from './components/ScheduleDisplay';
import ErrorPopup from './components/ErrorPopup';
import HistoryList from './components/HistoryList';
import HardRequestManager from './components/HardRequestManager';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getDisplayDateInfo, getThaiMonth, formatDateToLocalYYYYMMDD } from './utils/dateUtils';
import { constraintRuleTypes } from './utils/constraintUtils';


const SHIFT_CODE_TO_THAI_LABEL_SUMMARY = {
    1: 'เวรเช้า',
    2: 'เวรบ่าย',
    3: 'เวรดึก',
    4: 'เวรดึกควบบ่าย'
};

const NEW_REQUEST_TYPE_SPECIFIC_SHIFTS_KEY = 'request_specific_shifts_on_days';


function SortableNurseItem({ id, nurse, handleEditNurse, deleteNurse, isEditing, editingNurse }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
    const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.8 : 1, cursor: 'move' };
    return (
        <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="nurse-item">
            <span>{nurse.isGovernmentOfficial && <span title="ข้าราชการ (หยุด ส-อา และ นักขัตฤกษ์, ทำงานเฉพาะเวรเช้า)" style={{ marginRight: '5px', color: 'blue', fontWeight:'bold' }}>✪</span>}
                {`${nurse.prefix ?? ''} ${nurse.firstName ?? ''} ${nurse.lastName ?? ''}`.trim()}
            </span>
            <div className="nurse-actions">
                <button onPointerDown={(e) => e.stopPropagation()} onClick={() => handleEditNurse(nurse)} disabled={isEditing && editingNurse?.id === nurse.id}>แก้ไข</button>
                <button onPointerDown={(e) => e.stopPropagation()} onClick={() => deleteNurse(nurse.id)} className='danger-button'>ลบ</button>
            </div>
        </div>
    );
}


function App() {
    const [nurses, setNurses] = useState([]);
    const [activeSection, setActiveSection] = useState('nurses');
    const [generatedSchedule, setGeneratedSchedule] = useState(null);
    const [loading, setLoading] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [errorPopupMessage, setErrorPopupMessage] = useState(null);
    const [editingNurse, setEditingNurse] = useState(null);
    const [isEditing, setIsEditing] = useState(false);
    const [lastUsedTimeLimit, setLastUsedTimeLimit] = useState(60);
    const [showHistoryList, setShowHistoryList] = useState(false);
    const [viewingHistoryScheduleId, setViewingHistoryScheduleId] = useState(null);
    const [historyList, setHistoryList] = useState([]);
    const [selectedHistoryScheduleData, setSelectedHistoryScheduleData] = useState(null);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [currentMonthHistoryExists, setCurrentMonthHistoryExists] = useState(false);
    const [selectedMonth, setSelectedMonth] = useState('');
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
    const [showSummary, setShowSummary] = useState(false);
    const [summaryData, setSummaryData] = useState(null);
    const [isLoadingMonthlyRequests, setIsLoadingMonthlyRequests] = useState(false);
    const [nextCarryOverFlags, setNextCarryOverFlags] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [saveError, setSaveError] = useState(null);
    const [isDragging, setIsDragging] = useState(false);


    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const fetchNurses = useCallback(async () => {
        setLoading(true);
        setErrorPopupMessage(null);
        try {
            const q = query(collection(db, 'nurses'), orderBy("order", "asc"));
            const querySnapshot = await getDocs(q);
            let needsUpdate = false;
            const list = querySnapshot.docs.map((d, index) => {
                const data = d.data();
                const constraints = Array.isArray(data.constraints) ? data.constraints : [];
                const carryOverFlag = data.carry_over_priority_flag === true;
                const createdAt = data.createdAt || null;
                const isGovernmentOfficial = data.isGovernmentOfficial === true;
                let quotaResetMonth = data.quotaResetMonth;
                const order = data.order;

                if (order === undefined || order === null) needsUpdate = true;
                if (data.carry_over_priority_flag === undefined) needsUpdate = true;
                if (data.isGovernmentOfficial === undefined) needsUpdate = true;
                if (quotaResetMonth === undefined && createdAt && createdAt.toDate) {
                    needsUpdate = true;
                } else if (quotaResetMonth === undefined) {
                    needsUpdate = true;
                }

                return {
                    id: d.id,
                    ...data,
                    constraints,
                    carry_over_priority_flag: carryOverFlag,
                    createdAt: createdAt,
                    isGovernmentOfficial: isGovernmentOfficial,
                    quotaResetMonth: quotaResetMonth,
                    order: order
                };
            });

            if (needsUpdate || list.some((n, i) => n.order !== i)) {
                console.log("Re-ordering/updating nurse defaults in DB...");
                const batch = writeBatch(db);
                const sortedList = list.sort((a, b) => {
                    const orderA = a.order !== undefined && a.order !== null ? a.order : Infinity;
                    const orderB = b.order !== undefined && b.order !== null ? b.order : Infinity;
                    return orderA - orderB;
                });

                sortedList.forEach((nurse, index) => {
                    const updateData = {};
                    let shouldUpdateThisNurse = false;

                    if (nurse.order === undefined || nurse.order === null || nurse.order !== index) {
                        updateData.order = index;
                        nurse.order = index;
                        shouldUpdateThisNurse = true;
                    }
                    if (nurse.carry_over_priority_flag === undefined) {
                        updateData.carry_over_priority_flag = false;
                        nurse.carry_over_priority_flag = false;
                        shouldUpdateThisNurse = true;
                    }
                    if (nurse.isGovernmentOfficial === undefined) {
                        updateData.isGovernmentOfficial = false;
                        nurse.isGovernmentOfficial = false;
                        shouldUpdateThisNurse = true;
                    }
                    if (nurse.quotaResetMonth === undefined) {
                        if (nurse.createdAt && nurse.createdAt.toDate) {
                            try {
                                updateData.quotaResetMonth = (nurse.createdAt.toDate().getMonth() + 1) % 12;
                                nurse.quotaResetMonth = updateData.quotaResetMonth;
                            } catch (e) {
                                console.warn("Error processing createdAt for default quota month in batch:", e);
                                updateData.quotaResetMonth = 5;
                                nurse.quotaResetMonth = 5;
                            }
                        } else {
                            updateData.quotaResetMonth = 5;
                            nurse.quotaResetMonth = 5;
                        }
                        shouldUpdateThisNurse = true;
                    }

                    if (shouldUpdateThisNurse) {
                        const nurseRef = doc(db, 'nurses', nurse.id);
                        batch.update(nurseRef, updateData);
                    }
                });
                await batch.commit();
                console.log("Nurse defaults update/reorder complete.");
                setNurses(sortedList);
            } else {
                const sortedList = list.sort((a, b) => {
                    const orderA = a.order !== undefined && a.order !== null ? a.order : Infinity;
                    const orderB = b.order !== undefined && b.order !== null ? b.order : Infinity;
                    return orderA - orderB;
                });
                setNurses(sortedList);
            }
            console.log("Fetched nurses:", list.length);
        } catch (e) {
            if (e.code === 'failed-precondition') {
                console.warn("Order index likely missing... attempting fallback fetch without order.");
                try {
                    const querySnapshot = await getDocs(collection(db, 'nurses'));
                    const list = querySnapshot.docs.map(d => {
                        const data = d.data();
                        const constraints = Array.isArray(data.constraints) ? data.constraints : [];
                        const carryOverFlag = data.carry_over_priority_flag === true;
                        const createdAt = data.createdAt || null;
                        const isGovernmentOfficial = data.isGovernmentOfficial === true;
                        let quotaResetMonth = data.quotaResetMonth;
                        if (quotaResetMonth === undefined) {
                            if (createdAt && createdAt.toDate) {
                                quotaResetMonth = (createdAt.toDate().getMonth() + 1) % 12;
                            } else {
                                quotaResetMonth = 5;
                            }
                        }
                        return {
                            id: d.id, ...data, constraints, carry_over_priority_flag: carryOverFlag,
                            createdAt, isGovernmentOfficial, quotaResetMonth, order: data.order
                        };
                    });
                    const sortedByOrder = list.sort((a, b) => {
                        if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
                        if (a.order !== undefined) return -1;
                        if (b.order !== undefined) return 1;
                        return `${a?.firstName ?? ''} ${a?.lastName ?? ''}`.localeCompare(`${b?.firstName ?? ''} ${b?.lastName ?? ''}`, 'th');
                    });
                    setNurses(sortedByOrder);
                    showErrorPopup(`โหลดข้อมูลพยาบาลได้แต่อาจไม่เรียงลำดับ หรือค่าเริ่มต้นบางอย่างอาจหายไป กรุณาตรวจสอบ Index ใน Firestore หรือลองโหลดหน้าใหม่`);
                } catch (fallbackError) {
                    showErrorPopup(`โหลดข้อมูลพยาบาลไม่ได้ และเกิดข้อผิดพลาดในการโหลดสำรอง: ${fallbackError.message || fallbackError}`);
                    setNurses([]);
                }
            } else {
                showErrorPopup(`โหลดข้อมูลพยาบาลไม่ได้: ${e.message || e}`);
                setNurses([]);
            }
        } finally { setLoading(false); }
    }, []);


    useEffect(() => { fetchNurses(); }, [fetchNurses]);

    useEffect(() => {
        if (activeSection === 'nurses' && !viewingHistoryScheduleId && !showHistoryList) {
            fetchNurses();
        }
    }, [activeSection, viewingHistoryScheduleId, showHistoryList, fetchNurses]);

    const showErrorPopup = (message) => { console.error("Error:", message); setErrorPopupMessage(message); };

    const addNurse = async (nurseData) => {
        setErrorPopupMessage(null); try {
            const exists = nurses.some(n => n.firstName === nurseData.firstName && n.lastName === nurseData.lastName);
            if (exists) { alert(`พยาบาล ${nurseData.firstName} ${nurseData.lastName} มีอยู่แล้ว`); return false; }
            const nextOrder = nurses.length > 0 ? Math.max(...nurses.map(n => n.order ?? -1)) + 1 : 0;

            const dataToAdd = {
                ...nurseData,
                constraints: nurseData.constraints || [],
                order: nextOrder,
                carry_over_priority_flag: false,
                createdAt: serverTimestamp(),
                isGovernmentOfficial: nurseData.isGovernmentOfficial === true
            };
            await addDoc(collection(db, 'nurses'), dataToAdd);
            await fetchNurses();
            return true;
        } catch (e) { showErrorPopup(`เพิ่มข้อมูลพยาบาลไม่ได้: ${e.message || e}`); return false; }
    };

    const updateNurse = async (id, dataToUpdate) => {
        setErrorPopupMessage(null); if (!id) { showErrorPopup("ไม่พบ ID"); return false; }
        const nurseRef = doc(db, 'nurses', id); try {
            const dataForUpdate = { ...dataToUpdate };

            if (dataForUpdate.hasOwnProperty('constraints') && !Array.isArray(dataForUpdate.constraints)) {
                dataForUpdate.constraints = [];
            } else if (!dataForUpdate.hasOwnProperty('constraints')) {
                const existing = nurses.find(n => n.id === id);
                if (existing) dataForUpdate.constraints = existing.constraints || [];
                else dataForUpdate.constraints = [];
            }

            const existing = nurses.find(n => n.id === id);
            if (existing) {
                if (existing.order !== undefined && dataForUpdate.order === undefined) { dataForUpdate.order = existing.order; }
                if (existing.carry_over_priority_flag !== undefined && dataForUpdate.carry_over_priority_flag === undefined) { dataForUpdate.carry_over_priority_flag = existing.carry_over_priority_flag; }
                if (existing.isGovernmentOfficial !== undefined && dataForUpdate.isGovernmentOfficial === undefined) { dataForUpdate.isGovernmentOfficial = existing.isGovernmentOfficial; }
                if (existing.createdAt !== undefined && dataForUpdate.createdAt === undefined) { dataForUpdate.createdAt = existing.createdAt; }
                if (existing.quotaResetMonth !== undefined && dataForUpdate.quotaResetMonth === undefined) { dataForUpdate.quotaResetMonth = existing.quotaResetMonth; }
            }
            if (dataToUpdate.hasOwnProperty('quotaResetMonth')) {
                dataForUpdate.quotaResetMonth = dataToUpdate.quotaResetMonth;
            }


            await updateDoc(nurseRef, dataForUpdate);
            await fetchNurses();
            return true;
        } catch (e) { showErrorPopup(`อัปเดตข้อมูลพยาบาลไม่ได้: ${e.message || e}`); console.error(`Error update ${id}:`, e); return false; }
    };


    const deleteNurse = async (id) => {
        setErrorPopupMessage(null); if (!id) { showErrorPopup("ไม่พบ ID"); return; }
        const nurseToDelete = nurses.find(n => n.id === id);
        const confirmMsg = nurseToDelete ? `ยืนยันลบ '${nurseToDelete.firstName} ${nurseToDelete.lastName}'?\n(การดำเนินการนี้จะลบข้อมูลพยาบาลอย่างถาวร แต่จะไม่ลบ Hard Request ที่เคยอนุมัติไปแล้ว)` : 'ยืนยันลบ?';
        if (window.confirm(confirmMsg)) {
            try {
                await deleteDoc(doc(db, 'nurses', id));
                if (editingNurse?.id === id) { handleCancelEdit(); }
                console.log(`Deleted nurse ${id}.`);
                await fetchNurses();
            } catch (e) { showErrorPopup(`ลบข้อมูลพยาบาลไม่ได้: ${e.message || e}`); console.error(`Error delete ${id}:`, e); }
        }
    };

    const handleEditNurse = (nurse) => { setActiveSection('nurses'); setEditingNurse(nurse); setIsEditing(true); setShowHistoryList(false); setViewingHistoryScheduleId(null); window.scrollTo(0, 0); };
    const handleCancelEdit = () => { setEditingNurse(null); setIsEditing(false); };

    const getSpecificMonthHistory = useCallback(async (monthIndex, year) => {
        if (isNaN(monthIndex) || isNaN(year)) return null;
        const monthLabelToCheck = `${getThaiMonth(monthIndex)} ${year + 543}`;
        try { const q = query(collection(db, "scheduleHistory"), where("monthLabel", "==", monthLabelToCheck), limit(1)); const querySnapshot = await getDocs(q); if (!querySnapshot.empty) { const data = querySnapshot.docs[0].data(); return (data && data.scheduleData) ? data : null; } return null;
        } catch (error) { console.error("Error checking history existence:", error); return null; }
    }, []);

    const checkCurrentMonthHistoryExists = useCallback(async (startDateStr) => {
        if (!startDateStr) return false; try { const { monthIndex, year } = getDisplayDateInfo(startDateStr); if (isNaN(monthIndex) || isNaN(year)) return false; const historyData = await getSpecificMonthHistory(monthIndex, year); return historyData !== null;
        } catch (e) { console.error("Error check current month history:", e); return false; }
    }, [getSpecificMonthHistory]);

    const handleShowSummary = async (generalScheduleParams) => {
        if (selectedMonth === '' || selectedYear === '' || isNaN(selectedYear)) { 
            showErrorPopup("กรุณาเลือกเดือนและปีให้ถูกต้องก่อน"); 
            return; 
        }
        setIsLoadingMonthlyRequests(true); 
        setErrorPopupMessage(null); 
        setSummaryData(null);
        const monthYearString = `${selectedYear}-${String(parseInt(selectedMonth) + 1).padStart(2, '0')}`;
        const fetchedMonthlySoftRequests = {};
        try {
            const promises = nurses.map(async (nurse) => {
                if (nurse.isGovernmentOfficial) return;
                const docId = `${nurse.id}_${monthYearString}`;
                const docRef = doc(db, "monthlyNurseRequests", docId);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    if (data.softRequests) { 
                        fetchedMonthlySoftRequests[nurse.id] = data.softRequests; 
                    }
                }
            });
            await Promise.all(promises);

            const currentCarryOverFlags = nurses.reduce((acc, nurse) => {
                acc[nurse.id] = nurse.isGovernmentOfficial ? false : (nurse.carry_over_priority_flag || false);
                return acc;
            }, {});

            // ตรวจสอบให้แน่ใจว่า nurses ถูกเรียงตาม order
            const sortedNurses = [...nurses].sort((a, b) => {
                const orderA = a.order !== undefined && a.order !== null ? a.order : Infinity;
                const orderB = b.order !== undefined && b.order !== null ? b.order : Infinity;
                return orderA - orderB;
            });

            const dataForSummary = {
                selectedMonth,
                selectedYear,
                generalParams: generalScheduleParams,
                nurses: sortedNurses, // ใช้ sortedNurses แทน [...nurses]
                monthlySoftRequests: fetchedMonthlySoftRequests,
                carryOverFlags: currentCarryOverFlags
            };
            setSummaryData(dataForSummary);
            setShowSummary(true);
        } catch (error) { 
            console.error("Error fetching monthly soft requests for summary:", error); 
            showErrorPopup(`เกิดข้อผิดพลาดในการดึงข้อมูลคำขอ Soft Request: ${error.message}`);
        } finally { 
            setIsLoadingMonthlyRequests(false); 
        }
    };

    const generateSchedule = async () => {
        if (!summaryData) { showErrorPopup("ไม่มีข้อมูลสรุปสำหรับสร้างตาราง"); return; }
        setIsGenerating(true); setGeneratedSchedule(null); setSelectedHistoryScheduleData(null); setViewingHistoryScheduleId(null); setCurrentMonthHistoryExists(false); setErrorPopupMessage(null); setShowSummary(false); setNextCarryOverFlags(null);

        const { generalParams, nurses: nursesInSummary, monthlySoftRequests: msrInSummary, carryOverFlags: coFlagsInSummary } = summaryData;
        const startDate = new Date(selectedYear, parseInt(selectedMonth), 1);
        const endDate = new Date(selectedYear, parseInt(selectedMonth) + 1, 0);
        const localStartDateStr = formatDateToLocalYYYYMMDD(startDate);
        const localEndDateStr = formatDateToLocalYYYYMMDD(endDate);

        if (!localStartDateStr || !localEndDateStr) { showErrorPopup("เกิดข้อผิดพลาดในการแปลงข้อมูลวันที่"); setIsGenerating(false); return; }
        setLastUsedTimeLimit(generalParams.solverTimeLimit || 60);

        let previousMonthScheduleData = null;
        try {
            const currentStartDate = new Date(Date.UTC(selectedYear, parseInt(selectedMonth), 1));
            const prevMonthDate = new Date(currentStartDate);
            prevMonthDate.setUTCMonth(currentStartDate.getUTCMonth() - 1);
            const prevMonthIndex = prevMonthDate.getUTCMonth();
            const prevMonthYear = prevMonthDate.getUTCFullYear();
            const prevHistoryDoc = await getSpecificMonthHistory(prevMonthIndex, prevMonthYear);
            if (prevHistoryDoc?.scheduleData) {
                previousMonthScheduleData = prevHistoryDoc.scheduleData;
                console.log("Previous month schedule data found and included.");
            } else {
                console.log("No previous month schedule data found.");
            }
        } catch (histError) { console.error("Error fetching prev history:", histError); }

        const payload = {
            nurses: nursesInSummary.map(n => ({
                id: n.id,
                prefix: n.prefix,
                firstName: n.firstName,
                lastName: n.lastName,
                constraints: n.constraints || [],
                isGovernmentOfficial: n.isGovernmentOfficial === true,
            })),
            schedule: { startDate: localStartDateStr, endDate: localEndDateStr },
            requiredNursesMorning: generalParams.requiredNursesMorning,
            requiredNursesAfternoon: generalParams.requiredNursesAfternoon,
            requiredNursesNight: generalParams.requiredNursesNight,
            maxConsecutiveShiftsWorked: generalParams.maxConsecutiveShiftsWorked,
            targetOffDays: generalParams.targetOffDays,
            solverTimeLimit: generalParams.solverTimeLimit,
            previousMonthSchedule: previousMonthScheduleData,
            monthly_soft_requests: msrInSummary,
            carry_over_flags: coFlagsInSummary,
            holidays: generalParams.holidays || []
        };

        try {
            const backendUrl = process.env.REACT_APP_API_URL || 'http://localhost:5000/generate-schedule';
            console.log("Sending schedule request payload:", JSON.parse(JSON.stringify(payload)));
            const response = await axios.post(backendUrl, payload, { timeout: (payload.solverTimeLimit + 30) * 1000 });

            if (response.status === 200 && response.data?.nurseSchedules) {
                console.log("Schedule received successfully:", response.data.solverStatus);
                setGeneratedSchedule(response.data);
                setNextCarryOverFlags(response.data.nextCarryOverFlags || {});
                setActiveSection('view');
                const exists = await checkCurrentMonthHistoryExists(response.data.startDate);
                setCurrentMonthHistoryExists(exists);
            } else {
                throw new Error(response.data?.error || `API Error ${response.status}`);
            }
        } catch (err) {
            let msg = "เกิดข้อผิดพลาดระหว่างสร้างตารางเวร";
            if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) { msg = `API หมดเวลา (${lastUsedTimeLimit} วินาที) ลองเพิ่มเวลาคำนวณ หรือลดความซับซ้อน หรือตรวจสอบ Backend Log`; }
            else if (err.response) { msg = `สร้างตารางเวรไม่ได้ (${err.response.status}): ${err.response.data?.error || 'ข้อผิดพลาดจาก Backend'}`; }
            else if (err.request) { msg = "สร้างตารางเวรไม่ได้: ไม่สามารถเชื่อมต่อ Backend หรือ Backend ไม่ตอบสนอง"; }
            else { msg = err.message || "มีข้อผิดพลาดบางอย่างเกิดขึ้น"; }
            showErrorPopup(msg);
            console.error("Error generating schedule:", err);
            setGeneratedSchedule(null);
            setActiveSection('generate');
        } finally {
            setIsGenerating(false);
            setSummaryData(null);
        }
    };


    const handleDragEnd = async (event) => {
        const { active, over } = event;
        if (isDragging) return;
        
        if (active && over && active.id !== over.id) {
            setIsDragging(true);
            const oldIndex = nurses.findIndex((n) => n.id === active.id);
            const newIndex = nurses.findIndex((n) => n.id === over.id);
            if (oldIndex === -1 || newIndex === -1) {
                setIsDragging(false);
                return;
            }

            const tempOrderedNurses = arrayMove(nurses, oldIndex, newIndex);
            const finalOrderedNurses = tempOrderedNurses.map((n, i) => ({ ...n, order: i }));

            setNurses(finalOrderedNurses);

            const batch = writeBatch(db);
            finalOrderedNurses.forEach((n) => {
                batch.update(doc(db, 'nurses', n.id), { order: n.order });
            });
            try {
                await batch.commit();
                console.log("Nurse order updated in DB.");
            } catch (error) {
                showErrorPopup(`บันทึกเรียงลำดับไม่ได้: ${error.message}`);
                fetchNurses();
            } finally {
                setIsDragging(false);
            }
        }
    };


    const saveScheduleToHistory = async () => {
        if (!generatedSchedule?.startDate || !nextCarryOverFlags) { 
            showErrorPopup("ไม่มีข้อมูลตารางเวร/Flag สำหรับบันทึก"); 
            return { success: false, error: "ไม่มีข้อมูล" }; 
        }
        setErrorPopupMessage(null); 
        setIsSaving(true); 
        setSaveSuccess(false); 
        setSaveError(null);
        let flagsUpdated = false, historySaved = false;
        try {
            console.log("Attempting to update carry-over flags...");
            const flagBatch = writeBatch(db); 
            let flagUpdateCount = 0;
            for (const nurseId in nextCarryOverFlags) {
                const nurse = nurses.find(n => n.id === nurseId);
                if (nurse && !nurse.isGovernmentOfficial && typeof nextCarryOverFlags[nurseId] === 'boolean') {
                    flagBatch.update(doc(db, 'nurses', nurseId), { carry_over_priority_flag: nextCarryOverFlags[nurseId] });
                    flagUpdateCount++;
                }
            }
            if (flagUpdateCount > 0) { 
                await flagBatch.commit(); 
                console.log(`Updated flags for ${flagUpdateCount} non-gov nurses.`); 
                flagsUpdated = true; 
            }
            else { 
                console.log("No non-gov flags needed updating."); 
                flagsUpdated = true; 
            }

            console.log("Attempting to save schedule to history...");
            const startDateStr = generatedSchedule.startDate; 
            const { monthIndex, year } = getDisplayDateInfo(startDateStr);
            if (isNaN(monthIndex) || isNaN(year)) throw new Error("Invalid start date for history save");
            const monthLabel = `${getThaiMonth(monthIndex)} ${year + 543}`;
            const exists = await checkCurrentMonthHistoryExists(startDateStr);
            if (exists) { 
                throw new Error(`มีตาราง ${monthLabel} บันทึกไว้แล้ว`); 
            }

            const [sYear, sMonth, sDay] = startDateStr.split('-').map(Number);
            const startDateObj = new Date(Date.UTC(sYear, sMonth - 1, sDay));
            if (isNaN(startDateObj.getTime())) throw new Error("Invalid date object for history timestamp");

            // ตรวจสอบให้แน่ใจว่า nurses เรียงตาม order ก่อนบันทึก
            const sortedNurses = [...nurses].sort((a, b) => {
                const orderA = a.order !== undefined && a.order !== null ? a.order : Infinity;
                const orderB = b.order !== undefined && b.order !== null ? b.order : Infinity;
                return orderA - orderB;
            });
            const orderedNurseIds = sortedNurses.map(n => n.id);

            const historyData = {
                startDate: Timestamp.fromDate(startDateObj),
                createdAt: serverTimestamp(),
                monthLabel: monthLabel,
                nurseDisplayOrder: orderedNurseIds, // ใช้ลำดับที่เรียงแล้ว
                scheduleData: generatedSchedule
            };
            const docRef = await addDoc(collection(db, "scheduleHistory"), historyData);
            console.log("Saved to history:", docRef.id); 
            historySaved = true; 
            setCurrentMonthHistoryExists(true);

            alert(`บันทึกตาราง ${monthLabel} และอัปเดต Flag เรียบร้อย`); 
            setSaveSuccess(true); 
            setTimeout(() => setSaveSuccess(false), 4000);
            console.log("Refetching nurse data after saving flags...");
            await fetchNurses();
            return { success: true };

        } catch (error) {
            console.error("Error during save process:", error); 
            let errorMsg = `บันทึกไม่ได้: ${error.message}`;
            if (!flagsUpdated) { 
                errorMsg = `อัปเดต Flag ไม่สำเร็จ: ${error.message}. ไม่ได้บันทึกตารางเวร.`; 
            }
            else if (!historySaved) { 
                errorMsg = `อัปเดต Flag สำเร็จ แต่บันทึกตารางเวรไม่สำเร็จ: ${error.message}`; 
            }
            showErrorPopup(errorMsg); 
            setSaveError(errorMsg); 
            setTimeout(() => setSaveError(null), 6000);
            if (flagsUpdated && !historySaved) {
                console.log("History save failed, but flags might have updated. Refetching nurses.");
                await fetchNurses();
            }
            return { success: false, error: errorMsg };
        } finally { 
            setIsSaving(false); 
        }
    };


    const fetchScheduleHistory = async () => {
        setHistoryLoading(true); setShowHistoryList(true); setViewingHistoryScheduleId(null); setSelectedHistoryScheduleData(null); setErrorPopupMessage(null);
        try { const q = query(collection(db, "scheduleHistory"), orderBy("startDate", "desc")); const querySnapshot = await getDocs(q); const list = querySnapshot.docs.map(d => { const data = d.data(); const sd = data.startDate?.toDate()?.toISOString()?.split('T')[0] || 'N/A'; return { id: d.id, startDate: sd, monthLabel: data.monthLabel || 'N/A', createdAt: data.createdAt }; }); setHistoryList(list);
        } catch (error) { console.error("Error fetch history list:", error); showErrorPopup(`โหลดประวัติไม่ได้: ${error.message}`); setHistoryList([]); }
        finally { setHistoryLoading(false); }
    };

    const fetchSpecificHistorySchedule = async (historyId) => {
        if (!historyId) return; setHistoryLoading(true); setSelectedHistoryScheduleData(null); setViewingHistoryScheduleId(historyId); setShowHistoryList(false); setErrorPopupMessage(null);
        try {
            const docRef = doc(db, "scheduleHistory", historyId);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                const data = docSnap.data();
                if (data.scheduleData?.nurseSchedules && data.scheduleData?.shiftsCount) {
                    setSelectedHistoryScheduleData(data);
                } else {
                    throw new Error("ข้อมูลประวัติไม่สมบูรณ์");
                }
            } else {
                throw new Error("ไม่พบข้อมูล");
            }
        } catch (error) { console.error("Error fetch specific history:", error); showErrorPopup(`โหลดข้อมูล ID ${historyId} ไม่ได้: ${error.message}`); setViewingHistoryScheduleId(null); }
        finally { setHistoryLoading(false); }
    };


    const deleteHistorySchedule = async (historyId, historyMonthLabel) => {
        if (!historyId) return; if (window.confirm(`ยืนยันลบประวัติ ${historyMonthLabel}?`)) {
            setErrorPopupMessage(null); try { await deleteDoc(doc(db, "scheduleHistory", historyId)); console.log("Deleted history:", historyId); setHistoryList(prev => prev.filter(item => item.id !== historyId)); if (viewingHistoryScheduleId === historyId) { setViewingHistoryScheduleId(null); setSelectedHistoryScheduleData(null); setShowHistoryList(true); } if (generatedSchedule?.startDate) { try { const { monthIndex, year } = getDisplayDateInfo(generatedSchedule.startDate); if (!isNaN(monthIndex) && !isNaN(year)) { const currentLabel = `${getThaiMonth(monthIndex)} ${year + 543}`; if (currentLabel === historyMonthLabel) { setCurrentMonthHistoryExists(false); } } } catch (e) { console.error("Err check date post delete:", e); } }
            } catch (error) { console.error("Error deleting history:", error); showErrorPopup(`ลบประวัติไม่ได้: ${error.message}`); }
        }
    };

    let mainContent = null;

    if (showSummary && summaryData) {
        const holidaysList = summaryData.generalParams?.holidays || [];
        mainContent = (
            <div className="summary-container card">
                <h3><span role="img" aria-label="summary">📋</span> สรุปข้อมูลก่อนสร้างตารางเวร</h3>
                <p><strong>เดือน/ปี:</strong> {getThaiMonth(summaryData.selectedMonth)} {summaryData.selectedYear + 543}</p>
                <p><strong>จำนวนพยาบาล:</strong> {summaryData.nurses.length} คน</p>
                <div style={{ maxHeight: '350px', overflowY: 'auto', border: '1px solid #ccc', padding: '10px', marginBottom: '15px', backgroundColor: '#f9f9f9' }}>
                    <h4>ข้อจำกัด Soft Request รายเดือน (สำหรับพยาบาลปกติ):</h4>
                    {summaryData.nurses.map(nurse => {
                        if (nurse.isGovernmentOfficial) return null;

                        const monthlySoft = summaryData.monthlySoftRequests[nurse.id] || [];
                        return (
                            <div key={nurse.id} style={{ marginBottom: '10px', paddingBottom: '5px', borderBottom: '1px dotted #eee' }}>
                                <strong>{`${nurse.prefix ?? ''} ${nurse.firstName ?? ''} ${nurse.lastName ?? ''}`.trim()}</strong>
                                {summaryData.carryOverFlags[nurse.id] && <span style={{ color: 'orange', marginLeft: '5px' }} title="Carry-over Priority Active (for this generation)">⭐</span>}
                                <ul style={{margin: '5px 0 0 20px', padding: 0, listStylePosition: 'inside'}}>
                                    {monthlySoft.map((sr, idx) => {
                                        let valueDisplay = '';
                                        if (sr.type === 'no_specific_days' && Array.isArray(sr.value)) {
                                            valueDisplay = `(วันที่ ${sr.value.join(', ')})`;
                                        } else if (sr.type === NEW_REQUEST_TYPE_SPECIFIC_SHIFTS_KEY && Array.isArray(sr.value)) {
                                            const parts = sr.value.map(item =>
                                                `(วันที่ ${item.day}: ${SHIFT_CODE_TO_THAI_LABEL_SUMMARY[item.shift_type] || 'ไม่ระบุเวร'})`
                                            ).join(', ');
                                            valueDisplay = parts ? ` ${parts}` : '';
                                        }
                                        return (
                                            <li key={idx} style={{color: sr.is_high_priority ? 'blue' : 'inherit'}}>
                                                <span style={{fontWeight: 'bold'}}>[Soft{sr.is_high_priority ? '/HP' : ''}]</span>
                                                {' '}{constraintRuleTypes.find(crt => crt.value === sr.type)?.label || sr.type}
                                                {valueDisplay}
                                            </li>
                                        );
                                    })}
                                    {monthlySoft.length === 0 && <li style={{fontStyle:'italic'}}>(ไม่มี Soft Request สำหรับเดือนนี้)</li>}
                                </ul>
                            </div>
                        );
                    })}
                </div>
                {summaryData.generalParams && (
                    <>
                        <p><strong>ตั้งค่าทั่วไป:</strong> เช้า={summaryData.generalParams.requiredNursesMorning}, บ่าย={summaryData.generalParams.requiredNursesAfternoon}, ดึก={summaryData.generalParams.requiredNursesNight}, วันหยุดขั้นต่ำ(ปกติ)={summaryData.generalParams.targetOffDays}, เวรติดกันสูงสุด(ปกติ)={summaryData.generalParams.maxConsecutiveShiftsWorked}, เวลาคำนวณ={summaryData.generalParams.solverTimeLimit}วิ</p>
                        <p><strong>วันหยุดนักขัตฤกษ์ (ข้าราชการบังคับหยุด):</strong> {holidaysList.length > 0 ? holidaysList.join(', ') : 'ไม่มี'}</p>
                    </>
                )}
                <p style={{color: 'red', marginTop: '10px', fontWeight: 'bold'}}>หมายเหตุ: Hard Request ที่อนุมัติแล้ว (สำหรับพยาบาลปกติ) และวันหยุด ส-อา/นักขัตฤกษ์ ของข้าราชการ จะถูกบังคับใช้โดยอัตโนมัติ</p>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', marginTop: '20px' }}>
                    <button className="primary-button generate-button" onClick={generateSchedule} disabled={isGenerating}>ยืนยันและสร้างตารางเวร</button>
                    <button className="cancel-button" onClick={() => { setShowSummary(false); setSummaryData(null); }} disabled={isGenerating}>ยกเลิก / กลับไปแก้ไข</button>
                </div>
            </div>
        );
    } else if (isLoadingMonthlyRequests) {
        mainContent = <div className="loading">กำลังโหลดข้อมูลคำขอรายเดือน...</div>;
    }
    else if (viewingHistoryScheduleId && !historyLoading) {
        mainContent = selectedHistoryScheduleData ? (
            <>
                <button onClick={() => { setViewingHistoryScheduleId(null); setSelectedHistoryScheduleData(null); fetchScheduleHistory(); }} style={{ marginBottom: '15px' }}> &larr; กลับ </button>
                <ScheduleDisplay
                    schedule={{
                        ...selectedHistoryScheduleData.scheduleData,
                        nurseDisplayOrder: selectedHistoryScheduleData.nurseDisplayOrder // ส่ง nurseDisplayOrder ไปด้วย
                    }}
                    nurses={
                        (selectedHistoryScheduleData.nurseDisplayOrder || Object.keys(selectedHistoryScheduleData.scheduleData.nurseSchedules))
                        .map(id => {
                            const nurseInSchedule = selectedHistoryScheduleData.scheduleData?.nurseSchedules?.[id]?.nurse;
                            const currentNurseDetails = nurses.find(n => n.id === id);
                        
                            if (nurseInSchedule) {
                                return {
                                    id: nurseInSchedule.id,
                                    prefix: nurseInSchedule.prefix,
                                    firstName: nurseInSchedule.firstName,
                                    lastName: nurseInSchedule.lastName,
                                    isGovernmentOfficial: nurseInSchedule.isGovernmentOfficial,
                                    ...(currentNurseDetails && {
                                        constraints: currentNurseDetails.constraints,
                                        quotaResetMonth: currentNurseDetails.quotaResetMonth,
                                        order: currentNurseDetails.order // เพิ่ม order ด้วย
                                    })
                                };
                            } else if (currentNurseDetails) {
                                return currentNurseDetails;
                            }
                            return { id: id, firstName: "ไม่พบข้อมูล", lastName: "" };
                        })
                        .filter(Boolean)
                    }
                    isHistoryView={true}
                    isSaveDisabled={true}
                />
            </> 
        ) : ( 
            <div className="loading">กำลังโหลด...</div> );
    } else if (showHistoryList) {
        mainContent = (
            <div className="nurse-management-container">
                <button onClick={() => setShowHistoryList(false)} style={{marginBottom: '10px'}}> <span role="img" aria-label="hide">🔼</span> ซ่อนประวัติ </button>
                <HistoryList historyList={historyList} onViewHistory={fetchSpecificHistorySchedule} onDeleteHistory={deleteHistorySchedule} isLoading={historyLoading} />
            </div> );
    } else if (activeSection === 'nurses') {
        mainContent = (
            <div className="nurse-management-container">
                <div className="nurse-management">
                    <NurseForm addNurse={addNurse} updateNurse={updateNurse} nurseToEdit={editingNurse} isEditing={isEditing} onCancelEdit={handleCancelEdit}/>
                    <div className="nurse-list card">
                        <h2>รายชื่อ <span className="badge">{nurses.length}</span></h2>
                        {loading && nurses.length === 0 ? (<div className="loading">กำลังโหลด...</div>) :
                        nurses.length === 0 && !loading ? (<div className="empty-state">ไม่มีข้อมูล</div>) : (
                            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                                <SortableContext items={nurses.map(n => n.id)} strategy={verticalListSortingStrategy}>
                                    {nurses.map(n => <SortableNurseItem key={n.id} id={n.id} nurse={n} handleEditNurse={handleEditNurse} deleteNurse={deleteNurse} isEditing={isEditing} editingNurse={editingNurse}/>)}
                                </SortableContext>
                            </DndContext>
                        )}
                    </div>
                </div>
                <div style={{ marginTop: '20px', borderTop: '1px solid var(--gray-300)', paddingTop: '20px' }}>
                    <button onClick={fetchScheduleHistory} disabled={historyLoading}> <span role="img" aria-label="history">📚</span> แสดงประวัติ </button>
                </div>
            </div> );
    } else if (activeSection === 'hardRequests') {
        mainContent = (
            <HardRequestManager
                nurses={nurses}
                db={db}
                showErrorPopup={showErrorPopup}
                onUpdateNurseInApp={updateNurse}
            />
        );
    } else if (activeSection === 'generate') {
        mainContent = (
            <>
                {!isGenerating && (
                    <>
                        <div className="card" style={{ marginBottom: '20px' }}>
                            <h3><span role="img" aria-label="time">⏱️</span> 1. เลือกช่วงเวลา</h3>
                            <div className="month-selector">
                                <div className="form-group">
                                    <label htmlFor="monthSelectApp">เลือกเดือน / กรอกปี พ.ศ.</label>
                                    <div style={{ display: 'flex', gap: '10px' }}>
                                        <select id="monthSelectApp" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} required className="form-select">
                                            <option value="" disabled>-- เดือน --</option>
                                            {['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'].map((m, i) => (<option key={i} value={String(i)}>{m}</option>))}
                                        </select>
                                        <input type="number" aria-label="Input Year (BE)" value={selectedYear === '' ? '' : selectedYear + 543}
                                            onChange={(e) => { const be = e.target.value; setSelectedYear(be === '' ? '' : !isNaN(parseInt(be)) && parseInt(be) > 0 ? parseInt(be) - 543 : ''); }}
                                            placeholder="ปี พ.ศ." min="1" step="1" required className="form-input" style={{ minWidth: '100px' }}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                        {(selectedMonth !== '' && selectedYear !== '' && !isNaN(selectedYear)) && (
                            <>
                                <MonthlyRequestManager nurses={nurses} selectedMonth={selectedMonth} selectedYear={selectedYear} db={db} showErrorPopup={showErrorPopup} />
                                <ScheduleGenerator onPrepareSummary={handleShowSummary} selectedMonth={selectedMonth} selectedYear={selectedYear} />
                            </>
                        )}
                    </>
                )}
            </>
        );
    } else if (activeSection === 'view') {
        mainContent = !isGenerating && generatedSchedule ? (
            <ScheduleDisplay
                schedule={generatedSchedule}
                nurses={nurses}
                onSaveSchedule={saveScheduleToHistory}
                isHistoryView={false}
                isSaveDisabled={currentMonthHistoryExists || isSaving || saveSuccess}
                nextCarryOverFlags={nextCarryOverFlags}
            />
        ) : ( !isGenerating && (
            <div className="card empty-state"> <p>ยังไม่มีตารางเวร</p> <button onClick={() => setActiveSection('generate')} disabled={nurses.length === 0}>ไปหน้าสร้างตาราง</button> </div> )
        );
    }


    return (
        <div className="App">
            <ErrorPopup message={errorPopupMessage} onClose={() => setErrorPopupMessage(null)} />
            <header className="App-header">
                <h1><span role="img" aria-label="nurse">👩‍⚕️</span><span role="img" aria-label="calendar">🗓️</span>ระบบจัดการตารางเวรพยาบาล</h1>
                <div className="tabs">
                    <button className={(activeSection === 'nurses' && !viewingHistoryScheduleId && !showHistoryList) ? 'active' : ''} onClick={() => { setActiveSection('nurses'); handleCancelEdit(); setShowHistoryList(false); setViewingHistoryScheduleId(null); }} disabled={isGenerating || isLoadingMonthlyRequests}>
                        <span role="img" aria-label="manage">👥</span> จัดการข้อมูล
                    </button>
                    <button className={activeSection === 'hardRequests' ? 'active' : ''} onClick={() => { setActiveSection('hardRequests'); setViewingHistoryScheduleId(null); setShowHistoryList(false); setShowSummary(false); setSummaryData(null); handleCancelEdit(); }} disabled={nurses.length === 0 || isGenerating || isLoadingMonthlyRequests}>
                        <span role="img" aria-label="stop">🛑</span> จัดการวันหยุดรายปี
                    </button>
                    <button className={activeSection === 'generate' ? 'active' : ''} onClick={() => { setActiveSection('generate'); setViewingHistoryScheduleId(null); setShowHistoryList(false); setShowSummary(false); setSummaryData(null); handleCancelEdit(); }} disabled={nurses.length === 0 || isGenerating || isLoadingMonthlyRequests}>
                        <span role="img" aria-label="settings">⚙️</span> สร้างตารางเวร
                    </button>
                    <button className={activeSection === 'view' ? 'active' : ''} onClick={() => { setActiveSection('view'); setViewingHistoryScheduleId(null); setShowHistoryList(false); handleCancelEdit(); }} disabled={!generatedSchedule || isGenerating || isLoadingMonthlyRequests}>
                        <span role="img" aria-label="view">👁️</span> ดูตารางเวรปัจจุบัน
                    </button>
                </div>
            </header>
            <main>
                {loading && !historyLoading && !isLoadingMonthlyRequests && <div className="loading">กำลังโหลดข้อมูลพยาบาล...</div>}
                {isGenerating && <div className="loading generating">กำลังสร้างตารางเวร โปรดรอ... ({lastUsedTimeLimit} วินาที)</div>}
                {historyLoading && <div className="loading">กำลังโหลดข้อมูลประวัติ...</div>}
                {(!isGenerating || activeSection !== 'generate') && mainContent}
            </main>
        </div>
    );
}

export default App;