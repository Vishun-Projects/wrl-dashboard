import fs from 'node:fs';

const r = JSON.parse(fs.readFileSync('eslint-report.json', 'utf8'));
const unused = [];
const any = [];
const hooks = [];
for (const f of r) {
  const rel = f.filePath.replace(/.*fast-close-app[/\\]/, '').replace(/\\/g, '/');
  for (const m of f.messages || []) {
    const row = { file: rel, line: m.line, col: m.column, msg: m.message, rule: m.ruleId };
    if (m.ruleId === '@typescript-eslint/no-unused-vars') unused.push(row);
    else if (m.ruleId === '@typescript-eslint/no-explicit-any') any.push(row);
    else if (String(m.ruleId || '').startsWith('react-hooks')) hooks.push(row);
  }
}
fs.writeFileSync('eslint-unused.json', JSON.stringify(unused, null, 2));
fs.writeFileSync('eslint-any.json', JSON.stringify(any, null, 2));
fs.writeFileSync('eslint-hooks.json', JSON.stringify(hooks, null, 2));
console.log(JSON.stringify({ unused: unused.length, any: any.length, hooks: hooks.length }));
