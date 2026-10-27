const fs = require('fs');
const path = require('path');

const pages = [
  'src/app/dashboard/page.tsx',
  'src/app/dashboard/ai-analyst/page.tsx',
  'src/app/dashboard/audit/page.tsx',
  'src/app/dashboard/billing/page.tsx',
  'src/app/dashboard/break-even/page.tsx',
  'src/app/dashboard/carriers/page.tsx',
  'src/app/dashboard/clients/page.tsx',
  'src/app/dashboard/commissions/page.tsx',
  'src/app/dashboard/dispatch/page.tsx',
  'src/app/dashboard/intelligence/page.tsx',
  'src/app/dashboard/inventory/page.tsx',
  'src/app/dashboard/inventory/pricing-calculator/page.tsx',
  'src/app/dashboard/marketing/page.tsx',
  'src/app/dashboard/notifications/page.tsx',
  'src/app/dashboard/offers/page.tsx',
  'src/app/dashboard/orders/page.tsx',
  'src/app/dashboard/orders/new/page.tsx',
  'src/app/dashboard/orders/edit/page.tsx',
  'src/app/dashboard/pricing-intelligence/page.tsx',
  'src/app/dashboard/profile/page.tsx',
  'src/app/dashboard/purchase-orders/page.tsx',
  'src/app/dashboard/quotes/page.tsx',
  'src/app/dashboard/quotes/new/page.tsx',
  'src/app/dashboard/reports/page.tsx',
  'src/app/dashboard/reports/receivables-pdf/page.tsx',
  'src/app/dashboard/salespeople/page.tsx',
  'src/app/dashboard/settings/page.tsx',
  'src/app/dashboard/suppliers/page.tsx',
  'src/app/dashboard/treasury/page.tsx',
  'src/app/dashboard/users/page.tsx'
];

console.log('Auditing 30 Dashboard Pages for Role Guards & Query Scoping...\n');

const results = [];

for (const p of pages) {
  if (!fs.existsSync(p)) {
    console.warn(`File not found: ${p}`);
    continue;
  }
  const code = fs.readFileSync(p, 'utf8');
  
  const hasUserHook = code.includes('useUser');
  const checksRole = code.includes('.role') || code.includes('userRole') || code.includes('isAdmin') || code.includes('isClient');
  const hasRouter = code.includes('useRouter');
  const redirects = code.includes('router.push') || code.includes('redirect');
  const hasQueries = code.includes('useCollection') || code.includes('collection(') || code.includes('getDocs');
  
  // Look for role definitions in the file
  const matchedRoles = [];
  ['superadmin', 'gerencia', 'admin', 'ventas', 'deposito', 'cliente'].forEach(r => {
    if (code.includes(`'${r}'`) || code.includes(`"${r}"`)) matchedRoles.push(r);
  });

  results.push({
    page: p.replace('src/app/dashboard/', ''),
    checksRole,
    hasQueries,
    redirects,
    matchedRoles
  });
}

console.table(results);
