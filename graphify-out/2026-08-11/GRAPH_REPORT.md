# Graph Report - Anti Cheating Strava  (2026-08-11)

## Corpus Check
- 28 files · ~18,585 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 158 nodes · 351 edges · 7 communities
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `0af8fac6`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_devDependencies|devDependencies]]
- [[_COMMUNITY_app.ts|app.ts]]
- [[_COMMUNITY_index.ts|index.ts]]
- [[_COMMUNITY_telegram.service.ts|telegram.service.ts]]
- [[_COMMUNITY_compilerOptions|compilerOptions]]
- [[_COMMUNITY_db.ts|db.ts]]
- [[_COMMUNITY_sync.service.ts|sync.service.ts]]

## God Nodes (most connected - your core abstractions)
1. `initTelegramBot()` - 19 edges
2. `env` - 14 edges
3. `processActivityQueueItem()` - 12 edges
4. `compilerOptions` - 12 edges
5. `sendTelegramMessage()` - 11 edges
6. `syncUserPastActivities()` - 10 edges
7. `getValidAccessToken()` - 8 edges
8. `getAppCredentials()` - 7 edges
9. `syncAllUsersPastActivities()` - 7 edges
10. `escapeHtml()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `exportClubApiActivities()` --references--> `xlsx`  [EXTRACTED]
  src/export-club-api-excel.ts → package.json
- `exportViolationsToExcelBuffer()` --references--> `xlsx`  [EXTRACTED]
  src/services/excel.service.ts → package.json
- `initTelegramBot()` --calls--> `reconcileAllUsers()`  [EXTRACTED]
  src/bot/index.ts → src/services/reconcile.service.ts
- `initTelegramBot()` --calls--> `syncAllUsersPastActivities()`  [EXTRACTED]
  src/bot/index.ts → src/services/sync.service.ts
- `initTelegramBot()` --calls--> `formatVietnamDateTime()`  [EXTRACTED]
  src/bot/index.ts → src/services/telegram.service.ts

## Import Cycles
- None detected.

## Communities (7 total, 0 thin omitted)

### Community 1 - "devDependencies"
Cohesion: 0.07
Nodes (28): dependencies, axios, cors, dotenv, express, node-cron, p-queue, @prisma/client (+20 more)

### Community 2 - "app.ts"
Cohesion: 0.13
Nodes (21): app, server, env, handleOverrideActivity(), handleStravaCallback(), handleStravaLink(), handleSyncAll(), verifyWebhook() (+13 more)

### Community 3 - "index.ts"
Cohesion: 0.16
Nodes (21): escapeHtml(), initTelegramBot(), globalForPrisma, getWeek1TeamAward(), getWeek2TeamAward(), getWeek3IndividualAward(), getWeek3TeamAward(), getWeek4TeamAward() (+13 more)

### Community 4 - "telegram.service.ts"
Cohesion: 0.25
Nodes (14): processActivityQueueItem(), CONTEST_END, CONTEST_START, validateActivity(), ValidationResult, formatVietnamDateTime(), notifyActivityDeleted(), notifyActivityDeletedBatch() (+6 more)

### Community 5 - "compilerOptions"
Cohesion: 0.14
Nodes (13): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution, outDir, resolveJsonModule (+5 more)

### Community 6 - "db.ts"
Cohesion: 0.13
Nodes (16): CONTEST_START_DATE, exportClubApiActivities(), formatDuration(), formatPace(), checkRateLimitHeaders(), fetchStravaActivityDetail(), getValidAccessToken(), sleep() (+8 more)

### Community 7 - "sync.service.ts"
Cohesion: 0.29
Nodes (11): enqueueActivityTask(), handleWebhookEvent(), syncUserPastActivities(), activityQueue, AspectType, getAspectPriority(), isActivityQueued(), markActivityQueued() (+3 more)

## Knowledge Gaps
- **59 isolated node(s):** `name`, `version`, `description`, `main`, `build` (+54 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `xlsx` connect `devDependencies` to `index.ts`, `db.ts`?**
  _High betweenness centrality (0.264) - this node is a cross-community bridge._
- **Why does `exportViolationsToExcelBuffer()` connect `index.ts` to `devDependencies`?**
  _High betweenness centrality (0.184) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _59 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.06896551724137931 - nodes in this community are weakly interconnected._
- **Should `app.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.13118279569892474 - nodes in this community are weakly interconnected._
- **Should `compilerOptions` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._
- **Should `db.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.13 - nodes in this community are weakly interconnected._