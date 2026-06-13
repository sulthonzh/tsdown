#!/usr/bin/env node
'use strict';

const { runDiagnostics, renderReport, parseDiagnosticsOutput } = require('./index');
const fs = require('fs');
const path = require('path');

function parseArgs(args) {
  const opts = { top: 20, json: false, byExt: false, byDir: false, threshold: 0, tsconfig: null, ci: false };
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--top': opts.top = parseInt(args[++i], 10) || 20; break;
      case '--json': opts.json = true; break;
      case '--by-ext': opts.byExt = true; break;
      case '--by-dir': opts.byDir = true; break;
      case '--threshold': opts.threshold = parseInt(args[++i], 10) || 0; break;
      case '--tsconfig': opts.tsconfig = args[++i]; break;
      case '--ci': opts.ci = true; break;
      case '--help': case '-h': opts.help = true; break;
      default:
        if (!args[i].startsWith('-')) positional.push(args[i]);
        break;
    }
  }

  return { opts, positional };
}

function main() {
  const { opts, positional } = parseArgs(process.argv.slice(2));

  if (opts.help) {
    console.log(`tsdown — Analyze TypeScript compilation time per file

Usage: tsdown [dir] [options]

Options:
  --top <n>         Show top N slowest files (default: 20)
  --json            Output as JSON
  --by-ext          Group by file extension
  --by-dir          Group by directory
  --threshold <ms>  Only show files above this threshold
  --tsconfig <path> Path to tsconfig.json
  --ci              CI mode: exit 1 if critical files found
  -h, --help        Show this help

Examples:
  tsdown                          # analyze current project
  tsdown ./src --top 10           # top 10 slowest
  tsdown --by-ext --by-dir        # full breakdown
  tsdown --threshold 100          # only files >100ms
  tsdown --ci                     # use in CI pipeline
`);
    process.exit(0);
  }

  const projectDir = positional[0] || '.';
  const absDir = path.resolve(projectDir);

  if (!fs.existsSync(path.join(absDir, 'tsconfig.json')) && !opts.tsconfig) {
    console.error('Error: No tsconfig.json found. Use --tsconfig to specify one.');
    process.exit(1);
  }

  let files;
  try {
    files = runDiagnostics(absDir, { tsconfig: opts.tsconfig });
  } catch (err) {
    console.error(`Error running tsc: ${err.message}`);
    process.exit(1);
  }

  if (!files || files.length === 0) {
    console.log('No compilation timing data found. Ensure tsc --extendedDiagnostics outputs file timings.');
    process.exit(0);
  }

  const report = renderReport(files, opts);
  console.log(report);

  if (opts.ci) {
    const stats = require('./index').calculateStats(files);
    const criticals = files.filter(f => require('./index').classifyFile(f.time, stats) === 'critical');
    if (criticals.length > 0) {
      console.error(`\nCI FAIL: ${criticals.length} critical file(s) detected.`);
      process.exit(1);
    }
  }
}

main();
