"""Loopback-only WebSocket bridge between the chatbot and its kiosk UI."""

import asyncio
import json
import threading

import websockets


class UIBridge:
    def __init__(self, host="127.0.0.1", port=8765, on_command=None):
        self.host = host
        self.port = port
        self.on_command = on_command
        self.clients = set()
        self.loop = None
        self.thread = None

    def start(self):
        self.thread = threading.Thread(target=self._thread_main, daemon=True)
        self.thread.start()

    def _thread_main(self):
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        self.loop.run_until_complete(self._serve())

    async def _serve(self):
        async with websockets.serve(self._handle, self.host, self.port, max_size=4096):
            print(f"[UI] WebSocket đang nghe tại ws://{self.host}:{self.port}", flush=True)
            await asyncio.Future()

    async def _handle(self, websocket, *_args):
        self.clients.add(websocket)
        try:
            await websocket.send(json.dumps({"type": "connection", "connected": True}))
            async for raw in websocket:
                try:
                    message = json.loads(raw)
                except (TypeError, json.JSONDecodeError):
                    continue
                if isinstance(message, dict) and self.on_command:
                    self.on_command(message)
        finally:
            self.clients.discard(websocket)

    async def _broadcast(self, event):
        if not self.clients:
            return
        payload = json.dumps(event, ensure_ascii=False)
        clients = tuple(self.clients)
        results = await asyncio.gather(
            *(client.send(payload) for client in clients),
            return_exceptions=True,
        )
        for client, result in zip(clients, results):
            if isinstance(result, Exception):
                self.clients.discard(client)

    def emit(self, event_type, **data):
        loop = self.loop
        if loop and loop.is_running():
            asyncio.run_coroutine_threadsafe(
                self._broadcast({"type": event_type, **data}), loop
            )
