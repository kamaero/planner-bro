import json
from typing import Dict, Set
from fastapi import WebSocket


class WebSocketManager:
    def __init__(self):
        # project_id -> set of WebSocket connections
        self._rooms: Dict[str, Set[WebSocket]] = {}
        # user_id -> set of WebSocket
        self._user_sockets: Dict[str, Set[WebSocket]] = {}
        # WebSocket -> metadata
        self._socket_user: Dict[WebSocket, str] = {}
        self._socket_projects: Dict[WebSocket, list[str]] = {}

    async def connect(self, websocket: WebSocket, user_id: str, project_ids: list[str]):
        await websocket.accept()
        if user_id not in self._user_sockets:
            self._user_sockets[user_id] = set()
        self._user_sockets[user_id].add(websocket)
        self._socket_user[websocket] = user_id
        self._socket_projects[websocket] = project_ids
        for project_id in project_ids:
            if project_id not in self._rooms:
                self._rooms[project_id] = set()
            self._rooms[project_id].add(websocket)

    def disconnect(self, websocket: WebSocket):
        user_id = self._socket_user.pop(websocket, None)
        project_ids = self._socket_projects.pop(websocket, [])

        if user_id is not None:
            sockets = self._user_sockets.get(user_id)
            if sockets is not None:
                sockets.discard(websocket)
                if not sockets:
                    self._user_sockets.pop(user_id, None)

        for project_id in project_ids:
            room = self._rooms.get(project_id)
            if room:
                room.discard(websocket)
                if not room:
                    del self._rooms[project_id]

    def _disconnect_if_known(self, websocket: WebSocket):
        if websocket in self._socket_user or websocket in self._socket_projects:
            self.disconnect(websocket)

    async def broadcast_to_project(self, project_id: str, event: str, data: dict):
        room = self._rooms.get(project_id, set())
        message = json.dumps({"event": event, "data": data})
        dead = set()
        for ws in list(room):
            try:
                await ws.send_text(message)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self._disconnect_if_known(ws)

    async def send_to_user(self, user_id: str, event: str, data: dict):
        sockets = self._user_sockets.get(user_id)
        if not sockets:
            return

        message = json.dumps({"event": event, "data": data})
        dead: set[WebSocket] = set()
        for ws in list(sockets):
            try:
                await ws.send_text(message)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self._disconnect_if_known(ws)


ws_manager = WebSocketManager()
