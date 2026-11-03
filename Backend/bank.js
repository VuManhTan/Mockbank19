const { db } = require("./firebase");
const crypto = require("crypto");

const accounts = db.collection("bankAccounts");
const transactions = db.collection("bankTransactions");

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
    const account = await getAccountByUsername(username);
    return account && account.password === String(password) ? account : null;
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

async function debitAccount(username, amount) {
    const account = await getAccountByUsername(username);
    if (!account) throw new Error("Không tìm thấy tài khoản");
    if (!Number.isSafeInteger(Number(amount)) || Number(amount) <= 0) throw new Error("Số tiền không hợp lệ");
    return db.runTransaction(async transaction => {
        const ref = accounts.doc(account.id);
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) throw new Error("Không tìm thấy tài khoản");
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

async function getAllSafeAccounts() {
    await ensureSeedAccounts();
    const snapshot = await accounts.orderBy("accountNumber").get();
    return snapshot.docs.map(document => getSafeAccount({ id: document.id, ...document.data() }));
}

async function adjustAccountBalance(accountId, direction, amount, adminUsername) {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Số tiền phải là số nguyên dương");
    if (!["add", "subtract"].includes(direction)) throw new Error("Loại điều chỉnh không hợp lệ");
    const ref = accounts.doc(String(accountId || ""));
    const transactionRef = transactions.doc();
    return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) throw new Error("Không tìm thấy tài khoản");
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
    debitAccount,
    refundAccount,
    addTransaction,
    setTransactionStatus,
    getTransactions,
    getAllSafeAccounts,
    adjustAccountBalance
};
