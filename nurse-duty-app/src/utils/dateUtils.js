// dateUtils.js

export const getThaiMonth = (monthIndex) => {
    const thaiMonths = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
    if (typeof monthIndex === 'number' && monthIndex >= 0 && monthIndex <= 11) {
        return thaiMonths[monthIndex];
    }
    const monthNum = parseInt(monthIndex, 10);
     if (!isNaN(monthNum) && monthNum >= 0 && monthNum <= 11) {
         console.warn("getThaiMonth received non-standard number:", monthIndex);
         return thaiMonths[monthNum];
     }
    console.error("Invalid month index received by getThaiMonth:", monthIndex);
    return "??";
};

export const getThaiDayOfWeek = (date) => {
    if (!(date instanceof Date) || isNaN(date.getTime())) {
        return "?";
    }
    const thaiDays = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
    return thaiDays[date.getDay()];
};

export const getDaysArrayFromStrings = (dayStrings) => {
    if (!Array.isArray(dayStrings)) return [];
    return dayStrings.map(ds => {
        try {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) {
                 throw new Error(`Invalid date string format: "${ds}"`);
            }
            const date = new Date(ds + 'T00:00:00Z');
            if (isNaN(date.getTime())) throw new Error(`Invalid Date created from "${ds}"`);
            return date;
        } catch (e) {
            console.error(`Error parsing date string "${ds}":`, e);
            return null;
        }
    }).filter(d => d instanceof Date);
};

export const getDisplayDateInfo = (dateString) => {
    if (!dateString || typeof dateString !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        console.error("Invalid dateString format received:", dateString);
        return { monthIndex: NaN, year: NaN };
    }
    try {
        const parts = dateString.split('-');
        const year = parseInt(parts[0], 10);
        const monthIndex = parseInt(parts[1], 10) - 1;
        if (isNaN(year) || isNaN(monthIndex) || monthIndex < 0 || monthIndex > 11) {
             console.error("Parsed date parts are invalid:", { year, monthIndex });
             return { monthIndex: NaN, year: NaN };
        }
        return { monthIndex, year };
    } catch (e) {
         console.error("Error parsing date string:", dateString, e);
         return { monthIndex: NaN, year: NaN };
    }
};

export const formatDateToLocalYYYYMMDD = (date) => {
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