// ==========================================
// BACKEND - LOA THÔNG BÁO THANH TOÁN
// MOCK BANK + ORDER + QR + WEBHOOK
// ==========================================

const express = require("express");

const path = require("path");

const os = require("os");

const crypto = require("crypto");
const { issueToken, verifyToken } = require("./auth-tokens");


// ==========================================
// MODULES
// ==========================================

const {
    getProducts,
    createProduct,
    updateProduct,
    deleteProduct,
    createOrder,
    getOrderById,
    getOrderByToken,
    getAllOrders,
    getOrdersByCustomerId,
    recordPayment,
    recordCashPayment,
    publicOrder
} = require("./orders");

const { registerCustomer, loginCustomer, loginAdmin } = require("./auth");


const {
    createQRCode
} = require("./qr");


const {
    speakTransaction
} = require("./tts");


const {
    login,
    loginBankAdmin,
    getSafeAccount,
    getPaymentAccounts,
    getPaymentAccountSettings,
    setPaymentAccount,
    getBankAccountById,
    getAccountByUsername,
    updateBankAccountProfile,
    changeBankAccountPassword,
    getTransactions,
    getAllTransactions,
    transferFunds,
    settleOrderPayment,
    setOrderPaymentSettlementStatus,
    reverseOrderPaymentSettlement,
    getAllSafeAccounts,
    createBankAccount,
    registerBankAccount,
    deactivateBankAccount,
    adjustAccountBalance
} = require("./bank");


// ==========================================
// EXPRESS
// ==========================================

const app = express();
app.set("trust proxy", 1);

const PORT = Number(process.env.PORT) || 4000;


// ==========================================
// MIDDLEWARE
// ==========================================

app.use(
    express.json()
);


app.use(
    express.urlencoded({
        extended: true
    })
);


// ==========================================
// API ACCESS FROM FIREBASE HOSTING / RENDER
// ==========================================
const allowedOrigins = new Set(
    (process.env.FRONTEND_ORIGINS || "https://loathongbaochuyenkhoan-aaab1.web.app,https://loathongbaochuyenkhoan-aaab1.firebaseapp.com,http://localhost:4000")
        .split(",").map(origin => origin.trim()).filter(Boolean)
);

app.use((req, res, next) => {
    const origin = req.get("Origin");
    if (origin && allowedOrigins.has(origin)) {
        res.set("Access-Control-Allow-Origin", origin);
        res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Order-Access-Token, Idempotency-Key");
        res.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
        res.vary("Origin");
    }
    if (req.method === "OPTIONS") return res.sendStatus(origin && allowedOrigins.has(origin) ? 204 : 403);
    next();
});


// ==========================================
// STATIC
// ==========================================

app.use(
    express.static(
        path.join(__dirname, "public")
    )
);


// ==========================================
// HÀM XÁC ĐỊNH BASE URL
// ==========================================
//
// Nếu sau này dùng Cloudflare Tunnel:
// PUBLIC_BASE_URL=https://abcxyz.trycloudflare.com
//
// Khi chưa có:
// http://localhost:4000
// ==========================================

function getBaseUrl(req) {

    if (process.env.PUBLIC_BASE_URL) {

        return process.env.PUBLIC_BASE_URL
            .replace(/\/$/, "");

    }


    const protocol =
        req.headers["x-forwarded-proto"]
        || req.protocol
        || "http";


    const host =
        req.headers["x-forwarded-host"]
        || req.get("host");


    return `${protocol}://${host}`;
}

// Used by Cloudflare Containers to confirm that Express is ready.
app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));


// ==========================================
// AUTH MIDDLEWARE
// ==========================================

// Stateless bearer authentication is used because the Firebase and Render
// hostnames are different sites and cross-site cookies are not dependable.
function requireBankApi(req, res, next) { return authenticateRole("bank")(req, res, next); }
function requireBankAdminApi(req, res, next) { return authenticateRole("bank-admin")(req, res, next); }
function requireCustomerApi(req, res, next) { return authenticateRole("customer")(req, res, next); }
function requireAdminApi(req, res, next) { return authenticateRole("admin")(req, res, next); }
function authenticateRole(role) {
    return (req, res, next) => {
        const match = /^Bearer\s+(.+)$/i.exec(req.get("Authorization") || "");
        const auth = match ? verifyToken(match[1]) : null;
        if (!auth || auth.role !== role) {
            return res.status(401).json({ success: false, message: "Phiên đăng nhập hết hạn hoặc không hợp lệ.", code: `${role.toUpperCase()}_LOGIN_REQUIRED` });
        }
        req.auth = auth;
        if (role === "bank") {
            getAccountByUsername(auth.data).then(account => {
                if (!account || account.active === false) {
                    return res.status(401).json({ success: false, message: "Tài khoản ngân hàng không còn hoạt động.", code: "BANK_LOGIN_REQUIRED" });
                }
                next();
            }).catch(error => {
                console.error("Không xác minh được trạng thái tài khoản ngân hàng:", error);
                res.status(503).json({ success: false, message: "Không thể xác minh tài khoản ngân hàng." });
            });
            return;
        }
        next();
    };
}

