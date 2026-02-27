import hashlib
import uuid
from pathlib import Path

from app.core.config import settings
from app.models.project import ProjectFile
from app.services.vault_crypto import decrypt_file, encrypt_file


def _vault_key() -> str:
    key = settings.VAULT_ENCRYPTION_KEY
    if key:
        return key
    return hashlib.sha256(settings.SECRET_KEY.encode()).hexdigest()


def _project_vault_dir() -> Path:
    target = Path(settings.VAULT_FILES_DIR) / "projects"
    target.mkdir(parents=True, exist_ok=True)
    return target


def store_project_file_encrypted(file_id: str, plaintext: bytes) -> tuple[str, str, int]:
    ciphertext, nonce = encrypt_file(_vault_key(), file_id, plaintext)
    storage_path = _project_vault_dir() / file_id
    storage_path.write_bytes(ciphertext)
    return str(storage_path), nonce, len(ciphertext)


def read_project_file_bytes(record: ProjectFile) -> bytes:
    path = Path(record.storage_path)
    if not path.exists():
        raise FileNotFoundError(f"File not found: {record.storage_path}")

    if not record.is_encrypted:
        return path.read_bytes()

    if not record.nonce:
        raise ValueError(f"Encrypted project file {record.id} has no nonce")

    ciphertext = path.read_bytes()
    return decrypt_file(_vault_key(), record.id, ciphertext, record.nonce)


def delete_project_file_blob(record: ProjectFile) -> None:
    path = Path(record.storage_path)
    if path.exists():
        path.unlink()

