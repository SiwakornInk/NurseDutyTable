// App.js

import React, { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc, writeBatch, query, orderBy } from 'firebase/firestore';
import { db } from './firebase';
import axios from 'axios';
import './App.css';
import NurseForm from './components/NurseForm';
import ScheduleGenerator from './components/ScheduleGenerator';
import ScheduleDisplay from './components/ScheduleDisplay';
import ErrorPopup from './components/ErrorPopup';
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


    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );


    useEffect(() => {
        fetchNurses();
    }, []);

    const showErrorPopup = (message) => {
        console.error("Error Displayed:", message);
        setErrorPopupMessage(message);
    };

    const fetchNurses = async () => {
        setLoading(true);
        setErrorPopupMessage(null);
        try {
            const q = query(collection(db, 'nurses'), orderBy("order", "asc"));
            const querySnapshot = await getDocs(q);
            let needsUpdate = false;
            let maxOrder = -1;
            const list = querySnapshot.docs.map((d, index) => {
                const data = d.data();

                if (data.order === undefined || data.order === null) {
                    needsUpdate = true;
                    data.order = index;
                }
                 maxOrder = Math.max(maxOrder, data.order);
                return { id: d.id, ...data };
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
            showErrorPopup(`โหลดข้อมูลพยาบาลไม่ได้: ${e.message || e}`);

             if (e.code === 'failed-precondition') {
                 console.warn("Order index likely missing, fetching without ordering and will attempt re-order.");
                try {
                    const querySnapshot = await getDocs(collection(db, 'nurses'));
                     const list = querySnapshot.docs.map(d => ({ id: d.id, ...d.data() }));

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
        try {

            const existingNurse = nurses.find(n => n.id === id);
            const currentOrder = existingNurse?.order;
            const data = {
                ...dataToUpdate,
                constraints: dataToUpdate.constraints || []
            };

            if (currentOrder !== undefined && data.order === undefined) {
                data.order = currentOrder;
            }
            await updateDoc(doc(db, 'nurses', id), data);

            setNurses(prevNurses =>
                 prevNurses.map(n => n.id === id ? { ...n, ...data } : n).sort((a,b) => (a.order ?? Infinity) - (b.order ?? Infinity))
             );


            return true;
        } catch (e) {
            showErrorPopup(`อัปเดตข้อมูลพยาบาลไม่ได้: ${e.message || e}`);
            return false;
        }
    };

    const deleteNurse = async (id) => {
        setErrorPopupMessage(null);
        if (!id) {
            showErrorPopup("เกิดข้อผิดพลาด: ไม่พบ ID ของพยาบาลที่จะลบ");
            return;
        }
        if (window.confirm('ยืนยันการลบข้อมูลพยาบาลท่านนี้? การดำเนินการนี้ไม่สามารถย้อนกลับได้')) {
            try {
                await deleteDoc(doc(db, 'nurses', id));

                setNurses(prevNurses => prevNurses.filter(nurse => nurse.id !== id));

                if (editingNurse?.id === id) {
                    handleCancelEdit();
                }
            } catch (e) {
                showErrorPopup(`ลบข้อมูลพยาบาลไม่ได้: ${e.message || e}`);
            }
        }
    };

    const handleEditNurse = (nurse) => {
        setEditingNurse(nurse);
        setIsEditing(true);
        setSelectedTab('nurses');
        window.scrollTo(0, 0);
    };

    const handleCancelEdit = () => {
        setEditingNurse(null);
        setIsEditing(false);
    };

    const formatDateToLocalYYYYMMDD = (date) => {
        if (!(date instanceof Date) || isNaN(date.getTime())) {
            console.error("Invalid date passed to formatDateToLocalYYYYMMDD:", date);
            return null;
        }
        try {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        } catch (e) {
             console.error("Error formatting date:", date, e);
             return null;
        }
    }

    const generateSchedule = async (scheduleParams) => {
        setIsGenerating(true);
        setGeneratedSchedule(null);
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
            solverTimeLimit: scheduleParams.solverTimeLimit
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
            } else {
                 console.error("API Error: Unexpected response format", response);
                 throw new Error(response.data?.error || `API Error ${response.status}: Unexpected response format`);
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


            setNurses(newlyOrderedNurses);


            const batch = writeBatch(db);
            newlyOrderedNurses.forEach((nurse, index) => {
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


    return (
        <div className="App">
            <ErrorPopup
                message={errorPopupMessage}
                onClose={() => setErrorPopupMessage(null)}
            />

            <header className="App-header">
                 <h1><span role="img" aria-label="nurse-female">👩‍⚕️</span><span role="img" aria-label="calendar">🗓️</span> ระบบจัดการตารางเวรพยาบาล</h1>
                <div className="tabs">
                    <button
                        className={selectedTab === 'nurses' ? 'active' : ''}
                        onClick={() => { setSelectedTab('nurses'); handleCancelEdit(); }}
                        disabled={isGenerating}
                        >
                        <span role="img" aria-label="manage">👥</span> จัดการข้อมูล
                    </button>
                    <button
                        className={selectedTab === 'generate' ? 'active' : ''}
                        onClick={() => setSelectedTab('generate')}
                        disabled={nurses.length === 0 || isGenerating}
                        >
                        <span role="img" aria-label="settings">⚙️</span> สร้างตารางเวร
                    </button>
                    <button
                        className={selectedTab === 'view' ? 'active' : ''}
                        onClick={() => setSelectedTab('view')}
                        disabled={!generatedSchedule || isGenerating}
                        >
                        <span role="img" aria-label="view">👁️</span> ดูตารางเวร
                    </button>
                </div>
            </header>
            <main>
                {loading && <div className="loading">กำลังโหลดข้อมูลพยาบาล...</div>}
                {isGenerating && <div className="loading generating">กำลังสร้างตารางเวร โปรดรอสักครู่... (สูงสุดประมาณ { lastUsedTimeLimit + 30 } วินาที)</div>}

                {selectedTab === 'nurses' && (
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
                                <DndContext
                                    sensors={sensors}
                                    collisionDetection={closestCenter}
                                    onDragEnd={handleDragEnd}
                                >
                                    <SortableContext
                                        items={nurses.map(n => n.id)}
                                        strategy={verticalListSortingStrategy}
                                    >

                                        {nurses.map(nurse => (
                                             <SortableNurseItem
                                                 key={nurse.id}
                                                 id={nurse.id}
                                                 nurse={nurse}
                                                 handleEditNurse={handleEditNurse}
                                                 deleteNurse={deleteNurse}
                                                 isEditing={isEditing}
                                                 editingNurse={editingNurse}
                                             />
                                        ))}
                                    </SortableContext>
                                </DndContext>
                            )}
                        </div>
                    </div>
                )}

                {selectedTab === 'generate' && !isGenerating && (
                     <ScheduleGenerator
                         nurses={nurses}
                         onGenerateSchedule={generateSchedule}
                         updateNurse={updateNurse}
                     />
                )}

                {selectedTab === 'view' && !isGenerating && (
                     generatedSchedule ? (
                        <ScheduleDisplay
                             schedule={generatedSchedule}
                             nurses={nurses}
                        />
                    ) : (
                        <div className="card empty-state">
                            <p>ยังไม่มีตารางเวรให้แสดงผล</p>
                            <p>กรุณากลับไปที่หน้า 'สร้างตารางเวร' เพื่อสร้างตารางใหม่</p>
                            <button onClick={() => setSelectedTab('generate')} disabled={nurses.length === 0}>
                                ไปที่หน้าสร้างตารางเวร
                            </button>
                        </div>
                    )
                )}
            </main>
        </div>
    );
}

export default App;