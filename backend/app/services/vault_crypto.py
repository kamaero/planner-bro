"""
AES-256-GCM encryption for Vault files.

Flow:
  1. derive_file_key(master_key, file_id)  →  32-byte AES key (unique per file)
  2. encrypt_file(...)                     →  ciphertext (includes GCM auth tag) + random nonce
  3. decrypt_file(...)                     →  original plaintext

Key derivation uses HKDF-SHA256 so each file has an independent key derived from the
master key. Compromising one file's key (e.g., via side-channel) does not compromise
others — the master key itself stays in the environment config.
"""
import base64
import os

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from jose import JWTError, jwt
from datetime import datetime, timedelta, timezone


# ---------------------------------------------------------------------------
# Key derivation
# ---------------------------------------------------------------------------

def derive_file_key(master_key: bytes, file_id: str) -> bytes:
    """
    Derive a 32-byte AES key for *this specific file* from the master key using HKDF-SHA256.
    The file_id is used as the info parameter, binding the derived key to this specific file.
    """
    return HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=None,
        info=file_id.encode("utf-8"),
    ).derive(master_key)


# ---------------------------------------------------------------------------
# File encryption / decryption
# ---------------------------------------------------------------------------

def encrypt_file(master_key_hex: str, file_id: str, plaintext: bytes) -> tuple[bytes, str]:
    """
    Encrypt *plaintext* with AES-256-GCM.

    Returns:
        (ciphertext_with_auth_tag, nonce_b64)

    The caller stores nonce_b64 in the DB; the ciphertext is written to disk.
    AESGCM.encrypt() appends the 16-byte auth tag automatically.
    """
    key = derive_file_key(bytes.fromhex(master_key_hex), file_id)
    nonce = os.urandom(12)          # 96-bit random nonce — GCM best-practice
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(nonce, plaintext, None)   # AAD=None
    return ciphertext, base64.b64encode(nonce).decode()


def decrypt_file(master_key_hex: str, file_id: str, ciphertext: bytes, nonce_b64: str) -> bytes:
    """
    Decrypt *ciphertext* (with embedded auth tag) back to plaintext.
    Raises cryptography.exceptions.InvalidTag if ciphertext was tampered with.
    """
    key = derive_file_key(bytes.fromhex(master_key_hex), file_id)
    nonce = base64.b64decode(nonce_b64)
    aesgcm = AESGCM(key)
    return aesgcm.decrypt(nonce, ciphertext, None)


# ---------------------------------------------------------------------------
# Signed download tokens  (JWT, short-lived)
# ---------------------------------------------------------------------------

DOWNLOAD_TOKEN_EXPIRE_MINUTES = 15


def create_download_token(file_id: str, user_id: str, secret: str) -> str:
    """
    Create a signed JWT that authorises *user_id* to download *file_id*.
    Expires in 15 minutes — short enough to limit URL-sharing risk.
    """
    payload = {
        "sub": user_id,
        "fid": file_id,
        "purpose": "vault_download",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=DOWNLOAD_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def verify_download_token(token: str, secret: str, file_id: str, user_id: str) -> bool:
    """
    Return True if token is valid, unexpired, and bound to (file_id, user_id).
    """
    try:
        data = jwt.decode(token, secret, algorithms=["HS256"])
        return (
            data.get("purpose") == "vault_download"
            and data.get("fid") == file_id
            and data.get("sub") == user_id
        )
    except JWTError:
        return False
