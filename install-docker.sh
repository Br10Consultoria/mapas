#!/bin/bash
# ============================================================
# Script de instalação do Docker Engine + Docker Compose
# Compatível com Debian 12 (Bookworm) e Debian 13 (Trixie)
# Uso: bash install-docker.sh
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()    { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERRO]${NC} $1"; exit 1; }

# Verificar root
if [ "$EUID" -ne 0 ]; then
  error "Execute como root: sudo bash install-docker.sh"
fi

info "Detectando sistema operacional..."
. /etc/os-release
info "Sistema: $PRETTY_NAME"

# Debian 13 (Trixie) ainda não tem repositório oficial do Docker.
# Usamos o repositório do Debian 12 (Bookworm) que é compatível.
if [[ "$VERSION_CODENAME" == "trixie" || "$VERSION_CODENAME" == "sid" ]]; then
  warn "Debian 13 detectado. Usando repositório do Debian 12 (bookworm) para Docker."
  DOCKER_CODENAME="bookworm"
else
  DOCKER_CODENAME="$VERSION_CODENAME"
fi

info "Removendo versões antigas do Docker (se existirem)..."
apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

info "Instalando dependências..."
apt-get update -qq
apt-get install -y \
  ca-certificates \
  curl \
  gnupg \
  lsb-release \
  apt-transport-https

info "Adicionando chave GPG oficial do Docker..."
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

info "Adicionando repositório do Docker..."
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/debian \
  ${DOCKER_CODENAME} stable" \
  | tee /etc/apt/sources.list.d/docker.list > /dev/null

info "Atualizando lista de pacotes..."
apt-get update -qq

info "Instalando Docker Engine, CLI e Compose Plugin..."
apt-get install -y \
  docker-ce \
  docker-ce-cli \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin

info "Habilitando e iniciando o serviço Docker..."
systemctl enable docker
systemctl start docker

info "Verificando instalação..."
docker --version
docker compose version

info "Adicionando usuário atual ao grupo docker (evita uso de sudo)..."
REAL_USER="${SUDO_USER:-$USER}"
if [ -n "$REAL_USER" ] && [ "$REAL_USER" != "root" ]; then
  usermod -aG docker "$REAL_USER"
  warn "Usuário '$REAL_USER' adicionado ao grupo docker."
  warn "Faça logout e login novamente para aplicar, ou execute: newgrp docker"
fi

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  Docker instalado com sucesso!             ${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo "Próximo passo — suba o NetMap:"
echo ""
echo "  cd ~/mapas"
echo "  cp .env.example .env"
echo "  docker compose up -d"
echo ""
