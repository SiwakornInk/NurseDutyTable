// src/components/HistoryList.js

import React from 'react';

const getThaiMonthYear = (dateString) => {
    if (!dateString) return '???';
    try {
        const date = new Date(dateString + 'T00:00:00Z');
         if (isNaN(date.getTime())) throw new Error('Invalid Date');
        const monthIndex = date.getUTCMonth();
        const year = date.getUTCFullYear();
        const thaiMonths = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
        return `${thaiMonths[monthIndex]} ${year + 543}`;
    } catch (e) {
        console.error("Error formatting history date:", dateString, e);
        return dateString;
    }
};


const HistoryList = ({ historyList, onViewHistory, onDeleteHistory, isLoading }) => {
    if (isLoading) {
        return <div className="loading">กำลังโหลดประวัติตารางเวร...</div>;
    }

    if (!historyList || historyList.length === 0) {
        return <div className="empty-state" style={{ marginTop: '15px' }}><p>ยังไม่มีประวัติตารางเวรที่บันทึกไว้</p></div>;
    }

    const handleDelete = (e, id, label) => {
        e.stopPropagation();
        onDeleteHistory(id, label);
    };

    return (
        <div className="history-list card">
            <h2><span role="img" aria-label="history-book">📚</span> ประวัติตารางเวรที่บันทึกไว้</h2>
            <ul style={{ listStyle: 'none', padding: 0 }}>
                {historyList.map(item => (
                    <li key={item.id} className="history-item" style={{ borderBottom: '1px solid var(--gray-200)', padding: '10px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer'}} onClick={() => onViewHistory(item.id)}>
                        <div style={{ flexGrow: 1, marginRight: '10px'}}>
                             <span>{item.monthLabel || getThaiMonthYear(item.startDate)}</span>
                             {item.createdAt && (
                                 <span style={{ fontSize: '0.8em', color: 'var(--gray-600)', marginLeft: '10px', display: 'block' }}>
                                     (บันทึกเมื่อ: {new Date(item.createdAt.seconds * 1000).toLocaleString('th-TH')})
                                 </span>
                             )}
                        </div>
                        <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                             <button className="secondary-button" style={{ padding: '5px 10px', fontSize: '14px'}} onClick={(e) => {e.stopPropagation(); onViewHistory(item.id);}}>
                                 ดู
                             </button>
                             <button
                                 className="danger-button"
                                 style={{ padding: '5px 10px', fontSize: '14px'}}
                                 onClick={(e) => handleDelete(e, item.id, item.monthLabel || getThaiMonthYear(item.startDate))}
                                 >
                                 ลบ
                             </button>
                         </div>
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default HistoryList;