const { db } = require("./firebase");
const { FieldValue } = require("firebase-admin/firestore");
const crypto = require("crypto");
const { promisify } = require("util");
const scrypt = promisify(crypto.scrypt);

const accounts = db.collection("bankAccounts");
const transactions = db.collection("bankTransactions");
const adminAudit = db.collection("bankAdminAudit");
const paymentSettings = db.collection("appSettings").doc("paymentRecipient");

const seedAccounts = [
    { id: "TK001", username: "nguyenvana", password: "123456", name: "Nguyễn Văn A", accountNumber: "100001", balance: 2000000 },
    { id: "TK002", username: "tranvanb", password: "123456", name: "Trần Văn B", accountNumber: "100002", balance: 5000000 },
    { id: "TK003", username: "levanc", password: "123456", name: "Lê Văn C", accountNumber: "100003", balance: 1500000 }
];

function isAlreadyExists(error) {
    return error.code === 6 || error.code === "6" || error.code === "already-exists";
}

async function ensureSeedAccounts() {
    await Promise.all(seedAccounts.map(async account => {
        try {
            await accounts.doc(account.id).create({ ...account, createdAt: new Date().toISOString() });
        } catch (error) {
            if (!isAlreadyExists(error)) throw error;
        }
    }));
}

async function getAccountByUsername(username) {
    let snapshot = await accounts.where("username", "==", String(username || "").trim()).limit(1).get();
    if (snapshot.empty) {
        await ensureSeedAccounts();
        snapshot = await accounts.where("username", "==", String(username || "").trim()).limit(1).get();
    }
    return snapshot.empty ? null : { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
}

async function login(username, password) {
    if (typeof password !== "string" || password.length > 128) return null;
    const account = await getAccountByUsername(username);
    if (!account || account.active === false) return null;
    return await verifyAccountPassword(account, password) ? account : null;
}

async function hashPassword(password, salt) {
    return (await scrypt(password, salt, 64)).toString("hex");
}

async function verifyAccountPassword(account, password) {
    if (typeof password !== "string" || password.length > 128) return false;
    if (account.passwordHash && account.passwordSalt) {
        const actual = Buffer.from(await hashPassword(password, account.passwordSalt), "hex");
        const expected = Buffer.from(account.passwordHash, "hex");
        return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
    }
    return account.password === password;
}

function loginBankAdmin(username, password) {
    const configuredUsername = process.env.BANK_ADMIN_USERNAME;
    const configuredPassword = process.env.BANK_ADMIN_PASSWORD;
    if (!configuredUsername || !configuredPassword) return null;
    const matches = (actual, expected) => {
        const a = Buffer.from(String(actual || ""));
        const b = Buffer.from(String(expected || ""));
        return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
    };
    return matches(String(username || "").trim(), configuredUsername) && matches(password, configuredPassword)
        ? { username: configuredUsername }
        : null;
}

function getSafeAccount(account) {
    if (!account) return null;
    return {
        id: account.id,
        username: account.username,
        name: account.name,
        accountNumber: account.accountNumber,
        balance: account.balance
    };
}

function getPaymentSafeAccount(account) {
    if (!account) return null;
    return {
        id: account.id,
        name: account.name,
        accountNumber: account.accountNumber,
        bankName: String(account.bankName || "MockBank"),
        active: account.active !== false
    };
}

async function getPaymentAccounts() {
    const snapshot = await accounts.orderBy("accountNumber").get();
    return snapshot.docs.map(document => getPaymentSafeAccount({ id: document.id, ...document.data() }));
}

async function getPaymentAccountSettings() {
    const settingSnapshot = await paymentSettings.get();
    const selectedAccountId = settingSnapshot.exists ? String(settingSnapshot.get("accountId") || "") : "";
    if (!selectedAccountId) return { selectedAccountId: null, selectedAccount: null, updatedAt: null };
    const accountSnapshot = await accounts.doc(selectedAccountId).get();
    const selectedAccount = accountSnapshot.exists ? getPaymentSafeAccount({ id: accountSnapshot.id, ...accountSnapshot.data() }) : null;
    return {
        selectedAccountId,
        selectedAccount,
        updatedAt: settingSnapshot.get("updatedAt") || null,
        valid: Boolean(selectedAccount?.active && selectedAccount.accountNumber && selectedAccount.name)
    };
}

async function setPaymentAccount(accountId, adminUsername) {
    const safeId = String(accountId || "").trim();
    if (!safeId || safeId.length > 120) throw new Error("Hãy chọn một tài khoản MockBank hợp lệ.");
    const accountRef = accounts.doc(safeId);
    const timestamp = new Date().toISOString();
    await db.runTransaction(async transaction => {
        const [accountSnapshot, settingSnapshot] = await Promise.all([
            transaction.get(accountRef),
            transaction.get(paymentSettings)
        ]);
        if (!accountSnapshot.exists) throw new Error("Không tìm thấy tài khoản MockBank.");
        const account = accountSnapshot.data();
        if (account.active === false) throw new Error("Không thể chọn tài khoản đã bị khóa.");
        if (!String(account.name || "").trim() || !/^\d{6,24}$/.test(String(account.accountNumber || ""))) {
            throw new Error("Tài khoản MockBank chưa có thông tin hợp lệ.");
        }
        transaction.set(paymentSettings, {
            accountId: safeId,
            updatedAt: timestamp,
            updatedBy: String(adminUsername || "admin"),
            previousAccountId: settingSnapshot.exists ? settingSnapshot.get("accountId") || null : null
        });
    });
    return getPaymentAccountSettings();
}

async function getBankAccountById(accountId) {
    const snapshot = await accounts.doc(String(accountId || "")).get();
    return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
}

async function updateBankAccountProfile(currentUsername, input) {
    const account = await getAccountByUsername(currentUsername);
    if (!account || account.active === false) throw new Error("Không tìm thấy tài khoản đang hoạt động");
    const name = String(input.name || "").trim();
    const username = String(input.username || "").trim();
    if (name.length < 2 || name.length > 100) throw new Error("Họ tên cần dài từ 2 đến 100 ký tự");
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) throw new Error("Tên đăng nhập phải có 3-32 ký tự gồm chữ, số, dấu chấm, gạch dưới hoặc gạch ngang");
    const ref = accounts.doc(account.id);
    await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists || snapshot.get("active") === false) throw new Error("Không tìm thấy tài khoản đang hoạt động");
        if (username !== snapshot.get("username")) {
            const matches = await transaction.get(accounts.where("username", "==", username).limit(1));
            if (!matches.empty && matches.docs[0].id !== ref.id) throw new Error("Tên đăng nhập đã được sử dụng");
        }
        transaction.update(ref, { name, username, updatedAt: new Date().toISOString() });
    });
    return getSafeAccount({ ...account, name, username });
}

