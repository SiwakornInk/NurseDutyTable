// components/NurseForm.js
import React, { useState, useEffect } from 'react';

const NurseForm = ({ addNurse, updateNurse, nurseToEdit, isEditing, onCancelEdit }) => {
    const [formData, setFormData] = useState({
        prefix: 'นาง', firstName: '', lastName: '', constraints: []
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);
    const [successMessage, setSuccessMessage] = useState('');

    useEffect(() => {
        if (isEditing && nurseToEdit) {
            setFormData({
                prefix: nurseToEdit.prefix || 'นาง',
                firstName: nurseToEdit.firstName || '',
                lastName: nurseToEdit.lastName || '',
                constraints: nurseToEdit.constraints || []
            });
        } else {
            setFormData({ prefix: 'นาง', firstName: '', lastName: '', constraints: [] });
        }
    }, [nurseToEdit, isEditing]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData({ ...formData, [name]: value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.firstName || !formData.lastName) { alert("กรุณากรอกชื่อและนามสกุล"); return; }
        setIsSubmitting(true);
        try {
            let opSuccess = false;
            if (isEditing && nurseToEdit) {
                opSuccess = await updateNurse(nurseToEdit.id, formData);
                setSuccessMessage('แก้ไขข้อมูลพยาบาลเรียบร้อยแล้ว');
                if (onCancelEdit) onCancelEdit();
            } else {
                opSuccess = await addNurse(formData);
                setSuccessMessage('เพิ่มข้อมูลพยาบาลเรียบร้อยแล้ว');
                setFormData({ prefix: 'นาง', firstName: '', lastName: '', constraints: [] });
            }
            if (opSuccess) { setSuccess(true); setTimeout(() => setSuccess(false), 3000); }
        } catch (error) { console.error("Form submit error:", error); alert("เกิดข้อผิดพลาดในการบันทึกข้อมูล");
        } finally { setIsSubmitting(false); }
    };

    const handleCancel = () => { if (onCancelEdit) onCancelEdit(); };

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