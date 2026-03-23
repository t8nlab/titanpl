import { build, release } from "@titanpl/packet";
import fs from 'fs';
import path from 'path';

export async function buildCommand(isRelease = false) {
  const buildFn = isRelease ? release : build;
  const dist = await buildFn(process.cwd());

  const tanfigPath = path.join(process.cwd(), 'tanfig.json');
  if (fs.existsSync(tanfigPath)) {
    fs.copyFileSync(tanfigPath, path.join(dist, 'tanfig.json'));
  }
  const pkgPath = path.join(process.cwd(), 'package.json');
  if (fs.existsSync(pkgPath)) {
    fs.copyFileSync(pkgPath, path.join(dist, 'package.json'));
  }

  console.log(`✔ ${isRelease ? 'Release' : 'Build'} complete →`, dist);
}