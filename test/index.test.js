'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  parseDiagnosticsOutput,
  readTsConfig,
  collectTsFiles,
  analyzeFiles,
  estimateCompilationCost,
  generateReport,
  formatTable,
  formatJSON,
  analyze,
} = require('../src/index');

const TMP = path.join(__dirname, '__tmp_test__');

function setupTmp() {
  if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });
}

function cleanupTmp() {
  fs.rmSync(TMP, { recursive: true, force: true });
}

function writeFile(name, content) {
  const p = path.join(TMP, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.error('FAIL: ' + name + '\n  ' + e.message);
  }
}

// --- parseDiagnosticsOutput ---
test('parseDiagnosticsOutput parses file timing lines', () => {
  const raw = 'File                                           Time\n' +
    'src/types.ts                                   45.2ms\n' +
    'src/utils.ts                                    120ms\n' +
    'src/index.ts                                    89.5ms\n\n' +
    'Files: 3\nType checking: 254.7ms';
  const result = parseDiagnosticsOutput(raw);
  assert.strictEqual(result.files.length, 3);
  assert.strictEqual(result.files[0].timeMs, 45.2);
  assert.strictEqual(result.files[1].timeMs, 120);
  assert.strictEqual(result.files[2].timeMs, 89.5);
  assert.strictEqual(result.summary.files, 3);
  assert.strictEqual(result.summary.typeCheckingTime, 254.7);
});

test('parseDiagnosticsOutput handles empty input', () => {
  const result = parseDiagnosticsOutput('');
  assert.strictEqual(result.files.length, 0);
  assert.deepStrictEqual(result.summary, {});
});

test('parseDiagnosticsOutput parses memory and lines', () => {
  const raw = 'Files: 42\nLines: 12345\nMemory used: 256\nTypes: 800\n1.2 seconds';
  const result = parseDiagnosticsOutput(raw);
  assert.strictEqual(result.summary.files, 42);
  assert.strictEqual(result.summary.lines, 12345);
  assert.strictEqual(result.summary.memoryUsed, 256);
  assert.strictEqual(result.summary.types, 800);
  assert.strictEqual(result.summary.totalTime, 1.2);
});

// --- readTsConfig ---
test('readTsConfig reads valid tsconfig', () => {
  setupTmp();
  writeFile('tsconfig.json', '{"compilerOptions": {"strict": true}, "include": ["src"]}');
  const config = readTsConfig(TMP);
  assert.strictEqual(config.compilerOptions.strict, true);
  assert.deepStrictEqual(config.include, ['src']);
  cleanupTmp();
});

test('readTsConfig returns null for missing file', () => {
  assert.strictEqual(readTsConfig('/nonexistent/path'), null);
});

test('readTsConfig handles comments', () => {
  setupTmp();
  writeFile('tsconfig.json', '{\n// comment\n"compilerOptions": {}\n/* block */\n}');
  const config = readTsConfig(TMP);
  assert.ok(config);
  assert.ok(config.compilerOptions);
  cleanupTmp();
});

// --- collectTsFiles ---
test('collectTsFiles finds .ts files', () => {
  setupTmp();
  writeFile('app.ts', 'const x = 1;');
  writeFile('utils.ts', 'export function f() {}');
  writeFile('types.d.ts', 'declare type X = string;');
  writeFile('nested/deep/service.ts', 'export class S {}');
  writeFile('nested/deep/ignore.txt', 'not ts');
  const files = collectTsFiles(TMP, null);
  assert.ok(files.some(f => f.endsWith('app.ts')));
  assert.ok(files.some(f => f.endsWith('utils.ts')));
  assert.ok(files.some(f => f.endsWith('service.ts')));
  assert.ok(!files.some(f => f.endsWith('types.d.ts')));
  assert.ok(!files.some(f => f.endsWith('ignore.txt')));
  cleanupTmp();
});

test('collectTsFiles excludes node_modules', () => {
  setupTmp();
  writeFile('src/main.ts', 'export {}');
  writeFile('node_modules/lib/index.ts', 'export {}');
  const files = collectTsFiles(TMP, null);
  assert.ok(files.some(f => f.endsWith('main.ts')));
  assert.ok(!files.some(f => f.includes('node_modules')));
  cleanupTmp();
});

