import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const cli = resolve('bin/ryker.js');
const dir = mkdtempSync(join(tmpdir(), 'ryker-cli-'));
const html = join(dir, 'report.html');
const original = '<!doctype html>\n<html><body><h1>Report</h1></body></html>\n';
writeFileSync(html, original);
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8' });

assert.match(run('insert', 'report.html', '--dry-run'), /Would install/);
assert.equal(readFileSync(html, 'utf8'), original);
run('insert', 'report.html');
assert.match(readFileSync(html, 'utf8'), /<!-- ryker:begin -->/);
assert.match(run('doctor', 'report.html'), /^OK/m);
run('insert', 'report.html');
assert.equal((readFileSync(html, 'utf8').match(/<!-- ryker:begin -->/g) || []).length, 1);
run('remove', 'report.html');
assert.equal(readFileSync(html, 'utf8'), original);
const bad = spawnSync(process.execPath, [cli, 'doctor', 'report.html'], { cwd: dir, encoding: 'utf8' });
assert.notEqual(bad.status, 0);
console.log('CLI package acceptance checks passed.');
