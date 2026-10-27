// Prueba firestore.rules contra la API oficial de Firebase Rules (sin desplegar).
// Uso: node scripts/test-firestore-rules.js
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT = 'studio-5015730771-8ece8';
const DB = '/databases/(default)/documents';
const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
const source = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');

const USERS = {
  super1:   { role: 'superadmin' },
  admin1:   { role: 'admin' },
  ventas1:  { role: 'ventas' },
  dep1:     { role: 'deposito' },
  client1:  { role: 'cliente', associatedCustomerId: 'CUST-A' },
};
const ORDERS = {
  'P-A-1': { customerId: 'CUST-A', status: 'Entregado', amountPaid: 0, totalAmount: 100 },
  'P-B-1': { customerId: 'CUST-B', status: 'Entregado', amountPaid: 0, totalAmount: 100 },
  'BORR-A-1': { customerId: 'CUST-A', status: 'Borrador', amountPaid: 0, totalAmount: 50 },
};

function mocks() {
  const m = [];
  for (const [uid, data] of Object.entries(USERS)) {
    const p = `${DB}/users/${uid}`;
    m.push({ function: 'get', args: [{ exactValue: p }], result: { value: { data } } });
    m.push({ function: 'exists', args: [{ exactValue: p }], result: { value: true } });
  }
  for (const uid of ['anon1']) {
    const p = `${DB}/users/${uid}`;
    m.push({ function: 'exists', args: [{ exactValue: p }], result: { value: false } });
    m.push({ function: 'get', args: [{ exactValue: p }], result: { undefined: {} } });
  }
  for (const [id, data] of Object.entries(ORDERS)) {
    m.push({ function: 'get', args: [{ exactValue: `${DB}/orders/${id}` }], result: { value: { data } } });
  }
  return m;
}

function auth(uid) { return uid ? { uid, token: { email: `${uid}@x.com` } } : null; }

