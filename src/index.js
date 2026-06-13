'use strict';

const fs = require('fs');
const path = require('path');

/**
 * tsdown — Analyze TypeScript compilation time per file.
 * 
 * Parses tsc --diagnostics output or uses tsconfig to profile builds.
 * Identifies slow files, bottlenecks, and generates reports.
 */

// --- Parsing tsc extendedDiagnostics output ---

/**
 * Parse tsc --extendedDiagnostics output.
 * Returns structured diagnostics data.
 */
function parseDiagnosticsOutput(raw) {
  const lines = raw.split('\n');
  const result = {
    files: [],
    summary: {},
  };

  let inFiles = false;
  for (const line of lines) {
    const trimmed = line.trim();

    // Detect "Files being checked" or similar section
    if (/files\s+change\s+time/i.test(trimmed) || /file\s+time/i.test(trimmed)) {
      inFiles = true;
      continue;
    }

    if (inFiles) {
      // Parse file timing lines: "path/to/file.ts  120ms"
      const fileMatch = trimmed.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*ms$/);
      if (fileMatch) {
        result.files.push({
          file: fileMatch[1].trim(),
          timeMs: parseFloat(fileMatch[2]),
        });
        continue;
      }
      // End of file list (empty line or new section)
      if (trimmed === '' || /^[A-Z]/.test(trimmed)) {
        inFiles = false;
      }
    }

    // Parse summary lines
    const summaryPatterns = [
      { key: 'files', re: /Files\s*:\s*(\d+)/i },
      { key: 'lines', re: /Lines\s*:\s*(\d+)/i },
      { key: 'identifiers', re: /Identifiers\s*:\s*(\d+)/i },
      { key: 'types', re: /Types\s*:\s*(\d+)/i },
      { key: 'memoryUsed', re: /Memory used\s*:\s*(\d+)/i },
      { key: 'totalTime', re: /(\d+(?:\.\d+)?)\s*seconds?/i },
      { key: 'typeCheckingTime', re: /Type checking\s*:\s*(\d+(?:\.\d+)?)\s*ms/i },
      { key: 'programTime', re: /Program\s*:\s*(\d+(?:\.\d+)?)\s*ms/i },
      { key: 'bindTime', re: /Bind\s*:\s*(\d+(?:\.\d+)?)\s*ms/i },
      { key: 'checkTime', re: /Check\s*:\s*(\d+(?:\.\d+)?)\s*ms/i },
      { key: 'emitTime', re: /Emit\s*:\s*(\d+(?:\.\d+)?)\s*ms/i },
    ];

    for (const { key, re } of summaryPatterns) {
      const m = trimmed.match(re);
      if (m) {
        result.summary[key] = parseFloat(m[1]);
        break;
      }
    }
  }

  return result;
}

// --- TypeScript config parsing ---

/**
 * Read tsconfig.json from a directory.
 */
function readTsConfig(dir) {
  const tsconfigPath = path.join(dir, 'tsconfig.json');
  if (!fs.existsSync(tsconfigPath)) return null;
  try {
    const content = fs.readFileSync(tsconfigPath, 'utf-8');
    // Strip comments (simple approach)
    const clean = content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    return JSON.parse(clean);
  } catch {
    return null;
  }
}

/**
 * Collect all .ts/.tsx files from project.
 * Respects include/exclude from tsconfig.
 */
function collectTsFiles(dir, tsconfig) {
  const includePatterns = tsconfig?.include || ['**/*.ts'];
  const excludePatterns = tsconfig?.exclude || ['node_modules', '**/*.d.ts'];

  const files = [];

  function walk(d) {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch { return; }

    for (const entry of entries) {
      const fullPath = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (excludePatterns.some(p => entry.name.includes(p.replace(/\*\*/g, '')))) continue;
        walk(fullPath);
      } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
        const rel = path.relative(dir, fullPath);
        if (excludePatterns.some(p => {
          if (p.includes('**')) return new RegExp(p.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*')).test(rel);
          return rel.includes(p);
        })) continue;
        files.push(fullPath);
      }
    }
  }

  walk(dir);
  return files;
}

/**
 * Measure file sizes and line counts for TS files.
 */
