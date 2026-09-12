import { promises as fs } from 'node:fs';
import { join } from 'node:path';

const roots = ['src', 'test'];
let failures = 0;
for (const root of roots) {
  const files = await walk(root);
  for (const file of files.filter((name) => name.endsWith('.ts'))) {
    const source = await fs.readFile(file, 'utf8');
    if (source.includes('\t')) { console.error(`tab character: ${file}`); failures++; }
    if (source.endsWith(' \n')) { console.error(`trailing whitespace: ${file}`); failures++; }
  }
}
if (failures) process.exitCode = 1;

async function walk(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) { const path = join(root, entry.name); if (entry.isDirectory()) result.push(...await walk(path)); else result.push(path); }
  return result;
}
