'use strict';

const fs = require('fs');
const path = require('path');

// Parse TypeScript's --diagnostics or --extendedDiagnostics output
function parseDiagnosticsOutput(output) {
  const lines = output.split('\n');
  const files = [];

  for (const line of lines) {
    // Match lines like: "  45ms  src/components/App.tsx"
    const match = line.match(/^\s*(\d+)ms\s+(.+\.tsx?)$/);
    if (match) {
      files.push({
        file: match[2].trim(),
        time: parseInt(match[1], 10),
      });
    }
  }

  return files.sort((a, b) => b.time - a.time);
}

// Parse trace output from tsc --generateTrace <dir>
function parseTraceEvents(traceDir) {
  const eventsPath = path.join(traceDir, 'events.json');
  if (!fs.existsSync(eventsPath)) {
    return null;
  }

  const events = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
  const fileTimings = {};

  for (const event of events) {
    if (event.name && event.name.endsWith('.ts') || event.name?.endsWith('.tsx')) {
      const dur = event.dur || 0;
      if (!fileTimings[event.name]) {
        fileTimings[event.name] = { file: event.name, time: 0, count: 0 };
      }
      fileTimings[event.name].time += Math.round(dur / 1000); // μs → ms
      fileTimings[event.name].count++;
    }
  }

  return Object.values(fileTimings).sort((a, b) => b.time - a.time);
}

// Analyze files by extension
function groupByExtension(files) {
  const groups = {};
  for (const f of files) {
    const ext = path.extname(f.file) || 'other';
    if (!groups[ext]) groups[ext] = { ext, count: 0, totalTime: 0 };
    groups[ext].count++;
    groups[ext].totalTime += f.time;
  }
  return Object.values(groups).sort((a, b) => b.totalTime - a.totalTime);
}

// Analyze by directory depth
function groupByDirectory(files) {
  const groups = {};
  for (const f of files) {
    const dir = path.dirname(f.file);
    const topDir = dir.split('/').slice(0, 2).join('/');
    if (!groups[topDir]) groups[topDir] = { dir: topDir, count: 0, totalTime: 0 };
    groups[topDir].count++;
    groups[topDir].totalTime += f.time;
  }
  return Object.values(groups).sort((a, b) => b.totalTime - a.totalTime);
}

// Calculate stats
function calculateStats(files) {
  if (!files.length) return null;
  const times = files.map(f => f.time);
  const total = times.reduce((a, b) => a + b, 0);
  const avg = total / times.length;
  const sorted = [...times].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];

  return { total, avg: Math.round(avg), median, p95, p99, fileCount: files.length };
}

// Severity classification
function classifyFile(fileTime, stats) {
  if (!stats) return 'unknown';
  if (fileTime >= stats.p99) return 'critical';
  if (fileTime >= stats.p95) return 'slow';
  if (fileTime >= stats.avg) return 'moderate';
  return 'fast';
}

// Format bar chart
function formatBar(value, maxValue, width = 30) {
  const ratio = maxValue > 0 ? value / maxValue : 0;
  const filled = Math.round(ratio * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// Render report
function renderReport(files, options = {}) {
  const stats = calculateStats(files);
  if (!stats) return 'No files to analyze.\n';

  const { top = 20, json: jsonOutput = false, byExt = false, byDir = false, threshold = 0 } = options;

  if (jsonOutput) {
    return JSON.stringify({
      stats,
      files: files.slice(0, top).map(f => ({
        ...f,
        severity: classifyFile(f.time, stats),
        percentOfTotal: Math.round((f.time / stats.total) * 100),
      })),
      byExtension: byExt ? groupByExtension(files) : undefined,
      byDirectory: byDir ? groupByDirectory(files) : undefined,
    }, null, 2);
  }

  let out = '';
  out += 'TypeScript Compilation Time Analysis\n';
  out += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  out += `Files: ${stats.fileCount}  Total: ${stats.total}ms  Avg: ${stats.avg}ms  Median: ${stats.median}ms\n`;
  out += `P95: ${stats.p95}ms  P99: ${stats.p99}ms\n\n`;

  const filtered = threshold > 0 ? files.filter(f => f.time >= threshold) : files;
  const display = filtered.slice(0, top);
  const maxTime = display.length > 0 ? display[0].time : 1;

  out += `Top ${display.length} slowest files:\n`;
  out += '─'.repeat(80) + '\n';

  for (const f of display) {
    const sev = classifyFile(f.time, stats);
    const icon = sev === 'critical' ? '🔴' : sev === 'slow' ? '🟡' : sev === 'moderate' ? '🔵' : '🟢';
    const bar = formatBar(f.time, maxTime, 25);
    const pct = Math.round((f.time / stats.total) * 100);
    out += `${icon} ${String(f.time + 'ms').padEnd(8)} ${bar}  ${pct}%  ${f.file}\n`;
  }

  if (byExt) {
    const extGroups = groupByExtension(files);
    out += '\nBy Extension:\n';
    out += '─'.repeat(50) + '\n';
    for (const g of extGroups) {
      out += `  ${g.ext.padEnd(6)} ${g.count} files  ${g.totalTime}ms  (${Math.round((g.totalTime / stats.total) * 100)}%)\n`;
    }
  }

  if (byDir) {
    const dirGroups = groupByDirectory(files);
    out += '\nBy Directory:\n';
    out += '─'.repeat(50) + '\n';
    for (const g of dirGroups.slice(0, 10)) {
      out += `  ${g.dir.padEnd(25)} ${g.count} files  ${g.totalTime}ms\n`;
    }
  }

  // Tips
  const criticals = files.filter(f => classifyFile(f.time, stats) === 'critical');
  if (criticals.length > 0) {
    out += '\n💡 Tips:\n';
    out += `  - ${criticals.length} file(s) in critical zone (>${stats.p99}ms). Consider splitting.\n`;
    if (criticals.some(f => f.file.includes('.d.ts'))) {
      out += '  - Slow .d.ts files: check for large type exports or circular refs.\n';
    }
    out += '  - Run with --byDir to find hotspots in your codebase.\n';
  }

  return out;
}

// Run tsc with diagnostics
function runDiagnostics(projectDir, options = {}) {
  const { execSync } = require('child_process');
  const tsconfig = options.tsconfig ? `--project ${options.tsconfig}` : '--project tsconfig.json';

  try {
    const output = execSync(
      `npx tsc ${tsconfig} --noEmit --extendedDiagnostics 2>&1`,
      { cwd: projectDir, encoding: 'utf8', timeout: 120000 }
    );
    return parseDiagnosticsOutput(output);
  } catch (err) {
    // tsc exits non-zero on type errors but still outputs diagnostics
    if (err.stdout) {
      return parseDiagnosticsOutput(err.stdout);
    }
    throw new Error(`tsc failed: ${err.message}`);
  }
}

module.exports = {
  parseDiagnosticsOutput,
  parseTraceEvents,
  groupByExtension,
  groupByDirectory,
  calculateStats,
  classifyFile,
  formatBar,
  renderReport,
  runDiagnostics,
};
