# Graph Report - Anti Cheating Strava  (2026-08-29)

## Corpus Check
- 41 files · ~40,631 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 246 nodes · 642 edges · 13 communities
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.65)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b74839ca`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_dependencies|dependencies]]
- [[_COMMUNITY_devDependencies|devDependencies]]
- [[_COMMUNITY_app.ts|app.ts]]
- [[_COMMUNITY_index.ts|index.ts]]
- [[_COMMUNITY_telegram.service.ts|telegram.service.ts]]
- [[_COMMUNITY_compilerOptions|compilerOptions]]
- [[_COMMUNITY_index.ts|index.ts]]
- [[_COMMUNITY_sync.service.ts|sync.service.ts]]
- [[_COMMUNITY_getTeamName|getTeamName]]
- [[_COMMUNITY_department.service.ts|department.service.ts]]
- [[_COMMUNITY_progress.service.ts|progress.service.ts]]
- [[_COMMUNITY_bonus.service.ts|bonus.service.ts]]
- [[_COMMUNITY_strava.service.ts|strava.service.ts]]

## God Nodes (most connected - your core abstractions)
1. `initTelegramBot()` - 42 edges
2. `getExemptUserIdsForWeek()` - 26 edges
3. `getTeamName()` - 21 edges
4. `findUserByFlexibleQuery()` - 15 edges
5. `env` - 14 edges
6. `processActivityQueueItem()` - 12 edges
7. `syncUserPastActivities()` - 12 edges
8. `sendTelegramMessage()` - 12 edges
9. `compilerOptions` - 12 edges
10. `WEEKS` - 11 edges

## Surprising Connections (you probably didn't know these)
- `exportLeaderboardToExcelBuffer()` --references--> `xlsx`  [EXTRACTED]
  src/services/excel.service.ts → package.json
- `exportViolationsToExcelBuffer()` --references--> `xlsx`  [EXTRACTED]
  src/services/excel.service.ts → package.json
- `exportClubApiActivities()` --references--> `xlsx`  [EXTRACTED]
  src/export-club-api-excel.ts → package.json
- `initTelegramBot()` --calls--> `removeAthleteFromContest()`  [EXTRACTED]
  src/bot/index.ts → src/services/athlete-removal.service.ts
- `initTelegramBot()` --calls--> `findUserByFlexibleQuery()`  [EXTRACTED]
  src/bot/index.ts → src/services/bonus.service.ts

## Import Cycles
- None detected.

## Communities (13 total, 0 thin omitted)

### Community 0 - "dependencies"
Cohesion: 0.21
Nodes (7): getDashboardDailySummary(), ipRequestMap, isRateLimited(), getDailySummaryReport(), appCache, CacheEntry, MemoryCache

### Community 1 - "devDependencies"
Cohesion: 0.07
Nodes (27): dependencies, axios, cors, dotenv, express, node-cron, p-queue, @prisma/client (+19 more)

### Community 2 - "app.ts"
Cohesion: 0.12
Nodes (24): app, server, checkDistribution(), globalForPrisma, env, handleOverrideActivity(), handleStravaCallback(), handleStravaLink() (+16 more)

### Community 3 - "index.ts"
Cohesion: 0.08
Nodes (25): WEEKS, CompanyOverviewKpi, DailyReportOptions, DailySummaryReportResult, TeamDailyProgress, TeamMin3KmDetail, TopAthleteItem, getWeeklyActivityReminderList() (+17 more)

### Community 4 - "telegram.service.ts"
Cohesion: 0.25
Nodes (14): BestPaceQueryOptions, processActivityQueueItem(), CONTEST_END, CONTEST_START, validateActivity(), ValidationResult, notifyActivityDeleted(), notifyActivityDeletedBatch() (+6 more)

### Community 5 - "compilerOptions"
Cohesion: 0.14
Nodes (13): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution, outDir, resolveJsonModule (+5 more)

### Community 6 - "index.ts"
Cohesion: 0.26
Nodes (17): escapeHtml(), initTelegramBot(), sendChunkedHtmlMessages(), getBestPaceActivities(), getWeek1TeamAward(), getWeek2TeamAward(), getWeek3IndividualAward(), getWeek3TeamAward() (+9 more)

### Community 7 - "sync.service.ts"
Cohesion: 0.22
Nodes (15): enqueueActivityTask(), handleWebhookEvent(), verifyWebhook(), CONTEST_START, sleep(), syncAllUsersPastActivities(), syncUserPastActivities(), activityQueue (+7 more)

### Community 8 - "getTeamName"
Cohesion: 0.33
Nodes (10): ExcelExportResult, exportLeaderboardToExcelBuffer(), exportViolationsToExcelBuffer(), WEEK_RANGES, getTeamName(), formatPace(), formatVietnamDateTime(), compareAthletesWeek4() (+2 more)

### Community 9 - "department.service.ts"
Cohesion: 0.32
Nodes (7): DepartmentDetailResult, DepartmentLeaderboardResult, DepartmentMemberDetail, DepartmentSummaryItem, getDepartmentMembersDetail(), getDepartmentSummaryLeaderboard(), parseWeekParam()

### Community 10 - "progress.service.ts"
Cohesion: 0.50
Nodes (3): AthleteGrowthStat, GrowthLeaderboardResult, GrowthQueryOptions

### Community 12 - "bonus.service.ts"
Cohesion: 0.19
Nodes (16): BonusResult, findUserByFlexibleQuery(), grantPickleballBonus(), revokePickleballBonus(), ExemptionResult, getWeeklyExemptionsList(), grantWeeklyExemption(), revokeWeeklyExemption() (+8 more)

### Community 14 - "strava.service.ts"
Cohesion: 0.12
Nodes (17): xlsx, CONTEST_START_DATE, exportClubApiActivities(), formatDuration(), formatPace(), removeAthleteFromContest(), RemoveAthleteResult, checkRateLimitHeaders() (+9 more)

## Knowledge Gaps
- **96 isolated node(s):** `name`, `version`, `description`, `main`, `build` (+91 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `xlsx` connect `strava.service.ts` to `getTeamName`, `devDependencies`?**
  _High betweenness centrality (0.191) - this node is a cross-community bridge._
- **Why does `dependencies` connect `devDependencies` to `strava.service.ts`?**
  _High betweenness centrality (0.190) - this node is a cross-community bridge._
- **Why does `exportLeaderboardToExcelBuffer()` connect `getTeamName` to `index.ts`, `strava.service.ts`?**
  _High betweenness centrality (0.092) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _96 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.07142857142857142 - nodes in this community are weakly interconnected._
- **Should `app.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.12162162162162163 - nodes in this community are weakly interconnected._
- **Should `index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08374384236453201 - nodes in this community are weakly interconnected._