import hashlib
from pathlib import Path

from app.core.config import settings
from app.models.chat import ChatAttachment
from app.services.vault_crypto import decrypt_file, encrypt_file


def _vault_key() -> str:
    key = settings.VAULT_ENCRYPTION_KEY
    if key:
        return key
    return hashlib.sha256(settings.SECRET_KEY.encode()).hexdigest()


def _chat_vault_dir() -> Path:
    target = Path(settings.VAULT_FILES_DIR) / "Chat_attachments"
    target.mkdir(parents=True, exist_ok=True)
    return target


def store_chat_attachment_encrypted(attachment_id: str, plaintext: bytes) -> tuple[str, str, int]:
    ciphertext, nonce = encrypt_file(_vault_key(), attachment_id, plaintext)
    storage_path = _chat_vault_dir() / attachment_id
    storage_path.write_bytes(ciphertext)
    return str(storage_path), nonce, len(ciphertext)


def read_chat_attachment_bytes(attachment: ChatAttachment) -> bytes:
    path = Path(attachment.storage_path)
    if not path.exists():
        raise FileNotFoundError(f"Attachment not found: {attachment.storage_path}")
    ciphertext = path.read_bytes()
    return decrypt_file(_vault_key(), attachment.id, ciphertext, attachment.nonce)
