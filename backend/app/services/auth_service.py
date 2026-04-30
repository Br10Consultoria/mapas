"""
Serviço de autenticação: JWT + TOTP 2FA
Usa bcrypt puro (sem passlib) para evitar incompatibilidades de versão.
"""
import secrets
import logging
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from jose import JWTError, jwt
import pyotp
import qrcode
import qrcode.image.svg
import io
import base64

from app.core.config import settings

logger = logging.getLogger(__name__)

# ── Configurações ─────────────────────────────────────────────────────────────

SECRET_KEY = settings.JWT_SECRET_KEY
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES
REFRESH_TOKEN_EXPIRE_DAYS = settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS


# ── Password ──────────────────────────────────────────────────────────────────

def _pre_hash(password: str) -> bytes:
    """Pré-processa a senha com SHA-256 para evitar o limite de 72 bytes do bcrypt.
    Retorna bytes prontos para o bcrypt."""
    return hashlib.sha256(password.encode('utf-8')).hexdigest().encode('utf-8')


def hash_password(password: str) -> str:
    """Gera hash bcrypt da senha. Retorna string para armazenar no banco."""
    hashed = bcrypt.hashpw(_pre_hash(password), bcrypt.gensalt(rounds=12))
    return hashed.decode('utf-8')


def verify_password(plain: str, hashed: str) -> bool:
    """Verifica se a senha plain corresponde ao hash armazenado."""
    try:
        return bcrypt.checkpw(_pre_hash(plain), hashed.encode('utf-8'))
    except Exception:
        return False


# ── JWT ───────────────────────────────────────────────────────────────────────

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire, "type": "access"})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "type": "refresh"})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def create_pre_auth_token(user_id: int) -> str:
    """Token temporário emitido após senha correta, antes do 2FA."""
    to_encode = {"sub": str(user_id), "type": "pre_auth"}
    expire = datetime.now(timezone.utc) + timedelta(minutes=5)
    to_encode["exp"] = expire
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None


# ── TOTP 2FA ──────────────────────────────────────────────────────────────────

def generate_totp_secret() -> str:
    return pyotp.random_base32()


def get_totp_uri(secret: str, username: str, issuer: str = "NetMap") -> str:
    totp = pyotp.TOTP(secret)
    return totp.provisioning_uri(name=username, issuer_name=issuer)


def verify_totp(secret: str, code: str) -> bool:
    totp = pyotp.TOTP(secret)
    # valid_window=1 aceita o código do intervalo anterior (30s) para tolerância de clock skew
    return totp.verify(code, valid_window=1)


def generate_qr_code_base64(uri: str) -> str:
    """Gera QR code como PNG base64 para exibir no frontend."""
    img = qrcode.make(uri)
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    buffer.seek(0)
    return base64.b64encode(buffer.read()).decode()


def generate_backup_codes(count: int = 8) -> list[str]:
    """Gera códigos de backup de uso único (8 códigos de 8 caracteres)."""
    return [secrets.token_hex(4).upper() for _ in range(count)]
