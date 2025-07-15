// NurseForm.js

import React, { useState, useEffect } from 'react';

const NurseForm = ({ addNurse, updateNurse, nurseToEdit, isEditing, onCancelEdit }) => {
    // Add isGovernmentOfficial to initial state
    const initialFormData = {
        prefix: 'นาง', firstName: '', lastName: '', constraints: [], isGovernmentOfficial: false
    };
    const [formData, setFormData] = useState(initialFormData);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);
    const [successMessage, setSuccessMessage] = useState('');

    useEffect(() => {
        if (isEditing && nurseToEdit) {
            setFormData({
                prefix: nurseToEdit.prefix || 'นาง',
                firstName: nurseToEdit.firstName || '',
                lastName: nurseToEdit.lastName || '',
                constraints: nurseToEdit.constraints || [],
                // Set state based on nurseToEdit data, default to false
                isGovernmentOfficial: nurseToEdit.isGovernmentOfficial === true
            });
        } else {
            // Reset to initial state when not editing or nurseToEdit is null
            setFormData(initialFormData);
        }
        // Reset success message when form mode changes
        setSuccess(false);
        setSuccessMessage('');
    }, [nurseToEdit, isEditing]);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prevData => ({
            ...prevData,
            // Use checked for checkbox, value otherwise
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.firstName || !formData.lastName) { alert("กรุณากรอกชื่อและนามสกุล"); return; }
        setIsSubmitting(true);
        setSuccess(false); // Reset success state on new submission
        try {
            let opSuccess = false;
            // Ensure formData includes the isGovernmentOfficial flag
            const dataToSubmit = { ...formData };

            if (isEditing && nurseToEdit) {
                opSuccess = await updateNurse(nurseToEdit.id, dataToSubmit);
                if (opSuccess) {
                    setSuccessMessage('แก้ไขข้อมูลพยาบาลเรียบร้อยแล้ว');
                    if (onCancelEdit) onCancelEdit(); // Close edit form on success
                } else {
                     // Error handled by updateNurse (showErrorPopup)
                }
            } else {
                opSuccess = await addNurse(dataToSubmit);
                 if (opSuccess) {
                    setSuccessMessage('เพิ่มข้อมูลพยาบาลเรียบร้อยแล้ว');
                    setFormData(initialFormData); // Reset form after adding
                 } else {
                    // Error handled by addNurse (showErrorPopup)
                 }
            }
            if (opSuccess) { setSuccess(true); setTimeout(() => setSuccess(false), 3000); }
        } catch (error) {
            console.error("Form submit error:", error);
            // Use showErrorPopup if available, otherwise alert
            alert("เกิดข้อผิดพลาดในการบันทึกข้อมูล");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleCancel = () => {
        if (onCancelEdit) onCancelEdit();
        setFormData(initialFormData); // Reset form data on cancel
        setSuccess(false); // Clear success message
    };

    return (
        <div className="nurse-form card">
            <h2> <span role="img" aria-label={isEditing ? 'edit' : 'add'} style={{ marginRight: '10px' }}> {isEditing ? '✏️' : '➕'} </span> {isEditing ? 'แก้ไขข้อมูลพยาบาล' : 'เพิ่มข้อมูลพยาบาล'} </h2>
            {success && (<div className="success-alert"> <span role="img" aria-label="success">✅</span> {successMessage} </div>)}
            <form onSubmit={handleSubmit}>
                <div className="form-group">
                    <label htmlFor="prefix">คำนำหน้า</label>
                    <select id="prefix" name="prefix" value={formData.prefix} onChange={handleChange} required className="form-select" >
                        <option value="นาย">นาย</option> <option value="นาง">นาง</option> <option value="นางสาว">นางสาว</option>
                    </select>
                </div>
                <div className="form-group">
                    <label htmlFor="firstName">ชื่อ</label>
                    <input type="text" id="firstName" name="firstName" value={formData.firstName} onChange={handleChange} required className="form-input" placeholder="กรุณากรอกชื่อ" />
                </div>
                <div className="form-group">
                    <label htmlFor="lastName">นามสกุล</label>
                    <input type="text" id="lastName" name="lastName" value={formData.lastName} onChange={handleChange} required className="form-input" placeholder="กรุณากรอกนามสกุล" />
                </div>

                <div className="form-group-checkbox" style={{ marginTop: '15px', marginBottom: '15px', padding: '10px', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
                    <input
                        type="checkbox"
                        id="isGovernmentOfficial"
                        name="isGovernmentOfficial"
                        checked={formData.isGovernmentOfficial}
                        onChange={handleChange}
                        style={{ marginRight: '8px', transform: 'scale(1.1)' }}
                    />
                    <label htmlFor="isGovernmentOfficial" style={{ fontWeight: 'bold', color: '#333' }}>
                        เป็นข้าราชการ (มีเฉพาะเวรเช้าและบังคับหยุด ส-อา)
                    </label>
                </div>

                <div className="form-actions">
                    <button type="submit" className="submit-button" disabled={isSubmitting || !formData.firstName || !formData.lastName} >
                        {isSubmitting ? 'กำลังบันทึก...' : (isEditing ? 'บันทึกการแก้ไข' : 'เพิ่มข้อมูล')}
                    </button>
                    {isEditing && (<button type="button" className="cancel-button" onClick={handleCancel} disabled={isSubmitting} > ยกเลิก </button>)}
                </div>
            </form>
        </div>
    );
};
export default NurseForm;