function optionalAuth(req, res, next) {
    const match = /^Bearer\s+(.+)$/i.exec(req.get("Authorization") || "");
    req.auth = match ? verifyToken(match[1]) : null;
    next();
}


// ==========================================
// TRANG CHÍNH
// ==========================================

app.get("/", (req, res) => {

    res.redirect("/shop/");

});

app.get("/shop", (req, res) => res.redirect("/shop/"));
app.get("/shop/checkout.html", (req, res) => res.sendFile(path.join(__dirname, "public", "shop", "checkout.html")));
app.get("/admin/login", (req, res) => res.sendFile(path.join(__dirname, "public", "admin", "login.html")));
app.get("/admin/orders", (req, res) => res.sendFile(path.join(__dirname, "public", "admin", "orders.html")));
app.get("/admin/products", (req, res) => res.sendFile(path.join(__dirname, "public", "admin", "products.html")));
app.get("/admin/payment-settings", (req, res) => res.sendFile(path.join(__dirname, "public", "admin", "payment-settings.html")));
app.get("/admin/balance", (_req, res) => res.redirect("/bank/admin/balance"));
app.get("/bank/admin/balance", (_req, res) => res.sendFile(path.join(__dirname, "public", "bank", "admin-balance.html")));

app.post("/api/customer/register", async (req, res) => {
    try {
        const customer = await registerCustomer(req.body || {});
        const profile = { uid: customer.uid, name: customer.name, email: customer.email };
        res.status(201).json({ success: true, customer, token: issueToken("customer", profile) });
    } catch (error) {
        const validation = /Email|Tên cần|Mật khẩu|đã được đăng ký/.test(error.message);
        res.status(validation ? (error.message.includes("đã được đăng ký") ? 409 : 400) : 500).json({ success: false, message: validation ? error.message : "Không thể tạo tài khoản lúc này." });
    }
});

app.post("/api/customer/login", async (req, res) => {
    try {
        const customer = await loginCustomer(req.body || {});
        if (!customer) return res.status(401).json({ success: false, message: "Email hoặc mật khẩu không đúng." });
        const profile = { uid: customer.uid, name: customer.name, email: customer.email };
        res.json({ success: true, customer, token: issueToken("customer", profile) });
    } catch (error) {
        const validation = /Email không hợp lệ/.test(error.message);
        res.status(validation ? 400 : 500).json({ success: false, message: validation ? error.message : "Không thể đăng nhập lúc này." });
    }
});

app.get("/api/customer/me", requireCustomerApi, (req, res) => res.json({ success: true, customer: req.auth.data }));
app.get("/api/customer/orders", requireCustomerApi, async (req, res) => {
    try {
        res.json({ success: true, orders: await getOrdersByCustomerId(req.auth.data.uid) });
    } catch (error) {
        console.error("Lỗi tải đơn của khách hàng:", error);
        res.status(503).json({ success: false, message: "Không thể tải đơn hàng." });
    }
});
app.post("/api/customer/logout", (_req, res) => res.json({ success: true }));

