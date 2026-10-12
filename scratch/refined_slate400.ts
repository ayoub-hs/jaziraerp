import fs from 'fs';
import path from 'path';

interface Item {
  file: string;
  line: number;
  content: string;
  category: 'icon' | 'placeholder' | 'disabled' | 'dark background (preserved)' | 'MEANINGFUL TEXT';
}

function analyzeAll() {
  const root = '/home/admin/VibeCoding/JaziraERP/src';
  const items: Item[] = [];

  function walk(dir: string) {
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) {
        walk(full);
      } else if ((f.endsWith('.tsx') || f.endsWith('.ts')) && !f.endsWith('.test.tsx') && !f.endsWith('.test.ts')) {
        const lines = fs.readFileSync(full, 'utf-8').split('\n');
        lines.forEach((l, idx) => {
          if (l.includes('text-slate-400')) {
            const rel = path.relative('/home/admin/VibeCoding/JaziraERP', full);
            const lineNum = idx + 1;
            const trimmed = l.trim();

            let category: Item['category'] = 'MEANINGFUL TEXT';

            // Check if icon
            if (
              trimmed.startsWith('<Search') ||
              trimmed.startsWith('<Calendar') ||
              trimmed.startsWith('<Clock') ||
              trimmed.startsWith('<Truck') ||
              trimmed.startsWith('<Chevron') ||
              trimmed.startsWith('<X') ||
              trimmed.startsWith('<Trash2') ||
              trimmed.startsWith('<FileText') ||
              trimmed.startsWith('<Building2') ||
              trimmed.startsWith('<Filter') ||
              trimmed.startsWith('<RefreshCw') ||
              trimmed.startsWith('<BarcodeIcon') ||
              (trimmed.includes('hover:text-slate-600') && trimmed.includes('rounded')) ||
              (trimmed.includes('hover:text-rose-600') && trimmed.includes('rounded')) ||
              (trimmed.includes('hover:text-purple-600') && trimmed.includes('rounded')) ||
              (trimmed.includes('hover:text-white') && trimmed.includes('rounded') && trimmed.includes('p-'))
            ) {
              category = 'icon';
            } else if (trimmed.includes('placeholder:text-slate-400') || trimmed.includes('placeholder="')) {
              category = 'placeholder';
            } else if (
              trimmed.includes('disabled') ||
              trimmed.includes('cursor-not-allowed') ||
              (rel.includes('CreateCustomerModal.tsx') && (lineNum === 213 || lineNum === 218))
            ) {
              category = 'disabled';
            } else if (
              rel.includes('LockScreenModal.tsx') ||
              rel.includes('Header.tsx') ||
              (rel.includes('MobileRegister.tsx') && (lineNum >= 1760 || lineNum === 861 || lineNum === 1228 || lineNum === 1237)) ||
              (rel.includes('CustomerStatementModal.tsx') && (lineNum === 303 || lineNum === 311)) ||
              (rel.includes('RefundModal.tsx') && lineNum === 235)
            ) {
              category = 'dark background (preserved)';
            }

            items.push({
              file: rel,
              line: lineNum,
              content: trimmed,
              category
            });
          }
        });
      }
    }
  }

  walk(root);
  return items;
}

const all = analyzeAll();
const summary: Record<string, number> = {};
all.forEach(i => {
  summary[i.category] = (summary[i.category] || 0) + 1;
});

console.log('Total items:', all.length);
console.log('Category breakdown:', summary);

const meaningful = all.filter(i => i.category === 'MEANINGFUL TEXT');
console.log(`\nMEANINGFUL TEXT COUNT: ${meaningful.length}`);

fs.writeFileSync(
  '/home/admin/VibeCoding/JaziraERP/scratch/meaningful_slate400.json',
  JSON.stringify(meaningful, null, 2)
);
