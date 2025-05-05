// App.js
import React, { useState, useEffect, useCallback } from 'react';
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc, writeBatch, query, orderBy, Timestamp, getDoc, where, limit } from 'firebase/firestore';
import { db } from './firebase';
import axios from 'axios';
import './App.css';
import NurseForm from './components/NurseForm';
import ScheduleGenerator from './components/ScheduleGenerator';
import ScheduleDisplay from './components/ScheduleDisplay';
import ErrorPopup from './components/ErrorPopup';
import HistoryList from './components/HistoryList';
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

function SortableNurseItem({ id, nurse, handleEditNurse, deleteNurse, isEditing, editingNurse }) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.8 : 1,
        cursor: 'move',
    };

    return (
        <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="nurse-item">
            <span>{`${nurse.prefix ?? ''} ${nurse.firstName ?? ''} ${nurse.lastName ?? ''}`.trim()}</span>
            <div className="nurse-actions">
                <button onPointerDown={(e) => e.stopPropagation()} onClick={() => handleEditNurse(nurse)} disabled={isEditing && editingNurse?.id === nurse.id}>แก้ไข</button>
                <button onPointerDown={(e) => e.stopPropagation()} onClick={() => deleteNurse(nurse.id)} className='danger-button'>ลบ</button>
            </div>
        </div>
    );
}