app.post("/api/admin/login", async (req, res) => {
    try {
        const admin = loginAdmin(req.body || {});
        if (!admin) return res.status(401).json({ success: false, message: "Tên đăng nhập hoặc mật khẩu không đúng." });
        res.json({ success: true, username: admin.username, token: issueToken("admin", admin.username) });
    } catch (error) {
        res.status(503).json({ success: false, message: error.message });
    }
});
app.get("/api/admin/me", requireAdminApi, (req, res) => res.json({ success: true, username: req.auth.data }));
app.post("/api/admin/logout", (_req, res) => res.json({ success: true }));
app.get("/api/admin/payment-settings", requireAdminApi, async (_req, res) => {
    try {
        const [accounts, settings] = await Promise.all([getPaymentAccounts(), getPaymentAccountSettings()]);
        res.json({ success: true, accounts, settings });
    } catch (error) {
        console.error("Không tải được tài khoản nhận thanh toán:", error);
        res.status(503).json({ success: false, message: "Không thể tải danh sách tài khoản MockBank." });
    }
});
app.put("/api/admin/payment-settings", requireAdminApi, async (req, res) => {
    try {
        const settings = await setPaymentAccount(req.body?.accountId, req.auth.data);
        res.json({ success: true, settings });
    } catch (error) {
        res.status(/Không tìm thấy tài khoản|Không thể chọn|Hãy chọn|chưa có thông tin/.test(error.message) ? 400 : 503)
            .json({ success: false, message: error.message || "Không thể lưu tài khoản nhận tiền." });
    }
});
app.get("/api/bank/admin/accounts", requireBankAdminApi, async (_req, res) => {
    try {
        res.json({ success: true, accounts: await getAllSafeAccounts() });
    } catch (error) {
        console.error("Không tải được tài khoản ngân hàng:", error);
        res.status(503).json({ success: false, message: "Không tải được danh sách tài khoản." });
    }
});
app.get("/api/bank/admin/transactions", requireBankAdminApi, async (_req, res) => {
    try {
        res.json({ success: true, transactions: await getAllTransactions() });
    } catch (error) {
        console.error("Khong tai duoc lich su giao dich ngan hang:", error);
        res.status(503).json({ success: false, message: "Khong tai duoc lich su giao dich." });
    }
});
app.post("/api/bank/admin/accounts", requireBankAdminApi, async (req, res) => {
    try {
        const account = await createBankAccount(req.body || {}, req.auth.data);
        res.status(201).json({ success: true, account });
    } catch (error) {
        const conflict = /đã được sử dụng/.test(error.message);
        const validation = /Tên cần|Tên đăng nhập|Mật khẩu|Số tài khoản|Số dư ban đầu/.test(error.message);
        res.status(conflict ? 409 : validation ? 400 : 503).json({ success: false, message: conflict || validation ? error.message : "Không thể tạo tài khoản." });
    }
});
app.delete("/api/bank/admin/accounts/:id", requireBankAdminApi, async (req, res) => {
    try {
        await deactivateBankAccount(req.params.id, req.auth.data);
        res.json({ success: true });
    } catch (error) {
        const missing = /Không tìm thấy tài khoản/.test(error.message);
        const conflict = /Tài khoản đã bị xóa/.test(error.message);
        res.status(missing ? 404 : conflict ? 409 : 503).json({ success: false, message: missing || conflict ? error.message : "Không thể xóa tài khoản." });
    }
});
app.post("/api/bank/admin/accounts/:id/balance", requireBankAdminApi, async (req, res) => {
    try {
        const { direction, amount } = req.body || {};
        const result = await adjustAccountBalance(req.params.id, direction, amount, req.auth.data);
        res.json({ success: true, ...result });
    } catch (error) {
        const validation = /Số tiền|Loại điều chỉnh|Số dư không đủ|Không tìm thấy tài khoản|Tài khoản đã bị vô hiệu hóa/.test(error.message);
        res.status(validation ? 400 : 503).json({ success: false, message: validation ? error.message : "Không thể điều chỉnh số dư." });
    }
});

// MOCK BANK - LOGIN
// ==========================================

app.get("/bank/login", (req, res) => {
    res.sendFile(
        path.join(
            __dirname,
            "public",
            "bank",
            "login.html"
        )
    );

});


// ==========================================
// MOCK BANK - DASHBOARD
// ==========================================

app.get(
    "/bank/dashboard",
    async (req, res) => {

        res.sendFile(
            path.join(
                __dirname,
                "public",
                "bank",
                "dashboard.html"
            )
        );

    }
);
app.get("/bank/user/login", (_req, res) => res.redirect("/bank/login"));
app.get("/bank/admin/login", (_req, res) => res.sendFile(path.join(__dirname, "public", "bank", "admin-login.html")));


// ==========================================
// MOCK BANK - SCANNER
// ==========================================

app.get(
    "/bank/scanner",
    (req, res) => {

        res.sendFile(
            path.join(
                __dirname,
                "public",
                "bank",
                "scanner.html"
            )
        );

    }
);


// ==========================================
// MOCK BANK - PAYMENT
// ==========================================

app.get(
    "/bank/payment",
    (req, res) => {

        res.sendFile(
            path.join(
                __dirname,
                "public",
                "bank",
                "payment.html"
            )
        );

    }
);


// ==========================================
// API LOGIN
// ==========================================

app.post(
    "/api/bank/login",
    async (req, res) => {

        const {
            username,
            password
        } = req.body;


        if (!username || !password) {

            return res.status(400).json({

                success: false,

                message:
                    "Vui lòng nhập tài khoản và mật khẩu."

            });
        }


        const account =
            await login(
                username,
                password
            );


        if (!account) {

            return res.status(401).json({

                success: false,

                message:
                    "Tên đăng nhập hoặc mật khẩu không đúng."

            });
        }


        return res.json({
            success: true,
            token: issueToken("bank", account.username),
            account: getSafeAccount(account)
        });


        res.json({

            success: true,

            account:
                getSafeAccount(account)

        });

    }
);

