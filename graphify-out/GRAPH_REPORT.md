# Graph Report - Anti Cheating Strava  (2026-08-19)

## Corpus Check
- 33 files · ~25,608 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 193 nodes · 455 edges · 15 communities
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.65)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `bd2ccfe7`
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
- [[_COMMUNITY_progress.service.ts|progress.service.ts]]
- [[_COMMUNITY_strava.service.ts|strava.service.ts]]

## God Nodes (most connected - your core abstractions)
1. `initTelegramBot()` - 29 edges
2. `env` - 14 edges
3. `processActivityQueueItem()` - 12 edges
4. `syncUserPastActivities()` - 12 edges
5. `sendTelegramMessage()` - 12 edges
6. `compilerOptions` - 12 edges
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

## Communities (15 total, 0 thin omitted)

### Community 0 - "dependencies"
Cohesion: 0.42
Nodes (8): xlsx, ExcelExportResult, exportLeaderboardToExcelBuffer(), exportViolationsToExcelBuffer(), WEEK_RANGES, getTeamName(), formatPace(), formatVietnamDateTime()

### Community 1 - "devDependencies"
Cohesion: 0.07
Nodes (27): dependencies, axios, cors, dotenv, express, node-cron, p-queue, @prisma/client (+19 more)

### Community 2 - "app.ts"
Cohesion: 0.13
Nodes (14): app, server, env, verifyWebhook(), initKeepAliveCronJob(), initReconcileCronJob(), initWeeklyCronJob(), CONTEST_END (+6 more)

### Community 3 - "index.ts"
Cohesion: 0.47
Nodes (8): escapeHtml(), initTelegramBot(), getBestPaceActivities(), getWeek1TeamAward(), getWeek2TeamAward(), getWeek3IndividualAward(), getWeek3TeamAward(), getWeek4TeamAward()

### Community 4 - "telegram.service.ts"
Cohesion: 0.60
Nodes (4): CONTEST_START_DATE, exportClubApiActivities(), formatDuration(), formatPace()

### Community 5 - "compilerOptions"
Cohesion: 0.14
Nodes (13): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution, outDir, resolveJsonModule (+5 more)

### Community 6 - "db.ts"
Cohesion: 0.40
Nodes (3): globalForPrisma, calculatePenalties(), PenaltyRecord

### Community 7 - "sync.service.ts"
Cohesion: 0.16
Nodes (25): enqueueActivityTask(), handleWebhookEvent(), BestPaceQueryOptions, processActivityQueueItem(), getValidAccessToken(), CONTEST_START, syncUserPastActivities(), notifyActivityDeleted() (+17 more)

### Community 8 - "auth.controller.ts"
Cohesion: 0.25
Nodes (13): checkDistribution(), handleStravaCallback(), handleStravaLink(), handleSyncAll(), decrementPendingApp(), getAppCredentials(), getAvailableStravaApp(), getStravaAppPool() (+5 more)

### Community 9 - "progress.service.ts"
Cohesion: 0.40
Nodes (4): WEEKS, CompanySummaryStats, getCompanySummaryStats(), SummaryQueryOptions

### Community 10 - "department.service.ts"
Cohesion: 0.32
Nodes (7): DepartmentDetailResult, DepartmentLeaderboardResult, DepartmentMemberDetail, DepartmentSummaryItem, getDepartmentMembersDetail(), getDepartmentSummaryLeaderboard(), parseWeekParam()

### Community 11 - "team.service.ts"
Cohesion: 0.22
Nodes (8): getTeamWeekDetail(), getTeamWeeklyLeaderboard(), MemberWeekStat, TeamInfo, TEAMS, TeamSummaryItem, TeamWeekDetailResult, TeamWeeklyLeaderboardResult

### Community 12 - "bonus.service.ts"
Cohesion: 0.36
Nodes (8): handleOverrideActivity(), BonusResult, findUserByFlexibleQuery(), grantPickleballBonus(), revokePickleballBonus(), overrideActivityStatus(), recalculateUserStats(), recalculateUserStatsTx()

### Community 13 - "progress.service.ts"
Cohesion: 0.40
Nodes (4): AthleteGrowthStat, getGrowthLeaderboard(), GrowthLeaderboardResult, GrowthQueryOptions

### Community 14 - "strava.service.ts"
Cohesion: 0.21
Nodes (7): checkRateLimitHeaders(), fetchStravaActivityDetail(), sleep(), tokenRefreshPromises, ClientBucket, StravaDailyQuotaError, StravaRateLimiter

## Knowledge Gaps
- **73 isolated node(s):** `name`, `version`, `description`, `main`, `build` (+68 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `devDependencies` to `dependencies`?**
  _High betweenness centrality (0.232) - this node is a cross-community bridge._
- **Why does `xlsx` connect `dependencies` to `devDependencies`, `telegram.service.ts`?**
  _High betweenness centrality (0.230) - this node is a cross-community bridge._
- **Why does `exportViolationsToExcelBuffer()` connect `dependencies` to `index.ts`?**
  _High betweenness centrality (0.096) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _73 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.07142857142857142 - nodes in this community are weakly interconnected._
- **Should `app.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.1341991341991342 - nodes in this community are weakly interconnected._
- **Should `compilerOptions` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._