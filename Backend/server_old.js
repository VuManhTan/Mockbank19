// ==========================================
// BACKEND LOA THÔNG BÁO CHUYỂN KHOẢN
// ==========================================

const express = require("express");
const path = require("path");

const {
    createOrder,
    getOrderById,
    getOrderByToken,
    getAllOrders,
    markOrderAsPaid
} = require("./orders");

const {
    createQRCode
} = require("./qr");

// TTS hiện tại của bạn
const {
    speakTransaction
} = require("./tts");


const app = express();

const PORT = 4000;


// ==========================================
// MIDDLEWARE
// ==========================================

app.use(express.json());

app.use(express.urlencoded({
    extended: true
}));


// ==========================================
// PUBLIC
// ==========================================

app.use(express.static(
    path.join(__dirname, "public")
));


// ==========================================
// TRANG CHÍNH
// ==========================================

app.get("/", (req, res) => {

    res.sendFile(
        path.join(__dirname, "public", "index.html")
    );

});


// ==========================================
// 1. TẠO ĐƠN HÀNG
// ==========================================

app.post("/api/orders", async (req, res) => {

    try {

        const {
            product,
            amount
        } = req.body;


        // Kiểm tra dữ liệu
        if (!product) {

            return res.status(400).json({
                success: false,
                message: "Chưa nhập tên sản phẩm"
            });

        }


        if (!amount || Number(amount) <= 0) {

            return res.status(400).json({
                success: false,
                message: "Số tiền không hợp lệ"
            });

        }


        // Tạo đơn
        const order = createOrder(
            product,
            amount
        );


        // URL thanh toán
        const host =
            `${req.protocol}://${req.get("host")}`;

        const paymentUrl =
            `${host}/pay/${order.qrToken}`;


        // Tạo QR
        const qrCode =
            await createQRCode(paymentUrl);


        console.log("");
        console.log("======================================");
        console.log("          TẠO ĐƠN HÀNG");
        console.log("======================================");

        console.log("Mã đơn      :", order.orderId);
        console.log("Sản phẩm    :", order.product);
        console.log("Số tiền     :", order.amount);
        console.log("QR Token    :", order.qrToken);
        console.log("Payment URL :", paymentUrl);

        console.log("======================================");
        console.log("");


        res.json({

            success: true,

            order: order,

            paymentUrl: paymentUrl,

            qrCode: qrCode

        });


    } catch (error) {

        console.error(
            "Lỗi tạo đơn hàng:",
            error
        );

        res.status(500).json({

            success: false,

            message: "Không thể tạo đơn hàng"

        });

    }

});


// ==========================================
// 2. LẤY TẤT CẢ ĐƠN HÀNG
// ==========================================

app.get("/api/orders", (req, res) => {

    res.json({

        success: true,

        orders: getAllOrders()

    });

});


// ==========================================
// 3. LẤY ĐƠN HÀNG THEO ID
// ==========================================

app.get("/api/orders/:id", (req, res) => {

    const order =
        getOrderById(req.params.id);


    if (!order) {

        return res.status(404).json({

            success: false,

            message: "Không tìm thấy đơn hàng"

        });

    }


    res.json({

        success: true,

        order: order

    });

});


// ==========================================
// 4. TRANG THANH TOÁN
// ==========================================

app.get("/pay/:token", (req, res) => {

    const order =
        getOrderByToken(req.params.token);


    if (!order) {

        return res.status(404).send(`
            <h1>Không tìm thấy đơn hàng</h1>
        `);

    }


    res.sendFile(
        path.join(
            __dirname,
            "public",
            "payment.html"
        )
    );

});


// ==========================================
// 5. LẤY THÔNG TIN ĐƠN HÀNG CHO PAYMENT
// ==========================================

app.get("/api/payment/:token", (req, res) => {

    const order =
        getOrderByToken(req.params.token);


    if (!order) {

        return res.status(404).json({

            success: false,

            message: "Không tìm thấy đơn hàng"

        });

    }


    res.json({

        success: true,

        order: order

    });

});


// ==========================================
// 6. THANH TOÁN GIẢ LẬP
// ==========================================

