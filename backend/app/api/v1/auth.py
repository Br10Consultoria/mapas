"""
Endpoints de autenticação: login, 2FA, refresh, logout, perfil.
"""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, EmailStr
from typing import Optional

from app.core.database import get_db
from app.core.security import get_current_user, bearer_scheme
from app.models.user import User
from app.services.auth_service import (
    hash_password, verify_password,
    create_access_token, create_refresh_token, create_pre_auth_token,
    decode_token,
    generate_totp_secret, get_totp_uri, verify_totp,
    generate_qr_code_base64, generate_backup_codes,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str


class TwoFAVerifyRequest(BaseModel):
    pre_auth_token: str
    code: str


class TwoFASetupVerifyRequest(BaseModel):
    code: str


class RefreshRequest(BaseModel):
    refresh_token: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class UserOut(BaseModel):
    id: int
    username: str
    email: Optional[str]
    full_name: Optional[str]
    is_superuser: bool
    totp_enabled: bool

    class Config:
        from_attributes = True


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserOut
    requires_2fa: bool = False
    pre_auth_token: Optional[str] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/login")
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    """
    Passo 1: Valida usuário e senha.
    - Se 2FA não está habilitado: retorna access_token + refresh_token imediatamente.
    - Se 2FA está habilitado: retorna pre_auth_token e requires_2fa=True.
    """
    result = await db.execute(select(User).where(User.username == body.username))
    user = result.scalar_one_or_none()

    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuário ou senha incorretos.",
        )

    if not user.is_active:
        raise HTTPException(status_code=400, detail="Conta desativada.")

    # Atualiza last_login
    user.last_login = datetime.now(timezone.utc)
    await db.commit()

    if user.totp_enabled and user.totp_secret:
        # Precisa do 2FA — emite token temporário
        pre_token = create_pre_auth_token(user.id)
        return {
            "requires_2fa": True,
            "pre_auth_token": pre_token,
            "access_token": None,
            "refresh_token": None,
            "token_type": "bearer",
            "user": None,
        }

    # Sem 2FA — emite tokens finais
    access = create_access_token({"sub": str(user.id)})
    refresh = create_refresh_token({"sub": str(user.id)})
    return TokenResponse(
        access_token=access,
        refresh_token=refresh,
        requires_2fa=False,
        user=UserOut.model_validate(user),
    )


@router.post("/2fa/verify")
async def verify_2fa(body: TwoFAVerifyRequest, db: AsyncSession = Depends(get_db)):
    """
    Passo 2: Valida o código TOTP após login com senha.
    Retorna access_token + refresh_token se o código for válido.
    """
    payload = decode_token(body.pre_auth_token)
    if not payload or payload.get("type") != "pre_auth":
        raise HTTPException(status_code=401, detail="Token de pré-autenticação inválido ou expirado.")

    user_id = int(payload["sub"])
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user or not user.totp_secret:
        raise HTTPException(status_code=401, detail="Usuário não encontrado.")

    if not verify_totp(user.totp_secret, body.code):
        raise HTTPException(status_code=401, detail="Código 2FA inválido.")

    access = create_access_token({"sub": str(user.id)})
    refresh = create_refresh_token({"sub": str(user.id)})
    return TokenResponse(
        access_token=access,
        refresh_token=refresh,
        requires_2fa=False,
        user=UserOut.model_validate(user),
    )


@router.post("/2fa/setup/init")
async def setup_2fa_init(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Gera um novo secret TOTP e retorna o QR code para configurar o app."""
    if current_user.totp_enabled:
        raise HTTPException(status_code=400, detail="2FA já está habilitado.")

    secret = generate_totp_secret()
    uri = get_totp_uri(secret, current_user.username)
    qr_b64 = generate_qr_code_base64(uri)

    # Salva o secret temporariamente (ainda não habilitado)
    current_user.totp_secret = secret
    await db.commit()

    return {
        "secret": secret,
        "qr_code": f"data:image/png;base64,{qr_b64}",
        "uri": uri,
    }


@router.post("/2fa/setup/confirm")
async def setup_2fa_confirm(
    body: TwoFASetupVerifyRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Confirma o código TOTP e habilita o 2FA na conta."""
    if not current_user.totp_secret:
        raise HTTPException(status_code=400, detail="Inicie o setup do 2FA primeiro.")

    if not verify_totp(current_user.totp_secret, body.code):
        raise HTTPException(status_code=400, detail="Código inválido. Tente novamente.")

    current_user.totp_enabled = True
    backup_codes = generate_backup_codes()
    await db.commit()

    return {
        "message": "2FA habilitado com sucesso.",
        "backup_codes": backup_codes,
    }


@router.post("/2fa/disable")
async def disable_2fa(
    body: TwoFASetupVerifyRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Desabilita o 2FA após confirmar o código atual."""
    if not current_user.totp_enabled:
        raise HTTPException(status_code=400, detail="2FA não está habilitado.")

    if not verify_totp(current_user.totp_secret, body.code):
        raise HTTPException(status_code=400, detail="Código inválido.")

    current_user.totp_enabled = False
    current_user.totp_secret = None
    await db.commit()

    return {"message": "2FA desabilitado com sucesso."}


@router.post("/refresh")
async def refresh_token(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    """Renova o access_token usando o refresh_token."""
    payload = decode_token(body.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Refresh token inválido ou expirado.")

    user_id = int(payload["sub"])
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Usuário não encontrado.")

    access = create_access_token({"sub": str(user.id)})
    return {"access_token": access, "token_type": "bearer"}


@router.get("/me", response_model=UserOut)
async def get_me(current_user: User = Depends(get_current_user)):
    """Retorna os dados do usuário autenticado."""
    return current_user


@router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Altera a senha do usuário autenticado."""
    if not verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Senha atual incorreta.")

    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="A nova senha deve ter pelo menos 8 caracteres.")

    current_user.hashed_password = hash_password(body.new_password)
    await db.commit()
    return {"message": "Senha alterada com sucesso."}
