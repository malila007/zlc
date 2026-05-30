# .feat/

One folder per **release round**. All docs for that release go inside; delete the folder after prod is stable (promote durable facts to `PROJECT.md` first).

## Layout

```
.feat/
├── README.md              ← this file (workflow)
└── <release>/             ← e.g. bc-log
    ├── bc.md, log.md, …   ← whatever this release needs
    ├── deploy-*.md
    └── plans/             ← optional task plans for AI workers
```

**Current release:** `bc-log/` (broadcast + monitoring + deploy)

**Paused:** `shared-w/` — backoffice chat SharedWorker migration. Disabled on prod (`USE_SHARED_WORKER = false`, reverted to tab-leader); open issues before re-test. See `shared-w/README.md`.

## Workflow (PO)

1. `mkdir .feat/<release-name>`
2. Add markdown for this release; copy `bc-log/plans/_template.md` for new tasks
3. Point AI at `@.feat/<release>/` or a specific plan file
4. After prod is good → update `PROJECT.md` → delete `.feat/<release-name>/`

## Workflow (AI)

1. Read `PROJECT.md` (always)
2. If the user assigned a release or plan → read that path under `.feat/` fully before coding
3. Implement; check off plan tasks; update release docs if facts changed
4. Promote lasting rules to `PROJECT.md`

No other doc duplicates this flow — `AGENTS.md` / `CLAUDE.md` only point here.
