const crypto = require("crypto");

const TOKEN_TTL_SECONDS = 12 * 60 * 60;

function tokenSecret() {
    const secret = process.env.AUTH_TOKEN_SECRET || process.env.SESSION_SECRET;
    if (process.env.NODE_ENV === "production" && (!secret || secret.length < 32)) {
        throw new Error("Set AUTH_TOKEN_SECRET to a random value of at least 32 characters.");
    }
    return secret || "local-development-only-token-secret";
}

function sign(payloadPart) {
    return crypto.createHmac("sha256", tokenSecret()).update(payloadPart).digest("base64url");
}

function issueToken(role, data) {
    const payload = Buffer.from(JSON.stringify({
        role,
        data,
        exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
    })).toString("base64url");
    return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
    if (typeof token !== "string") return null;
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra !== undefined) return null;
    const expected = Buffer.from(sign(payload));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
    try {
        const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        if (!decoded.role || !decoded.data || !Number.isFinite(decoded.exp) || decoded.exp <= Date.now() / 1000) return null;
        return decoded;
    } catch {
        return null;
    }
}

module.exports = { issueToken, verifyToken };
