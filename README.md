# tsdown

Analyze TypeScript compilation time per file. Find your slowest types.

## Why?

TypeScript projects get slow. You know it's slow, but which files are the bottleneck? `tsdown` runs `tsc --extendedDiagnostics` and breaks down compilation time per file so you can actually fix the problem instead of just waiting.

## Install

```bash
npm install -g tsdown
```

Or use directly:

```bash
npx tsdown
```

## Usage

```bash
# Analyze current project
tsdown

# Top 10 slowest files
tsdown --top 10

# Only show files above 100ms
tsdown --threshold 100

# Group by extension and directory
tsdown --by-ext --by-dir

# JSON output for scripting
tsdown --json

# CI mode — exit 1 if critical files found
tsdown --ci

# Specific tsconfig
tsdown --tsconfig tsconfig.prod.json

# Different project directory
tsdown ./packages/api
```

## Output

```
TypeScript Compilation Time Analysis
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Files: 42  Total: 3200ms  Avg: 76ms  Median: 45ms
P95: 210ms  P99: 450ms

Top 10 slowest files:
────────────────────────────────────────────────────────────────────────────────
🔴 450ms    █████████████████████████░  14%  src/types/schema.ts
🔴 380ms    █████████████████████░░░░░  11%  src/models/User.ts
🟡 210ms    ████████████░░░░░░░░░░░░░░   6%  src/api/handlers.ts
🔵 120ms    ██████░░░░░░░░░░░░░░░░░░░░   3%  src/utils/validators.ts
🟢 45ms     ██░░░░░░░░░░░░░░░░░░░░░░░░   1%  src/index.ts
...

💡 Tips:
  - 2 file(s) in critical zone (>450ms). Consider splitting.
  - Run with --byDir to find hotspots in your codebase.
```

## How It Works

`tsdown` runs `tsc --extendedDiagnostics --noEmit` and parses the per-file timing output. No build system integration needed, no plugins, no config — just point it at a TypeScript project.

## Severity Levels

| Level | Condition | Icon |
|-------|-----------|------|
| Critical | ≥ P99 | 🔴 |
| Slow | ≥ P95 | 🟡 |
| Moderate | ≥ Average | 🔵 |
| Fast | Below average | 🟢 |

## Programmatic API

```js
const { runDiagnostics, renderReport, calculateStats } = require('tsdown');

const files = runDiagnostics('./my-project');
console.log(renderReport(files, { top: 10, byExt: true }));
```

## Zero Dependencies

No runtime dependencies. Just Node.js and TypeScript in your project.

## License

MIT
