const { db } = require("./firebase");
const crypto = require("crypto");
const { promisify } = require("util");
const scrypt = promisify(crypto.scrypt);

const accounts = db.collection("bankAccounts");
const transactions = db.collection("bankTransactions");
const adminAudit = db.collection("bankAdminAudit");

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
    if (account.passwordHash && account.passwordSalt) {
        const actual = Buffer.from(await hashPassword(password, account.passwordSalt), "hex");
        const expected = Buffer.from(account.passwordHash, "hex");
        return actual.length === expected.length && crypto.timingSafeEqual(actual, expected) ? account : null;
    }
    return account.password === String(password) ? account : null;
}

async function hashPassword(password, salt) {
    return (await scrypt(password, salt, 64)).toString("hex");
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
    for (let attempt = 0; attempt < 5; attempt++) {
        const accountNumber = String(crypto.randomInt(10000000, 100000000));
        try {
            return await createBankAccount({ name, username, password, accountNumber, balance: 0 }, "self-registration");
        } catch (error) {
            if (/Tên đăng nhập đã được sử dụng/.test(error.message)) throw error;
            if (!/Số tài khoản đã được sử dụng/.test(error.message) || attempt === 4) throw error;
        }
    }
    throw new Error("Không thể cấp số tài khoản lúc này");
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
    debitAccount,
    refundAccount,
    addTransaction,
    setTransactionStatus,
    getTransactions,
    getAllSafeAccounts,
    createBankAccount,
    registerBankAccount,
    deactivateBankAccount,
    adjustAccountBalance
};