async function changeBankAccountPassword(username, currentPassword, newPassword) {
    const account = await getAccountByUsername(username);
    if (!account || account.active === false) throw new Error("Không tìm thấy tài khoản đang hoạt động");
    if (!(await verifyAccountPassword(account, currentPassword))) throw new Error("Mật khẩu hiện tại không đúng");
    if (typeof newPassword !== "string" || newPassword.length < 8 || newPassword.length > 128) throw new Error("Mật khẩu mới phải có từ 8 đến 128 ký tự");
    const passwordSalt = crypto.randomBytes(16).toString("hex");
    const passwordHash = await hashPassword(newPassword, passwordSalt);
    const ref = accounts.doc(account.id);
    await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists || snapshot.get("active") === false) throw new Error("Không tìm thấy tài khoản đang hoạt động");
        if (snapshot.get("passwordHash") !== account.passwordHash || snapshot.get("passwordSalt") !== account.passwordSalt || snapshot.get("password") !== account.password) {
            throw new Error("Thông tin đăng nhập vừa thay đổi. Hãy đăng nhập lại rồi thử lại.");
        }
        transaction.update(ref, {
            passwordSalt,
            passwordHash,
            password: FieldValue.delete(),
            passwordChangedAt: new Date().toISOString()
        });
    });
    return { username: account.username };
}

