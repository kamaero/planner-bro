import json
from typing import Dict, Set
from fastapi import WebSocket


class WebSocketManager:
    def __init__(self):
        # project_id -> set of WebSocket connections
        self._rooms: Dict[str, Set[WebSocket]] = {}
        # user_id -> WebSocket
        self._user_sockets: Dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, user_id: str, project_ids: list[str]):
        await websocket.accept()
        self._user_sockets[user_id] = websocket
        for project_id in project_ids:
            if project_id not in self._rooms:
                self._rooms[project_id] = set()
            self._rooms[project_id].add(websocket)

    def disconnect(self, websocket: WebSocket, user_id: str, project_ids: list[str]):
        self._user_sockets.pop(user_id, None)
        for project_id in project_ids:
            room = self._rooms.get(project_id)
            if room:
                room.discard(websocket)
                if not room:
                    del self._rooms[project_id]

    async def broadcast_to_project(self, project_id: str, event: str, data: dict):
        room = self._rooms.get(project_id, set())
        message = json.dumps({"event": event, "data": data})
        dead = set()
        for ws in room:
            try:
                await ws.send_text(message)
            except Exception:
                dead.add(ws)
        for ws in dead:
            room.discard(ws)

    async def send_to_user(self, user_id: str, event: str, data: dict):
        ws = self._user_sockets.get(user_id)
        if ws:
            try:
                await ws.send_text(json.dumps({"event": event, "data": data}))
            except Exception:
                self._user_sockets.pop(user_id, None)


ws_manager = WebSocketManager()
