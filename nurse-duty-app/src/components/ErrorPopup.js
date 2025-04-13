// src/components/ErrorPopup.js
import React from 'react';
import './ErrorPopup.css'; // สร้างไฟล์ CSS สำหรับตกแต่ง Popup

function ErrorPopup({ message, onClose }) {
  if (!message) {
    return null; // ไม่แสดงอะไรเลยถ้าไม่มีข้อความ error
  }

  return (
    <div className="popup-overlay" onClick={onClose}> {/* คลิกพื้นหลังเพื่อปิด */}
      <div className="popup-content" onClick={(e) => e.stopPropagation()}> {/* ป้องกันการปิดเมื่อคลิกในเนื้อหา */}
        <div className="popup-header">
           <h3><span role="img" aria-label="warning">⚠️</span> เกิดข้อผิดพลาด</h3>
           <button className="close-button" onClick={onClose}>&times;</button>
        </div>
        <div className="popup-body">
          <p>{message}</p>
        </div>
        <div className="popup-footer">
          <button className="ok-button" onClick={onClose}>
            ตกลง
          </button>
        </div>
      </div>
    </div>
  );
}

export default ErrorPopup;