const fs = require('fs');
const glob = require('path');

const filesToInspect = [
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
  'src/app/dashboard/users/page.tsx',
  // Key Content Subcomponents
  'src/app/dashboard/clients/ClientsPageContent.tsx',
  'src/app/dashboard/billing/BillingClientPage.tsx',
  'src/app/dashboard/orders/OrdersPageContent.tsx',
  'src/app/dashboard/quotes/QuotesPageContent.tsx'
];

console.log('Inspecting Query Guards in Pages and Major Components...\n');

const issues = [];

filesToInspect.forEach(filePath => {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');

  // Find all collection(...) or query(collection(...)
  const matches = [...content.matchAll(/query\s*\(\s*collection\s*\(\s*firestore\s*,\s*['"]([a-zA-Z0-9_-]+)['"]\)/g)];
  matches.forEach(m => {
    const coll = m[1];
    // Check surrounding context (5 lines before)
    const idx = m.index;
    const contextBefore = content.slice(Math.max(0, idx - 200), idx);
    const isGuarded = contextBefore.includes('canManage') || 
                      contextBefore.includes('canAccess') || 
                      contextBefore.includes('isAdmin') || 
                      contextBefore.includes('role') || 
                      contextBefore.includes('isManager') ||
                      contextBefore.includes('isStaff') ||
                      contextBefore.includes('isAllowed');

    issues.push({
      file: filePath.replace('src/app/dashboard/', ''),
      collection: coll,
      guardedInUseMemo: isGuarded
    });
  });
});

console.table(issues);
