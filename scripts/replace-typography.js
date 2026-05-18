const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'src');
const exts = ['.tsx', '.ts', '.jsx', '.js'];

function walk(dir) {
  const files = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      files.push(...walk(full));
    } else if (exts.includes(path.extname(full))) {
      files.push(full);
    }
  }
  return files;
}

function transformClassString(str) {
  // split on whitespace preserving other tokens
  const tokens = str.split(/\s+/).filter(Boolean);
  let hasStrong = false;
  let hasSmall = false;
  const keep = [];
  for (let t of tokens) {
    if (/^font-(black|extrabold|bold|semibold|heavy)$/.test(t)) {
      hasStrong = true;
      continue;
    }
    if (/^(uppercase|tracking-widest|tracking-wide|tracking-wider|tracking-tight|tracking-tighter)$/.test(t)) {
      continue; // remove
    }
    if (/^(text-\[?1[0-3]px\]?|text-xs|text-sm|text-[10px]|text-[11px])$/.test(t)) {
      hasSmall = true;
    }
    keep.push(t);
  }

  // remove duplicates
  const dedup = Array.from(new Set(keep));

  if (hasSmall && hasStrong) {
    // prefer label utility
    dedup.push('ui-label');
  } else if (hasStrong) {
    dedup.push('ui-strong');
  }

  return dedup.join(' ').trim();
}

function processFile(file) {
  let content = fs.readFileSync(file, 'utf8');
  // handle className="..." and className={`...`} and className={'...'}
  const regexes = [
    /className=\"([^\"]+)\"/g,
    /className=\{\`([^`]+)\`\}/g,
    /className=\{\'([^']+)\'\}/g,
  ];

  let changed = false;
  for (const re of regexes) {
    content = content.replace(re, (m, g1) => {
      const before = g1;
      const after = transformClassString(before);
      if (after !== before) {
        changed = true;
        return m.replace(before, after);
      }
      return m;
    });
  }

  if (changed) {
    fs.writeFileSync(file, content, 'utf8');
    return true;
  }
  return false;
}

const files = walk(root).filter(f => (f.includes(path.join('src','app')) || f.includes(path.join('src','components'))));
let count = 0;
const modified = [];
for (const f of files) {
  try {
    if (processFile(f)) {
      modified.push(f);
      count++;
    }
  } catch (err) {
    console.error('ERROR', f, err.message);
  }
}

console.log('Processed files:', files.length);
console.log('Modified files:', count);
if (modified.length) console.log(modified.join('\n'));
