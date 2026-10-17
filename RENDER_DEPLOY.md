# Backend Render Free + frontend Firebase Hosting

Firebase Hosting remains the public frontend at `https://loathongbaochuyenkhoan-aaab1.web.app`. Render runs the Express API at `https://mockbank-loathongbaochuyenkhoan-aaab1.onrender.com`. The frontend sends API requests to Render with bearer tokens; the server allows only the Firebase Hosting origins listed in `FRONTEND_ORIGINS`.

## Deploy the backend

1. Create a private GitHub repository and push this project. Keep `.env`, service account JSON files, and `node_modules` out of Git. This workspace currently has no Git repository or remote.
2. Sign in to Render, connect GitHub, then choose **New → Blueprint** and select the repository. Render reads `render.yaml` and creates the backend on its Free plan.
3. Set the Blueprint's private environment variables in Render:
   - `FIREBASE_SERVICE_ACCOUNT`: the complete JSON for a Firebase service account that can access Firestore.
   - `AUTH_TOKEN_SECRET`: a random secret of at least 32 characters.
   - `MOCK_BANK_WEBHOOK_SECRET`: the same webhook secret used by the mock payment flow.
   - `ADMIN_USERNAME` and `ADMIN_PASSWORD`: the admin credentials.
4. Wait for the service deploy to finish. Its URL must match the API URL in `Backend/public/api-client.js`. If Render assigns a different `onrender.com` hostname, update that file and redeploy Firebase Hosting.
5. Check `https://mockbank-loathongbaochuyenkhoan-aaab1.onrender.com/health`; the response should be `{"status":"ok"}`.

## Deploy the frontend

After the backend is live, run:

```powershell
firebase deploy --only hosting --project loathongbaochuyenkhoan-aaab1
```

Firebase Hosting serves the shop, account, Mock Bank, and admin pages. Its rewrites map short page URLs to static HTML files; API requests go directly to Render.

## Free-tier behavior

Render Free sleeps after 15 minutes without incoming traffic. The next request may wait about a minute while it starts. If the workspace reaches a free usage limit and has no payment method, Render can suspend its free services until the limit resets. Firestore remains on the existing Firebase project and has its own quotas. The Raspberry Pi speaker worker can continue to poll Firestore separately.
