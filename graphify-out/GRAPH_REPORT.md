# Graph Report - Anti Cheating Strava  (2026-08-11)

## Corpus Check
- 29 files · ~19,045 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 162 nodes · 367 edges · 9 communities
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.65)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `3d5643d4`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_dependencies|dependencies]]
- [[_COMMUNITY_devDependencies|devDependencies]]
- [[_COMMUNITY_app.ts|app.ts]]
- [[_COMMUNITY_index.ts|index.ts]]
- [[_COMMUNITY_telegram.service.ts|telegram.service.ts]]
- [[_COMMUNITY_compilerOptions|compilerOptions]]
- [[_COMMUNITY_db.ts|db.ts]]
- [[_COMMUNITY_sync.service.ts|sync.service.ts]]
- [[_COMMUNITY_auth.controller.ts|auth.controller.ts]]

## God Nodes (most connected - your core abstractions)
1. `initTelegramBot()` - 19 edges
2. `env` - 14 edges
3. `processActivityQueueItem()` - 12 edges
4. `sendTelegramMessage()` - 12 edges
5. `compilerOptions` - 12 edges
6. `syncUserPastActivities()` - 10 edges
7. `getValidAccessToken()` - 8 edges
8. `getAppCredentials()` - 8 edges
9. `StravaRateLimiter` - 8 edges
10. `getAvailableStravaApp()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `exportViolationsToExcelBuffer()` --references--> `xlsx`  [EXTRACTED]
  src/services/excel.service.ts → package.json
- `exportClubApiActivities()` --references--> `xlsx`  [EXTRACTED]
  src/export-club-api-excel.ts → package.json
- `initTelegramBot()` --calls--> `reconcileAllUsers()`  [EXTRACTED]
  src/bot/index.ts → src/services/reconcile.service.ts
- `initTelegramBot()` --calls--> `syncAllUsersPastActivities()`  [EXTRACTED]
  src/bot/index.ts → src/services/sync.service.ts
- `initTelegramBot()` --calls--> `formatVietnamDateTime()`  [EXTRACTED]
  src/bot/index.ts → src/services/telegram.service.ts

## Import Cycles
- None detected.

## Communities (9 total, 0 thin omitted)

### Community 0 - "dependencies"
Cohesion: 0.15
Nodes (15): dependencies, axios, cors, dotenv, express, node-cron, p-queue, @prisma/client (+7 more)

### Community 1 - "devDependencies"
Cohesion: 0.11
Nodes (18): description, devDependencies, prisma, ts-node-dev, @types/cors, @types/express, @types/node, @types/node-cron (+10 more)

### Community 2 - "app.ts"
Cohesion: 0.12
Nodes (16): app, server, env, handleSyncAll(), verifyWebhook(), initKeepAliveCronJob(), initReconcileCronJob(), initWeeklyCronJob() (+8 more)

### Community 3 - "index.ts"
Cohesion: 0.18
Nodes (19): escapeHtml(), initTelegramBot(), handleOverrideActivity(), getWeek1TeamAward(), getWeek2TeamAward(), getWeek3IndividualAward(), getWeek3TeamAward(), getWeek4TeamAward() (+11 more)

### Community 4 - "telegram.service.ts"
Cohesion: 0.21
Nodes (17): processActivityQueueItem(), validateActivity(), checkRateLimitHeaders(), fetchStravaActivityDetail(), sleep(), tokenRefreshPromises, formatVietnamDateTime(), notifyActivityDeleted() (+9 more)

### Community 5 - "compilerOptions"
Cohesion: 0.14
Nodes (13): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution, outDir, resolveJsonModule (+5 more)

### Community 6 - "db.ts"
Cohesion: 0.31
Nodes (3): ClientBucket, StravaDailyQuotaError, StravaRateLimiter

### Community 7 - "sync.service.ts"
Cohesion: 0.24
Nodes (14): enqueueActivityTask(), handleWebhookEvent(), CONTEST_START, sleep(), syncAllUsersPastActivities(), syncUserPastActivities(), activityQueue, AspectType (+6 more)

### Community 8 - "auth.controller.ts"
Cohesion: 0.29
Nodes (11): checkDistribution(), globalForPrisma, handleStravaCallback(), handleStravaLink(), decrementPendingApp(), getAppCredentials(), getAvailableStravaApp(), getStravaAppPool() (+3 more)

## Knowledge Gaps
- **59 isolated node(s):** `name`, `version`, `description`, `main`, `build` (+54 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `dependencies` to `devDependencies`?**
  _High betweenness centrality (0.266) - this node is a cross-community bridge._
- **Why does `xlsx` connect `dependencies` to `index.ts`?**
  _High betweenness centrality (0.260) - this node is a cross-community bridge._
- **Why does `exportViolationsToExcelBuffer()` connect `index.ts` to `dependencies`, `app.ts`?**
  _High betweenness centrality (0.180) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _59 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.10526315789473684 - nodes in this community are weakly interconnected._
- **Should `app.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.12 - nodes in this community are weakly interconnected._
- **Should `compilerOptions` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._