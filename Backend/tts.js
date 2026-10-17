const path = require("path");
const { spawn } = require("child_process");


// =========================================================
// CẤU HÌNH
// =========================================================

// Thư mục Backend
const PROJECT_ROOT = path.resolve(__dirname, "..");

// File Python TTS
const TTS_SCRIPT = path.join(
    PROJECT_ROOT,
    "scripts",
    "speak.py"
);

// Windows
const PYTHON_COMMAND = "python";


// =========================================================
// HÀNG ĐỢI TTS
// =========================================================

let isPlaying = false;

const audioQueue = [];


// =========================================================
// TẠO CÂU THÔNG BÁO
// =========================================================

function createMessage(transaction) {

    const amount = Number(transaction.amount);

    // Kiểm tra số tiền
    if (!Number.isSafeInteger(amount) || amount <= 0) {

        throw new Error(
            "So tien giao dich khong hop le"
        );
    }

    // Format tiền Việt
    const amountText = amount.toLocaleString("vi-VN");

    return `Đã nhận được ${amountText} đồng.`;
}


// =========================================================
// THÊM THÔNG BÁO VÀO QUEUE
// =========================================================

function speakTransaction(transaction) {

    try {

        const message = createMessage(
            transaction
        );

        audioQueue.push(message);

        console.log(
            "[TTS] Đã thêm thông báo:",
            message
        );

        console.log(
            `[TTS] Số thông báo đang chờ: ${audioQueue.length}`
        );

        processQueue();

        return message;

    } catch (error) {

        // Không để TTS làm Backend crash
        console.error(
            "[TTS] Không thể tạo thông báo:",
            error.message
        );

        return null;
    }
}


// =========================================================
// XỬ LÝ QUEUE
// =========================================================

function processQueue() {

    // Đang phát → không chạy thêm
    if (isPlaying) {

        return;
    }

    // Không còn thông báo
    if (audioQueue.length === 0) {

        return;
    }

    isPlaying = true;

    // Lấy thông báo đầu tiên
    const message = audioQueue.shift();

    console.log("");
    console.log(
        "=========================================="
    );

    console.log(
        "[TTS] Đang đọc:"
    );

    console.log(
        message
    );

    console.log(
        "=========================================="
    );

    console.log("");


    // =====================================================
    // GỌI PYTHON
    // =====================================================

    const pythonProcess = spawn(
        PYTHON_COMMAND,
        [
            TTS_SCRIPT,
            message
        ],
        {
            stdio: "inherit",
            windowsHide: false
        }
    );


    // =====================================================
    // PYTHON KẾT THÚC
    // =====================================================

    pythonProcess.on(
        "close",
        (code) => {

            if (code === 0) {

                console.log(
                    "[TTS] Hoàn thành thông báo."
                );

            } else {

                console.error(
                    `[TTS] Phát âm thanh thất bại. Mã lỗi: ${code}`
                );

                console.error(
                    "[TTS] Giao dịch vẫn được giữ nguyên."
                );
            }

            // Cho phép thông báo tiếp theo chạy
            isPlaying = false;

            // Xử lý tiếp queue
            processQueue();
        }
    );


    // =====================================================
    // KHÔNG CHẠY ĐƯỢC PYTHON
    // =====================================================

    pythonProcess.on(
        "error",
        (error) => {

            console.error(
                "[TTS] Không thể chạy Python:",
                error.message
            );

            // Không làm Backend dừng
            isPlaying = false;

            // Tiếp tục giao dịch tiếp theo
            processQueue();
        }
    );
}


// =========================================================
// XEM TRẠNG THÁI QUEUE
// =========================================================

function getQueueStatus() {

    return {

        isPlaying: isPlaying,

        queueLength: audioQueue.length
    };
}


// =========================================================
// EXPORT
// =========================================================

module.exports = {

    speakTransaction,

    createMessage,

    getQueueStatus
};
