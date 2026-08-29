# Graph Report - Anti Cheating Strava  (2026-08-29)

## Corpus Check
- 43 files · ~41,270 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 257 nodes · 683 edges · 9 communities
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.65)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `94837b43`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_dependencies|dependencies]]
- [[_COMMUNITY_devDependencies|devDependencies]]
- [[_COMMUNITY_app.ts|app.ts]]
- [[_COMMUNITY_index.ts|index.ts]]
- [[_COMMUNITY_telegram.service.ts|telegram.service.ts]]
- [[_COMMUNITY_compilerOptions|compilerOptions]]
- [[_COMMUNITY_sync.service.ts|sync.service.ts]]
- [[_COMMUNITY_bonus.service.ts|bonus.service.ts]]
- [[_COMMUNITY_strava.service.ts|strava.service.ts]]

## God Nodes (most connected - your core abstractions)
1. `initTelegramBot()` - 44 edges
2. `getExemptUserIdsForWeek()` - 26 edges
3. `getTeamName()` - 20 edges
4. `env` - 16 edges
5. `sendTelegramMessage()` - 16 edges
6. `findUserByFlexibleQuery()` - 15 edges
7. `processActivityQueueItem()` - 14 edges
8. `compilerOptions` - 12 edges
9. `WEEKS` - 11 edges
10. `syncUserPastActivities()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `exportClubApiActivities()` --references--> `xlsx`  [EXTRACTED]
  src/export-club-api-excel.ts → package.json
- `exportLeaderboardToExcelBuffer()` --references--> `xlsx`  [EXTRACTED]
  src/services/excel.service.ts → package.json
- `exportViolationsToExcelBuffer()` --references--> `xlsx`  [EXTRACTED]
  src/services/excel.service.ts → package.json
- `initTelegramBot()` --calls--> `broadcastContestClosureAnnouncement()`  [EXTRACTED]
  src/bot/index.ts → src/cron/contest-freeze.ts
- `initTelegramBot()` --calls--> `buildContestClosureMessage()`  [EXTRACTED]
  src/bot/index.ts → src/cron/contest-freeze.ts

## Import Cycles
- None detected.

## Communities (9 total, 0 thin omitted)

### Community 0 - "dependencies"
Cohesion: 0.10
Nodes (24): xlsx, getDashboardDailySummary(), ipRequestMap, isRateLimited(), CompanyOverviewKpi, DailyReportOptions, DailySummaryReportResult, getDailySummaryReport() (+16 more)

### Community 1 - "devDependencies"
Cohesion: 0.07
Nodes (27): dependencies, axios, cors, dotenv, express, node-cron, p-queue, @prisma/client (+19 more)

### Community 2 - "app.ts"
Cohesion: 0.13
Nodes (21): app, server, checkDistribution(), globalForPrisma, env, handleStravaCallback(), handleStravaLink(), verifyWebhook() (+13 more)

### Community 3 - "index.ts"
Cohesion: 0.08
Nodes (51): escapeHtml(), initTelegramBot(), sendChunkedHtmlMessages(), getBestPaceActivities(), getWeek1TeamAward(), getWeek2TeamAward(), getWeek3IndividualAward(), getWeek3TeamAward() (+43 more)

### Community 4 - "telegram.service.ts"
Cohesion: 0.17
Nodes (22): broadcastContestClosureAnnouncement(), buildContestClosureMessage(), initContestFreezeCronJob(), BestPaceQueryOptions, processActivityQueueItem(), CONTEST_END, CONTEST_START, validateActivity() (+14 more)

### Community 5 - "compilerOptions"
Cohesion: 0.14
Nodes (13): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution, outDir, resolveJsonModule (+5 more)

### Community 6 - "sync.service.ts"
Cohesion: 0.22
Nodes (15): handleSyncAll(), enqueueActivityTask(), handleWebhookEvent(), CONTEST_START, sleep(), syncAllUsersPastActivities(), syncUserPastActivities(), activityQueue (+7 more)

### Community 12 - "bonus.service.ts"
Cohesion: 0.23
Nodes (14): handleOverrideActivity(), BonusResult, findUserByFlexibleQuery(), grantPickleballBonus(), revokePickleballBonus(), getCurrentWeekNumber(), grantManualKm(), GrantManualKmOptions (+6 more)

### Community 14 - "strava.service.ts"
Cohesion: 0.12
Nodes (16): CONTEST_START_DATE, exportClubApiActivities(), formatDuration(), formatPace(), removeAthleteFromContest(), RemoveAthleteResult, checkRateLimitHeaders(), fetchStravaActivityDetail() (+8 more)

## Knowledge Gaps
- **98 isolated node(s):** `name`, `version`, `description`, `main`, `build` (+93 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `xlsx` connect `dependencies` to `devDependencies`, `strava.service.ts`?**
  _High betweenness centrality (0.184) - this node is a cross-community bridge._
- **Why does `dependencies` connect `devDependencies` to `dependencies`?**
  _High betweenness centrality (0.183) - this node is a cross-community bridge._
- **Why does `exportLeaderboardToExcelBuffer()` connect `dependencies` to `index.ts`?**
  _High betweenness centrality (0.089) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _98 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.1028225806451613 - nodes in this community are weakly interconnected._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.07142857142857142 - nodes in this community are weakly interconnected._
- **Should `app.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.1268939393939394 - nodes in this community are weakly interconnected._