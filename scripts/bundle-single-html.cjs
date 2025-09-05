#!/usr/bin/env node
// Bundle public/index.html into a single self-contained HTML by inlining CSS and JS
const fs = require('fs');
const path = require('path');

const pubDir = path.join(__dirname, '..', 'public');
const distDir = path.join(__dirname, '..', 'dist');
const inHtmlPath = path.join(pubDir, 'index.html');
const cssPath = path.join(pubDir, 'style.css');
const jsPath = path.join(pubDir, 'main.js');

function main(){
  let html = fs.readFileSync(inHtmlPath, 'utf8');
  const css = fs.readFileSync(cssPath, 'utf8');
  const js = fs.readFileSync(jsPath, 'utf8');

  // Inline CSS link
  html = html.replace(
    /<link\s+rel=\"stylesheet\"\s+href=\"style\.css\"\s*\/>/i,
    `<style>\n${css}\n</style>`
  );

  // Inline module script
  html = html.replace(
    /<script[^>]*type=\"module\"[^>]*src=\"main\.js\"[^>]*><\/script>/i,
    `<script type="module">\n${js}\n</script>`
  );

  if (!fs.existsSync(distDir)) fs.mkdirSync(distDir);
  const outPath = path.join(distDir, 'voxelcraft-single.html');
  fs.writeFileSync(outPath, html, 'utf8');
  console.log('Wrote', outPath);
}

main();

