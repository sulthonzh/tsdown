#!/usr/bin/env node
'use strict';

const { analyze } = require('./src/index');
const path = require('path');

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
tsdown — Analyze TypeScript compilation time per file

Usage:
  tsdown [dir] [options]

Options:
  --top <n>          Show top N files (default: 20)
  --sort <field>     Sort by field: estimatedCost, lines, typeAnnotations, generics (default: estimatedCost)
  --threshold <n>    Only show files with estimated cost >= n
  --show-path        Show full file paths
  --json             Output as JSON
  --stdin            Read tsc --extendedDiagnostics output from stdin
  --help, -h         Show this help

Examples:
  tsdown ./src
  tsdown ./src --top 10 --sort lines
  tsc --extendedDiagnostics | tsdown --stdin
  tsdown . --json > report.json
`);
  process.exit(0);
}

// Parse args
let dir = '.';
let top = 20;
let sortBy = 'estimatedCost';
let threshold = 0;
let showPath = false;
let outputFormat = 'table';
let useStdin = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--top' && args[i + 1]) { top = parseInt(args[++i], 10); }
  else if (arg === '--sort' && args[i + 1]) { sortBy = args[++i]; }
  else if (arg === '--threshold' && args[i + 1]) { threshold = parseInt(args[++i], 10); }
  else if (arg === '--show-path') { showPath = true; }
  else if (arg === '--json') { outputFormat = 'json'; }
  else if (arg === '--stdin') { useStdin = true; }
  else if (!arg.startsWith('--')) { dir = arg; }
}

async function run() {
  let diagnosticsOutput = null;

  if (useStdin) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    diagnosticsOutput = Buffer.concat(chunks).toString('utf-8');
  }

  const result = analyze(dir, {
    top,
    sortBy,
    threshold,
    showPath,
    format: outputFormat,
    diagnosticsOutput,
  });

  if (result === null) {
    console.error('No TypeScript files found in ' + path.resolve(dir));
    process.exit(1);
  }

  if (typeof result === 'string') {
    console.log(result);
  } else {
    console.log(result);
  }
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