function analyzeFiles(files) {
  return files.map(f => {
    try {
      const stat = fs.statSync(f);
      const content = fs.readFileSync(f, 'utf-8');
      const lines = content.split('\n').length;
      const imports = (content.match(/import\s/g) || []).length;
      const exports = (content.match(/export\s/g) || []).length;
      const types = (content.match(/:\s*(?:string|number|boolean|any|void|never|unknown|object|undefined|null|Record|Partial|Required|Readonly|Pick|Omit|Exclude|Extract|NonNullable|ReturnType|InstanceType|Parameters|ConstructorParameters)/g) || []).length;
      const generics = (content.match(/<[^>]+>/g) || []).length;
      const interfaces = (content.match(/interface\s+\w+/g) || []).length;
      const typeAliases = (content.match(/type\s+\w+/g) || []).length;
      const decorators = (content.match(/@\w+/g) || []).length;

      return {
        file: f,
        sizeBytes: stat.size,
        lines,
        imports,
        exports,
        typeAnnotations: types,
        generics,
        interfaces,
        typeAliases,
        decorators,
        complexityScore: lines * 1 + types * 2 + generics * 3 + interfaces * 2 + decorators * 2,
      };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

// --- Estimating compilation cost ---

/**
 * Estimate compilation cost based on file characteristics.
 * This is a heuristic since we can't instrument tsc internally without the TS compiler API.
 * Score is relative — higher = likely slower to compile.
 */
function estimateCompilationCost(fileInfo) {
  const { lines, typeAnnotations, generics, interfaces, typeAliases, imports, decorators } = fileInfo;
  
  // Base cost from lines
  let cost = lines * 0.5;
  
  // Type complexity
  cost += typeAnnotations * 5;
  cost += generics * 15;
  cost += interfaces * 10;
  cost += typeAliases * 8;
  cost += decorators * 12;
  
  // Import cost (each import adds resolution overhead)
  cost += imports * 3;
  
  return Math.round(cost);
}

// --- Report generation ---

/**
 * Generate a report from file analysis.
 */
function generateReport(fileAnalysis, options = {}) {
  const { top = 20, sortBy = 'estimatedCost', threshold = 0 } = options;

  // Add estimated cost
  const enriched = fileAnalysis.map(f => ({
    ...f,
    estimatedCost: estimateCompilationCost(f),
    file: path.basename(f.file),
    path: f.file,
  }));

  // Sort
  enriched.sort((a, b) => b[sortBy] - a[sortBy]);

  // Filter by threshold
  const filtered = threshold > 0 
    ? enriched.filter(f => f.estimatedCost >= threshold) 
    : enriched;

  const totalLines = fileAnalysis.reduce((s, f) => s + f.lines, 0);
  const totalCost = enriched.reduce((s, f) => s + f.estimatedCost, 0);
  const avgCost = enriched.length > 0 ? Math.round(totalCost / enriched.length) : 0;

  // Find bottlenecks (top 20% files contributing to cost)
  const bottleneckThreshold = totalCost * 0.8;
  let runningCost = 0;
  const bottlenecks = [];
  for (const f of enriched) {
    runningCost += f.estimatedCost;
    bottlenecks.push(f);
    if (runningCost >= bottleneckThreshold) break;
  }

  return {
    totalFiles: enriched.length,
    totalLines,
    totalEstimatedCost: totalCost,
    averageCost: avgCost,
    bottlenecks: bottlenecks.length,
    bottleneckFiles: bottlenecks.slice(0, top).map(f => f.file),
    topFiles: enriched.slice(0, top),
    allFiles: enriched,
  };
}

/**
 * Format report as ASCII table.
 */
function formatTable(report, options = {}) {
  const { showPath = false } = options;
  const files = report.topFiles;
  if (files.length === 0) return 'No TypeScript files found.\n';

  // Column widths
  const maxFile = Math.max(...files.map(f => (showPath ? f.path : f.file).length), 8);
  const maxCost = 12;

  let out = '';
  
  // Header
  out += `${'File'.padEnd(maxFile)}  ${'Lines'.padStart(6)}  ${'Types'.padStart(5)}  ${'Generic'.padStart(7)}  ${'Import'.padStart(6)}  ${'Est Cost'.padStart(maxCost)}  ${'Bar'}\n`;
  out += `${'─'.repeat(maxFile)}  ${'─'.repeat(6)}  ${'─'.repeat(5)}  ${'─'.repeat(7)}  ${'─'.repeat(6)}  ${'─'.repeat(maxCost)}  ${'─'.repeat(30)}\n`;

  const maxEstCost = Math.max(...files.map(f => f.estimatedCost), 1);
  for (const f of files) {
    const name = showPath ? f.path : f.file;
    const bar = '█'.repeat(Math.round((f.estimatedCost / maxEstCost) * 30));
    out += `${name.padEnd(maxFile)}  ${String(f.lines).padStart(6)}  ${String(f.typeAnnotations).padStart(5)}  ${String(f.generics).padStart(7)}  ${String(f.imports).padStart(6)}  ${String(f.estimatedCost).padStart(maxCost)}  ${bar}\n`;
  }

  out += `\nTotal: ${report.totalFiles} files | ${report.totalLines} lines | Est cost: ${report.totalEstimatedCost}\n`;
  out += `Bottleneck files (80% of cost): ${report.bottlenecks} files\n`;

  return out;
}

/**
 * Format report as JSON.
 */
function formatJSON(report) {
  return JSON.stringify(report, null, 2);
}

// --- Main analysis function ---

/**
 * Analyze a TypeScript project directory.
 * @param {string} dir - Project directory
 * @param {object} options - { top, sortBy, threshold, showPath, format }
 * @returns {object|string} Report object or formatted string
 */
function analyze(dir, options = {}) {
  const {
    top = 20,
    sortBy = 'estimatedCost',
    threshold = 0,
    showPath = false,
    format = 'table',
    diagnosticsOutput = null,
  } = options;

  const absDir = path.resolve(dir);

  // If raw diagnostics output provided, parse it
  if (diagnosticsOutput) {
    const parsed = parseDiagnosticsOutput(diagnosticsOutput);
    if (parsed.files.length > 0) {
      parsed.files.sort((a, b) => b.timeMs - a.timeMs);
      return format === 'json' ? formatJSON({ source: 'diagnostics', ...parsed }) : parsed;
    }
    // Fall through to static analysis
  }

  const tsconfig = readTsConfig(absDir);
  const tsFiles = collectTsFiles(absDir, tsconfig);
  
  if (tsFiles.length === 0) {
    return format === 'json' ? '{"error":"No TypeScript files found"}' : null;
  }

  const fileAnalysis = analyzeFiles(tsFiles);
  const report = generateReport(fileAnalysis, { top, sortBy, threshold });

  if (format === 'json') return formatJSON(report);
  if (format === 'table') return formatTable(report, { showPath });
  return report;
}

module.exports = {
  parseDiagnosticsOutput,
  readTsConfig,
  collectTsFiles,
  analyzeFiles,
  estimateCompilationCost,
  generateReport,
  formatTable,
  formatJSON,
  analyze,
};
