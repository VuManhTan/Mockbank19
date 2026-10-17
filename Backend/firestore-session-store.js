const session = require("express-session");
const { db } = require("./firebase");

class FirestoreSessionStore extends session.Store {
    constructor() {
        super();
        this.collection = db.collection("sessions");
    }

    get(sessionId, callback) {
        this.collection.doc(sessionId).get()
            .then(async snapshot => {
                if (!snapshot.exists) return callback(null, null);
                const record = snapshot.data();
                if (record.expiresAt && record.expiresAt.toMillis() <= Date.now()) {
                    await snapshot.ref.delete();
                    return callback(null, null);
                }
                callback(null, record.session || null);
            })
            .catch(callback);
    }

    set(sessionId, value, callback = () => {}) {
        const expiresAt = value.cookie?.expires
            ? new Date(value.cookie.expires)
            : value.cookie?.maxAge
                ? new Date(Date.now() + value.cookie.maxAge)
                : null;
        this.collection.doc(sessionId).set({
            session: JSON.parse(JSON.stringify(value)),
            expiresAt
        }).then(() => callback(null)).catch(callback);
    }

    touch(sessionId, value, callback = () => {}) {
        this.set(sessionId, value, callback);
    }

    destroy(sessionId, callback = () => {}) {
        this.collection.doc(sessionId).delete().then(() => callback(null)).catch(callback);
    }
}

module.exports = FirestoreSessionStore;
