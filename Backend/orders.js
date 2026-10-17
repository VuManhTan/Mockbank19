const crypto = require("crypto");
const { db } = require("./firebase");

const products = [
    { id: "ceramic-mug", name: "Cốc gốm Mộc", category: "home", categoryName: "Nhà cửa", price: 185000, tag: "THỦ CÔNG", imageUrl: "https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?auto=format&fit=crop&w=900&q=85", active: true },
    { id: "linen-tote", name: "Túi vải linen", category: "living", categoryName: "Đời sống", price: 245000, tag: "BÁN CHẠY", imageUrl: "https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=900&q=85", active: true },
    { id: "wood-tray", name: "Khay gỗ sồi", category: "home", categoryName: "Nhà cửa", price: 320000, tag: "GỖ TỰ NHIÊN", imageUrl: "https://images.unsplash.com/photo-1603199506016-b9a594b593c0?auto=format&fit=crop&w=900&q=85", active: true },
    { id: "glass-vase", name: "Bình hoa dáng mộc", category: "home", categoryName: "Nhà cửa", price: 275000, tag: "MỚI VỀ", imageUrl: "https://images.unsplash.com/photo-1578500494198-246f612d3b3d?auto=format&fit=crop&w=900&q=85", active: true }
];

function publicOrder(data) {
    if (!data) return null;
    const { qrToken, ...safe } = data;
    return safe;
}

async function getProducts() {
    const collection = db.collection("products");
    const snapshot = await collection.get();
    if (snapshot.empty) {
        const batch = db.batch();
        for (const product of products) batch.set(collection.doc(product.id), product);
        await batch.commit();
        return products;
    }
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(product => product.active !== false);
}

function validateProduct(input) {
    const name = String(input.name || "").trim();
    const category = String(input.category || "home").trim();
    const categoryName = String(input.categoryName || (category === "living" ? "Đời sống" : "Nhà cửa")).trim();
    const tag = String(input.tag || "").trim().slice(0, 40);
    const imageUrl = String(input.imageUrl || "").trim();
    const price = Number(input.price);
    if (name.length < 2 || name.length > 120) throw new Error("Tên sản phẩm phải dài từ 2 đến 120 ký tự.");
    if (!Number.isSafeInteger(price) || price <= 0) throw new Error("Giá phải là số nguyên dương theo VND.");
    if (!/^[a-z0-9-]{1,40}$/i.test(category) || categoryName.length > 40) throw new Error("Danh mục không hợp lệ.");
    if (imageUrl && (!/^https?:\/\//i.test(imageUrl) || imageUrl.length > 1000)) throw new Error("Ảnh phải là URL HTTP hoặc HTTPS hợp lệ.");
    return { name, category, categoryName, price, tag, imageUrl, active: input.active !== false };
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

async function createOrder(items, legacyAmount, customer) {
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
        else normalized.set(productId, { quantity: (normalized.get(productId)?.quantity || 0) + quantity });
    }
    const catalog = await getProducts();
    const byId = new Map(catalog.map(item => [item.id, item]));
    const orderItems = [...normalized].map(([productId, entry]) => {
        const product = entry.legacy || byId.get(productId);
        if (!product || product.active === false) throw new Error("Có sản phẩm không còn được bán.");
        return { productId, name: product.name, imageUrl: product.imageUrl || "", unitPrice: Number(product.price), quantity: entry.quantity, subtotal: Number(product.price) * entry.quantity };
    });
    const amount = orderItems.reduce((sum, item) => sum + item.subtotal, 0);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Tổng tiền đơn hàng không hợp lệ.");

    const orderData = { items: orderItems, amount, status: "UNPAID", qrToken: crypto.randomBytes(24).toString("hex"), customerId: customer?.uid || null, customerName: customer?.name || null, customerEmail: customer?.email || null, createdAt: new Date().toISOString(), paidAt: null, transactionId: null, sender: null };
    for (let attempt = 0; attempt < 5; attempt++) {
        // Mã ngắn để dễ đọc và nhập nội dung chuyển khoản: 2 chữ + 4 chữ số.
        const letters = String.fromCharCode(65 + crypto.randomInt(26), 65 + crypto.randomInt(26));
        const digits = String(crypto.randomInt(10000)).padStart(4, "0");
        const orderId = `${letters}${digits}`;
        try {
            await db.collection("orders").doc(orderId).create({ orderId, ...orderData });
            return { orderId, ...orderData };
        } catch (error) {
            if (error.code !== 6 && error.code !== "already-exists" && error.code !== "6") throw error;
        }
    }
    throw new Error("Không thể tạo mã đơn hàng duy nhất, vui lòng thử lại.");
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
        const updated = { ...order, status: "PAID", sender: String(transaction.sender || ""), transactionId: String(transaction.transactionId), content: String(transaction.content || ""), paidAt };
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

module.exports = { getProducts, createProduct, updateProduct, deleteProduct, createOrder, getOrderById, getOrderByToken, getAllOrders, getOrdersByCustomerId, recordPayment, publicOrder };