app.post("/api/bank/admin/login", (req, res) => {
    const admin = loginBankAdmin((req.body || {}).username, (req.body || {}).password);
    if (!admin) return res.status(401).json({ success: false, message: "Tên đăng nhập hoặc mật khẩu admin không đúng." });
    res.json({ success: true, token: issueToken("bank-admin", admin.username), role: "bank-admin" });
});

app.post("/api/bank/register", async (req, res) => {
    try {
        const account = await registerBankAccount(req.body || {});
        res.status(201).json({ success: true, account, token: issueToken("bank", account.username) });
    } catch (error) {
        const conflict = /đã được sử dụng/.test(error.message);
        const validation = /Tên cần|Tên đăng nhập|Mật khẩu|Số tài khoản phải/.test(error.message);
        res.status(conflict ? 409 : validation ? 400 : 503).json({
            success: false,
            message: conflict || validation ? error.message : "Không thể tạo tài khoản lúc này."
        });
    }
});


// ==========================================
// API LOGOUT
// ==========================================

app.post("/api/bank/logout", (_req, res) => res.json({ success: true }));

// API ACCOUNT
// ==========================================

app.get(
    "/api/bank/account",
    requireBankApi,
    async (req, res) => {

        const account =
            await getAccountByUsername(
                req.auth.data
            );


        if (!account) {

            return res.status(404).json({

                success: false,

                message:
                    "Không tìm thấy tài khoản."

            });
        }


        res.json({

            success: true,

            account:
                getSafeAccount(account)

        });

    }
);

app.patch("/api/bank/account/profile", requireBankApi, async (req, res) => {
    try {
        const account = await updateBankAccountProfile(req.auth.data, req.body || {});
        res.json({ success: true, account, token: issueToken("bank", account.username) });
    } catch (error) {
        const conflict = /đã được sử dụng/.test(error.message);
        const notFound = /Không tìm thấy tài khoản đang hoạt động/.test(error.message);
        const validation = /Họ tên|Tên đăng nhập phải/.test(error.message);
        res.status(conflict ? 409 : notFound ? 404 : validation ? 400 : 503).json({
            success: false,
            message: conflict || notFound || validation ? error.message : "Không thể cập nhật thông tin tài khoản."
        });
    }
});

app.post("/api/bank/account/password", requireBankApi, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body || {};
        const result = await changeBankAccountPassword(req.auth.data, currentPassword, newPassword);
        res.json({ success: true, token: issueToken("bank", result.username) });
    } catch (error) {
        const notFound = /Không tìm thấy tài khoản đang hoạt động/.test(error.message);
        const invalidCurrent = /Mật khẩu hiện tại không đúng/.test(error.message);
        const validation = /Mật khẩu mới/.test(error.message);
        const conflict = /Thông tin đăng nhập vừa thay đổi/.test(error.message);
        res.status(notFound ? 404 : conflict ? 409 : invalidCurrent ? 401 : validation ? 400 : 503).json({
            success: false,
            message: notFound || conflict || invalidCurrent || validation ? error.message : "Không thể đổi mật khẩu."
        });
    }
});


// ==========================================
// API BANK TRANSACTIONS
// ==========================================

app.get(
    "/api/bank/transactions",
    requireBankApi,
    async (req, res) => {

        res.json({

            success: true,

            transactions:
                await getTransactions(
                    req.auth.data
                )

        });

    }
);

app.post("/api/bank/transfer", requireBankApi, async (req, res) => {
    try {
        const { recipientAccountNumber, amount, content } = req.body || {};
        const result = await transferFunds(req.auth.data, recipientAccountNumber, amount, content);
        res.json({ success: true, ...result });
    } catch (error) {
        const validation = /Số tiền|Số tài khoản nhận|Tài khoản gửi|Tài khoản nhận|Không tìm thấy tài khoản|Không thể chuyển tiền|Số dư không đủ|vượt giới hạn/.test(error.message);
        res.status(validation ? 400 : 503).json({ success: false, message: validation ? error.message : "Không thể thực hiện chuyển khoản lúc này." });
    }
});


// ==========================================
// TẠO ĐƠN HÀNG
// ==========================================

app.get("/api/products", async (req, res) => {
    try {
        res.json({ success: true, products: await getProducts() });
    } catch (error) {
        console.error("Lỗi tải sản phẩm:", error);
        res.status(503).json({ success: false, message: "Không thể tải danh sách sản phẩm." });
    }
});