async function debitAccount(username, amount) {
    const account = await getAccountByUsername(username);
    if (!account) throw new Error("Không tìm thấy tài khoản");
    if (!Number.isSafeInteger(Number(amount)) || Number(amount) <= 0) throw new Error("Số tiền không hợp lệ");
    return db.runTransaction(async transaction => {
        const ref = accounts.doc(account.id);
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) throw new Error("Không tìm thấy tài khoản");
        if (snapshot.get("active") === false) throw new Error("Tài khoản đã bị vô hiệu hóa");
        const currentBalance = Number(snapshot.get("balance"));
        if (currentBalance < amount) throw new Error("Số dư không đủ");
        const balance = currentBalance - amount;
        transaction.update(ref, { balance });
        return balance;
    });
}

async function refundAccount(username, amount) {
    const account = await getAccountByUsername(username);
    if (!account) throw new Error("Không tìm thấy tài khoản");
    return db.runTransaction(async transaction => {
        const ref = accounts.doc(account.id);
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) throw new Error("Không tìm thấy tài khoản");
        const balance = Number(snapshot.get("balance")) + Number(amount);
        transaction.update(ref, { balance });
        return balance;
    });
}

async function addTransaction(username, transaction) {
    const account = await getAccountByUsername(username);
    if (!account) throw new Error("Không tìm thấy tài khoản");
    const record = { ...transaction, accountId: account.id, status: "PENDING" };
    await transactions.doc(String(transaction.transactionId)).create(record);
    return record;
}

async function setTransactionStatus(transactionId, status) {
    await transactions.doc(String(transactionId)).update({ status });
}

async function getTransactions(username) {
    const account = await getAccountByUsername(username);
    if (!account) return [];
    const snapshot = await transactions
        .where("accountId", "==", account.id)
        .orderBy("timestamp", "desc")
        .limit(100)
        .get();
    return snapshot.docs.map(document => document.data());
}

async function getAllTransactions() {
    const [transactionSnapshot, accountSnapshot] = await Promise.all([
        transactions.orderBy("timestamp", "desc").limit(500).get(),
        accounts.get()
    ]);
    const accountById = new Map(accountSnapshot.docs.map(document => {
        const account = document.data();
        return [document.id, {
            name: account.name || "",
            accountNumber: account.accountNumber || ""
        }];
    }));
    return transactionSnapshot.docs.map(document => {
        const record = document.data();
        const account = accountById.get(record.accountId) || {};
        return {
            ...record,
            transactionId: record.transactionId || document.id,
            accountName: account.name || record.senderName || record.sender || "",
            accountNumber: account.accountNumber || record.senderAccountNumber || record.senderAccount || ""
        };
    });
}

