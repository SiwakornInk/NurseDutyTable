// App.js

import React, { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from './firebase';
import axios from 'axios';
import './App.css';
import NurseForm from './components/NurseForm';
import ScheduleGenerator from './components/ScheduleGenerator';
import ScheduleDisplay from './components/ScheduleDisplay';
import ErrorPopup from './components/ErrorPopup';

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
            const querySnapshot = await getDocs(collection(db, 'nurses'));
            const list = querySnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            setNurses(list);
            console.log("Fetched nurses:", list.length);
        } catch (e) {
            showErrorPopup(`โหลดข้อมูลพยาบาลไม่ได้: ${e.message || e}`);
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
            const dataToAdd = { ...nurseData, constraints: nurseData.constraints || [] };
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
            const data = { ...dataToUpdate, constraints: dataToUpdate.constraints || [] };
            await updateDoc(doc(db, 'nurses', id), data);
            await fetchNurses();
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
                fetchNurses();
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
            nurses: nurses,
            schedule: {
                startDate: localStartDateStr,
                endDate: localEndDateStr,
                holidays: scheduleParams.holidays || [],
            },
            requiredNursesMorning: scheduleParams.requiredNursesMorning,
            requiredNursesAfternoon: scheduleParams.requiredNursesAfternoon,
            requiredNursesNight: scheduleParams.requiredNursesNight,
            maxConsecutiveShifts: scheduleParams.maxConsecutiveShifts,
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
                                nurses
                                .sort((a, b) => `${a?.firstName ?? ''} ${a?.lastName ?? ''}`.localeCompare(`${b?.firstName ?? ''} ${b?.lastName ?? ''}`, 'th'))
                                .map(nurse => (
                                    <div key={nurse.id} className="nurse-item">
                                        <span>{`${nurse.prefix ?? ''} ${nurse.firstName ?? ''} ${nurse.lastName ?? ''}`.trim()}</span>
                                        <div className="nurse-actions">
                                            <button onClick={() => handleEditNurse(nurse)} disabled={isEditing && editingNurse?.id === nurse.id}>แก้ไข</button>
                                            <button onClick={() => deleteNurse(nurse.id)} className='danger-button'>ลบ</button>
                                        </div>
                                    </div>
                                ))
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