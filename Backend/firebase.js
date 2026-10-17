const { applicationDefault, cert, getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

if (!getApps().length) {
    const options = {};
    if (process.env.FIREBASE_PROJECT_ID) options.projectId = process.env.FIREBASE_PROJECT_ID;
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        let serviceAccount;
        try {
            serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        } catch {
            throw new Error("FIREBASE_SERVICE_ACCOUNT must contain valid JSON.");
        }
        options.credential = cert(serviceAccount);
        options.projectId = options.projectId || serviceAccount.project_id;
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.K_SERVICE) {
        options.credential = applicationDefault();
    } else {
        throw new Error("Configure FIREBASE_SERVICE_ACCOUNT or GOOGLE_APPLICATION_CREDENTIALS before starting the backend.");
    }
    initializeApp(options);
}

module.exports = { db: getFirestore() };
