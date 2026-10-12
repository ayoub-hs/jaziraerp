import fs from 'fs';
import path from 'path';

interface ChangeReport {
  file: string;
  line: number;
  oldContent: string;
  newContent: string;
  category: 'icon' | 'placeholder' | 'disabled' | 'dark background (preserved)' | 'MEANINGFUL TEXT';
  action: 'CHANGED' | 'PRESERVED';
}

function processFiles(dryRun = true): ChangeReport[] {
  const root = '/home/admin/VibeCoding/JaziraERP/src';
  const reports: ChangeReport[] = [];

  function walk(dir: string) {
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) {
        walk(full);
      } else if ((f.endsWith('.tsx') || f.endsWith('.ts')) && !f.endsWith('.test.tsx') && !f.endsWith('.test.ts')) {
        const content = fs.readFileSync(full, 'utf-8');
        const lines = content.split('\n');
        let modified = false;

        const newLines = lines.map((l, idx) => {
          if (!l.includes('text-slate-400')) return l;

          const rel = path.relative('/home/admin/VibeCoding/JaziraERP', full);
          const lineNum = idx + 1;
          const trimmed = l.trim();

          // 1. Placeholder
          if (trimmed.includes('placeholder:text-slate-400') || trimmed.includes('placeholder="')) {
            reports.push({ file: rel, line: lineNum, oldContent: trimmed, newContent: trimmed, category: 'placeholder', action: 'PRESERVED' });
            return l;
          }

          // 2. Disabled
          if (
            trimmed.includes('disabled') ||
            trimmed.includes('cursor-not-allowed') ||
            (rel.includes('CreateCustomerModal.tsx') && (lineNum === 213 || lineNum === 218))
          ) {
            reports.push({ file: rel, line: lineNum, oldContent: trimmed, newContent: trimmed, category: 'disabled', action: 'PRESERVED' });
            return l;
          }

          // 3. Dark background (preserved for contrast >= 4.5:1 against dark bg)
          if (
            rel.includes('LockScreenModal.tsx') ||
            rel.includes('Header.tsx') ||
            (rel.includes('MobileRegister.tsx') && (lineNum >= 1760 || lineNum === 861 || lineNum === 1228 || lineNum === 1237)) ||
            (rel.includes('CustomerStatementModal.tsx') && (lineNum === 303 || lineNum === 311)) ||
            (rel.includes('RefundModal.tsx') && lineNum === 235)
          ) {
            reports.push({ file: rel, line: lineNum, oldContent: trimmed, newContent: trimmed, category: 'dark background (preserved)', action: 'PRESERVED' });
            return l;
          }

          // 4. Icon
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
            reports.push({ file: rel, line: lineNum, oldContent: trimmed, newContent: trimmed, category: 'icon', action: 'PRESERVED' });
            return l;
          }

          // 5. MEANINGFUL TEXT -> Change to text-slate-600
          const updatedLine = l.replace(/text-slate-400/g, 'text-slate-600');
          reports.push({
            file: rel,
            line: lineNum,
            oldContent: trimmed,
            newContent: updatedLine.trim(),
            category: 'MEANINGFUL TEXT',
            action: 'CHANGED'
          });
          modified = true;
          return updatedLine;
        });

        if (!dryRun && modified) {
          fs.writeFileSync(full, newLines.join('\n'), 'utf-8');
        }
      }
    }
  }

  walk(root);
  return reports;
}

const dryRunResults = processFiles(false);
const changed = dryRunResults.filter(r => r.action === 'CHANGED');
const preserved = dryRunResults.filter(r => r.action === 'PRESERVED');

console.log(`TOTAL DETECTED: ${dryRunResults.length}`);
console.log(`CHANGED (MEANINGFUL TEXT): ${changed.length}`);
console.log(`PRESERVED: ${preserved.length}`);

const preservedByCategory: Record<string, number> = {};
preserved.forEach(p => {
  preservedByCategory[p.category] = (preservedByCategory[p.category] || 0) + 1;
});
console.log('Preserved by category:', preservedByCategory);

fs.writeFileSync(
  '/home/admin/VibeCoding/JaziraERP/scratch/slate400_dryrun.json',
  JSON.stringify(dryRunResults, null, 2)
);
