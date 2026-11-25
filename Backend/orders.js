const crypto = require("crypto");
const { db } = require("./firebase");

const products = [
    { id: "com-ga-chien-mam", name: "Cơm gà chiên mắm", category: "rice", categoryName: "Cơm", price: 45000, description: "Cơm trắng dẻo thơm ăn kèm đùi gà chiên giòn, phủ lớp nước mắm tỏi ớt đậm đà.", portion: "1 người", feature: "Mặn ngọt · giòn ngoài, mềm trong", tag: "BÁN CHẠY", imageUrl: "https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?auto=format&fit=crop&w=900&q=85", active: true },
    { id: "com-suon-nuong", name: "Cơm sườn nướng", category: "rice", categoryName: "Cơm", price: 40000, description: "Cơm trắng ăn kèm sườn heo nướng mật ong, dưa leo, cà chua và nước mắm chua ngọt.", portion: "1 người", feature: "Thơm mùi than nướng · đậm đà", tag: "MÓN QUEN", imageUrl: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=900&q=85", active: true },
    { id: "mi-xao-bo", name: "Mì xào bò", category: "noodles", categoryName: "Mì", price: 45000, description: "Mì xào nóng với thịt bò thái lát, cải xanh, cà rốt và hành tây.", portion: "1 người", feature: "Mì dai · bò mềm · rau củ tươi", tag: "NÓNG HỔI", imageUrl: "https://images.unsplash.com/photo-1569718212165-3a8278d5f624?auto=format&fit=crop&w=900&q=85", active: true },
    { id: "ga-ran-gion", name: "Gà rán giòn", category: "food", categoryName: "Món ăn", price: 35000, description: "Hai miếng gà tẩm bột chiên vàng, thịt bên trong mềm và giữ vị ngọt tự nhiên.", portion: "2 miếng", feature: "Giòn rụm · dùng kèm tương ớt hoặc tương cà", tag: "GIÒN RỤM", imageUrl: "https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?auto=format&fit=crop&w=900&q=85", active: true },
    { id: "tra-dao-cam-sa", name: "Trà đào cam sả", category: "drinks", categoryName: "Đồ uống", price: 25000, description: "Trà đào thanh mát kết hợp cam tươi, sả thơm và đào miếng.", portion: "500 ml", feature: "Chua ngọt nhẹ · thơm cam sả", tag: "THANH MÁT", imageUrl: "https://images.unsplash.com/photo-1556679343-c7306c1976bc?auto=format&fit=crop&w=900&q=85", active: true },
    { id: "ca-phe-sua-da", name: "Cà phê sữa đá", category: "drinks", categoryName: "Đồ uống", price: 20000, description: "Cà phê pha phin đậm vị kết hợp sữa đặc và đá.", portion: "500 ml", feature: "Đậm đà · béo nhẹ", tag: "PHA PHIN", imageUrl: "https://images.unsplash.com/photo-1461023058943-07fcbe16d735?auto=format&fit=crop&w=900&q=85", active: true }
];

let menuProductsEnsured = false;
async function ensureMenuProducts() {
    if (menuProductsEnsured) return;
    const collection = db.collection("products");
    const marker = db.collection("appSettings").doc("restaurantMenuSeedV1");
    await db.runTransaction(async transaction => {
        const markerSnapshot = await transaction.get(marker);
        if (markerSnapshot.exists) return;
        const snapshot = await transaction.get(collection);
        const existing = new Set(snapshot.docs.map(doc => doc.id));
        for (const product of products) if (!existing.has(product.id)) transaction.create(collection.doc(product.id), product);
        transaction.create(marker, { seededAt: new Date().toISOString() });
    });
    menuProductsEnsured = true;
}

function publicOrder(data) {
    if (!data) return null;
    const { qrToken, orderAccessToken, ...safe } = data;
    return safe;
}

async function getProducts() {
    await ensureMenuProducts();
    const collection = db.collection("products");
    const snapshot = await collection.get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(product => product.active !== false);
}

function validateProduct(input) {
    const name = String(input.name || "").trim();
    const category = String(input.category || "home").trim();
    const categoryName = String(input.categoryName || (category === "living" ? "Đời sống" : "Nhà cửa")).trim();
    const tag = String(input.tag || "").trim().slice(0, 40);
    const imageUrl = String(input.imageUrl || "").trim();
    const description = String(input.description || "").trim().slice(0, 500);
    const portion = String(input.portion || "").trim().slice(0, 80);
    const feature = String(input.feature || "").trim().slice(0, 160);
    const price = Number(input.price);
    if (name.length < 2 || name.length > 120) throw new Error("Tên sản phẩm phải dài từ 2 đến 120 ký tự.");
    if (!Number.isSafeInteger(price) || price <= 0) throw new Error("Giá phải là số nguyên dương theo VND.");
    if (!/^[a-z0-9-]{1,40}$/i.test(category) || categoryName.length > 40) throw new Error("Danh mục không hợp lệ.");
    if (imageUrl && (!/^https?:\/\//i.test(imageUrl) || imageUrl.length > 1000)) throw new Error("Ảnh phải là URL HTTP hoặc HTTPS hợp lệ.");
    return { name, category, categoryName, price, tag, imageUrl, description, portion, feature, active: input.active !== false };
}

async function createProduct(input) {
    const product = validateProduct(input);
    const slug = product.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "product";
    const id = `${slug}-${crypto.randomBytes(4).toString("hex")}`;
    await db.collection("products").doc(id).create({ id, ...product });
    return { id, ...product };
}

async function updateProduct(id, input) {
    if (!/^[a-z0-9-]{1,80}$/i.test(String(id))) throw new Error("Mã sản phẩm không hợp lệ.");
    const ref = db.collection("products").doc(String(id));
    const snapshot = await ref.get();
    if (!snapshot.exists) return null;
    const product = { id: String(id), ...validateProduct(input) };
    await ref.set(product);
    return product;
}

async function deleteProduct(id) {
    if (!/^[a-z0-9-]{1,80}$/i.test(String(id))) throw new Error("Mã sản phẩm không hợp lệ.");
    const ref = db.collection("products").doc(String(id));
    const snapshot = await ref.get();
    if (!snapshot.exists) return false;
    await ref.delete();
    return true;
}

async function createOrder(items, legacyAmount, customer, tableId, idempotencyKey, paymentMethod) {
    if (!/^0[1-4]$/.test(String(tableId || ""))) throw new Error("Vui lòng chọn bàn hợp lệ.");
    const safeIdempotencyKey = idempotencyKey || crypto.randomBytes(24).toString("hex");
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(String(safeIdempotencyKey))) throw new Error("Mã yêu cầu tạo đơn không hợp lệ.");
    if (!['QR', 'CASH'].includes(paymentMethod)) throw new Error("Phương thức thanh toán không hợp lệ.");
    if (!Array.isArray(items) && typeof items === "string" && Number.isSafeInteger(Number(legacyAmount)) && Number(legacyAmount) > 0) {
        const name = items.trim().slice(0, 120);
        if (!name) throw new Error("Tên sản phẩm không hợp lệ.");
        items = [{ productId: "legacy-" + crypto.randomBytes(5).toString("hex"), quantity: 1, legacy: { name, price: Number(legacyAmount) } }];
    }
    if (!Array.isArray(items) || items.length === 0 || items.length > 30) throw new Error("Giỏ hàng không hợp lệ.");
    const normalized = new Map();
    for (const item of items) {
        const productId = String(item.productId || "");
        const quantity = Number(item.quantity);
        if ((!item.legacy && !/^[a-z0-9-]{1,80}$/i.test(productId)) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new Error("Sản phẩm hoặc số lượng không hợp lệ.");
        if (item.legacy) normalized.set(productId, { quantity, legacy: item.legacy });
        else normalized.set(productId, { quantity: (normalized.get(productId)?.quantity || 0) + quantity, note: String(item.note || "").trim().slice(0, 200) });
    }
    const catalog = await getProducts();
    const byId = new Map(catalog.map(item => [item.id, item]));
    const orderItems = [...normalized].map(([productId, entry]) => {
        const product = entry.legacy || byId.get(productId);
        if (!product || product.active === false) throw new Error("Có sản phẩm không còn được bán.");
        return { productId, name: product.name, imageUrl: product.imageUrl || "", unitPrice: Number(product.price), quantity: entry.quantity, subtotal: Number(product.price) * entry.quantity, note: entry.note || "" };
    });
    const amount = orderItems.reduce((sum, item) => sum + item.subtotal, 0);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Tổng tiền đơn hàng không hợp lệ.");

    const idempotencyId = crypto.createHash("sha256").update(String(safeIdempotencyKey)).digest("hex");
    const requestRef = db.collection("orderRequests").doc(idempotencyId);
    const now = new Date().toISOString();
    return db.runTransaction(async transaction => {
        const requestSnapshot = await transaction.get(requestRef);
        if (requestSnapshot.exists) {
            const orderSnapshot = await transaction.get(db.collection("orders").doc(requestSnapshot.get("orderId")));
            if (orderSnapshot.exists) return orderSnapshot.data();
            throw new Error("Không tìm thấy đơn hàng đã tạo cho yêu cầu này.");
        }
        for (let attempt = 0; attempt < 10; attempt++) {
            const letters = String.fromCharCode(65 + crypto.randomInt(26), 65 + crypto.randomInt(26));
            const digits = String(crypto.randomInt(10000)).padStart(4, "0");
            const orderId = `${letters}${digits}`;
            const orderRef = db.collection("orders").doc(orderId);
            const orderSnapshot = await transaction.get(orderRef);
            if (orderSnapshot.exists) continue;
            const orderData = {
                items: orderItems, amount, tableId: String(tableId), status: "UNPAID", orderStatus: "NEW", paymentStatus: "PENDING",
                paymentMethod, qrToken: crypto.randomBytes(24).toString("hex"), orderAccessToken: crypto.randomBytes(32).toString("hex"),
                customerId: customer?.uid || null, customerName: customer?.name || null, customerEmail: customer?.email || null,
                createdAt: now, paidAt: null, transactionId: null, sender: null
            };
            transaction.create(orderRef, { orderId, ...orderData });
            transaction.create(requestRef, { orderId, createdAt: now });
            return { orderId, ...orderData };
        }
        throw new Error("Không thể tạo mã đơn hàng duy nhất, vui lòng thử lại.");
    });
}

async function recordCashPayment(orderId, confirmedBy) {
    const ref = db.collection("orders").doc(String(orderId));
    return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) return { error: "ORDER_NOT_FOUND" };
        const order = snapshot.data();
        if (order.paymentMethod !== "CASH") return { error: "CASH_NOT_SELECTED" };
        if (order.paymentStatus === "PAID" || order.status === "PAID") return { error: "ORDER_ALREADY_PAID" };
        const confirmedAt = new Date().toISOString();
        const updated = { ...order, status: "PAID", paymentStatus: "PAID", paymentMethod: "CASH", paidAt: confirmedAt, cashConfirmedAt: confirmedAt, cashConfirmedBy: String(confirmedBy || "staff") };
        transaction.update(ref, updated);
        return { order: publicOrder(updated) };
    });
}