// --- analyzeFiles ---
test('analyzeFiles counts lines, imports, exports', () => {
  setupTmp();
  writeFile('sample.ts', "import { a } from 'a';\nimport { b } from 'b';\nexport function hello(x: string): number {\n  return x.length;\n}\nexport type Result = string | number;\ninterface Config { name: string; }\n");
  const files = collectTsFiles(TMP, null);
  const analysis = analyzeFiles(files);
  assert.strictEqual(analysis.length, 1);
  const f = analysis[0];
  assert.strictEqual(f.imports, 2);
  assert.strictEqual(f.exports, 2);
  assert.ok(f.typeAnnotations >= 3);
  assert.ok(f.interfaces >= 1);
  cleanupTmp();
});

// --- estimateCompilationCost ---
test('estimateCompilationCost returns reasonable values', () => {
  const simple = { lines: 10, typeAnnotations: 2, generics: 0, interfaces: 0, typeAliases: 0, imports: 1, decorators: 0 };
  const complex = { lines: 200, typeAnnotations: 50, generics: 20, interfaces: 10, typeAliases: 5, imports: 15, decorators: 8 };
  const simpleCost = estimateCompilationCost(simple);
  const complexCost = estimateCompilationCost(complex);
  assert.ok(simpleCost > 0);
  assert.ok(complexCost > simpleCost);
  assert.ok(complexCost > simpleCost * 5);
});

// --- generateReport ---
test('generateReport produces valid report', () => {
  const fileAnalysis = [
    { file: '/a/big.ts', lines: 500, typeAnnotations: 100, generics: 30, interfaces: 10, typeAliases: 5, imports: 20, decorators: 5, exports: 15 },
    { file: '/a/small.ts', lines: 10, typeAnnotations: 1, generics: 0, interfaces: 0, typeAliases: 0, imports: 1, decorators: 0, exports: 1 },
  ];
  const report = generateReport(fileAnalysis, { top: 10 });
  assert.strictEqual(report.totalFiles, 2);
  assert.strictEqual(report.totalLines, 510);
  assert.ok(report.totalEstimatedCost > 0);
  assert.strictEqual(report.topFiles[0].file, 'big.ts');
  assert.strictEqual(report.topFiles[1].file, 'small.ts');
});

test('generateReport respects threshold', () => {
  const fileAnalysis = [
    { file: '/a/big.ts', lines: 500, typeAnnotations: 100, generics: 30, interfaces: 10, typeAliases: 5, imports: 20, decorators: 5, exports: 15 },
    { file: '/a/small.ts', lines: 10, typeAnnotations: 1, generics: 0, interfaces: 0, typeAliases: 0, imports: 1, decorators: 0, exports: 1 },
  ];
  const report = generateReport(fileAnalysis, { threshold: 1000 });
  assert.strictEqual(report.totalFiles, 2);
});

// --- formatTable ---
test('formatTable produces readable output', () => {
  const report = {
    totalFiles: 2,
    totalLines: 100,
    totalEstimatedCost: 500,
    averageCost: 250,
    bottlenecks: 1,
    topFiles: [
      { file: 'big.ts', path: '/a/big.ts', lines: 80, typeAnnotations: 10, generics: 5, imports: 3, estimatedCost: 400 },
      { file: 'small.ts', path: '/a/small.ts', lines: 20, typeAnnotations: 1, generics: 0, imports: 1, estimatedCost: 100 },
    ],
  };
  const table = formatTable(report);
  assert.ok(table.includes('big.ts'));
  assert.ok(table.includes('small.ts'));
  assert.ok(table.includes('Total:'));
  assert.ok(table.includes('█'));
});

test('formatTable handles empty files', () => {
  const report = { totalFiles: 0, totalLines: 0, totalEstimatedCost: 0, averageCost: 0, bottlenecks: 0, topFiles: [] };
  const table = formatTable(report);
  assert.ok(table.includes('No TypeScript files'));
});

// --- formatJSON ---
test('formatJSON produces valid JSON', () => {
  const report = { totalFiles: 1, totalLines: 50 };
  const json = formatJSON(report);
  const parsed = JSON.parse(json);
  assert.strictEqual(parsed.totalFiles, 1);
});

// --- analyze (integration) ---
test('analyze returns null for dir with no ts files', () => {
  setupTmp();
  writeFile('readme.md', '# hello');
  const result = analyze(TMP, { format: 'report' });
  assert.strictEqual(result, null);
  cleanupTmp();
});

