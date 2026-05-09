import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const clientDir = join(process.cwd(), 'dist', 'client');
const assetsDir = join(clientDir, 'assets');
const files = readdirSync(assetsDir);

const entryCandidates = files.filter((f) => /^index-.*\.js$/.test(f));
const entryJs = entryCandidates
  .map((f) => ({ f, size: statSync(join(assetsDir, f)).size }))
  .sort((a, b) => b.size - a.size)[0]?.f;

const css = files.find((f) => /^styles-.*\.css$/.test(f));

if (!entryJs) {
  throw new Error('Could not find client entry bundle (index-*.js) in dist/client/assets');
}

const html = `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>Blindspot</title>\n    ${css ? `<link rel="stylesheet" href="/assets/${css}" />` : ''}\n  </head>\n  <body>\n    <script type="module" src="/assets/${entryJs}"></script>\n  </body>\n</html>\n`;

writeFileSync(join(clientDir, 'index.html'), html, 'utf8');
console.log(
  'Generated dist/client/index.html using',
  entryJs,
  css ?? '(no css)',
  'from candidates:',
  entryCandidates.join(', '),
);
