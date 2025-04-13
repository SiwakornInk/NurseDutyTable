// App.js
import React, { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from './firebase'; // ตรวจสอบว่า path ถูกต้อง
import axios from 'axios';
import './App.css'; // ตรวจสอบว่า path ถูกต้อง
import NurseForm from './components/NurseForm'; // ตรวจสอบว่า path ถูกต้อง
import ScheduleGenerator from './components/ScheduleGenerator'; // ตรวจสอบว่า path ถูกต้อง
import ScheduleDisplay from './components/ScheduleDisplay'; // ตรวจสอบว่า path ถูกต้อง
import ErrorPopup from './components/ErrorPopup'; // *** 1. Import ErrorPopup ***

function App() {
    // --- State Variables ---
    const [nurses, setNurses] = useState([]);
    const [selectedTab, setSelectedTab] = useState('nurses');
    const [generatedSchedule, setGeneratedSchedule] = useState(null);
    const [loading, setLoading] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    // const [apiError, setApiError] = useState(null); // เก็บข้อความ error
    const [errorPopupMessage, setErrorPopupMessage] = useState(null); // *** 2. State ใหม่สำหรับ Popup ***
    const [editingNurse, setEditingNurse] = useState(null);
    const [isEditing, setIsEditing] = useState(false);
    const [lastUsedTimeLimit, setLastUsedTimeLimit] = useState(60);

    // Fetch nurses on initial mount
    useEffect(() => {
        fetchNurses();
    }, []);

    // --- Helper to show error popup ---
    const showErrorPopup = (message) => {
        console.error("Error Displayed:", message); // Log error for debugging
        setErrorPopupMessage(message);
    };

    // --- Firebase Functions ---
    const fetchNurses = async () => {
        setLoading(true);
        setErrorPopupMessage(null); // Clear previous error
        try {
            const querySnapshot = await getDocs(collection(db, 'nurses'));
            const list = querySnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            setNurses(list);
            console.log("Fetched nurses:", list.length);
        } catch (e) {
            // console.error("Fetch error:", e); // Removed console.error here, handled by showErrorPopup
            showErrorPopup(`โหลดข้อมูลพยาบาลไม่ได้: ${e.message || e}`);
        } finally {
            setLoading(false);
        }
    };

    const addNurse = async (nurseData) => {
        setErrorPopupMessage(null); // Clear previous error
        try {
            const exists = nurses.some(n =>
                n.firstName === nurseData.firstName && n.lastName === nurseData.lastName
            );
            if (exists) {
                // ใช้ alert ปกติสำหรับแจ้งเตือนที่ไม่ใช่ error ร้ายแรง
                alert(`พยาบาล ${nurseData.firstName} ${nurseData.lastName} มีอยู่ในระบบแล้ว`);
                return false;
            }
            const dataToAdd = { ...nurseData, constraints: nurseData.constraints || [] };
            await addDoc(collection(db, 'nurses'), dataToAdd);
            fetchNurses(); // Refresh list after adding
            return true;
        } catch (e) {
            showErrorPopup(`เพิ่มข้อมูลพยาบาลไม่ได้: ${e.message || e}`);
            return false;
        }
    };

    const updateNurse = async (id, dataToUpdate) => {
        setErrorPopupMessage(null); // Clear previous error
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
        setErrorPopupMessage(null); // Clear previous error
         if (!id) {
               showErrorPopup("เกิดข้อผิดพลาด: ไม่พบ ID ของพยาบาลที่จะลบ");
               return;
         }
        if (window.confirm('ยืนยันการลบข้อมูลพยาบาลท่านนี้? การดำเนินการนี้ไม่สามารถย้อนกลับได้')) {
            try {
                await deleteDoc(doc(db, 'nurses', id));
                fetchNurses(); // Refresh list
                if (editingNurse?.id === id) {
                    handleCancelEdit();
                }
            } catch (e) {
                showErrorPopup(`ลบข้อมูลพยาบาลไม่ได้: ${e.message || e}`);
            }
        }
    };

    // --- Edit State Handling ---
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

    // --- Schedule Generation via API ---
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
        setErrorPopupMessage(null); // Clear previous error

        // 1. Basic Validations
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

        // 2. Format Dates using Local Time
        const localStartDateStr = formatDateToLocalYYYYMMDD(scheduleParams.startDate);
        const localEndDateStr = formatDateToLocalYYYYMMDD(scheduleParams.endDate);

        if (!localStartDateStr || !localEndDateStr) {
            showErrorPopup("เกิดข้อผิดพลาดในการแปลงข้อมูลวันที่ กรุณาลองใหม่อีกครั้ง");
            setIsGenerating(false);
            return;
        }

        // 3. Create Payload for Backend
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

        // 4. Call Backend API
        try {
            const backendUrl = process.env.REACT_APP_API_URL || 'http://localhost:5000/generate-schedule';
            console.log("Sending schedule request to:", backendUrl);

            const response = await axios.post(backendUrl, payload, {
                timeout: (payload.solverTimeLimit + 30) * 1000
            });

            // 5. Handle Response
            if (response.status === 200 && response.data?.nurseSchedules) {
                console.log("Schedule received successfully:", response.data.solverStatus);
                setGeneratedSchedule(response.data);
                setSelectedTab('view');
            } else {
                 console.error("API Error: Unexpected response format", response);
                 // Throw error to be caught by the catch block
                 throw new Error(response.data?.error || `API Error ${response.status}: Unexpected response format`);
            }
        } catch (err) {
            // 6. Handle Errors (Network, Timeout, Server Error)
             // console.error("API Call Error:", err); // Logged in showErrorPopup
            let msg = "เกิดข้อผิดพลาดระหว่างสร้างตารางเวร";
            if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
                 msg = `การเชื่อมต่อ API หมดเวลาหลังจากรอ ${ (payload.solverTimeLimit + 30)} วินาที (ตั้งค่าเวลาคำนวณไว้ ${payload.solverTimeLimit} วินาที) ลองเพิ่มเวลาคำนวณ, ตรวจสอบข้อจำกัด หรือตรวจสอบสถานะ Backend Server`;
            } else if (err.response) {
                 msg = err.response.data?.error || `Server Error (${err.response.status}): ${err.message}`;
                 // *** นี่คือจุดที่จะแสดงข้อความที่คุณต้องการ ***
                 if (err.response.status === 500 || err.response.status === 404 || !err.response.data?.error) { // อาจจะปรับเงื่อนไขตามต้องการ
                     // msg = "สร้างตารางเวรไม่ได้: ไม่สามารถเชื่อมต่อ Backend ได้ กรุณาตรวจสอบว่า Server ทำงานอยู่และ URL ถูกต้อง";
                     // ใช้ข้อความเดิมจาก error ถ้ามี, หรือข้อความ default
                     msg = `สร้างตารางเวรไม่ได้ (${err.response.status}): ${err.response.data?.error || 'ไม่สามารถเชื่อมต่อ Backend หรือเกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ กรุณาตรวจสอบว่า Server ทำงานอยู่และ URL ถูกต้อง'}`;
                 }

            } else if (err.request) {
                 // *** หรือตรงนี้ ถ้า request ส่งไปแต่ไม่ได้รับการตอบกลับ ***
                 msg = "สร้างตารางเวรไม่ได้: ไม่สามารถเชื่อมต่อ Backend ได้ กรุณาตรวจสอบว่า Server ทำงานอยู่และ URL ถูกต้อง";
            } else {
                 msg = err.message || "มีข้อผิดพลาดบางอย่างเกิดขึ้น";
            }
            showErrorPopup(`${msg}`); // ใช้ showErrorPopup แทน setApiError
            setGeneratedSchedule(null);
            setSelectedTab('generate'); // กลับไปหน้า generate เมื่อเกิด error
        } finally {
            setIsGenerating(false);
        }
    };
    // --- End Schedule Generation ---

    // --- Render ---
    return (
        <div className="App">
            {/* *** 3. Render ErrorPopup Component *** */}
            <ErrorPopup
                message={errorPopupMessage}
                onClose={() => setErrorPopupMessage(null)} // ส่ง function ปิด popup
            />

            <header className="App-header">
                 <h1><span role="img" aria-label="nurse-female">👩‍⚕️</span><span role="img" aria-label="calendar">🗓️</span> ระบบจัดการตารางเวรพยาบาล</h1>
                <div className="tabs">
                   {/* ... (โค้ด Tabs เหมือนเดิม) ... */}
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
                {/* Loading/Error Indicators */}
                {loading && <div className="loading">กำลังโหลดข้อมูลพยาบาล...</div>}
                {isGenerating && <div className="loading generating">กำลังสร้างตารางเวร โปรดรอสักครู่... (สูงสุดประมาณ { lastUsedTimeLimit + 30 } วินาที)</div>}
                {/* {apiError && !isGenerating && <div className="error-alert">{apiError}</div>} *** 4. ลบ Error เดิมออก *** */}

                {/* Tab Content */}
                {selectedTab === 'nurses' && (
                    // ... (เนื้อหา Tab 'nurses' เหมือนเดิม) ...
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
                    // ... (เนื้อหา Tab 'generate' เหมือนเดิม) ...
                     <ScheduleGenerator
                        nurses={nurses}
                        onGenerateSchedule={generateSchedule}
                        updateNurse={updateNurse}
                    />
                )}

                {selectedTab === 'view' && !isGenerating && (
                    // ... (เนื้อหา Tab 'view' เหมือนเดิม) ...
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