app.post(
    "/api/orders",
    optionalAuth,
    async (req, res) => {

        try {

            const { items, product, amount, tableId } = req.body || {};
            const idempotencyKey = req.get("Idempotency-Key");
            if ((!Array.isArray(items) || items.length === 0) && !product) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Giỏ hàng đang trống."

                });
            }


            // ------------------------------
            // Tạo order
            // ------------------------------

            const order =
                createOrder(
                    items || product,
                    items ? undefined : amount,
                    req.auth?.role === "customer" ? req.auth.data : null,
                    tableId,
                    idempotencyKey,
                    req.body?.paymentMethod
                );
            const storedOrder = await order;


            // ------------------------------
            // URL thanh toán
            // ------------------------------

            const baseUrl =
                getBaseUrl(req);


            let paymentUrl = null;
            let qrCode = null;
            if (storedOrder.paymentMethod === "QR") {
                paymentUrl = `${baseUrl}/bank/payment?token=${storedOrder.qrToken}`;
                qrCode = await createQRCode(paymentUrl);
            }


            console.log(
                "\n======================================"
            );

            console.log(
                "ĐÃ TẠO ĐƠN HÀNG"
            );

            console.log(
                "Mã đơn:",
                storedOrder.orderId
            );

            console.log(
                "Sản phẩm:",
                storedOrder.items.map(item => `${item.name} × ${item.quantity}`).join(", ")
            );

            console.log(
                "Số tiền:",
                storedOrder.amount
            );

            console.log(
                "QR URL:",
                paymentUrl
            );

            console.log(
                "======================================\n"
            );


            res.json({

                success: true,

                order: publicOrder(storedOrder),

                orderAccessToken: storedOrder.orderAccessToken,

                qrCode,

                paymentUrl

            });


        } catch (error) {

            console.error(
                "Lỗi tạo đơn hàng:",
                error
            );


            const invalidRecipient = /Cửa hàng chưa cấu hình tài khoản nhận thanh toán|Tài khoản nhận thanh toán/.test(error.message);
            res.status(invalidRecipient ? 409 : 500).json({

                success: false,

                message:
                    invalidRecipient ? error.message : "Không thể tạo đơn hàng."

            });

        }

    }
);


// ==========================================
// DANH SÁCH ĐƠN
// ==========================================

app.get(
    "/api/orders",
    requireAdminApi,
    async (req, res) => {

        res.json({

            success: true,

            orders:
                await getAllOrders()

        });

    }
);


// ==========================================
// CHI TIẾT ĐƠN
// ==========================================

app.get(
    "/api/orders/:id",
    optionalAuth,
    async (req, res) => {

        const order =
            await getOrderById(
                req.params.id
            );


        if (!order) {

            return res.status(404).json({

                success: false,

                message:
                    "Không tìm thấy đơn hàng."

            });
        }

        const accessToken = req.get("X-Order-Access-Token") || "";
        const expectedToken = String(order.orderAccessToken || "");
        const accessBytes = Buffer.from(accessToken);
        const expectedBytes = Buffer.from(expectedToken);
        const hasOrderAccess = accessBytes.length === expectedBytes.length && accessBytes.length > 0 && crypto.timingSafeEqual(accessBytes, expectedBytes);
        if (order.customerId && (!req.auth || !["customer", "admin"].includes(req.auth.role))) {
            return res.status(401).json({ success: false, message: "Đăng nhập để xem đơn hàng." });
        }
        if (!order.customerId && req.auth?.role !== "admin" && !hasOrderAccess) {
            return res.status(401).json({ success: false, message: "Không có quyền xem đơn hàng này." });
        }

        if (req.auth?.role === "customer" && order.customerId !== req.auth.data.uid) {
            return res.status(404).json({ success: false, message: "Không tìm thấy đơn hàng." });
        }


        res.json({

            success: true,

            order: publicOrder(order)

        });

    }
);


// ==========================================
// API LẤY THÔNG TIN THANH TOÁN
// ==========================================

app.get("/api/admin/orders", requireAdminApi, async (req, res) => {
    try {
        res.json({ success: true, orders: await getAllOrders() });
    } catch (error) {
        console.error("Lỗi tải danh sách đơn:", error);
        res.status(503).json({ success: false, message: "Không thể tải danh sách đơn hàng." });
    }
});

app.post("/api/admin/orders/:id/cash-payment", requireAdminApi, async (req, res) => {
    try {
        const result = await recordCashPayment(req.params.id, req.auth.data);
        if (result.error === "ORDER_NOT_FOUND") return res.status(404).json({ success: false, message: "Không tìm thấy đơn hàng." });
        if (result.error === "CASH_NOT_SELECTED") return res.status(400).json({ success: false, message: "Đơn hàng không chọn thanh toán tiền mặt." });
        if (result.error === "ORDER_ALREADY_PAID") return res.status(409).json({ success: false, message: "Đơn hàng đã được thanh toán." });
        res.json({ success: true, order: result.order });
    } catch (error) {
        console.error("Lỗi xác nhận tiền mặt:", error);
        res.status(503).json({ success: false, message: "Không thể xác nhận thanh toán tiền mặt." });
    }
});

