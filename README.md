# NetMap — Sistema de Mapa de Redes

Sistema de monitoramento e visualização de topologia de redes com coleta SNMP em tempo real.
Suporte a roteadores e switches **Huawei**, **MikroTik** e **Datacom**.

## Funcionalidades

- **Mapa de topologia interativo** com Cytoscape.js (arrastar, zoom, clique)
- **Descoberta automática** de dispositivos via LLDP/CDP
- **Coleta SNMP** de métricas de interfaces (tráfego, erros, status)
- **Monitoramento em tempo real** via WebSocket
- **Dashboard** com resumo de saúde da rede
- **Gerenciamento de dispositivos** (CRUD completo)
- **Interface responsiva** com tema claro profissional

## Arquitetura

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (React + Cytoscape.js)  :80                   │
│  ─ Dashboard  ─ Mapa de Rede  ─ Dispositivos            │
└────────────────────┬────────────────────────────────────┘
                     │ HTTP / WebSocket
┌────────────────────▼────────────────────────────────────┐
│  Backend (FastAPI + Python)  :8000                      │
│  ─ API REST  ─ WebSocket  ─ Scheduler SNMP              │
└──────────┬─────────────────────┬───────────────────────┘
           │                     │
┌──────────▼──────┐   ┌──────────▼──────────────────────┐
│  PostgreSQL :5432│   │  InfluxDB :8086                  │
│  Topologia       │   │  Métricas de interfaces          │
│  Dispositivos    │   │  Séries temporais                │
│  Links           │   │                                  │
└──────────────────┘   └──────────────────────────────────┘
```

## Pré-requisitos

- Docker Engine 24+
- Docker Compose v2+
- Debian 13 (ou qualquer Linux com Docker)
- Acesso de rede aos dispositivos SNMP (porta UDP 161)

## Início Rápido

### 1. Clone o repositório

```bash
git clone https://github.com/Br10Consultoria/mapas.git
cd mapas
```

### 2. Configure as variáveis de ambiente

```bash
cp .env.example .env
# Edite .env com suas configurações (senhas, comunidade SNMP, etc.)
```

### 3. Suba os containers

```bash
# Produção
docker compose up -d

# Desenvolvimento (com hot reload)
docker compose -f docker-compose.dev.yml up
```

### 4. Acesse a interface

| Serviço       | URL                         |
|---------------|-----------------------------|
| Interface Web | http://localhost            |
| API (Swagger) | http://localhost:8000/docs  |
| InfluxDB UI   | http://localhost:8086       |

### 5. Adicione seus dispositivos

1. Acesse **Dispositivos** na interface web
2. Clique em **Adicionar Dispositivo**
3. Informe IP, hostname, comunidade SNMP e fabricante
4. Clique em **Consultar Agora** para forçar o primeiro polling
5. Acesse **Mapa de Rede** e clique em **Descoberta LLDP**

## Configuração SNMP nos Dispositivos

### Huawei (VRP)
```
snmp-agent
snmp-agent community read public
snmp-agent sys-info version v2c
lldp enable
```

### MikroTik (RouterOS)
```
/snmp set enabled=yes community=public
/ip neighbor discovery-settings set discover-interface-list=all
```

### Datacom
```
snmp-server community public ro
lldp run
```

## Estrutura do Projeto

```
mapas/
├── backend/
│   ├── app/
│   │   ├── api/v1/          # Rotas REST (devices, topology, metrics)
│   │   ├── collectors/      # Coletor SNMP
│   │   ├── core/            # Config, Database
│   │   ├── models/          # Modelos SQLAlchemy
│   │   ├── services/        # Poller, Discovery
│   │   └── main.py          # Entrypoint FastAPI
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/      # Layout, NetworkMap
│   │   ├── hooks/           # useWebSocket
│   │   ├── pages/           # Dashboard, Topology, Devices
│   │   ├── services/        # API client (axios)
│   │   └── styles/          # Tailwind CSS
│   ├── Dockerfile
│   └── package.json
├── docker/
│   └── nginx/default.conf   # Proxy reverso
├── docker-compose.yml        # Produção
├── docker-compose.dev.yml    # Desenvolvimento
└── .env.example
```

## Próximas Etapas (Roadmap)

- [ ] Coleta NetFlow/sFlow para tráfego detalhado
- [ ] Gráficos de banda por interface (Recharts)
- [ ] Alertas por e-mail/Webhook quando dispositivo cai
- [ ] Suporte SNMP v3 (autenticação + criptografia)
- [ ] Importação de topologia via CSV
- [ ] Múltiplos mapas (por site, por VLAN)

## Licença

MIT — Br10 Consultoria
