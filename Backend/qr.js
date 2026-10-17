// ==========================================
// TẠO QR CODE
// ==========================================

const QRCode = require("qrcode");

async function createQRCode(url) {

    try {

        const qrData = await QRCode.toDataURL(url, {

            width: 300,
            margin: 2

        });

        return qrData;

    } catch (error) {

        console.error("Lỗi tạo QR:", error);

        throw error;
    }
}


module.exports = {
    createQRCode
};