app.get("/api/admin/products", requireAdminApi, async (req, res) => {
    try {
        res.json({ success: true, products: await getProducts() });
    } catch (error) {
        console.error("Lỗi tải sản phẩm quản trị:", error);
        res.status(503).json({ success: false, message: "Không thể tải sản phẩm." });
    }
});

app.post("/api/admin/products", requireAdminApi, async (req, res) => {
    try {
        res.status(201).json({ success: true, product: await createProduct(req.body || {}) });
    } catch (error) {
        const validation = /Tên sản phẩm|Giá phải|Danh mục|Ảnh phải/.test(error.message);
        res.status(validation ? 400 : 500).json({ success: false, message: validation ? error.message : "Không thể tạo sản phẩm." });
    }
});

app.put("/api/admin/products/:id", requireAdminApi, async (req, res) => {
    try {
        const product = await updateProduct(req.params.id, req.body || {});
        if (!product) return res.status(404).json({ success: false, message: "Không tìm thấy sản phẩm." });
        res.json({ success: true, product });
    } catch (error) {
        const validation = /Mã sản phẩm|Tên sản phẩm|Giá phải|Danh mục|Ảnh phải/.test(error.message);
        res.status(validation ? 400 : 500).json({ success: false, message: validation ? error.message : "Không thể cập nhật sản phẩm." });
    }
});

app.delete("/api/admin/products/:id", requireAdminApi, async (req, res) => {
    try {
        if (!await deleteProduct(req.params.id)) return res.status(404).json({ success: false, message: "Không tìm thấy sản phẩm." });
        res.json({ success: true });
    } catch (error) {
        res.status(/Mã sản phẩm/.test(error.message) ? 400 : 500).json({ success: false, message: error.message });
    }
});

app.get(
    "/api/bank/payment/:token",
    requireBankApi,
    async (req, res) => {

        const order =
            await getOrderByToken(
                req.params.token
            );


        if (!order) {

            return res.status(404).json({

                success: false,

                message:
                    "Mã QR không hợp lệ."

            });
        }


        if (order.status === "PAID") {

            return res.status(400).json({

                success: false,

                message:
                    "Đơn hàng này đã được thanh toán."

            });
        }

        if (!order.recipientAccountId || !order.recipientAccountNumber || !order.recipientName) {
            return res.status(409).json({ success: false, message: "Đơn hàng này chưa có tài khoản nhận thanh toán được lưu. Vui lòng liên hệ nhân viên để tạo đơn mới." });
        }
        const recipientAccount = await getBankAccountById(order.recipientAccountId);
        if (!recipientAccount || recipientAccount.active === false || recipientAccount.accountNumber !== order.recipientAccountNumber) {
            return res.status(409).json({ success: false, message: "Tài khoản nhận thanh toán của đơn hàng đã bị khóa hoặc không còn hợp lệ. Vui lòng liên hệ nhân viên." });
        }


        const account =
            await getAccountByUsername(
                req.auth.data
            );


        res.json({

            success: true,

            order: {

                orderId:
                    order.orderId,

                items:
                    order.items,

                amount:
                    order.amount,

                status:
                    order.status

            },

            recipient: {
                id: order.recipientAccountId,
                bankName: order.recipientBankName || "MockBank",
                accountNumber: order.recipientAccountNumber,
                name: order.recipientName
            },

            account:
                getSafeAccount(account)

        });

    }
);


// ==========================================
// MOCK BANK THANH TOÁN
// ==========================================

