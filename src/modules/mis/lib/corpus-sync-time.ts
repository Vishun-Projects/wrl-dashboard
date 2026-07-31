export function formatCorpusLastSync(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}
