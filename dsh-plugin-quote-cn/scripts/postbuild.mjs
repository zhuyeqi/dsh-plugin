import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';

await mkdir('lib', { recursive: true });

for (const junk of ['lib/index.ts', 'lib/index.mjs', 'lib/types']) {
  if (existsSync(junk)) await rm(junk, { recursive: true, force: true });
}

const client = await readFile('lib/client.js', 'utf8');
if (!client.includes('window.__ModuleLoader__.load') || !client.includes('@zhuyeqi/dsh-plugin-quote-cn')) {
  throw new Error(`lib/client.js is not a ModuleLoader factory bundle.\ngot: ${client.slice(0, 160)}`);
}
if (!existsSync('lib/index.js')) {
  throw new Error('lib/index.js missing after bundle');
}
console.log('✓ client ModuleLoader banner ok');
console.log('✓ postbuild done');
