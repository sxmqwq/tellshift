import { mkdir, rm, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
await rm(`${root}/dist`, { recursive: true, force: true });
await mkdir(`${root}/dist`, { recursive: true });
for (const path of ['index.html', 'src', 'favicon.svg', '.nojekyll']) {
  await cp(`${root}/${path}`, `${root}/dist/${path}`, { recursive: true });
}
console.log('tellshift built → dist/ (no runtime dependencies)');