async function getOrderById(orderId) {
    const snapshot = await db.collection("orders").doc(String(orderId)).get();
    return snapshot.exists ? snapshot.data() : null;
}

async function getOrderByToken(token) {
    const snapshot = await db.collection("orders").where("qrToken", "==", String(token)).limit(1).get();
    return snapshot.empty ? null : snapshot.docs[0].data();
}

async function getAllOrders() {
    const snapshot = await db.collection("orders").orderBy("createdAt", "desc").limit(500).get();
    return snapshot.docs.map(doc => publicOrder(doc.data()));
}

async function getOrdersByCustomerId(customerId) {
    const snapshot = await db.collection("orders").where("customerId", "==", String(customerId)).limit(200).get();
    return snapshot.docs.map(doc => publicOrder(doc.data())).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function recordPayment(orderId, transaction) {
    const transactionKey = crypto.createHash("sha256").update(String(transaction.transactionId)).digest("hex");
    const transactionRef = db.collection("transactions").doc(transactionKey);
    const legacyTransactionRef = db.collection("processedTransactions").doc(transactionKey);
    const orderRef = db.collection("orders").doc(String(orderId));
    return db.runTransaction(async firestoreTransaction => {
        const [orderSnapshot, transactionSnapshot, legacySnapshot] = await Promise.all([firestoreTransaction.get(orderRef), firestoreTransaction.get(transactionRef), firestoreTransaction.get(legacyTransactionRef)]);
        if (!orderSnapshot.exists) return { error: "ORDER_NOT_FOUND" };
        const order = orderSnapshot.data();
        if (transactionSnapshot.exists || legacySnapshot.exists) {
            const prior = (transactionSnapshot.exists ? transactionSnapshot : legacySnapshot).data();
            if (prior.orderId !== order.orderId) return { error: "TRANSACTION_ALREADY_USED" };
            return { order: publicOrder(order), alreadyProcessed: true };
        }
        if (order.status === "PAID") return { error: "ORDER_ALREADY_PAID" };
        if (!Number.isSafeInteger(Number(transaction.amount)) || Number(transaction.amount) !== Number(order.amount)) return { error: "AMOUNT_MISMATCH" };
        const paidAt = new Date().toISOString();
        const updated = { ...order, status: "PAID", paymentStatus: "PAID", paymentMethod: "QR", sender: String(transaction.sender || ""), transactionId: String(transaction.transactionId), content: String(transaction.content || ""), paidAt };
        firestoreTransaction.update(orderRef, updated);
        firestoreTransaction.create(transactionRef, { transactionId: String(transaction.transactionId), orderId: order.orderId, amount: Number(transaction.amount), createdAt: paidAt });
        let notificationId = null;
        if (process.env.TTS_MODE === "queue") {
            notificationId = transactionKey;
            const notificationRef = db.collection("speakerNotifications").doc(notificationId);
            firestoreTransaction.create(notificationRef, {
                notificationId,
                transactionId: String(transaction.transactionId),
                orderId: order.orderId,
                amount: Number(transaction.amount),
                status: "PENDING",
                attempts: 0,
                createdAt: paidAt,
                playedAt: null,
                workerId: null,
                leaseUntil: null,
                retryAfter: null,
                lastError: null
            });
        }
        return { order: publicOrder(updated), alreadyProcessed: false, notificationId };
    });
}

module.exports = { getProducts, createProduct, updateProduct, deleteProduct, createOrder, getOrderById, getOrderByToken, getAllOrders, getOrdersByCustomerId, recordPayment, recordCashPayment, publicOrder };