async function transferFunds(senderUsername, recipientAccountNumber, amount, content = "") {
    const safeAmount = Number(amount);
    const accountNumber = String(recipientAccountNumber || "").trim();
    const memo = String(content || "").trim().slice(0, 200);
    if (!Number.isSafeInteger(safeAmount) || safeAmount <= 0) throw new Error("Số tiền phải là số nguyên dương");
    if (!/^\d{6,24}$/.test(accountNumber)) throw new Error("Số tài khoản nhận không hợp lệ");
    const sender = await getAccountByUsername(senderUsername);
    if (!sender) throw new Error("Không tìm thấy tài khoản gửi");

    const senderRef = accounts.doc(sender.id);
    const recipientQuery = accounts.where("accountNumber", "==", accountNumber).limit(1);
    const senderHistoryRef = transactions.doc();
    const recipientHistoryRef = transactions.doc();
    const transferId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    return db.runTransaction(async transaction => {
        const senderSnapshot = await transaction.get(senderRef);
        const recipientMatches = await transaction.get(recipientQuery);
        if (!senderSnapshot.exists || senderSnapshot.get("active") === false) throw new Error("Tài khoản gửi không còn hoạt động");
        if (recipientMatches.empty) throw new Error("Không tìm thấy tài khoản nhận");
        const recipientSnapshot = recipientMatches.docs[0];
        const recipientRef = recipientSnapshot.ref;
        if (recipientSnapshot.get("active") === false) throw new Error("Tài khoản nhận không còn hoạt động");
        if (recipientRef.id === senderRef.id) throw new Error("Không thể chuyển tiền vào chính tài khoản này");

        const senderBalance = Number(senderSnapshot.get("balance"));
        const recipientBalance = Number(recipientSnapshot.get("balance"));
        if (!Number.isSafeInteger(senderBalance - safeAmount) || senderBalance < safeAmount) throw new Error("Số dư không đủ");
        if (!Number.isSafeInteger(recipientBalance + safeAmount)) throw new Error("Số dư tài khoản nhận vượt giới hạn");
        const senderBalanceAfter = senderBalance - safeAmount;
        const recipientBalanceAfter = recipientBalance + safeAmount;
        const senderName = senderSnapshot.get("name");
        const senderAccountNumber = senderSnapshot.get("accountNumber");
        const recipientName = recipientSnapshot.get("name");
        const recipientAccountNumberValue = recipientSnapshot.get("accountNumber");

        transaction.update(senderRef, { balance: senderBalanceAfter });
        transaction.update(recipientRef, { balance: recipientBalanceAfter });
        transaction.create(senderHistoryRef, {
            transactionId: senderHistoryRef.id,
            transferId,
            accountId: senderRef.id,
            type: "TRANSFER_OUT",
            direction: "OUT",
            amount: safeAmount,
            counterpartyName: recipientName,
            counterpartyAccountNumber: recipientAccountNumberValue,
            senderName,
            senderAccountNumber,
            recipientName,
            recipientAccountNumber: recipientAccountNumberValue,
            content: memo || "Chuyển tiền",
            timestamp,
            status: "COMPLETED",
            balanceAfter: senderBalanceAfter
        });
        transaction.create(recipientHistoryRef, {
            transactionId: recipientHistoryRef.id,
            transferId,
            accountId: recipientRef.id,
            type: "TRANSFER_IN",
            direction: "IN",
            amount: safeAmount,
            counterpartyName: senderName,
            counterpartyAccountNumber: senderAccountNumber,
            senderName,
            senderAccountNumber,
            recipientName,
            recipientAccountNumber: recipientAccountNumberValue,
            content: memo || "Nhận tiền chuyển khoản",
            timestamp,
            status: "COMPLETED",
            balanceAfter: recipientBalanceAfter
        });
        return { transferId, balance: senderBalanceAfter, recipient: { name: recipientName, accountNumber: recipientAccountNumberValue } };
    });
}

