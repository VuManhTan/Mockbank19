const { spawn } = require("child_process");
const path = require("path");
const crypto = require("crypto");
const { db } = require("./firebase");
const { createMessage } = require("./tts");

const notifications = db.collection("speakerNotifications");
const workerId = `${process.env.HOSTNAME || "raspberry-pi"}-${crypto.randomBytes(4).toString("hex")}`;
const script = path.resolve(__dirname, "..", "scripts", "speak.py");
const python = process.env.PYTHON_COMMAND || (process.platform === "win32" ? "python" : "python3");
const pollDelayMs = Math.max(500, Number(process.env.SPEAKER_POLL_MS) || 1500);
const maxAttempts = 5;
let stopping = false;

function timestamp(value) {
    return value && typeof value.toMillis === "function" ? value.toMillis() : Number(value) || 0;
}

async function claimNext() {
    const [pending, processing] = await Promise.all([
        notifications.where("status", "==", "PENDING").limit(25).get(),
        notifications.where("status", "==", "PROCESSING").limit(25).get()
    ]);
    const now = Date.now();
    const candidates = [
        ...pending.docs,
        ...processing.docs.filter(doc => timestamp(doc.get("leaseUntil")) <= now)
    ].filter(doc => timestamp(doc.get("retryAfter")) <= now)
        .sort((a, b) => String(a.get("createdAt")).localeCompare(String(b.get("createdAt"))));

    for (const candidate of candidates) {
        const claimed = await db.runTransaction(async transaction => {
            const ref = notifications.doc(candidate.id);
            const snapshot = await transaction.get(ref);
            if (!snapshot.exists) return null;
            const job = snapshot.data();
            const expiredLease = job.status === "PROCESSING" && timestamp(job.leaseUntil) <= Date.now();
            if (job.status !== "PENDING" && !expiredLease) return null;
            if (timestamp(job.retryAfter) > Date.now()) return null;
            const attempts = Number(job.attempts || 0) + 1;
            transaction.update(ref, {
                status: "PROCESSING",
                workerId,
                attempts,
                leaseUntil: new Date(Date.now() + 3 * 60 * 1000),
                retryAfter: null,
                updatedAt: new Date().toISOString()
            });
            return { ...job, notificationId: candidate.id, attempts };
        });
        if (claimed) return claimed;
    }
    return null;
}

function play(message) {
    return new Promise((resolve, reject) => {
        const child = spawn(python, [script, message], {
            stdio: "inherit",
            windowsHide: true
        });
        child.once("error", reject);
        child.once("close", code => code === 0
            ? resolve()
            : reject(new Error(`speak.py kết thúc với mã ${code}`)));
    });
}

async function finish(job, status, error = null) {
    const ref = notifications.doc(job.notificationId);
    await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists || snapshot.get("workerId") !== workerId) return;
        if (status === "DONE") {
            transaction.update(ref, {
                status: "DONE",
                playedAt: new Date().toISOString(),
                workerId: null,
                leaseUntil: null,
                lastError: null
            });
            return;
        }
        const exhausted = Number(snapshot.get("attempts") || 0) >= maxAttempts;
        const waitMs = Math.min(60_000, Number(snapshot.get("attempts") || 1) * 5_000);
        transaction.update(ref, {
            status: exhausted ? "FAILED" : "PENDING",
            workerId: null,
            leaseUntil: null,
            retryAfter: exhausted ? null : new Date(Date.now() + waitMs),
            lastError: String(error?.message || error || "TTS playback failed").slice(0, 500)
        });
    });
}

async function run() {
    console.log(`[Speaker] Worker ${workerId} đang chạy; Python: ${python}`);
    while (!stopping) {
        try {
            const job = await claimNext();
            if (!job) {
                await new Promise(resolve => setTimeout(resolve, pollDelayMs));
                continue;
            }
            console.log(`[Speaker] Đọc giao dịch ${job.transactionId}, đơn ${job.orderId}.`);
            try {
                await play(createMessage({ amount: job.amount }));
                await finish(job, "DONE");
                console.log(`[Speaker] Đã phát xong thông báo ${job.notificationId}.`);
            } catch (error) {
                await finish(job, "FAILED", error);
                console.error(`[Speaker] Phát thông báo thất bại (${job.attempts}/${maxAttempts}):`, error.message);
            }
        } catch (error) {
            console.error("[Speaker] Lỗi xử lý hàng đợi:", error.message);
            await new Promise(resolve => setTimeout(resolve, pollDelayMs));
        }
    }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => { stopping = true; });
}

run().catch(error => {
    console.error("[Speaker] Worker dừng do lỗi khởi tạo:", error);
    process.exitCode = 1;
});
