const crypto = require("crypto");
const { promisify } = require("util");
const { db } = require("./firebase");

const scrypt = promisify(crypto.scrypt);
const CUSTOMER_COLLECTION = "customers";

function normalizeEmail(value) {
    const email = String(value || "").trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Email không hợp lệ.");
    return email;
}

function publicCustomer(customer) {
    if (!customer) return null;
    const { passwordSalt, passwordHash, ...safe } = customer;
    return safe;
}

async function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
    const derived = await scrypt(password, salt, 64);
    return { passwordSalt: salt, passwordHash: derived.toString("hex") };
}

async function passwordsMatch(password, customer) {
    const { passwordHash } = await hashPassword(password, customer.passwordSalt);
    const actual = Buffer.from(passwordHash, "hex");
    const expected = Buffer.from(customer.passwordHash, "hex");
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

async function registerCustomer({ name, email, password }) {
    const safeName = String(name || "").trim();
    const emailNormalized = normalizeEmail(email);
    if (safeName.length < 2 || safeName.length > 100) throw new Error("Tên cần dài từ 2 đến 100 ký tự.");
    if (typeof password !== "string" || password.length < 10 || password.length > 128) throw new Error("Mật khẩu cần có ít nhất 10 ký tự.");

    // A deterministic document ID makes email uniqueness atomic under concurrent signups.
    const uid = crypto.createHash("sha256").update(emailNormalized).digest("hex");
    const ref = db.collection(CUSTOMER_COLLECTION).doc(uid);
    const credentials = await hashPassword(password);
    const customer = { uid, name: safeName, email: emailNormalized, emailNormalized, ...credentials, createdAt: new Date().toISOString(), active: true };
    try {
        await ref.create(customer);
    } catch (error) {
        if (error.code === 6 || error.code === "already-exists") throw new Error("Email này đã được đăng ký.");
        throw error;
    }
    return publicCustomer(customer);
}

async function loginCustomer({ email, password }) {
    const emailNormalized = normalizeEmail(email);
    if (typeof password !== "string" || password.length > 128) return null;
    const uid = crypto.createHash("sha256").update(emailNormalized).digest("hex");
    const snapshot = await db.collection(CUSTOMER_COLLECTION).doc(uid).get();
    if (!snapshot.exists) return null;
    const customer = snapshot.data();
    if (!customer.active || !(await passwordsMatch(password, customer))) return null;
    return publicCustomer(customer);
}

function equalSecret(actualValue, expectedValue) {
    const actual = Buffer.from(String(actualValue || ""));
    const expected = Buffer.from(String(expectedValue || ""));
    return actual.length > 0 && actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function loginAdmin({ username, password }) {
    const configuredUsername = process.env.ADMIN_USERNAME || "admin";
    const configuredPassword = process.env.ADMIN_PASSWORD;
    if (!configuredPassword) throw new Error("ADMIN_PASSWORD chưa được cấu hình trong .env.");
    if (!equalSecret(String(username || "").trim(), configuredUsername) || !equalSecret(password, configuredPassword)) return null;
    return { username: configuredUsername };
}

module.exports = { registerCustomer, loginCustomer, loginAdmin, publicCustomer };
