import fs from 'fs';
import path from 'path';

function findSlate400() {
  const root = '/home/admin/VibeCoding/JaziraERP/src';
  const results: Array<{ file: string; line: number; content: string }> = [];

  function walk(dir: string) {
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) {
        walk(full);
      } else if (f.endsWith('.tsx') || f.endsWith('.ts')) {
        if (f.endsWith('.test.tsx') || f.endsWith('.test.ts')) continue;
        const lines = fs.readFileSync(full, 'utf-8').split('\n');
        lines.forEach((l, idx) => {
          if (l.includes('text-slate-400')) {
            const rel = path.relative('/home/admin/VibeCoding/JaziraERP', full);
            results.push({ file: rel, line: idx + 1, content: l });
          }
        });
      }
    }
  }

  walk(root);
  return results;
}

const items = findSlate400();
console.log(`Total non-test occurrences: ${items.length}`);

// Categorize
const categorized = items.map(item => {
  const c = item.content;
  let category = 'MEANINGFUL TEXT';

  // 1. Icon / button wrapper for icon
  if (
    c.includes('<Search') ||
    c.includes('<Calendar') ||
    c.includes('<Clock') ||
    c.includes('<Truck') ||
    c.includes('<Chevron') ||
    c.includes('<X ') ||
    c.includes('<Trash2') ||
    (c.includes('hover:text-slate-600') && c.includes('rounded')) ||
    (c.includes('hover:text-rose-600') && c.includes('rounded')) ||
    (c.includes('hover:text-white') && c.includes('rounded') && c.includes('p-'))
  ) {
    category = 'icon';
  } else if (c.includes('placeholder:text-slate-400')) {
    category = 'placeholder';
  } else if (c.includes('disabled:')) {
    category = 'disabled';
  } else if (
    item.file.includes('Header.tsx') ||
    c.includes('hover:text-white font-bold') ||
    c.includes('bg-slate-800 text-slate-400') ||
    (item.file.includes('MobileRegister.tsx') && item.line >= 1760) // Bottom nav in mobile register
  ) {
    category = 'dark background (preserved)';
  }

  return { ...item, category };
});

const counts: Record<string, number> = {};
categorized.forEach(c => {
  counts[c.category] = (counts[c.category] || 0) + 1;
});

console.log('Counts by category:', counts);

fs.writeFileSync(
  '/home/admin/VibeCoding/JaziraERP/scratch/slate400_analysis.json',
  JSON.stringify(categorized, null, 2)
);