// [descripción, esperado, método, ruta, uid, resourceData(existente), newData(request.resource)]
const T = [
  ['Cliente intenta hacerse superadmin', 'DENY', 'update', 'users/client1', 'client1', { role: 'cliente', associatedCustomerId: 'CUST-A' }, { role: 'superadmin', associatedCustomerId: 'CUST-A' }],
  ['Cliente actualiza su token push', 'ALLOW', 'update', 'users/client1', 'client1', { role: 'cliente', associatedCustomerId: 'CUST-A' }, { role: 'cliente', associatedCustomerId: 'CUST-A', fcmTokens: ['t'] }],
  ['Cliente cambia su vínculo de cliente', 'DENY', 'update', 'users/client1', 'client1', { role: 'cliente', associatedCustomerId: 'CUST-A' }, { role: 'cliente', associatedCustomerId: 'CUST-B' }],
  ['Ventas se asciende a admin', 'DENY', 'update', 'users/ventas1', 'ventas1', { role: 'ventas' }, { role: 'admin' }],
  ['Admin asciende a otro a superadmin', 'DENY', 'update', 'users/ventas1', 'admin1', { role: 'ventas' }, { role: 'superadmin' }],
  ['Admin edita a un vendedor', 'ALLOW', 'update', 'users/ventas1', 'admin1', { role: 'ventas' }, { role: 'ventas', phone: '58414' }],
  ['Superadmin asigna superadmin', 'ALLOW', 'update', 'users/ventas1', 'super1', { role: 'ventas' }, { role: 'superadmin' }],
  ['Cliente lee su propio pedido', 'ALLOW', 'get', 'orders/P-A-1', 'client1', ORDERS['P-A-1']],
  ['Cliente lee pedido ajeno', 'DENY', 'get', 'orders/P-B-1', 'client1', ORDERS['P-B-1']],
  ['Cliente se marca pagado (amountPaid)', 'DENY', 'update', 'orders/P-A-1', 'client1', ORDERS['P-A-1'], { ...ORDERS['P-A-1'], amountPaid: 100 }],
  ['Cliente aprueba su pedido', 'DENY', 'update', 'orders/P-A-1', 'client1', ORDERS['P-A-1'], { ...ORDERS['P-A-1'], status: 'Aprobado' }],
  ['Cliente pasa a En Verificación (reporta pago)', 'ALLOW', 'update', 'orders/P-A-1', 'client1', ORDERS['P-A-1'], { ...ORDERS['P-A-1'], status: 'En Verificación' }],
  ['Cliente crea pedido Pendiente propio', 'ALLOW', 'create', 'orders/P-A-2', 'client1', null, { customerId: 'CUST-A', status: 'Pendiente', amountPaid: 0 }],
  ['Cliente crea pedido ya pagado', 'DENY', 'create', 'orders/P-A-3', 'client1', null, { customerId: 'CUST-A', status: 'Pendiente', amountPaid: 100 }],
  ['Cliente crea pedido a nombre de otro', 'DENY', 'create', 'orders/P-B-2', 'client1', null, { customerId: 'CUST-B', status: 'Pendiente', amountPaid: 0 }],
  ['Cliente reporta pago pendiente', 'ALLOW', 'create', 'orders/P-A-1/payments/pay1', 'client1', null, { status: 'pending_verification', registeredBy: 'client1', amount: 50 }],
  ['Cliente registra pago ya verificado', 'DENY', 'create', 'orders/P-A-1/payments/pay2', 'client1', null, { status: 'verified', registeredBy: 'client1', amount: 50 }],
  ['Cliente reporta pago en pedido ajeno', 'DENY', 'create', 'orders/P-B-1/payments/pay3', 'client1', null, { status: 'pending_verification', registeredBy: 'client1' }],
  ['Ventas registra pago', 'ALLOW', 'create', 'orders/P-B-1/payments/pay4', 'ventas1', null, { status: 'verified', registeredBy: 'ventas1' }],
  ['Ventas modifica pago verificado', 'DENY', 'update', 'orders/P-B-1/payments/pay4', 'ventas1', { status: 'verified' }, { status: 'verified', amount: 999 }],
  ['Admin concilia pago', 'ALLOW', 'update', 'orders/P-B-1/payments/pay4', 'admin1', { status: 'pending_verification' }, { status: 'verified' }],
  ['Cliente edita producto/precio', 'DENY', 'update', 'products/prod1', 'client1', { price: 10 }, { price: 1 }],
  ['Depósito ajusta stock', 'ALLOW', 'update', 'products/prod1', 'dep1', { stockLevel: 5 }, { stockLevel: 6 }],
  ['Público (sin login) ve catálogo', 'ALLOW', 'get', 'products/prod1', null, { price: 10 }],
  ['Cliente lee costos privados', 'DENY', 'get', 'products/prod1/private/pricing', 'client1', { cost: 5 }],
  ['Ventas lee costos privados', 'DENY', 'get', 'products/prod1/private/pricing', 'ventas1', { cost: 5 }],
  ['Admin lee costos privados', 'ALLOW', 'get', 'products/prod1/private/pricing', 'admin1', { cost: 5 }],
  ['Cliente lee comisiones', 'DENY', 'get', 'commissions/c1', 'client1', { salespersonId: 'ventas1' }],
  ['Vendedor lee su comisión', 'ALLOW', 'get', 'commissions/c1', 'ventas1', { salespersonId: 'ventas1' }],
  ['Vendedor marca comisión pagada', 'DENY', 'update', 'commissions/c1', 'ventas1', { status: 'pendiente', salespersonId: 'ventas1' }, { status: 'pagado', salespersonId: 'ventas1' }],
  ['Superadmin borra log de auditoría', 'DENY', 'delete', 'auditLogs/l1', 'super1', { a: 1 }],
  ['Cliente cambia tasa BCV', 'DENY', 'update', 'system/financials', 'client1', { bcvRate: 50 }, { bcvRate: 1 }],
  ['Admin cambia tasa BCV', 'ALLOW', 'update', 'system/financials', 'admin1', { bcvRate: 50 }, { bcvRate: 51 }],
  ['Cuenta anónima lee pedidos', 'DENY', 'get', 'orders/P-A-1', 'anon1', ORDERS['P-A-1']],
  ['Colección no declarada (antes abierta)', 'DENY', 'get', 'secretStuff/x', 'admin1', { a: 1 }],
  ['Cliente lee órdenes de compra', 'DENY', 'get', 'purchaseOrders/po1', 'client1', { a: 1 }],
  ['Cliente lee ficha de su empresa', 'ALLOW', 'get', 'customers/CUST-A', 'client1', { name: 'A' }],
  ['Cliente lee ficha de otra empresa', 'DENY', 'get', 'customers/CUST-B', 'client1', { name: 'B' }],
  ['Cliente envía notificación a otro usuario', 'ALLOW', 'create', 'users/admin1/notifications/n1', 'client1', null, { title: 'x' }],
  ['Cliente lee notificaciones de otro', 'DENY', 'get', 'users/admin1/notifications/n1', 'client1', { title: 'x' }],
];

function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (Array.isArray(v)) return { listValue: { values: v.map(toValue) } };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toValue(x)])) } };
  return { stringValue: String(v) };
}

async function main() {
  const testCases = T.map(([desc, expect, method, p, uid, resData, newData]) => {
    const request = { auth: auth(uid), method, path: `${DB}/${p}`, time: new Date().toISOString() };
    if (newData) request.resource = { data: newData };
    const tc = { expectation: expect, request, functionMocks: mocks() };
    if (resData) tc.resource = { data: resData };
    return tc;
  });

  const res = await fetch(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-goog-user-project': PROJECT },
    body: JSON.stringify({ source: { files: [{ name: 'firestore.rules', content: source }] }, testSuite: { testCases } }),
  });
  const data = await res.json();
  if (data.error) { console.error('API ERROR:', JSON.stringify(data.error, null, 2)); process.exit(1); }
  if (data.issues?.length) { console.log('ISSUES:', JSON.stringify(data.issues, null, 2)); }

  let pass = 0;
  data.testResults.forEach((r, i) => {
    const ok = r.state === 'SUCCESS';
    if (ok) pass++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} [${T[i][1]}] ${T[i][0]}${ok ? '' : '  -> ' + (r.debugMessages || []).join(' | ') + ' ' + JSON.stringify(r.errorPosition || '')}`);
  });
  console.log(`\n${pass}/${T.length} pruebas superadas`);
  process.exit(pass === T.length ? 0 : 1);
}
main();
