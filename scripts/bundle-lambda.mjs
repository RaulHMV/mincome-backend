// Empaqueta la Lambda en un solo archivo con solo el código que usa: sin
// devDependencies, sin src/ ni test/, sin los .ts y sin lo que el
// tree-shaking deja fuera.
//
//   npm run build:lambda                # deja el paquete en dist-lambda/
//   node scripts/bundle-lambda.mjs DIR  # en otra carpeta
//
// Se empaqueta la salida de `nest build` (dist/), no los .ts: esbuild no emite
// la metadata de los decoradores (emitDecoratorMetadata) que la inyección de
// dependencias de Nest necesita, y tsc sí.

import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { readdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const ENTRY = 'dist/lambda.js';
const outdir = resolve(process.argv[2] ?? 'dist-lambda');

// Paquetes que Nest carga solo si están instalados (con try/catch) y que esta
// API no usa. Si alguno se vuelve necesario, hay que instalarlo, no quitarlo
// de aquí.
const OPTIONAL_PACKAGES = [
  '@nestjs/microservices',
  '@nestjs/websockets',
  'class-transformer',
  'class-validator',
  'graphql',
];

if (!existsSync(ENTRY)) {
  console.error(`No existe ${ENTRY}: corre "npm run build" primero.`);
  process.exit(1);
}

await rm(outdir, { recursive: true, force: true });

const result = await build({
  entryPoints: { lambda: ENTRY },
  outdir,
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  minify: true,
  // Nest y TypeORM leen el nombre de las clases (contextos de log, metadata
  // de entidades); sin esto, el minificador las renombra.
  keepNames: true,
  // Stack traces legibles en CloudWatch con NODE_OPTIONS=--enable-source-maps.
  sourcemap: true,
  sourcesContent: false,
  // Las licencias de las dependencias quedan en lambda.js.LEGAL.txt.
  legalComments: 'external',
  external: OPTIONAL_PACKAGES,
  // Nest, @nestjs/typeorm y Observe son ESM y usan createRequire(import.meta.url)
  // para paquetes opcionales; en CJS import.meta queda vacío y truenan al
  // cargar. Se reemplaza por la URL del propio paquete.
  banner: {
    js: 'const __importMetaUrl = require("node:url").pathToFileURL(__filename).href;',
  },
  define: { 'import.meta.url': '__importMetaUrl' },
  metafile: true,
  logLevel: 'warning',
});

if (result.errors.length > 0) {
  process.exit(1);
}

let total = 0;
for (const file of await readdir(outdir)) {
  const { size } = await stat(join(outdir, file));
  total += size;
  console.log(`${(size / 1024).toFixed(0).padStart(8)} KB  ${file}`);
}
console.log(`${(total / 1024).toFixed(0).padStart(8)} KB  total en ${outdir}`);
