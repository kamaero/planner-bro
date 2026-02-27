import hashlib
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
    target = Path(settings.VAULT_FILES_DIR) / "Project_processing"
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
        # Backward-compatibility: old encrypted project files were stored in uploads/vault/projects.
        if "/projects/" in str(path):
            legacy_to_new = Path(str(path).replace("/projects/", "/Project_processing/"))
            if legacy_to_new.exists():
                path = legacy_to_new
            else:
                raise FileNotFoundError(f"File not found: {record.storage_path}")
        else:
            legacy_fallback = Path(str(path).replace("/Project_processing/", "/projects/"))
            if legacy_fallback.exists():
                path = legacy_fallback
            else:
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
        return
    # Cleanup fallback path when DB still points to old/new directory name.
    alt_old = Path(str(path).replace("/Project_processing/", "/projects/"))
    if alt_old.exists():
        alt_old.unlink()
        return
    alt_new = Path(str(path).replace("/projects/", "/Project_processing/"))
    if alt_new.exists():
        alt_new.unlink()
