# Robot kiosk UI

The UI is served directly from the `interface` directory by Chromium. The chatbot process hosts a WebSocket server on `127.0.0.1:8765`; it does not expose the microphone control port on the network. Run the chatbot from this directory so its existing `.env` file continues to load:

```bash
cd /home/pi/MockBank/chatbot_ai/chatbot
source ../venv/bin/activate
pip install -r requirements.txt
python main.py
```

If PyAudio must be built on Raspberry Pi OS, install the PortAudio development package first (`sudo apt install portaudio19-dev`). The provided virtual environment already contains the existing chatbot packages; install `websockets` there before starting the updated program.

In another terminal, open the local UI in kiosk mode:

```bash
chromium --kiosk --noerrdialogs --disable-infobars \
  file:///home/pi/MockBank/chatbot_ai/chatbot/interface/index.html
```

The microphone begins in the same always-listening mode as the existing chatbot. Tap the large button to pause/resume microphone capture. A stop request is applied when the current `SpeechRecognition.listen()` call returns (up to its existing phrase limit); it does not interrupt a response or TTS already in progress. The clear button only clears the visible UI transcript.

The six robot looks are CSS/SVG states for idle, listening, thinking, speaking, happy, and error. Speech recognition, OpenAI, gTTS, and pygame remain in `main.py`; transcript and answer events are sent to the page from that process. TTS events bracket actual pygame playback. The existing MockBank transaction notification worker has no local event channel to this chatbot UI, so payment notifications do not currently trigger the happy state.

For a quick UI check, start the chatbot, open the page, and speak a short Vietnamese prompt. To see error styling, stop the local chatbot or disconnect network access; restart it to check WebSocket reconnection. A physical Raspberry Pi, microphone, speaker, and configured API credentials are needed to verify the full voice path.
