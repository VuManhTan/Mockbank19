# Raspberry Pi speaker worker

In the deployed setup, Express and the Mock Bank run on Cloud Run. Cloud Run cannot output sound through the Raspberry Pi's speaker, so the webhook writes one `speakerNotifications` job to Firestore in the same transaction that marks an order paid. The worker below runs on the Pi, claims jobs, plays the existing `scripts/speak.py` notification, then marks the job `DONE`.

## Prepare the Pi

1. Copy/clone this project onto the Raspberry Pi. Use Node.js 20 or newer and Python 3.
2. Configure the Pi's audio output and test that it can play sound.
3. Install TTS packages:

   ```bash
   python3 -m venv .venv
   . .venv/bin/activate
   pip install -r scripts/requirements.txt
   ```

4. Create a Google service account for the Pi with the `Cloud Datastore User` role on the existing Firebase project. Store its JSON key outside the project directory with file access restricted to the Pi user. Do not commit or copy it into the public Hosting directory.
5. Set the worker's environment. For example, create `.env` in the project root with:

   ```dotenv
   FIREBASE_PROJECT_ID=loathongbaochuyenkhoan-aaab1
   GOOGLE_APPLICATION_CREDENTIALS=/home/pi/keys/firebase-speaker-worker.json
   ```

   Use the actual protected key path on the Pi. This worker needs Firestore access; it does not need the Mock Bank webhook secret or admin password.

6. Start the worker from the project root:

   ```bash
   npm run speaker:worker
   ```

Keep the worker running as a systemd service for unattended operation. It checks Firestore every 1.5 seconds by default; set `SPEAKER_POLL_MS` to change the interval.

## Cloud Run configuration

Set `TTS_MODE=queue` on the Cloud Run service. Do not run the direct local TTS path in Cloud Run. Grant the Cloud Run runtime service account Firestore access as described in `FIREBASE_DEPLOY.md`. The Pi worker and Cloud Run must point to the same Firebase project.

The queue prevents webhook retries from enqueuing a second notification for the same transaction. If a worker crashes while a notification is being played, its three-minute lease can expire and the job may be attempted again; physical audio playback cannot be guaranteed exactly once across a device crash.

## Persistent Mock Bank data

The demo accounts are stored in `bankAccounts` and `bankTransactions` in Firestore now. On first use, the original demo accounts are inserted if missing; subsequent logins do not reset their balances. Existing in-memory balances from before this change cannot be recovered after the old process has stopped.
