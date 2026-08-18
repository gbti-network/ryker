import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const cli = resolve('bin/ryker.js');
const dir = mkdtempSync(join(tmpdir(), 'ryker-cli-'));
const html = join(dir, 'report.html');
const original = '<!doctype html>\n<html><body><h1>Report</h1></body></html>\n';
writeFileSync(html, original);
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8' });
const result = (cwd, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });

function configOf(content) {
  const match = /<script\b[^>]*\bid=["']ryker-config["'][^>]*>([\s\S]*?)<\/script\s*>/i.exec(content);
  assert.ok(match, 'managed config element is present');
  return JSON.parse(match[1]);
}

assert.match(run('insert', 'report.html', '--dry-run'), /Would install/);
assert.equal(readFileSync(html, 'utf8'), original);
run('insert', 'report.html');
assert.match(readFileSync(html, 'utf8'), /<!-- ryker:begin -->/);
assert.match(run('doctor', 'report.html'), /^OK/m);
run('insert', 'report.html');
assert.equal((readFileSync(html, 'utf8').match(/<!-- ryker:begin -->/g) || []).length, 1);
run('remove', 'report.html');
assert.equal(readFileSync(html, 'utf8'), original);
assert.ok(existsSync(join(dir, 'ryker', 'dist', 'ryker.js')), 'remove retains a potentially shared bundle');
const bad = spawnSync(process.execPath, [cli, 'doctor', 'report.html'], { cwd: dir, encoding: 'utf8' });
assert.notEqual(bad.status, 0);

const optionsHtml = join(dir, 'options.html');
writeFileSync(optionsHtml, original);
const swallowedDryRun = result(dir, 'insert', 'options.html', '--asset-dir', '--dry-run');
assert.notEqual(swallowedDryRun.status, 0);
assert.match(swallowedDryRun.stderr, /--asset-dir requires a value/);
assert.equal(readFileSync(optionsHtml, 'utf8'), original, 'a swallowed dry-run cannot mutate the target');
const missingDocumentId = result(dir, 'insert', 'options.html', '--document-id');
assert.notEqual(missingDocumentId.status, 0);
assert.match(missingDocumentId.stderr, /--document-id requires a value/);

const injectedHtml = join(dir, 'injected.html');
const hostileId = 'x</script><script>alert(1)</script>';
writeFileSync(injectedHtml, original);
run('insert', 'injected.html', '--document-id', hostileId);
const injected = readFileSync(injectedHtml, 'utf8');
assert.equal(configOf(injected).RYKER_DOCUMENT_ID, hostileId);
assert.ok(!injected.includes(hostileId), 'the raw closing-script sequence is not written to HTML');
assert.match(injected, /x\\u003c\/script>\\u003cscript>alert\(1\)\\u003c\/script>/);

const customHtml = join(dir, 'custom.html');
writeFileSync(customHtml, original);
run('insert', 'custom.html', '--document-id', 'acme-q3-audit');
run('sync', 'custom.html');
assert.equal(configOf(readFileSync(customHtml, 'utf8')).RYKER_DOCUMENT_ID, 'acme-q3-audit',
  'sync preserves the managed document id unless a replacement is explicit');

const reportDir = join(dir, 'report');
mkdirSync(reportDir);
writeFileSync(join(reportDir, 'contained.html'), original);
const siblingAsset = result(dir, 'insert', 'report/contained.html', '--asset-dir', '../report-public', '--dry-run');
assert.notEqual(siblingAsset.status, 0);
assert.match(siblingAsset.stderr, /Asset directory must stay beside or below the target/);
writeFileSync(join(dir, 'outside.html'), original);
const outsideTarget = result(reportDir, 'insert', '../outside.html', '--dry-run');
assert.notEqual(outsideTarget.status, 0);
assert.match(outsideTarget.stderr, /Target must be inside the current working directory/);
if (process.platform === 'win32') {
  const crossDriveTarget = resolve('test/fixtures/report.html');
  const crossDrive = result(dir, 'doctor', crossDriveTarget);
  assert.notEqual(crossDrive.status, 0);
  assert.match(crossDrive.stderr, /Target must be inside the current working directory/);
}

const trickyHtml = join(dir, 'tricky.html');
const tricky = '<!doctype html>\n<html><body><script>const fake = "</body>";</script>' +
  '<!-- another </body> --><h1>Report</h1></body></html>\n';
writeFileSync(trickyHtml, tricky);
run('insert', 'tricky.html');
const installedTricky = readFileSync(trickyHtml, 'utf8');
const managedStart = installedTricky.indexOf('<!-- ryker:begin -->');
assert.ok(managedStart > installedTricky.indexOf('</script>'));
assert.ok(managedStart > installedTricky.indexOf('-->'));
assert.ok(managedStart < installedTricky.lastIndexOf('</body>'));
assert.match(run('doctor', 'tricky.html'), /^OK/m);

const managedEnd = installedTricky.indexOf('<!-- ryker:end -->') + '<!-- ryker:end -->'.length;
const managed = installedTricky.slice(managedStart, managedEnd);
const withoutManaged = installedTricky.slice(0, managedStart) + installedTricky.slice(managedEnd);
const realBody = withoutManaged.lastIndexOf('</body>');
writeFileSync(trickyHtml, withoutManaged.slice(0, realBody) + '<div>' + managed + '</div>' +
  withoutManaged.slice(realBody));
const nestedDoctor = result(dir, 'doctor', 'tricky.html');
assert.notEqual(nestedDoctor.status, 0);
assert.match(nestedDoctor.stderr, /not directly inside the document body/);

const firstShared = join(dir, 'shared-a.html');
const secondShared = join(dir, 'shared-b.html');
writeFileSync(firstShared, original);
writeFileSync(secondShared, original);
run('insert', 'shared-a.html');
run('insert', 'shared-b.html');
run('remove', 'shared-a.html');
assert.ok(existsSync(join(dir, 'ryker', 'dist', 'ryker.js')));
assert.match(run('doctor', 'shared-b.html'), /^OK/m,
  'removing one document does not break another document using the shared bundle');

const scanRuntime = {};
Function('Ryker', readFileSync(resolve('drop-in/src/security/scan.js'), 'utf8'))(scanRuntime);
assert.equal(scanRuntime.scan.text('{"client_secret":"abcdefghijklmnop"}', 'json').length, 1,
  'the generic credential pattern covers quoted JSON keys');
const largeMember = new Uint8Array(3 * 1024 * 1024);
largeMember.fill(32);
largeMember.set(Buffer.from('ghp_' + 'A'.repeat(36)), 2500000);
const largeHits = scanRuntime.scan.bytes(largeMember, 'large-member.txt');
assert.equal(largeHits.length, 1, 'the credential scanner reaches beyond the former 2 MiB cutoff');
assert.equal(largeHits.truncated, false);
assert.equal(largeHits.scannedBytes, largeMember.length);

const zipRuntime = {};
Function('Ryker', readFileSync(resolve('drop-in/src/export/zip.js'), 'utf8'))(zipRuntime);
assert.throws(() => zipRuntime.zip.safeName('data/../../outside.txt'), /parent path segments/);
assert.throws(() => zipRuntime.zip.safeName('C:\\outside.txt'), /must be relative/);
await assert.rejects(zipRuntime.zip.build(new Array(65536).fill({ name: 'x', data: '' })),
  /at most 65535 files/);
await assert.rejects(zipRuntime.zip.build([
  { name: 'same.txt', data: 'one' }, { name: 'same.txt', data: 'two' }
]), /same filename twice/);
const archive = await zipRuntime.zip.build([{ name: 'safe/report.txt', data: 'ok' }]);
assert.deepEqual(Array.from(archive.slice(0, 4)), [0x50, 0x4b, 0x03, 0x04]);

console.log('CLI package acceptance checks passed.');
