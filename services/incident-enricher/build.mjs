import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';

await build({
  entryPoints: ['src/lambda.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
});
await writeFile('dist/package.json', JSON.stringify({ type: 'commonjs' }) + '\n');