test('analyze returns table format by default', () => {
  setupTmp();
  writeFile('code.ts', 'import { x } from "y";\nexport function f(a: string): number { return a.length; }\ninterface T { n: number; }');
  const result = analyze(TMP, { format: 'table' });
  assert.ok(typeof result === 'string');
  assert.ok(result.includes('code.ts'));
  cleanupTmp();
});

test('analyze returns JSON with --json', () => {
  setupTmp();
  writeFile('code.ts', 'export const x: number = 1;');
  const result = analyze(TMP, { format: 'json' });
  const parsed = JSON.parse(result);
  assert.ok(parsed.totalFiles >= 1);
  assert.ok(parsed.topFiles.length >= 1);
  cleanupTmp();
});

test('analyze with diagnostics output returns parsed data', () => {
  const result = analyze('.', {
    format: 'json',
    diagnosticsOutput: 'File                                            Time\nsrc/a.ts                                         100ms\nsrc/b.ts                                         50ms\n\nFiles: 2',
  });
  const parsed = JSON.parse(result);
  assert.ok(parsed.files);
  assert.strictEqual(parsed.files.length, 2);
});

test('analyze sorts by different fields', () => {
  setupTmp();
  let bigContent = 'export function big() {\n';
  for (let i = 0; i < 50; i++) bigContent += '  const x: string = "a";\n';
  bigContent += '}\n';
  writeFile('big.ts', bigContent);
  writeFile('small.ts', 'export const a = 1;\n');
  const result = analyze(TMP, { format: 'report', sortBy: 'lines' });
  assert.ok(result.topFiles[0].lines > result.topFiles[1].lines);
  cleanupTmp();
});

// --- Edge cases ---
test('handles files with complex generics', () => {
  setupTmp();
  writeFile('generic.ts', "type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };\nfunction map<T, U>(result: Result<T>, fn: (val: T) => U): Result<U> {\n  return { ok: true, value: fn(result.value) };\n}\nexport { Result, map };\n");
  const files = collectTsFiles(TMP, null);
  const analysis = analyzeFiles(files);
  assert.strictEqual(analysis.length, 1);
  assert.ok(analysis[0].generics >= 3);
  cleanupTmp();
});

test('handles .tsx files', () => {
  setupTmp();
  writeFile('component.tsx', 'export function App(): JSX.Element { return <div>hi</div>; }');
  const files = collectTsFiles(TMP, null);
  assert.strictEqual(files.length, 1);
  assert.ok(files[0].endsWith('.tsx'));
  cleanupTmp();
});

test('handles deeply nested directories', () => {
  setupTmp();
  writeFile('a/b/c/d/e/deep.ts', 'export const deep = true;');
  const files = collectTsFiles(TMP, null);
  assert.strictEqual(files.length, 1);
  cleanupTmp();
});

test('bottleneck detection works', () => {
  const fileAnalysis = [
    { file: '/huge.ts', lines: 2000, typeAnnotations: 300, generics: 100, interfaces: 50, typeAliases: 20, imports: 50, decorators: 30, exports: 40 },
    { file: '/big.ts', lines: 500, typeAnnotations: 80, generics: 20, interfaces: 10, typeAliases: 5, imports: 20, decorators: 10, exports: 15 },
    { file: '/medium.ts', lines: 100, typeAnnotations: 15, generics: 5, interfaces: 2, typeAliases: 1, imports: 5, decorators: 2, exports: 3 },
    { file: '/tiny.ts', lines: 5, typeAnnotations: 0, generics: 0, interfaces: 0, typeAliases: 0, imports: 0, decorators: 0, exports: 1 },
  ];
  const report = generateReport(fileAnalysis);
  assert.ok(report.bottlenecks <= 2);
  assert.ok(report.bottleneckFiles.length > 0);
});

test('module exports analyze function', () => {
  const { analyze: a } = require('../src/index');
  assert.strictEqual(typeof a, 'function');
});

test('parseDiagnosticsOutput handles program/bind/check/emit times', () => {
  const raw = 'Program: 150.5ms\nBind: 30.2ms\nCheck: 200.8ms\nEmit: 45.1ms';
  const result = parseDiagnosticsOutput(raw);
  assert.strictEqual(result.summary.programTime, 150.5);
  assert.strictEqual(result.summary.bindTime, 30.2);
  assert.strictEqual(result.summary.checkTime, 200.8);
  assert.strictEqual(result.summary.emitTime, 45.1);
});

// Summary
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