app.post("/api/payment", async (req, res) => {

    try {

        const {
            token,
            sender
        } = req.body;


        // Tìm đơn
        const order =
            getOrderByToken(token);


        if (!order) {

            return res.status(404).json({

                success: false,

                message: "Không tìm thấy đơn hàng"

            });

        }


        // Kiểm tra đã thanh toán chưa
        if (order.status === "PAID") {

            return res.json({

                success: false,

                message: "Đơn hàng đã thanh toán"

            });

        }


        // Tên người gửi
        const senderName =
            sender || "Nguyen Van A";


        // Tạo mã giao dịch
        const transactionId =
            "GD" + Date.now();


        // Nội dung giao dịch
        const content =
            `Thanh toan ${order.orderId}`;


        const transaction = {

            transactionId: transactionId,

            orderId: order.orderId,

            sender: senderName,

            amount: order.amount,

            content: content,

            timestamp: new Date().toISOString()

        };


        console.log("");

        console.log("======================================");
        console.log("       THANH TOÁN GIẢ LẬP");
        console.log("======================================");

        console.log(
            "Mã giao dịch :",
            transaction.transactionId
        );

        console.log(
            "Mã đơn       :",
            transaction.orderId
        );

        console.log(
            "Người gửi    :",
            transaction.sender
        );

        console.log(
            "Số tiền      :",
            transaction.amount
        );

        console.log(
            "Nội dung     :",
            transaction.content
        );

        console.log(
            "Thời gian    :",
            transaction.timestamp
        );

        console.log("======================================");


        // ==================================
        // CẬP NHẬT ĐƠN HÀNG
        // ==================================

        const paidOrder =
            markOrderAsPaid(
                order.orderId,
                transaction
            );


        // ==================================
        // TTS
        // ==================================

        try {

            await speakTransaction(transaction);

        } catch (ttsError) {

            console.error(
                "[TTS] Lỗi:",
                ttsError.message
            );

        }


        res.json({

            success: true,

            message:
                "Thanh toán thành công",

            transaction: transaction,

            order: paidOrder

        });


    } catch (error) {

        console.error(
            "Lỗi thanh toán:",
            error
        );

        res.status(500).json({

            success: false,

            message:
                "Thanh toán thất bại"

        });

    }

});


// ==========================================
// 7. WEBHOOK BANK
// ==========================================
// Sau này Mock Bank thật sẽ gọi endpoint này.
// ==========================================

app.post("/webhook/bank", async (req, res) => {

    try {

        const transaction =
            req.body;


        console.log("");

        console.log("======================================");
        console.log("      NHẬN GIAO DỊCH TỪ MOCK BANK");
        console.log("======================================");

        console.log(
            "Mã giao dịch :",
            transaction.transactionId
        );

        console.log(
            "Mã đơn       :",
            transaction.orderId
        );

        console.log(
            "Người gửi    :",
            transaction.sender
        );

        console.log(
            "Số tiền      :",
            transaction.amount
        );

        console.log(
            "Nội dung     :",
            transaction.content
        );

        console.log(
            "Thời gian    :",
            transaction.timestamp
        );

        console.log("======================================");


        // Nếu Webhook có orderId
        if (transaction.orderId) {

            const order =
                getOrderById(
                    transaction.orderId
                );


            if (order) {

                const paidOrder =
                    markOrderAsPaid(
                        order.orderId,
                        transaction
                    );


                console.log(
                    "Đơn hàng",
                    order.orderId,
                    "đã thanh toán thành công."
                );


                // TTS
                try {

                    await speakTransaction(
                        transaction
                    );

                } catch (ttsError) {

                    console.error(
                        "[TTS] Lỗi:",
                        ttsError.message
                    );

                }


                return res.json({

                    success: true,

                    message:
                        "Backend đã nhận giao dịch",

                    order: paidOrder

                });

            }

        }


        res.json({

            success: true,

            message:
                "Backend đã nhận giao dịch"

        });


    } catch (error) {

        console.error(
            "Webhook error:",
            error
        );

        res.status(500).json({

            success: false,

            message:
                "Webhook error"

        });

    }

});


// ==========================================
// START SERVER
// ==========================================

app.listen(PORT, () => {

    console.log("");
    console.log("======================================");
    console.log("      BACKEND ĐANG CHẠY");
    console.log("======================================");

    console.log(
        `http://localhost:${PORT}`
    );

    console.log("======================================");
    console.log("");

});