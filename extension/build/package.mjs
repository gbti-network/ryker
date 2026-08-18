// Build the Chrome Web Store upload from extension/.
//
// The store wants one zip of the extension directory. What it must NOT contain
// is the developer README: it documents loading an unpacked build, which is
// noise to a reviewer and to every installed copy. Everything else in the
// directory is runtime.
//
// Deterministic on purpose. Every entry carries a fixed timestamp and the files
// are walked in sorted order, so the same tree produces byte-identical bytes.
// That is what lets `test/extension-package.mjs` assert the zip matches the
// working tree instead of merely asserting that a zip exists.
//
// No dependencies, matching the rest of this repository's tooling. The writer
// is the same shape as drop-in/src/export/zip.js, which had to work in a
// browser; here zlib supplies the deflate.
//
//   node extension/build/package.mjs                 # -> extension/dist/ryker-chrome.zip
//   node extension/build/package.mjs path/to/out.zip
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, inflateRawSync, crc32 } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
export const EXTENSION = resolve(HERE, '..');
export const DEFAULT_OUT = join(EXTENSION, 'dist', 'ryker-chrome.zip');

// Developer documentation, not runtime. `icons/README.md` records where the
// mark comes from and is equally not something to ship to a reviewer.
const EXCLUDE_NAMES = new Set(['README.md']);
const EXCLUDE_DIRS = new Set(['dist', 'build']);

// A fixed DOS timestamp (1980-01-01 00:00:00), so the archive does not change
// when the clock does. Reproducibility is the whole point of this file.
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

/** Every file that belongs in the package, sorted, relative to extension/. */
export function packageFiles(root = EXTENSION) {
  const out = [];
  (function walk(dir) {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const rel = relative(root, full).split('\\').join('/');
      if (statSync(full).isDirectory()) {
        if (EXCLUDE_DIRS.has(rel)) continue;
        walk(full);
        continue;
      }
      if (EXCLUDE_NAMES.has(name)) continue;
      out.push(rel);
    }
  })(root);
  return out;
}

/** Build the archive bytes. Pure given the file contents, so it is testable. */
export function buildZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const comp = deflateRawSync(data, { level: 9 });
    const sum = crc32(data) >>> 0;

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6); // UTF-8 names
    lh.writeUInt16LE(8, 8); // deflate
    lh.writeUInt16LE(DOS_TIME, 10);
    lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(sum, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBytes.length, 26);
    local.push(lh, nameBytes, comp);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(DOS_TIME, 12);
    ch.writeUInt16LE(DOS_DATE, 14);
    ch.writeUInt32LE(sum, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBytes.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBytes);

    offset += lh.length + nameBytes.length + comp.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...local, centralBuf, eocd]);
}

/** Read a built archive back. publish.mjs uses this to learn what it is about
 *  to upload, because the zip is the only thing that is true about the artifact. */
export function readZipEntries(buf) {
  const out = [];
  // Find the end-of-central-directory record by scanning back from the tail.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip archive: no end-of-central-directory record');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt central directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');

    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.slice(start, start + compSize);
    out.push({ name, data: method === 0 ? raw : inflateRawSync(raw) });

    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export function pack(out = DEFAULT_OUT, root = EXTENSION) {
  const names = packageFiles(root);
  const entries = names.map((name) => ({ name, data: readFileSync(join(root, name)) }));
  const buf = buildZip(entries);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buf);
  return { out, entries, bytes: buf.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_OUT;
  const { entries, bytes } = pack(target);
  const manifest = JSON.parse(
    entries.find((e) => e.name === 'manifest.json').data.toString('utf8'));
  for (const e of entries) {
    console.log(String(e.data.length).padStart(7) + '  ' + e.name);
  }
  console.log(`\nRyker ${manifest.version}: ${entries.length} files, ` +
    `${(bytes / 1024).toFixed(1)} KB -> ${relative(process.cwd(), target)}`);
  if (!existsSync(target)) process.exit(1);
}
