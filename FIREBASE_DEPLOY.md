# Firebase Hosting frontend

Firebase Hosting serves the static frontend at:

`https://loathongbaochuyenkhoan-aaab1.web.app`

The Express backend runs separately on Render Free. The frontend calls the Render API using bearer tokens, so no Cloud Run rewrite is required. Set up the backend first using [RENDER_DEPLOY.md](RENDER_DEPLOY.md), then deploy Hosting from the project root:

```powershell
firebase deploy --only hosting --project loathongbaochuyenkhoan-aaab1
```

Firebase Hosting serves the shop, account, Mock Bank, and admin pages. Hosting rewrites map short routes such as `/bank/payment` and `/admin/orders` to their static HTML files.
