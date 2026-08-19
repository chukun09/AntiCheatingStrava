# Graph Report - Anti Cheating Strava  (2026-08-19)

## Corpus Check
- 33 files · ~24,763 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 190 nodes · 449 edges · 13 communities
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.65)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `8fa49d0b`
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
- [[_COMMUNITY_progress.service.ts|progress.service.ts]]
- [[_COMMUNITY_department.service.ts|department.service.ts]]
- [[_COMMUNITY_team.service.ts|team.service.ts]]
- [[_COMMUNITY_bonus.service.ts|bonus.service.ts]]

## God Nodes (most connected - your core abstractions)
1. `initTelegramBot()` - 28 edges
2. `env` - 14 edges
3. `processActivityQueueItem()` - 12 edges
4. `sendTelegramMessage()` - 12 edges
5. `compilerOptions` - 12 edges
6. `syncUserPastActivities()` - 10 edges
7. `getTeamName()` - 10 edges
8. `getValidAccessToken()` - 8 edges
9. `getAppCredentials()` - 8 edges
10. `StravaRateLimiter` - 8 edges

## Surprising Connections (you probably didn't know these)
- `exportClubApiActivities()` --references--> `xlsx`  [EXTRACTED]
  src/export-club-api-excel.ts → package.json
- `exportLeaderboardToExcelBuffer()` --references--> `xlsx`  [EXTRACTED]
  src/services/excel.service.ts → package.json
- `exportViolationsToExcelBuffer()` --references--> `xlsx`  [EXTRACTED]
  src/services/excel.service.ts → package.json
- `initTelegramBot()` --calls--> `grantPickleballBonus()`  [EXTRACTED]
  src/bot/index.ts → src/services/bonus.service.ts
- `initTelegramBot()` --calls--> `revokePickleballBonus()`  [EXTRACTED]
  src/bot/index.ts → src/services/bonus.service.ts

## Import Cycles
- None detected.

## Communities (13 total, 0 thin omitted)

### Community 0 - "dependencies"
Cohesion: 0.43
Nodes (7): xlsx, ExcelExportResult, exportLeaderboardToExcelBuffer(), exportViolationsToExcelBuffer(), WEEK_RANGES, formatPace(), formatVietnamDateTime()

### Community 1 - "devDependencies"
Cohesion: 0.07
Nodes (27): dependencies, axios, cors, dotenv, express, node-cron, p-queue, @prisma/client (+19 more)

### Community 2 - "app.ts"
Cohesion: 0.19
Nodes (10): app, server, env, verifyWebhook(), initKeepAliveCronJob(), initReconcileCronJob(), initWeeklyCronJob(), reconcileAllUsers() (+2 more)

### Community 3 - "index.ts"
Cohesion: 0.33
Nodes (10): escapeHtml(), initTelegramBot(), getBestPaceActivities(), getWeek1TeamAward(), getWeek2TeamAward(), getWeek3IndividualAward(), getWeek3TeamAward(), getWeek4TeamAward() (+2 more)

### Community 4 - "telegram.service.ts"
Cohesion: 0.13
Nodes (14): CONTEST_START_DATE, exportClubApiActivities(), formatDuration(), formatPace(), checkRateLimitHeaders(), fetchStravaActivityDetail(), getValidAccessToken(), sleep() (+6 more)

### Community 5 - "compilerOptions"
Cohesion: 0.14
Nodes (13): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution, outDir, resolveJsonModule (+5 more)

### Community 6 - "db.ts"
Cohesion: 0.25
Nodes (14): BestPaceQueryOptions, processActivityQueueItem(), CONTEST_END, CONTEST_START, validateActivity(), ValidationResult, notifyActivityDeleted(), notifyActivityDeletedBatch() (+6 more)

### Community 7 - "sync.service.ts"
Cohesion: 0.22
Nodes (15): handleSyncAll(), enqueueActivityTask(), handleWebhookEvent(), CONTEST_START, sleep(), syncAllUsersPastActivities(), syncUserPastActivities(), activityQueue (+7 more)

### Community 8 - "auth.controller.ts"
Cohesion: 0.22
Nodes (14): checkDistribution(), globalForPrisma, handleOverrideActivity(), handleStravaCallback(), handleStravaLink(), overrideActivityStatus(), recalculateUserStatsTx(), decrementPendingApp() (+6 more)

### Community 9 - "progress.service.ts"
Cohesion: 0.20
Nodes (8): WEEKS, AthleteGrowthStat, getGrowthLeaderboard(), GrowthLeaderboardResult, GrowthQueryOptions, CompanySummaryStats, getCompanySummaryStats(), SummaryQueryOptions

### Community 10 - "department.service.ts"
Cohesion: 0.32
Nodes (7): DepartmentDetailResult, DepartmentLeaderboardResult, DepartmentMemberDetail, DepartmentSummaryItem, getDepartmentMembersDetail(), getDepartmentSummaryLeaderboard(), parseWeekParam()

### Community 11 - "team.service.ts"
Cohesion: 0.38
Nodes (6): getTeamName(), getTeamWeekDetail(), MemberWeekStat, TeamInfo, TEAMS, TeamWeekDetailResult

### Community 12 - "bonus.service.ts"
Cohesion: 0.60
Nodes (5): BonusResult, findUserByFlexibleQuery(), grantPickleballBonus(), revokePickleballBonus(), recalculateUserStats()

## Knowledge Gaps
- **71 isolated node(s):** `name`, `version`, `description`, `main`, `build` (+66 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `devDependencies` to `dependencies`?**
  _High betweenness centrality (0.235) - this node is a cross-community bridge._
- **Why does `xlsx` connect `dependencies` to `devDependencies`, `telegram.service.ts`?**
  _High betweenness centrality (0.233) - this node is a cross-community bridge._
- **Why does `exportViolationsToExcelBuffer()` connect `dependencies` to `team.service.ts`, `index.ts`?**
  _High betweenness centrality (0.095) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _71 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.07142857142857142 - nodes in this community are weakly interconnected._
- **Should `telegram.service.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.13043478260869565 - nodes in this community are weakly interconnected._
- **Should `compilerOptions` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._