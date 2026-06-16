import path from 'path';

/** Absolute paths for tesseract.js — required when Next/Turbopack would otherwise rewrite __dirname. */
export function resolveTesseractPaths() {
  const root = process.cwd();
  return {
    workerPath: path.join(root, 'node_modules/tesseract.js/src/worker-script/node/index.js'),
    corePath: path.join(root, 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js'),
    workerBlobURL: false as const,
  };
}