app.post("/api/bank/pay", requireBankApi, async (req, res) => {
    const token = req.body?.token;
    if (!token) return res.status(400).json({ success: false, message: "Thiếu mã QR." });
    try {
        const order = await getOrderByToken(token);
        if (!order) return res.status(404).json({ success: false, message: "Không tìm thấy đơn hàng." });
        if (order.status === "PAID") return res.status(409).json({ success: false, message: "Đơn hàng đã được thanh toán." });
        if (!order.recipientAccountId || !order.recipientAccountNumber || !order.recipientName) {
            return res.status(409).json({ success: false, message: "Đơn hàng này không có tài khoản nhận thanh toán đã lưu. Vui lòng liên hệ nhân viên." });
        }

        const username = req.auth.data;
        const account = await getAccountByUsername(username);
        if (!account) return res.status(401).json({ success: false, message: "Tài khoản không tồn tại." });
        const transactionId = `GD${Date.now()}${crypto.randomBytes(6).toString("hex")}`;
        const content = `Thanh toan ${order.orderId}`;
        const settlement = await settleOrderPayment({
            senderUsername: username,
            recipientAccountId: order.recipientAccountId,
            recipientAccountNumber: order.recipientAccountNumber,
            amount: order.amount,
            orderId: order.orderId,
            transactionId,
            content
        });
        const transaction = {
            transactionId,
            transferId: settlement.transferId,
            orderId: order.orderId,
            sender: account.name,
            senderAccount: account.accountNumber,
            recipientAccountId: order.recipientAccountId,
            recipientAccountNumber: order.recipientAccountNumber,
            recipientName: order.recipientName,
            recipientBankName: order.recipientBankName || "MockBank",
            amount: Number(order.amount),
            content,
            timestamp: new Date().toISOString()
        };

        try {
            const webhookResponse = await fetch(`http://127.0.0.1:${PORT}/webhook/bank`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-mock-bank-secret": process.env.MOCK_BANK_WEBHOOK_SECRET || "" },
                body: JSON.stringify(transaction)
            });
            const webhookData = await webhookResponse.json();
            if (!webhookResponse.ok || !webhookData.success) throw new Error("Webhook không xác nhận giao dịch.");
        } catch (error) {
            console.error("Lỗi webhook:", error);
            const latestOrder = await getOrderById(order.orderId);
            if (latestOrder?.status === "PAID") {
                await setOrderPaymentSettlementStatus(order.orderId, "COMPLETED");
            } else {
                const reversal = await reverseOrderPaymentSettlement(order.orderId);
                if (!reversal.success) {
                    console.error("Không hoàn tác được chuyển khoản đơn hàng:", reversal.error);
                    return res.status(503).json({ success: false, message: "Giao dịch chưa được xác nhận và cần nhân viên kiểm tra hoàn tiền." });
                }
                return res.status(500).json({ success: false, message: "Không thể xác nhận giao dịch; tiền đã được hoàn lại." });
            }
        }

        try {
            await setOrderPaymentSettlementStatus(order.orderId, "COMPLETED");
        } catch (error) {
            console.error("Không cập nhật được lịch sử thanh toán:", error.message);
        }
        const updatedAccount = await getAccountByUsername(username);
        res.json({ success: true, message: "Thanh toán thành công.", transaction, balance: updatedAccount?.balance ?? settlement.balance });
    } catch (error) {
        const clientError = /Số dư không đủ|Tài khoản gửi|Tài khoản nhận|Không thể thanh toán|đang được xử lý|đã được thanh toán|không còn hoạt động|không khớp|vượt giới hạn/.test(error.message);
        res.status(clientError ? 400 : 503).json({ success: false, message: clientError ? error.message : "Không thể thực hiện thanh toán lúc này." });
    }
});


// ==========================================
// WEBHOOK BANK
// ==========================================