function App() {
    const [nurses, setNurses] = useState([]);
    const [selectedTab, setSelectedTab] = useState('nurses');
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

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const fetchNurses = useCallback(async () => {
        setLoading(true);
        setErrorPopupMessage(null);
        try {
            const q = query(collection(db, 'nurses'), orderBy("order", "asc"));
            const querySnapshot = await getDocs(q);
            let needsUpdate = false;
            let maxOrder = -1;
            const list = querySnapshot.docs.map((d, index) => {
                const data = d.data();
                const constraints = Array.isArray(data.constraints) ? data.constraints : [];
                if (data.order === undefined || data.order === null) {
                    needsUpdate = true;
                    data.order = index;
                }
                maxOrder = Math.max(maxOrder, data.order);
                return { id: d.id, ...data, constraints };
            });

            if (needsUpdate || list.some((n, i) => n.order !== i)) {
                console.log("Order mismatch or missing, re-ordering in DB...");
                const batch = writeBatch(db);
                const sortedList = list.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
                sortedList.forEach((nurse, index) => {
                    nurse.order = index;
                    const nurseRef = doc(db, 'nurses', nurse.id);
                    batch.update(nurseRef, { order: index });
                });
                await batch.commit();
                setNurses(sortedList);
                console.log("Re-ordering complete.");
            } else {
                setNurses(list);
            }
            console.log("Fetched nurses:", list.length);
        } catch (e) {
             if (e.code === 'failed-precondition') {
                 console.warn("Order index likely missing, fetching without ordering and will attempt re-order.");
                  try {
                     const querySnapshot = await getDocs(collection(db, 'nurses'));
                     const list = querySnapshot.docs.map(d => ({ id: d.id, ...d.data(), constraints: Array.isArray(d.data().constraints) ? d.data().constraints : [] }));
                     const sortedByName = list.sort((a, b) => `${a?.firstName ?? ''} ${a?.lastName ?? ''}`.localeCompare(`${b?.firstName ?? ''} ${b?.lastName ?? ''}`, 'th'))
                     const batch = writeBatch(db);
                     let orderUpdated = false;
                     sortedByName.forEach((nurse, index) => {
                         if (nurse.order === undefined || nurse.order === null) {
                             nurse.order = index;
                             const nurseRef = doc(db, 'nurses', nurse.id);
                             batch.update(nurseRef, { order: index });
                             orderUpdated = true;
                         }
                     });
                     if (orderUpdated) {
                          console.log("Applying initial order based on name sort.");
                          await batch.commit();
                     }
                     setNurses(sortedByName.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity)));
                      showErrorPopup(`โหลดข้อมูลพยาบาลได้ แต่จำเป็นต้องสร้าง index สำหรับ 'order' กรุณาลองโหลดหน้าใหม่อีกครั้งเพื่อการเรียงลำดับที่ถูกต้อง`);

                 } catch (fallbackError) {
                     showErrorPopup(`โหลดข้อมูลพยาบาลไม่ได้ และเกิดข้อผิดพลาดในการสร้าง order เริ่มต้น: ${fallbackError.message || fallbackError}`);
                      setNurses([]);
                 }
              } else {
                 showErrorPopup(`โหลดข้อมูลพยาบาลไม่ได้: ${e.message || e}`);
                 setNurses([]);
              }
          } finally {
             setLoading(false);
          }
    }, []);


    useEffect(() => {
        fetchNurses();
    }, [fetchNurses]);

    const showErrorPopup = (message) => {
        console.error("Error Displayed:", message);
        setErrorPopupMessage(message);
    };

    const addNurse = async (nurseData) => {
        setErrorPopupMessage(null);
        try {
            const exists = nurses.some(n =>
                n.firstName === nurseData.firstName && n.lastName === nurseData.lastName
            );
            if (exists) {
                alert(`พยาบาล ${nurseData.firstName} ${nurseData.lastName} มีอยู่ในระบบแล้ว`);
                return false;
            }
            const nextOrder = nurses.length > 0 ? Math.max(...nurses.map(n => n.order ?? -1)) + 1 : 0;
            const dataToAdd = {
                ...nurseData,
                constraints: nurseData.constraints || [],
                order: nextOrder
            };
            await addDoc(collection(db, 'nurses'), dataToAdd);
            fetchNurses();
            return true;
        } catch (e) {
            showErrorPopup(`เพิ่มข้อมูลพยาบาลไม่ได้: ${e.message || e}`);
            return false;
        }
    };

    const updateNurse = async (id, dataToUpdate) => {
        setErrorPopupMessage(null);
        if (!id) {
            showErrorPopup("เกิดข้อผิดพลาด: ไม่พบ ID ของพยาบาลที่จะอัปเดต");
            return false;
        }
        const nurseRef = doc(db, 'nurses', id);
        try {
            const dataForUpdate = {
                ...dataToUpdate,
                constraints: Array.isArray(dataToUpdate.constraints) ? dataToUpdate.constraints : []
            };

            const existingNurse = nurses.find(n => n.id === id);
            const currentOrder = existingNurse?.order;
            if (currentOrder !== undefined && dataForUpdate.order === undefined) {
                dataForUpdate.order = currentOrder;
            }

            console.log(`[updateNurse] Updating nurse ${id} in Firestore with data:`, JSON.stringify(dataForUpdate));
            await updateDoc(nurseRef, dataForUpdate);
            console.log(`[updateNurse] Firestore update successful for nurse ${id}.`);

            setNurses(prevNurses =>
                prevNurses.map(n => n.id === id ? { ...n, ...dataForUpdate } : n).sort((a,b) => (a.order ?? Infinity) - (b.order ?? Infinity))
               );

            return true;

        } catch (e) {
            showErrorPopup(`อัปเดตข้อมูลพยาบาลไม่ได้: ${e.message || e}`);
            console.error(`[updateNurse] Error updating nurse ${id} in Firestore:`, e);
            return false;
        }
    };

    const deleteNurse = async (id) => {
        setErrorPopupMessage(null);
        if (!id) {
            showErrorPopup("เกิดข้อผิดพลาด: ไม่พบ ID ของพยาบาลที่จะลบ");
            return;
        }

        const nurseToDelete = nurses.find(n => n.id === id);
        const confirmMessage = nurseToDelete
            ? `ยืนยันการลบข้อมูลพยาบาล '${nurseToDelete.firstName} ${nurseToDelete.lastName}'? การดำเนินการนี้ไม่สามารถย้อนกลับได้`
            : 'ยืนยันการลบข้อมูลพยาบาลท่านนี้? การดำเนินการนี้ไม่สามารถย้อนกลับได้';


        if (window.confirm(confirmMessage)) {
            try {
                const nurseRef = doc(db, 'nurses', id);
                console.log(`[deleteNurse] Deleting nurse ${id} from Firestore.`);
                await deleteDoc(nurseRef);
                console.log(`[deleteNurse] Firestore delete successful for nurse ${id}.`);

                setNurses(prevNurses => prevNurses.filter(nurse => nurse.id !== id));
                if (editingNurse?.id === id) {
                    handleCancelEdit();
                }
                console.log(`[deleteNurse] Local state updated after deleting nurse ${id}.`);

            } catch (e) {
                showErrorPopup(`ลบข้อมูลพยาบาลไม่ได้: ${e.message || e}`);
                console.error(`[deleteNurse] Error deleting nurse ${id} from Firestore:`, e);
            }
        }
    };

    const handleEditNurse = (nurse) => {
        setEditingNurse(nurse);
        setIsEditing(true);
        setSelectedTab('nurses');
        setShowHistoryList(false);
        setViewingHistoryScheduleId(null);
        window.scrollTo(0, 0);
    };

    const handleCancelEdit = () => {
        setEditingNurse(null);
        setIsEditing(false);
    };

    const getSpecificMonthHistory = async (monthIndex, year) => {
        if (isNaN(monthIndex) || isNaN(year)) return null;
        const monthLabelToCheck = `${getThaiMonth(monthIndex)} ${year + 543}`;
        console.log("Checking for schedule history:", monthLabelToCheck);
        try {
            const q = query(
                collection(db, "scheduleHistory"),
                where("monthLabel", "==", monthLabelToCheck),
                limit(1)
            );
            const querySnapshot = await getDocs(q);
            if (!querySnapshot.empty) {
                const docSnap = querySnapshot.docs[0];
                console.log("Found schedule history:", docSnap.id);
                const data = docSnap.data();
                if (data && data.scheduleData) {
                     return data;
                } else {
                     console.warn("Schedule history document found but scheduleData is missing:", docSnap.id);
                     return null;
                }
            }
            console.log("No schedule history found for", monthLabelToCheck);
            return null;
        } catch (error) {
            console.error("Error checking specific schedule history existence:", error);
            return null;
        }
    };

     const checkCurrentMonthHistoryExists = async (startDateStr) => {
        if (!startDateStr) return false;
        try {
            const { monthIndex, year } = getDisplayDateInfo(startDateStr);
             if (isNaN(monthIndex) || isNaN(year)) return false;
             const historyData = await getSpecificMonthHistory(monthIndex, year);
             return historyData !== null;
        } catch (e) {
            console.error("Error in checkCurrentMonthHistoryExists:", e);
            return false;
        }
    };


    const generateSchedule = async (scheduleParams) => {
        setIsGenerating(true);
        setGeneratedSchedule(null);
        setSelectedHistoryScheduleData(null);
        setViewingHistoryScheduleId(null);
        setCurrentMonthHistoryExists(false);
        setErrorPopupMessage(null);

        if (!Array.isArray(nurses) || nurses.length === 0) {
            showErrorPopup("ไม่สามารถสร้างตารางได้: ไม่มีข้อมูลพยาบาลในระบบ");
            setIsGenerating(false);
            return;
        }
        if (!scheduleParams?.startDate || !scheduleParams?.endDate) {
            showErrorPopup("ไม่สามารถสร้างตารางได้: ข้อมูลวันที่เริ่มต้นหรือสิ้นสุดไม่ถูกต้อง");
            setIsGenerating(false);
            return;
        }
        if (typeof scheduleParams?.targetOffDays !== 'number' || scheduleParams.targetOffDays < 0) {
            showErrorPopup("ไม่สามารถสร้างตารางได้: ข้อมูลวันหยุดขั้นต่ำไม่ถูกต้อง หรือไม่ได้ระบุ");
           setIsGenerating(false);
           return;
        }

        setLastUsedTimeLimit(scheduleParams.solverTimeLimit || 60);
        const localStartDateStr = formatDateToLocalYYYYMMDD(scheduleParams.startDate);
        const localEndDateStr = formatDateToLocalYYYYMMDD(scheduleParams.endDate);

        if (!localStartDateStr || !localEndDateStr) {
            showErrorPopup("เกิดข้อผิดพลาดในการแปลงข้อมูลวันที่ กรุณาลองใหม่อีกครั้ง");
            setIsGenerating(false);
            return;
        }

        let previousMonthScheduleData = null;
        try {
             const currentStartDate = new Date(Date.UTC(
                 scheduleParams.startDate.getFullYear(),
                 scheduleParams.startDate.getMonth(),
                 scheduleParams.startDate.getDate()
             ));
             const prevMonthDate = new Date(currentStartDate);
             prevMonthDate.setUTCMonth(currentStartDate.getUTCMonth() - 1);
             const prevMonthIndex = prevMonthDate.getUTCMonth();
             const prevMonthYear = prevMonthDate.getUTCFullYear();

            console.log(`Attempting to fetch history for previous month: ${prevMonthIndex + 1}/${prevMonthYear}`);
            const prevHistoryDoc = await getSpecificMonthHistory(prevMonthIndex, prevMonthYear);
            if (prevHistoryDoc && prevHistoryDoc.scheduleData) {
                 previousMonthScheduleData = prevHistoryDoc.scheduleData;
                console.log("Previous month history found and will be included in the request.");
             } else {
                console.log("No usable previous month history found.");
             }
        } catch (histError) {
            console.error("Error fetching previous month history:", histError);
        }


        const payload = {
            nurses: nurses.map(n => ({
                id: n.id,
                prefix: n.prefix,
                firstName: n.firstName,
                lastName: n.lastName,
                constraints: n.constraints || [],
            })),
            schedule: {
                startDate: localStartDateStr,
                endDate: localEndDateStr,
                holidays: scheduleParams.holidays || [],
            },
            requiredNursesMorning: scheduleParams.requiredNursesMorning,
            requiredNursesAfternoon: scheduleParams.requiredNursesAfternoon,
            requiredNursesNight: scheduleParams.requiredNursesNight,
            maxConsecutiveShiftsWorked: scheduleParams.maxConsecutiveShiftsWorked,
            targetOffDays: scheduleParams.targetOffDays,
            solverTimeLimit: scheduleParams.solverTimeLimit,
            previousMonthSchedule: previousMonthScheduleData
        };

        try {
            const backendUrl = process.env.REACT_APP_API_URL || 'http://localhost:5000/generate-schedule';
            console.log("Sending schedule request to:", backendUrl);
            const response = await axios.post(backendUrl, payload, {
                timeout: (payload.solverTimeLimit + 30) * 1000
            });

            if (response.status === 200 && response.data?.nurseSchedules) {
                console.log("Schedule received successfully:", response.data.solverStatus);
                setGeneratedSchedule(response.data);
                setSelectedTab('view');
                 const exists = await checkCurrentMonthHistoryExists(response.data.startDate);
                setCurrentMonthHistoryExists(exists);
             } else {
                console.error("API Error: Unexpected response format", response);
                const backendError = response.data?.error || `API Error ${response.status}: Unexpected response format`;
                 throw new Error(backendError);
            }
        } catch (err) {
            let msg = "เกิดข้อผิดพลาดระหว่างสร้างตารางเวร";
            if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
                msg = `การเชื่อมต่อ API หมดเวลาหลังจากรอ ${ (payload.solverTimeLimit + 30)} วินาที (ตั้งค่าเวลาคำนวณไว้ ${payload.solverTimeLimit} วินาที) ลองเพิ่มเวลาคำนวณ, ตรวจสอบข้อจำกัด หรือตรวจสอบสถานะ Backend Server`;
            } else if (err.response) {
                msg = `สร้างตารางเวรไม่ได้ (${err.response.status}): ${err.response.data?.error || 'ไม่สามารถเชื่อมต่อ Backend หรือเกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ กรุณาตรวจสอบว่า Server ทำงานอยู่และ URL ถูกต้อง'}`;
             } else if (err.request) {
                msg = "สร้างตารางเวรไม่ได้: ไม่สามารถเชื่อมต่อ Backend ได้ กรุณาตรวจสอบว่า Server ทำงานอยู่และ URL ถูกต้อง";
             } else {
                 msg = err.message || "มีข้อผิดพลาดบางอย่างเกิดขึ้น";
             }
             showErrorPopup(`${msg}`);
             setGeneratedSchedule(null);
             setSelectedTab('generate');
         } finally {
             setIsGenerating(false);
         }
    };

     const handleDragEnd = async (event) => {
         const { active, over } = event;
         if (active && over && active.id !== over.id) {
             const oldIndex = nurses.findIndex((nurse) => nurse.id === active.id);
             const newIndex = nurses.findIndex((nurse) => nurse.id === over.id);
             if (oldIndex === -1 || newIndex === -1) return;

             const newlyOrderedNurses = arrayMove(nurses, oldIndex, newIndex);
             const finalOrderedNurses = newlyOrderedNurses.map((nurse, index) => ({ ...nurse, order: index }));
             setNurses(finalOrderedNurses);

             const batch = writeBatch(db);
             finalOrderedNurses.forEach((nurse, index) => {
                 const nurseRef = doc(db, 'nurses', nurse.id);
                 batch.update(nurseRef, { order: index });
             });

             try {
                  await batch.commit();
                  console.log("Nurse order updated in Firestore.");
              } catch (error) {
                  showErrorPopup(`ไม่สามารถบันทึกการเรียงลำดับได้: ${error.message}`);
                  fetchNurses();
              }
         }
     };

     const saveScheduleToHistory = async () => {
         if (!generatedSchedule || !generatedSchedule.startDate) {
             showErrorPopup("ไม่มีข้อมูลตารางเวรปัจจุบันที่จะบันทึก");
             return { success: false, error: "ไม่มีข้อมูลตารางเวรปัจจุบัน" };
         }
         setErrorPopupMessage(null);

         try {
             const startDateStr = generatedSchedule.startDate;
             const { monthIndex, year } = getDisplayDateInfo(startDateStr);
             if (isNaN(monthIndex) || isNaN(year)) {
                 throw new Error("Invalid start date in generated schedule data");
             }
             const monthLabel = `${getThaiMonth(monthIndex)} ${year + 543}`;

             const exists = await checkCurrentMonthHistoryExists(startDateStr);
             if (exists) {
                 const message = `มีตารางเวรสำหรับ ${monthLabel} บันทึกไว้แล้ว กรุณาลบของเก่าก่อนหากต้องการบันทึกตารางเวรใหม่นี้`;
                 alert(message);
                 return { success: false, error: message };
             }

              const [sYear, sMonth, sDay] = startDateStr.split('-').map(Number);
              const startDateObj = new Date(Date.UTC(sYear, sMonth - 1, sDay));
             if (isNaN(startDateObj.getTime())) {
                 throw new Error("Invalid start date object conversion");
             }

              const orderedNurseIds = nurses.map(n => n.id);

              const historyData = {
                  startDate: Timestamp.fromDate(startDateObj),
                  createdAt: Timestamp.now(),
                  monthLabel: monthLabel,
                  nurseDisplayOrder: orderedNurseIds,
                  scheduleData: generatedSchedule
              };

             const docRef = await addDoc(collection(db, "scheduleHistory"), historyData);
             console.log("Schedule saved to history with ID: ", docRef.id);
             setCurrentMonthHistoryExists(true);
              alert(`บันทึกตารางเวรสำหรับ ${monthLabel} เรียบร้อยแล้ว`);
              return { success: true };

         } catch (error) {
             console.error("Error saving schedule to history: ", error);
             showErrorPopup(`ไม่สามารถบันทึกตารางเวรได้: ${error.message}`);
             return { success: false, error: `ไม่สามารถบันทึกตารางเวรได้: ${error.message}` };
         }
     };

     const fetchScheduleHistory = async () => {
         setHistoryLoading(true);
         setShowHistoryList(true);
         setViewingHistoryScheduleId(null);
         setSelectedHistoryScheduleData(null);
         setErrorPopupMessage(null);
         try {
             const q = query(collection(db, "scheduleHistory"), orderBy("startDate", "desc"));
             const querySnapshot = await getDocs(q);
             const list = querySnapshot.docs.map(d => {
                 const data = d.data();
                  const startDate = data.startDate?.toDate()?.toISOString()?.split('T')[0] || 'N/A';
                 return {
                      id: d.id,
                      startDate: startDate,
                      monthLabel: data.monthLabel || 'N/A',
                      createdAt: data.createdAt
                  };
             });
             setHistoryList(list);
         } catch (error) {
             console.error("Error fetching schedule history: ", error);
             showErrorPopup(`ไม่สามารถโหลดประวัติตารางเวรได้: ${error.message}`);
             setHistoryList([]);
         } finally {
             setHistoryLoading(false);
         }
     };

     const fetchSpecificHistorySchedule = async (historyId) => {
         if (!historyId) return;
         setHistoryLoading(true);
         setSelectedHistoryScheduleData(null);
         setViewingHistoryScheduleId(historyId);
         setShowHistoryList(false);
         setErrorPopupMessage(null);
         try {
             const docRef = doc(db, "scheduleHistory", historyId);
             const docSnap = await getDoc(docRef);

             if (docSnap.exists()) {
                  const data = docSnap.data();
                  if (data.scheduleData && data.scheduleData.nurseSchedules && data.scheduleData.shiftsCount) {
                      setSelectedHistoryScheduleData(data);
                  } else {
                      throw new Error("รูปแบบข้อมูลประวัติไม่ถูกต้อง หรือ ข้อมูล scheduleData ไม่สมบูรณ์");
                  }
              } else {
                  throw new Error("ไม่พบข้อมูลตารางเวรที่บันทึกไว้นี้");
              }
         } catch (error) {
             console.error("Error fetching specific history schedule: ", error);
             showErrorPopup(`ไม่สามารถโหลดข้อมูลตารางเวร ID ${historyId} ได้: ${error.message}`);
             setViewingHistoryScheduleId(null);
         } finally {
             setHistoryLoading(false);
         }
     };

     const deleteHistorySchedule = async (historyId, historyMonthLabel) => {
         if (!historyId) return;

         if (window.confirm(`ยืนยันการลบประวัติตารางเวรสำหรับ ${historyMonthLabel}? การดำเนินการนี้ไม่สามารถย้อนกลับได้`)) {
             setErrorPopupMessage(null);
             try {
                 await deleteDoc(doc(db, "scheduleHistory", historyId));
                 console.log("Deleted history schedule:", historyId);

                  setHistoryList(prevList => prevList.filter(item => item.id !== historyId));

                  if (viewingHistoryScheduleId === historyId) {
                      setViewingHistoryScheduleId(null);
                      setSelectedHistoryScheduleData(null);
                      setShowHistoryList(true);
                  }

                  if (generatedSchedule && generatedSchedule.startDate) {
                      try {
                          const { monthIndex, year } = getDisplayDateInfo(generatedSchedule.startDate);
                          if (!isNaN(monthIndex) && !isNaN(year)) {
                              const currentMonthLabel = `${getThaiMonth(monthIndex)} ${year + 543}`;
                              if (currentMonthLabel === historyMonthLabel) {
                                  setCurrentMonthHistoryExists(false);
                              }
                          }
                      } catch (dateError) {
                          console.error("Error checking date after deletion:", dateError);
                      }
                  }

             } catch (error) {
                 console.error("Error deleting history schedule: ", error);
                 showErrorPopup(`ไม่สามารถลบประวัติตารางเวรได้: ${error.message}`);
             }
         }
     };

     let mainContent = null;
     if (viewingHistoryScheduleId && !historyLoading) {
          mainContent = selectedHistoryScheduleData ? (
              <>
                  <button onClick={() => { setViewingHistoryScheduleId(null); setSelectedHistoryScheduleData(null); fetchScheduleHistory(); }} style={{ marginBottom: '15px' }}>
                      &larr; กลับไปรายการประวัติ
                  </button>
                  <ScheduleDisplay
                      schedule={selectedHistoryScheduleData.scheduleData}
                      nurses={
                          (selectedHistoryScheduleData.nurseDisplayOrder || Object.keys(selectedHistoryScheduleData.scheduleData.nurseSchedules))
                             .map(id => selectedHistoryScheduleData.scheduleData.nurseSchedules[id]?.nurse)
                             .filter(Boolean)
                      }
                      isHistoryView={true}
                   />
               </>
           ) : (
               <div className="loading">กำลังโหลดข้อมูลตารางเวรประวัติ...</div>
           );

     } else if (showHistoryList) {
          mainContent = (
              <div className="nurse-management-container">
                  <button onClick={() => setShowHistoryList(false)} style={{marginBottom: '10px'}}>
                      <span role="img" aria-label="hide">🔼</span> ซ่อนประวัติตารางเวร
                  </button>
                  <HistoryList
                      historyList={historyList}
                      onViewHistory={fetchSpecificHistorySchedule}
                      onDeleteHistory={deleteHistorySchedule}
                      isLoading={historyLoading}
                  />
              </div>
          );
     } else if (selectedTab === 'nurses') {
          mainContent = (
              <div className="nurse-management-container">
                  <div className="nurse-management">
                      <NurseForm
                          addNurse={addNurse}
                          updateNurse={updateNurse}
                          nurseToEdit={editingNurse}
                          isEditing={isEditing}
                          onCancelEdit={handleCancelEdit}
                      />
                      <div className="nurse-list card">
                          <h2>รายชื่อพยาบาล <span className="badge">{nurses.length}</span></h2>
                          {nurses.length === 0 && !loading ? (
                              <div className="empty-state"><p>ยังไม่มีข้อมูลพยาบาลในระบบ</p></div>
                          ) : (
                              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                                  <SortableContext items={nurses.map(n => n.id)} strategy={verticalListSortingStrategy}>
                                      {nurses.map(nurse => (
                                          <SortableNurseItem
                                              key={nurse.id} id={nurse.id} nurse={nurse}
                                              handleEditNurse={handleEditNurse}
                                              deleteNurse={deleteNurse}
                                              isEditing={isEditing} editingNurse={editingNurse}
                                           />
                                      ))}
                                  </SortableContext>
                              </DndContext>
                          )}
                      </div>
                  </div>
                   <div style={{ marginTop: '20px', borderTop: '1px solid var(--gray-300)', paddingTop: '20px' }}>
                       <button onClick={fetchScheduleHistory} disabled={historyLoading}>
                           <span role="img" aria-label="history-book">📚</span> แสดงประวัติตารางเวรที่บันทึกไว้
                       </button>
                   </div>
              </div>
          );
     } else if (selectedTab === 'generate') {
          mainContent = !isGenerating ? (
              <ScheduleGenerator
                  nurses={nurses}
                  onGenerateSchedule={generateSchedule}
                  updateNurse={updateNurse}
               />
          ) : null;
     } else if (selectedTab === 'view') {
          mainContent = !isGenerating && generatedSchedule ? (
              <ScheduleDisplay
                  schedule={generatedSchedule}
                  nurses={nurses}
                  onSaveSchedule={saveScheduleToHistory}
                  isHistoryView={false}
                  isSaveDisabled={currentMonthHistoryExists}
              />
          ) : (
               !isGenerating && (
                   <div className="card empty-state">
                       <p>ยังไม่มีตารางเวรให้แสดงผล</p>
                       <p>กรุณากลับไปที่หน้า 'สร้างตารางเวร' เพื่อสร้างตารางใหม่</p>
                       <button onClick={() => setSelectedTab('generate')} disabled={nurses.length === 0}>
                            ไปที่หน้าสร้างตารางเวร
                       </button>
                   </div>
               )
           );
      }

     return (
         <div className="App">
             <ErrorPopup
                 message={errorPopupMessage}
                 onClose={() => setErrorPopupMessage(null)}
             />

             <header className="App-header">
                 <h1><span role="img" aria-label="nurse-female">👩‍⚕️</span><span role="img" aria-label="calendar">🗓️</span>ระบบจัดการตารางเวรพยาบาล</h1>
                 <div className="tabs">
                     <button
                         className={(selectedTab === 'nurses' && !viewingHistoryScheduleId && !showHistoryList) ? 'active' : ''}
                         onClick={() => {
                             setSelectedTab('nurses');
                             handleCancelEdit();
                             setShowHistoryList(false);
                             setViewingHistoryScheduleId(null);
                         }}
                         disabled={isGenerating}
                     >
                         <span role="img" aria-label="manage">👥</span> จัดการข้อมูล
                     </button>
                     <button
                         className={selectedTab === 'generate' ? 'active' : ''}
                         onClick={() => {
                              setSelectedTab('generate');
                              setViewingHistoryScheduleId(null);
                              setShowHistoryList(false);
                          }}
                          disabled={nurses.length === 0 || isGenerating}
                      >
                          <span role="img" aria-label="settings">⚙️</span> สร้างตารางเวร
                     </button>
                      <button
                          className={selectedTab === 'view' ? 'active' : ''}
                          onClick={() => {
                              setSelectedTab('view');
                              setViewingHistoryScheduleId(null);
                              setShowHistoryList(false);
                          }}
                          disabled={!generatedSchedule || isGenerating}
                      >
                          <span role="img" aria-label="view">👁️</span> ดูตารางเวรปัจจุบัน
                      </button>
                 </div>
              </header>
             <main>
                  {loading && !historyLoading && <div className="loading">กำลังโหลดข้อมูลพยาบาล...</div>}
                  {isGenerating && <div className="loading generating">กำลังสร้างตารางเวร โปรดรอสักครู่... (สูงสุดประมาณ { lastUsedTimeLimit + 30 } วินาที)</div>}
                  {historyLoading && <div className="loading">กำลังโหลดข้อมูลประวัติ...</div>}
                  {mainContent}
              </main>
          </div>
      );
}

export default App;