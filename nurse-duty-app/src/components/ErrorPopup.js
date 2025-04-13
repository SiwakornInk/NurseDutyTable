// ErrorPopup.js

import React from 'react';
import './ErrorPopup.css';

function ErrorPopup({ message, onClose }) {
  if (!message) {
    return null;
  }

  return (
    <div className="popup-overlay" onClick={onClose}>
      <div className="popup-content" onClick={(e) => e.stopPropagation()}>
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