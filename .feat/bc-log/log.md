# Heimdall Monitoring Feature

**Status:** Deployed to production (2026-05-25). **Temporarily stopped** on server (2026-05-26) due to RAM pressure.

## What it does

Grafana + Prometheus monitoring for the chat stack. Dashboards, scrape health, and Grafana-managed alert rules (no separate Alertmanager).

## Key locations

| Area | Path |
|------|------|
| App metrics | `chat-service` — `GET /metrics` (auth: `CHAT_API_SECRET` bearer token) |
| Stack (repo) | `heimdall/` in this workspace |
| Stack (server) | `/opt/apps/heimdall` — `git@bitbucket.org:mafia-dev/chat-heimdall.git` |
| Usage guide | `heimdall/GRAFANA_PROMETHEUS_USAGE.md` |
| Deploy / rollback | `.feat/bc-log/deploy-2026-05-16.md` |

## Production (2026-05-26)

| Item | Value |
|------|-------|
| Grafana (local) | `http://127.0.0.1:3001` |
| Prometheus (local) | `http://127.0.0.1:9090` |
| Public URL | `https://chat-metrics.zixma.co` (nginx basic auth, Let's Encrypt) |
| State | **Stopped** — `docker compose down` to save ~200 MB RAM on 3.9 GiB droplet |
| Volumes | Retained (`heimdall_prometheus_data`, `heimdall_grafana_data`) |

Restart when RAM allows:

```bash
cd /opt/apps/heimdall && docker compose up -d
```

**RAM (2026-05-26):** Droplet has 3.9 GiB RAM; swap was ~92%. Stopping Heimdall freed ~200 MB RSS but swap stays high until resize (8 GB recommended) or reboot. Do not run Heimdall + full chat load on 4 GB without headroom check (`free -m`, `docker stats`).

## Alerting approach

Grafana unified alerting — no Alertmanager container. Rules provisioned from `heimdall/grafana/provisioning/alerting-static/rules.yaml`. Push via `ALERT_WEBHOOK_URL` in `heimdall/.env` (optional; alerts still show in UI without it).

## Alert rules

| Rule | Severity |
|------|----------|
| chat-app scrape down | critical |
| mongodb exporter scrape down | critical |
| nginx exporter scrape down | warning |
| Host memory < 10% | warning |
| Host swap > 50% | warning |
| Auth failures elevated | warning |
| nginx stub_status unreachable | warning |

## Env vars (heimdall/.env on server)

```dotenv
GF_ADMIN_USER=admin
GF_ADMIN_PASSWORD=<strong>
GF_SERVER_ROOT_URL=https://chat-metrics.zixma.co
CHAT_API_SECRET=<same as chat-service>
ALERT_WEBHOOK_URL=https://hooks.slack.com/...   # optional
```

## Phase 2 (deferred)

cAdvisor: `docker compose --profile phase2 up -d`, then uncomment `cadvisor` job in `prometheus/prometheus.yml`. Enable only after 24h memory burn-in on production droplet (or after RAM resize).

## Open / next steps

1. **RAM** — resize droplet (8 GB recommended) or confirm `free -m` headroom before restart.
2. **Restart Heimdall** on server when safe — `docker compose up -d` in `/opt/apps/heimdall`.
3. **Alerts** — set `ALERT_WEBHOOK_URL`, restart Grafana, fire a test alert.
4. **Phase 2** — after burn-in: enable cAdvisor.
