'use strict';

const {
  parseDiagnosticsOutput, parseTraceEvents, groupByExtension,
  groupByDirectory, calculateStats, classifyFile, formatBar, renderReport
} = require('./index');
const assert = require('assert');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}: ${e.message}`); }
}

console.log('tsdown tests\n');

// parseDiagnosticsOutput
test('parses diagnostic output with ms timings', () => {
  const output = `
Files:            3
Type:             15ms
  120ms  src/components/App.tsx
  45ms   src/utils/helpers.ts
  10ms   src/index.ts
`;
  const files = parseDiagnosticsOutput(output);
  assert.strictEqual(files.length, 3);
  assert.strictEqual(files[0].file, 'src/components/App.tsx');
  assert.strictEqual(files[0].time, 120);
  assert.strictEqual(files[1].time, 45);
  assert.strictEqual(files[2].time, 10);
});

test('sorts files by time descending', () => {
  const output = `
  5ms  a.ts
  50ms  b.ts
  10ms  c.ts
`;
  const files = parseDiagnosticsOutput(output);
  assert.strictEqual(files[0].file, 'b.ts');
  assert.strictEqual(files[0].time, 50);
});

test('handles empty output', () => {
  const files = parseDiagnosticsOutput('');
  assert.strictEqual(files.length, 0);
});

test('ignores non-file lines', () => {
  const output = `
Some random text
Files: 10
  20ms  foo.ts
More text
`;
  const files = parseDiagnosticsOutput(output);
  assert.strictEqual(files.length, 1);
  assert.strictEqual(files[0].file, 'foo.ts');
});

// calculateStats
test('calculates stats correctly', () => {
  const files = [
    { file: 'a.ts', time: 100 },
    { file: 'b.ts', time: 50 },
    { file: 'c.ts', time: 30 },
    { file: 'd.ts', time: 20 },
  ];
  const stats = calculateStats(files);
  assert.strictEqual(stats.fileCount, 4);
  assert.strictEqual(stats.total, 200);
  assert.strictEqual(stats.avg, 50);
  assert.strictEqual(stats.median, 50); // sorted[2] for 4 elements
});

test('returns null for empty array', () => {
  assert.strictEqual(calculateStats([]), null);
});

test('calculates p95 and p99', () => {
  const files = Array.from({ length: 100 }, (_, i) => ({ file: `f${i}.ts`, time: i + 1 }));
  const stats = calculateStats(files);
  assert.strictEqual(stats.total, 5050);
  assert.ok(stats.p95 >= 90);
  assert.ok(stats.p99 >= 95);
});

// classifyFile
test('classifies critical files', () => {
  const files = Array.from({ length: 100 }, (_, i) => ({ file: `f${i}.ts`, time: i + 1 }));
  const stats = calculateStats(files);
  assert.strictEqual(classifyFile(100, stats), 'critical');
  assert.strictEqual(classifyFile(1, stats), 'fast');
});

test('classifies slow files', () => {
  const files = Array.from({ length: 50 }, (_, i) => ({ file: `f${i}.ts`, time: 50 - i }));
  const stats = calculateStats(files);
  assert.strictEqual(classifyFile(50, stats), 'critical');
  assert.strictEqual(classifyFile(10, stats), 'fast');
});

// formatBar
test('formatBar creates correct bar', () => {
  const bar = formatBar(50, 100, 10);
  assert.strictEqual(bar, '█████░░░░░');
});

test('formatBar handles zero max', () => {
  const bar = formatBar(0, 0, 10);
  assert.strictEqual(bar, '░░░░░░░░░░');
});

test('formatBar handles full bar', () => {
  const bar = formatBar(100, 100, 10);
  assert.strictEqual(bar, '██████████');
});

// groupByExtension
test('groups files by extension', () => {
  const files = [
    { file: 'a.ts', time: 100 },
    { file: 'b.tsx', time: 50 },
    { file: 'c.ts', time: 30 },
  ];
  const groups = groupByExtension(files);
  assert.strictEqual(groups.length, 2);
  assert.strictEqual(groups[0].ext, '.ts');
  assert.strictEqual(groups[0].count, 2);
  assert.strictEqual(groups[0].totalTime, 130);
});

// groupByDirectory
test('groups files by directory', () => {
  const files = [
    { file: 'src/components/a.tsx', time: 100 },
    { file: 'src/utils/b.ts', time: 50 },
    { file: 'src/components/c.tsx', time: 30 },
  ];
  const groups = groupByDirectory(files);
  assert.strictEqual(groups.length, 2);
  const compGroup = groups.find(g => g.dir === 'src/components');
  assert.strictEqual(compGroup.count, 2);
  assert.strictEqual(compGroup.totalTime, 130);
});

// renderReport
test('renders text report', () => {
  const files = [
    { file: 'slow.ts', time: 200 },
    { file: 'medium.ts', time: 50 },
    { file: 'fast.ts', time: 10 },
  ];
  const report = renderReport(files);
  assert.ok(report.includes('TypeScript Compilation Time Analysis'));
  assert.ok(report.includes('slow.ts'));
  assert.ok(report.includes('200ms'));
});

test('renders JSON report', () => {
  const files = [
    { file: 'slow.ts', time: 200 },
    { file: 'fast.ts', time: 10 },
  ];
  const report = renderReport(files, { json: true });
  const data = JSON.parse(report);
  assert.strictEqual(data.stats.fileCount, 2);
  assert.strictEqual(data.files[0].file, 'slow.ts');
  assert.ok(data.files[0].percentOfTotal > 0);
});

test('respects top limit', () => {
  const files = Array.from({ length: 50 }, (_, i) => ({ file: `f${i}.ts`, time: 50 - i }));
  const report = renderReport(files, { top: 5 });
  // should show 5 files
  const lines = report.split('\n').filter(l => l.includes('ms') && l.includes('.ts'));
  assert.ok(lines.length <= 5);
});

test('respects threshold filter', () => {
  const files = [
    { file: 'slow.ts', time: 200 },
    { file: 'medium.ts', time: 50 },
    { file: 'fast.ts', time: 10 },
  ];
  const report = renderReport(files, { threshold: 40 });
  assert.ok(report.includes('slow.ts'));
  assert.ok(!report.includes('fast.ts'));
});

test('renders by extension breakdown', () => {
  const files = [
    { file: 'a.ts', time: 100 },
    { file: 'b.tsx', time: 50 },
  ];
  const report = renderReport(files, { byExt: true });
  assert.ok(report.includes('By Extension'));
});

test('renders by directory breakdown', () => {
  const files = [
    { file: 'src/a.ts', time: 100 },
    { file: 'lib/b.ts', time: 50 },
  ];
  const report = renderReport(files, { byDir: true });
  assert.ok(report.includes('By Directory'));
});

test('shows tips for critical files', () => {
  const files = Array.from({ length: 100 }, (_, i) => ({ file: `f${i}.ts`, time: 100 - i }));
  const report = renderReport(files);
  assert.ok(report.includes('💡 Tips'));
});

test('handles empty files', () => {
  const report = renderReport([]);
  assert.ok(report.includes('No files'));
});

// parseTraceEvents
test('returns null for missing trace dir', () => {
  const result = parseTraceEvents('/nonexistent/path');
  assert.strictEqual(result, null);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