app.post(
    "/webhook/bank",
    async (req, res) => {

        try {

            const webhookSecret = process.env.MOCK_BANK_WEBHOOK_SECRET;
            const providedSecret = req.get("x-mock-bank-secret") || "";
            if (!webhookSecret) {
                return res.status(503).json({ success: false, message: "Webhook secret is not configured." });
            }
            const providedBytes = Buffer.from(providedSecret);
            const expectedBytes = Buffer.from(webhookSecret);
            if (providedBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(providedBytes, expectedBytes)) {
                return res.status(401).json({ success: false, message: "Webhook authentication failed." });
            }

            const transaction =
                req.body;

            if (!transaction || typeof transaction !== "object" || Array.isArray(transaction)) {
                return res.status(400).json({ success: false, message: "Payload giao dịch không hợp lệ." });
            }
            if (!transaction.orderId && typeof transaction.content === "string") {
                // Nhận mã mới (2 chữ + 4 số) và các mã DH đã phát hành trước đây.
                transaction.orderId = (transaction.content.match(/(?:[A-Z]{2}\d{4}|DH(?:[A-F0-9]{12}|\d{6}[A-F0-9]{16}))/i) || [])[0];
            }


            console.log(
                "\n======================================"
            );

            console.log(
                "NHẬN GIAO DỊCH TỪ MOCK BANK"
            );

            console.log(
                "======================================"
            );

            console.log(
                "Mã giao dịch :",
                transaction.transactionId
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
                "Đơn hàng     :",
                transaction.orderId
            );

            console.log(
                "Thời gian    :",
                transaction.timestamp
            );

            console.log(
                "======================================\n"
            );


            // ------------------------------
            // Kiểm tra dữ liệu
            // ------------------------------

            if (
                typeof transaction.transactionId !== "string"
                || !transaction.transactionId.trim()
                ||
                !transaction.orderId
                ||
                !Number.isSafeInteger(Number(transaction.amount))
                || Number(transaction.amount) <= 0
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Dữ liệu giao dịch không đầy đủ."

                });
            }


            // ------------------------------
            // Tìm order
            // ------------------------------

            const order =
                await getOrderById(
                    transaction.orderId
                );


            if (!order) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Không tìm thấy đơn hàng."

                });
            }

            if (order.recipientAccountId) {
                const recipientAccount = await getBankAccountById(order.recipientAccountId);
                const recipientMatches = recipientAccount
                    && recipientAccount.active !== false
                    && recipientAccount.accountNumber === order.recipientAccountNumber
                    && (!transaction.recipientAccountId || String(transaction.recipientAccountId) === String(order.recipientAccountId))
                    && (!transaction.recipientAccountNumber || String(transaction.recipientAccountNumber) === String(order.recipientAccountNumber))
                    && (!transaction.recipientBankName || String(transaction.recipientBankName) === String(order.recipientBankName || "MockBank"))
                    && (!transaction.content || String(transaction.content) === `Thanh toan ${order.orderId}`);
                if (!recipientMatches) {
                    return res.status(400).json({ success: false, message: "Tài khoản nhận hoặc nội dung giao dịch không khớp mã QR của đơn hàng." });
                }
            }


            // ------------------------------
            // Đã thanh toán
            // ------------------------------

            // ------------------------------
            // Kiểm tra số tiền
            // ------------------------------

            if (
                Number(transaction.amount)
                !==
                Number(order.amount)
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Số tiền giao dịch không khớp."

                });
            }


            // ------------------------------
            // Đánh dấu PAID
            // ------------------------------

            const paymentResult = await recordPayment(order.orderId, transaction);
            if (paymentResult.error) {
                const status = paymentResult.error === "ORDER_NOT_FOUND" ? 404 : 409;
                return res.status(status).json({ success: false, message: paymentResult.error });
            }
            const updatedOrder = paymentResult.order;


            console.log(
                `Đơn hàng ${order.orderId} đã thanh toán thành công.`
            );


            // ------------------------------
            // TTS
            // ------------------------------

            try {

                if (!paymentResult.alreadyProcessed && process.env.TTS_MODE === "queue") {
                    console.log(`[TTS] Đã xếp thông báo ${paymentResult.notificationId} vào Firestore cho Raspberry Pi.`);
                } else if (!paymentResult.alreadyProcessed) {
                    await speakTransaction(transaction);
                }

            } catch (ttsError) {

                console.error(
                    "Lỗi TTS:",
                    ttsError
                );

            }


            res.json({

                success: true,

                message:
                    "Webhook xử lý thành công.",

                order:
                    updatedOrder,
                alreadyProcessed: paymentResult.alreadyProcessed

            });


        } catch (error) {

            console.error(
                "Lỗi webhook:",
                error
            );


            res.status(500).json({

                success: false,

                message:
                    "Lỗi xử lý webhook."

            });

        }

    }
);


// ==========================================
// SERVER
// ==========================================

function getStartupBases() {
    const bases = new Set();
    if (process.env.RENDER_EXTERNAL_URL) {
        bases.add(process.env.RENDER_EXTERNAL_URL.replace(/\/$/, ""));
        return [...bases];
    }
    if (process.env.PUBLIC_BASE_URL) bases.add(process.env.PUBLIC_BASE_URL.replace(/\/$/, ""));
    bases.add(`http://localhost:${PORT}`);
    for (const addresses of Object.values(os.networkInterfaces())) {
        for (const address of addresses || []) {
            if (address.family === "IPv4" && !address.internal) bases.add(`http://${address.address}:${PORT}`);
        }
    }
    return [...bases];
}

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            "======================================"
        );

        console.log(
            " MOCK BANK PAYMENT SYSTEM"
        );

        console.log(
            "======================================"
        );

        for (const base of getStartupBases()) {
            console.log(`Web Order:       ${base}/shop/`);
            console.log(`Checkout mẫu:    ${base}/shop/checkout.html?order=[ORDER_ID]`);
            console.log(`Mock Bank:       ${base}/bank/login`);
            console.log(`Dashboard Bank:  ${base}/bank/dashboard (cần đăng nhập)`);
            console.log(`Quét QR:         ${base}/bank/scanner (cần đăng nhập)`);
            console.log(`Xác nhận trả tiền:${base}/bank/payment?token=[QR_TOKEN]`);
            console.log(`Admin đăng nhập: ${base}/admin/login`);
            console.log(`Quản lý đơn:     ${base}/admin/orders (admin)`);
            console.log(`Quản lý sản phẩm:${base}/admin/products (admin)`);
            console.log(`Webhook API:     ${base}/webhook/bank`);
            console.log("--------------------------------------");
        }

        const bankAdminBase = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
        console.log(`Admin ngân hàng: ${bankAdminBase}/bank/admin/balance`);

        console.log(
            "======================================"
        );

        console.log(
            "Tai khoan demo:"
        );

        console.log(
            "Username: nguyenvana"
        );

        console.log(
            "Password: 123456"
        );

        console.log(
            "======================================\n"
        );

    }
);
