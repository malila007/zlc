# Session: Memory Swap Fix (No-Budget)

**Date:** 2026-05-26

## Goal
แก้ production swap ~92% โดยไม่ resize droplet และไม่แตะ Heimdall

## What Changed

### `chat-service/src/config/env.ts`
- `mongoMaxPoolSize: 100` (hardcoded) → `parseEnvInt(process.env.MONGO_MAX_POOL_SIZE, 20)`
- ก่อนหน้านี้ env var `MONGO_MAX_POOL_SIZE` ใน docker-compose ถูก ignore โดยสิ้นเชิง

### `chat-service/docker-compose.yml`
| เปลี่ยน | จาก | เป็น | เหตุผล |
|---------|-----|------|--------|
| MongoDB command | (ไม่มี) | `--wiredTigerCacheSizeGB 0.35` | MongoDB default claim 50% RAM = ~500MB; cap ที่ 350MB |
| `MONGO_MAX_POOL_SIZE` | 100 | 10 | 100 connections = ~100MB overhead โดยไม่มีประโยชน์ |
| `NODE_OPTIONS` | (ไม่มี) | `--max-old-space-size=384` | V8 default ~1.5GB → GC ช้า ทำให้ swap พุ่ง |
| `mem_limit` + `memswap_limit` | (ไม่มี top-level) | 512m/512m (app), 1g/1g (mongo) | ห้าม containers ใช้ host swap |

## Decisions
- ไม่แตะ Heimdall (ผู้ใช้ขอ skip)
- ไม่ resize droplet (งบไม่ผ่าน)
- คง MongoDB mem_limit ที่ 1G (safe buffer กับ WiredTiger cap + cleanup spike)
- V8 flag ผ่าน `NODE_OPTIONS` env var (PM2 fork mode inherit env ได้ปกติ)
- Fallback pool size ใน env.ts = 20 (ปลอดภัยสำหรับ local dev โดยไม่ต้องตั้ง env)

## Expected Savings
| รายการ | ประมาณ |
|--------|--------|
| MongoDB WiredTiger 500MB→350MB | ~150MB |
| Pool 100→10 server-side overhead | ~80MB |
| V8 GC earlier (max-old-space=384) | ~100-200MB |
| **รวม** | **~330-430MB** |

## Open / Next Steps
1. Deploy บน production: `git pull && docker compose up -d --build`
2. รัน memory check: `free -h && docker stats --no-stream`
3. ถ้า free RAM > 1.5GB: `sudo swapoff -a && sudo swapon -a` (reclaim swap ที่ค้าง)
4. ตั้ง DO Console Alerts: RAM > 85% (ฟรี, ทำบน DO dashboard)
5. vm.swappiness: `sudo sysctl vm.swappiness=10 && echo 'vm.swappiness=10' >> /etc/sysctl.conf`
6. ระยะยาว: $slice บน messages[], Managed MongoDB (เพื่อ backup)

## Notes for Next Session
- `memswap_limit` อยู่ที่ top-level service (ไม่ใช่ใน `deploy.resources`)
- ทั้ง `mem_limit` และ `deploy.resources.limits.memory` ตั้งไว้พร้อมกัน (redundant แต่ explicit)
- Broadcast worker ใน index.ts ใช้ `mongoMaxPoolSize: 5` hardcode อยู่แล้ว — ถูกต้อง ไม่ต้องแก้
- TypeScript build ผ่านแล้ว (`npm run build` clean)
