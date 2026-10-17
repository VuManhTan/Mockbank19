# Firebase / Firestore setup

This backend uses Firebase Admin SDK. Firestore requests are made only from Express; the browser never receives a service account key.

1. Create a Firebase project and enable **Cloud Firestore** in Native mode.
2. In Project settings → Service accounts, create a private service account key. Keep the JSON file outside this repository and do not commit it.
3. Copy `.env.example` to `.env` in the repository root, or add its missing values to your existing `.env`. Set `FIREBASE_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS` to the key file path, a long random `MOCK_BANK_WEBHOOK_SECRET`, and a unique `ADMIN_PASSWORD` with `ADMIN_USERNAME` (defaults to `admin`). `.env` is ignored by Git.
4. Start the backend with those variables set. The product catalog is initialized on first request to `GET /api/products`; you can then update the four documents in the Firestore `products` collection.
   Run `npm start` for the existing combined backend and Mock Bank at port 4000.
5. Give the service account only the required Firestore access. Admin SDK bypasses Firestore client security rules, so never expose its key or call Admin SDK from browser code.

Firestore collections:

- `products/{productId}`: name, category, categoryName, price (integer VND), imageUrl, tag, active.
- `orders/{orderId}`: immutable item and price snapshots, total amount, status, created/paid time, and payment details.
- `transactions/{sha256(transactionId)}`: one transaction claim per bank transaction ID, written atomically with the paid order update. Existing claims in the legacy `processedTransactions` collection are also checked to avoid reprocessing older payments.
- `customers/{sha256(normalizedEmail)}`: customer name, normalized email, salted scrypt password hash, creation time, and active flag.
- `bankAccounts/{accountId}` and `bankTransactions/{transactionId}`: persistent Mock Bank balances and payment history. The demo accounts are inserted automatically on first Mock Bank login and are not overwritten on later startups.
- `sessions/{sessionId}`: Express login sessions, so customer, admin, and bank login state survives Cloud Run instance changes.
- `speakerNotifications/{sha256(transactionId)}`: idempotent TTS jobs created atomically with a valid paid order when `TTS_MODE=queue`. A Raspberry Pi worker claims each job, plays it, and records `DONE`; transient playback failures retry up to five times.

The administrator is available at `/admin/orders` and `/admin/products` after signing in at `/admin/login`. The admin session is separate from customer and Mock Bank sessions. Customer orders are scoped to their authenticated customer ID. The payment state is retrieved from the backend; browser requests cannot mark an order paid. Mock Bank and the backend must use the same webhook secret.