async function settleOrderPayment({ senderUsername, recipientAccountId, recipientAccountNumber, amount, orderId, transactionId, content }) {
    const safeAmount = Number(amount);
    const safeNumber = String(recipientAccountNumber || "").trim();
    const safeOrderId = String(orderId || "").trim();
    if (!Number.isSafeInteger(safeAmount) || safeAmount <= 0) throw new Error("Số tiền phải là số nguyên dương");
    if (!safeOrderId || !String(recipientAccountId || "").trim() || !/^\d{6,24}$/.test(safeNumber)) throw new Error("Thông tin tài khoản nhận của đơn hàng không hợp lệ.");
    const sender = await getAccountByUsername(senderUsername);
    if (!sender) throw new Error("Không tìm thấy tài khoản gửi");

    const senderRef = accounts.doc(sender.id);
    const recipientRef = accounts.doc(String(recipientAccountId));
    const settlementRef = db.collection("bankOrderSettlements").doc(safeOrderId);
    const senderHistoryRef = transactions.doc();
    const recipientHistoryRef = transactions.doc();
    const transferId = String(transactionId || crypto.randomUUID());
    const timestamp = new Date().toISOString();
    const memo = String(content || `Thanh toan ${safeOrderId}`).trim().slice(0, 200);

    return db.runTransaction(async transaction => {
        const settlementSnapshot = await transaction.get(settlementRef);
        if (settlementSnapshot.exists) {
            if (settlementSnapshot.get("status") === "COMPLETED") throw new Error("Đơn hàng đã được thanh toán.");
            if (settlementSnapshot.get("status") === "PENDING") throw new Error("Giao dịch của đơn hàng đang được xử lý.");
        }
        const [senderSnapshot, recipientSnapshot] = await Promise.all([
            transaction.get(senderRef),
            transaction.get(recipientRef)
        ]);
        if (!senderSnapshot.exists || senderSnapshot.get("active") === false) throw new Error("Tài khoản gửi không còn hoạt động.");
        if (!recipientSnapshot.exists || recipientSnapshot.get("active") === false) throw new Error("Tài khoản nhận của đơn hàng đã bị khóa hoặc không còn hợp lệ.");
        if (recipientSnapshot.get("accountNumber") !== safeNumber) throw new Error("Số tài khoản nhận không khớp với mã QR của đơn hàng.");
        if (senderRef.id === recipientRef.id) throw new Error("Không thể thanh toán vào chính tài khoản đang đăng nhập.");

        const senderBalance = Number(senderSnapshot.get("balance"));
        const recipientBalance = Number(recipientSnapshot.get("balance"));
        if (!Number.isSafeInteger(senderBalance - safeAmount) || senderBalance < safeAmount) throw new Error("Số dư không đủ.");
        if (!Number.isSafeInteger(recipientBalance + safeAmount)) throw new Error("Số dư tài khoản nhận vượt giới hạn.");
        const senderBalanceAfter = senderBalance - safeAmount;
        const recipientBalanceAfter = recipientBalance + safeAmount;
        const senderName = senderSnapshot.get("name") || "";
        const senderNumber = senderSnapshot.get("accountNumber") || "";
        const recipientName = recipientSnapshot.get("name") || "";
        const recipientNumber = recipientSnapshot.get("accountNumber") || "";
        const recipientBankName = String(recipientSnapshot.get("bankName") || "MockBank");

        transaction.update(senderRef, { balance: senderBalanceAfter });
        transaction.update(recipientRef, { balance: recipientBalanceAfter });
        transaction.create(senderHistoryRef, {
            transactionId: transferId, transferId, orderId: safeOrderId, accountId: senderRef.id,
            type: "ORDER_PAYMENT_OUT", direction: "OUT", amount: safeAmount,
            senderName, senderAccountNumber: senderNumber, recipientAccountId: recipientRef.id,
            recipientName, recipientAccountNumber: recipientNumber, recipientBankName,
            content: memo, timestamp, status: "PENDING", balanceAfter: senderBalanceAfter
        });
        transaction.create(recipientHistoryRef, {
            transactionId: `${transferId}-IN`, transferId, orderId: safeOrderId, accountId: recipientRef.id,
            type: "ORDER_PAYMENT_IN", direction: "IN", amount: safeAmount,
            senderName, senderAccountNumber: senderNumber, recipientAccountId: recipientRef.id,
            recipientName, recipientAccountNumber: recipientNumber, recipientBankName,
            content: memo, timestamp, status: "PENDING", balanceAfter: recipientBalanceAfter
        });
        const settlement = {
            orderId: safeOrderId, transferId, senderAccountId: senderRef.id, recipientAccountId: recipientRef.id,
            senderHistoryId: senderHistoryRef.id, recipientHistoryId: recipientHistoryRef.id,
            amount: safeAmount, status: "PENDING", createdAt: timestamp
        };
        transaction.set(settlementRef, settlement);
        return { transferId, balance: senderBalanceAfter, recipient: { id: recipientRef.id, name: recipientName, accountNumber: recipientNumber, bankName: recipientBankName } };
    });
}

async function setOrderPaymentSettlementStatus(orderId, status) {
    if (!["COMPLETED", "REFUNDED"].includes(status)) throw new Error("Trạng thái giao dịch không hợp lệ.");
    const settlementRef = db.collection("bankOrderSettlements").doc(String(orderId));
    return db.runTransaction(async transaction => {
        const settlementSnapshot = await transaction.get(settlementRef);
        if (!settlementSnapshot.exists) throw new Error("Không tìm thấy giao dịch thanh toán của đơn hàng.");
        const settlement = settlementSnapshot.data();
        const senderHistoryRef = transactions.doc(settlement.senderHistoryId);
        const recipientHistoryRef = transactions.doc(settlement.recipientHistoryId);
        const [senderHistory, recipientHistory] = await Promise.all([
            transaction.get(senderHistoryRef),
            transaction.get(recipientHistoryRef)
        ]);
        if (settlement.status === status) return settlement;
        if (settlement.status !== "PENDING") throw new Error("Giao dịch thanh toán đã kết thúc.");
        const finalizedAt = new Date().toISOString();
        transaction.update(settlementRef, { status, finalizedAt });
        if (senderHistory.exists) transaction.update(senderHistoryRef, { status, finalizedAt });
        if (recipientHistory.exists) transaction.update(recipientHistoryRef, { status, finalizedAt });
        return { ...settlement, status, finalizedAt };
    });
}

