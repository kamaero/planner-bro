import os
import firebase_admin
from firebase_admin import credentials, messaging

_initialized = False


def init_firebase():
    global _initialized
    if _initialized:
        return
    cred_path = os.environ.get("FIREBASE_CREDENTIALS_PATH", "firebase-credentials.json")
    if os.path.isfile(cred_path):
        cred = credentials.Certificate(cred_path)
        firebase_admin.initialize_app(cred)
        _initialized = True


def send_push_notification(token: str, title: str, body: str, data: dict = None) -> bool:
    if not _initialized:
        return False
    try:
        message = messaging.Message(
            notification=messaging.Notification(title=title, body=body),
            data={str(k): str(v) for k, v in (data or {}).items()},
            token=token,
        )
        messaging.send(message)
        return True
    except Exception:
        return False


def send_push_to_multiple(tokens: list[str], title: str, body: str, data: dict = None) -> int:
    if not _initialized or not tokens:
        return 0
    try:
        message = messaging.MulticastMessage(
            notification=messaging.Notification(title=title, body=body),
            data={str(k): str(v) for k, v in (data or {}).items()},
            tokens=tokens,
        )
        response = messaging.send_each_for_multicast(message)
        return response.success_count
    except Exception:
        return 0
