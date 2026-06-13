# tsdown

Analyze TypeScript compilation time per file. Find slow files, bottlenecks, and track build performance.

## Why?

TypeScript builds get slow. You know it when your `tsc` takes 30 seconds and you have no idea why. `tsdown` tells you exactly which files are killing your build time.

Instead of guessing "is it that massive generic utility file?", you get a ranked list of files by estimated compilation cost — type annotations, generics, interfaces, imports, all factored in.

## Install

```bash
npm install -g tsdown
```

## Usage

### Analyze a project

```bash
tsdown ./src
```

Output:

```
File              Lines  Types  Generic  Import    Est Cost  Bar
────────────────  ──────  ─────  ───────  ──────  ─────────  ──────────────────────────────
types.ts            450    120       45      30        1200  ██████████████████████████████
utils.ts            280     60       20      15         650  ████████████████
service.ts          150     25        5       8         340  ████████
index.ts             50      5        0       3         100  ██

Total: 4 files | 930 lines | Est cost: 2290
Bottleneck files (80% of cost): 2 files
```

### From tsc diagnostics

Pipe actual compilation times:

```bash
tsc --extendedDiagnostics | tsdown --stdin
```

### JSON output

```bash
tsdown . --json > report.json
```

### Options

```
--top <n>        Show top N slowest files (default: 20)
--sort <field>   Sort by: estimatedCost, lines, typeAnnotations, generics
--threshold <n>  Only show files with cost >= n
--show-path      Show full file paths
--json           Output as JSON
--stdin          Read tsc diagnostics from stdin
```

### Programmatic API

```js
const { analyze } = require('tsdown');

const report = analyze('./src', { top: 10, format: 'table' });
console.log(report);

// Or get structured data
const data = analyze('./src', { format: 'json' });
const parsed = JSON.parse(data);
console.log(`Top bottleneck: ${parsed.topFiles[0].file}`);
```

## How it works

For static analysis, `tsdown` scans your `.ts`/`.tsx` files and estimates compilation cost based on:

- **Lines** — base overhead
- **Type annotations** — `: string`, `: number`, complex types
- **Generics** — `<T>`, `<T extends U>` — expensive for the compiler
- **Interfaces & type aliases** — type system work
- **Decorators** — additional transform overhead
- **Imports** — module resolution cost

It also identifies **bottleneck files** — the smallest set of files responsible for 80% of your total estimated compilation cost.

If you pipe `tsc --extendedDiagnostics` output, it uses actual measured times instead.

## Zero dependencies

No `node_modules` bloat. Just one file that does its job.

## License

MIT