async function reverseOrderPaymentSettlement(orderId) {
    const settlementRef = db.collection("bankOrderSettlements").doc(String(orderId));
    return db.runTransaction(async transaction => {
        const settlementSnapshot = await transaction.get(settlementRef);
        if (!settlementSnapshot.exists) return { error: "SETTLEMENT_NOT_FOUND" };
        const settlement = settlementSnapshot.data();
        if (settlement.status === "REFUNDED") return { success: true, alreadyReversed: true };
        if (settlement.status !== "PENDING") return { error: "SETTLEMENT_NOT_PENDING" };
        const senderRef = accounts.doc(settlement.senderAccountId);
        const recipientRef = accounts.doc(settlement.recipientAccountId);
        const senderHistoryRef = transactions.doc(settlement.senderHistoryId);
        const recipientHistoryRef = transactions.doc(settlement.recipientHistoryId);
        const [senderSnapshot, recipientSnapshot, senderHistory, recipientHistory] = await Promise.all([
            transaction.get(senderRef), transaction.get(recipientRef),
            transaction.get(senderHistoryRef), transaction.get(recipientHistoryRef)
        ]);
        if (!senderSnapshot.exists || !recipientSnapshot.exists) return { error: "SETTLEMENT_ACCOUNT_MISSING" };
        const amount = Number(settlement.amount);
        const senderBalance = Number(senderSnapshot.get("balance"));
        const recipientBalance = Number(recipientSnapshot.get("balance"));
        if (!Number.isSafeInteger(senderBalance + amount) || recipientBalance < amount) return { error: "SETTLEMENT_REVERSAL_FAILED" };
        const finalizedAt = new Date().toISOString();
        transaction.update(senderRef, { balance: senderBalance + amount });
        transaction.update(recipientRef, { balance: recipientBalance - amount });
        transaction.update(settlementRef, { status: "REFUNDED", finalizedAt });
        if (senderHistory.exists) transaction.update(senderHistoryRef, { status: "REFUNDED", finalizedAt });
        if (recipientHistory.exists) transaction.update(recipientHistoryRef, { status: "REFUNDED", finalizedAt });
        return { success: true, amount };
    });
}

async function getAllSafeAccounts() {
    await ensureSeedAccounts();
    const snapshot = await accounts.orderBy("accountNumber").get();
    return snapshot.docs
        .map(document => ({ id: document.id, ...document.data() }))
        .filter(account => account.active !== false)
        .map(getSafeAccount);
}

async function createBankAccount(input, adminUsername) {
    const name = String(input.name || "").trim();
    const username = String(input.username || "").trim();
    const password = input.password;
    const accountNumber = String(input.accountNumber || "").trim();
    const balance = input.balance === undefined || input.balance === "" ? 0 : Number(input.balance);
    if (name.length < 2 || name.length > 100) throw new Error("Tên cần dài từ 2 đến 100 ký tự");
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) throw new Error("Tên đăng nhập phải có 3-32 ký tự gồm chữ, số, dấu chấm, gạch dưới hoặc gạch ngang");
    if (typeof password !== "string" || password.length < 6 || password.length > 128) throw new Error("Mật khẩu phải có 6-128 ký tự");
    if (!/^\d{6,24}$/.test(accountNumber)) throw new Error("Số tài khoản phải có 6-24 chữ số");
    if (!Number.isSafeInteger(balance) || balance < 0) throw new Error("Số dư ban đầu phải là số nguyên không âm");

    await ensureSeedAccounts();
    const passwordSalt = crypto.randomBytes(16).toString("hex");
    const passwordHash = await hashPassword(password, passwordSalt);
    const accountRef = accounts.doc(`BANK-${crypto.randomUUID()}`);
    const auditRef = adminAudit.doc();
    const timestamp = new Date().toISOString();
    await db.runTransaction(async transaction => {
        const usernameMatches = await transaction.get(accounts.where("username", "==", username).limit(1));
        const numberMatches = await transaction.get(accounts.where("accountNumber", "==", accountNumber).limit(1));
        if (!usernameMatches.empty) throw new Error("Tên đăng nhập đã được sử dụng");
        if (!numberMatches.empty) throw new Error("Số tài khoản đã được sử dụng");
        transaction.create(accountRef, { name, username, passwordSalt, passwordHash, accountNumber, balance, active: true, createdAt: timestamp, createdBy: adminUsername });
        transaction.create(auditRef, {
            transactionId: auditRef.id,
            accountId: accountRef.id,
            amount: balance,
            type: "ADMIN_ACCOUNT_CREATED",
            content: `Admin ${adminUsername} tạo tài khoản ${accountNumber}`,
            adminUsername,
            timestamp,
            status: "COMPLETED"
        });
    });
    return getSafeAccount({ id: accountRef.id, name, username, accountNumber, balance });
}

async function registerBankAccount(input) {
    const name = String(input.name || "").trim();
    const username = String(input.username || "").trim();
    const password = input.password;
    const accountNumber = String(input.accountNumber || "").trim();
    if (!/^\d{7,24}$/.test(accountNumber)) throw new Error("Số tài khoản phải có 7-24 chữ số");
    return createBankAccount({ name, username, password, accountNumber, balance: 0 }, "self-registration");
}

async function deactivateBankAccount(accountId, adminUsername) {
    const ref = accounts.doc(String(accountId || ""));
    const auditRef = adminAudit.doc();
    return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) throw new Error("Không tìm thấy tài khoản");
        if (snapshot.get("active") === false) throw new Error("Tài khoản đã bị xóa");
        const timestamp = new Date().toISOString();
        transaction.update(ref, { active: false, deactivatedAt: timestamp, deactivatedBy: adminUsername });
        transaction.create(auditRef, {
            transactionId: auditRef.id,
            accountId: ref.id,
            amount: 0,
            type: "ADMIN_ACCOUNT_DEACTIVATED",
            content: `Admin ${adminUsername} xóa tài khoản ${snapshot.get("accountNumber")}`,
            adminUsername,
            timestamp,
            status: "COMPLETED"
        });
        return { success: true };
    });
}

async function adjustAccountBalance(accountId, direction, amount, adminUsername) {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Số tiền phải là số nguyên dương");
    if (!["add", "subtract"].includes(direction)) throw new Error("Loại điều chỉnh không hợp lệ");
    const ref = accounts.doc(String(accountId || ""));
    const transactionRef = transactions.doc();
    return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) throw new Error("Không tìm thấy tài khoản");
        if (snapshot.get("active") === false) throw new Error("Tài khoản đã bị vô hiệu hóa");
        const current = Number(snapshot.get("balance"));
        const balance = direction === "add" ? current + amount : current - amount;
        if (!Number.isSafeInteger(balance) || balance < 0) throw new Error("Số dư không đủ hoặc vượt giới hạn");
        const timestamp = new Date().toISOString();
        transaction.update(ref, { balance });
        transaction.create(transactionRef, {
            transactionId: transactionRef.id,
            accountId: ref.id,
            amount,
            type: direction === "add" ? "ADMIN_CREDIT" : "ADMIN_DEBIT",
            content: `Admin ${adminUsername} ${direction === "add" ? "cộng" : "trừ"} số dư`,
            adminUsername,
            timestamp,
            status: "COMPLETED"
        });
        return { balance };
    });
}

module.exports = {
    getAccountByUsername,
    login,
    loginBankAdmin,
    getSafeAccount,
    getPaymentAccounts,
    getPaymentAccountSettings,
    setPaymentAccount,
    getBankAccountById,
    updateBankAccountProfile,
    changeBankAccountPassword,
    debitAccount,
    refundAccount,
    addTransaction,
    setTransactionStatus,
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
};
