// Suite exhaustiva de verificación módulo por módulo asumiendo todos los roles
// Ejecuta contra la API oficial de Firebase Rules de Google Cloud
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
  gerente1: { role: 'gerencia' },
  ventas1:  { role: 'ventas' },
  ventas2:  { role: 'ventas' },
  dep1:     { role: 'deposito' },
  client1:  { role: 'cliente', associatedCustomerId: 'CUST-A' },
  client2:  { role: 'cliente', associatedCustomerId: 'CUST-B' },
};

const ORDERS = {
  'P-A-1': { customerId: 'CUST-A', salespersonId: 'ventas1', status: 'Entregado', amountPaid: 0, totalAmount: 100 },
  'P-B-1': { customerId: 'CUST-B', salespersonId: 'ventas2', status: 'Entregado', amountPaid: 0, totalAmount: 200 },
};

const QUOTES = {
  'COT-A-1': { customerId: 'CUST-A', salespersonId: 'ventas1', status: 'Enviada', totalAmount: 150 },
  'COT-B-1': { customerId: 'CUST-B', salespersonId: 'ventas2', status: 'Enviada', totalAmount: 250 },
};

const CUSTOMERS = {
  'CUST-A': { userId: 'client1', assignedSalespersonId: 'ventas1', razonSocial: 'Farma A' },
  'CUST-B': { userId: 'client2', assignedSalespersonId: 'ventas2', razonSocial: 'Farma B' },
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
  for (const [id, data] of Object.entries(QUOTES)) {
    m.push({ function: 'get', args: [{ exactValue: `${DB}/quotes/${id}` }], result: { value: { data } } });
  }
  for (const [id, data] of Object.entries(CUSTOMERS)) {
    m.push({ function: 'get', args: [{ exactValue: `${DB}/customers/${id}` }], result: { value: { data } } });
  }
  return m;
}

function auth(uid) { return uid ? { uid, token: { email: `${uid}@test.athleticenter.com` } } : null; }

// Lista exhaustiva de casos de prueba organizados por módulo y rol:
const testCases = [
  // ================= 1. MÓDULO USUARIOS =================
  ['[USUARIOS] Superadmin puede ascender a admin', 'ALLOW', 'update', 'users/ventas1', 'super1', USERS.ventas1, { role: 'admin' }],
  ['[USUARIOS] Admin NO puede crear superadmin', 'DENY', 'update', 'users/ventas1', 'admin1', USERS.ventas1, { role: 'superadmin' }],
  ['[USUARIOS] Gerencia NO puede ascender a superadmin', 'DENY', 'update', 'users/ventas1', 'gerente1', USERS.ventas1, { role: 'superadmin' }],
  ['[USUARIOS] Ventas NO puede cambiarse a admin', 'DENY', 'update', 'users/ventas1', 'ventas1', USERS.ventas1, { role: 'admin' }],
  ['[USUARIOS] Depósito NO puede editar otros usuarios', 'DENY', 'update', 'users/ventas1', 'dep1', USERS.ventas1, { role: 'ventas', name: 'Hack' }],
  ['[USUARIOS] Cliente NO puede cambiarse rol a admin ni superadmin', 'DENY', 'update', 'users/client1', 'client1', USERS.client1, { role: 'superadmin' }],
  ['[USUARIOS] Cliente puede actualizar su propio FCM push token', 'ALLOW', 'update', 'users/client1', 'client1', USERS.client1, { ...USERS.client1, fcmTokens: ['push1'] }],

  // ================= 2. MÓDULO CLIENTES / CRM =================
  ['[CLIENTES] Admin puede crear nuevo cliente', 'ALLOW', 'create', 'customers/CUST-NEW', 'admin1', null, { razonSocial: 'Nuevo B2B', rif: 'J-123' }],
  ['[CLIENTES] Gerencia puede editar cliente', 'ALLOW', 'update', 'customers/CUST-A', 'gerente1', CUSTOMERS['CUST-A'], { ...CUSTOMERS['CUST-A'], address: 'Av 1' }],
  ['[CLIENTES] Ventas puede leer clientes', 'ALLOW', 'get', 'customers/CUST-A', 'ventas1', CUSTOMERS['CUST-A']],
  ['[CLIENTES] Cliente puede leer SOLO su propia ficha', 'ALLOW', 'get', 'customers/CUST-A', 'client1', CUSTOMERS['CUST-A']],
  ['[CLIENTES] Cliente NO puede leer ficha de otro cliente', 'DENY', 'get', 'customers/CUST-B', 'client1', CUSTOMERS['CUST-B']],
  ['[CLIENTES] Cliente NO puede alterar su límite de crédito', 'DENY', 'update', 'customers/CUST-A', 'client1', CUSTOMERS['CUST-A'], { ...CUSTOMERS['CUST-A'], creditLimit: 999999 }],

  // ================= 3. MÓDULO COTIZACIONES =================
  ['[COTIZACIONES] Ventas puede crear cotización', 'ALLOW', 'create', 'quotes/COT-NEW', 'ventas1', null, { customerId: 'CUST-A', salespersonId: 'ventas1', totalAmount: 100 }],
  ['[COTIZACIONES] Cliente puede leer su propia cotización', 'ALLOW', 'get', 'quotes/COT-A-1', 'client1', QUOTES['COT-A-1']],
  ['[COTIZACIONES] Cliente NO puede leer cotización de otro cliente', 'DENY', 'get', 'quotes/COT-B-1', 'client1', QUOTES['COT-B-1']],
  ['[COTIZACIONES] Admin puede ver cualquier cotización', 'ALLOW', 'get', 'quotes/COT-B-1', 'admin1', QUOTES['COT-B-1']],

  // ================= 4. MÓDULO PEDIDOS =================
  ['[PEDIDOS] Cliente puede leer su propio pedido', 'ALLOW', 'get', 'orders/P-A-1', 'client1', ORDERS['P-A-1']],
  ['[PEDIDOS] Cliente NO puede leer pedido ajeno', 'DENY', 'get', 'orders/P-B-1', 'client1', ORDERS['P-B-1']],
  ['[PEDIDOS] Cliente puede crear pedido propio en estado Pendiente', 'ALLOW', 'create', 'orders/P-A-NEW', 'client1', null, { customerId: 'CUST-A', status: 'Pendiente', amountPaid: 0 }],
  ['[PEDIDOS] Cliente NO puede crearse un pedido en estado Pagado', 'DENY', 'create', 'orders/P-A-NEW', 'client1', null, { customerId: 'CUST-A', status: 'Pagado', amountPaid: 0 }],
  ['[PEDIDOS] Cliente NO puede crearse un pedido a nombre de otra empresa', 'DENY', 'create', 'orders/P-B-NEW', 'client1', null, { customerId: 'CUST-B', status: 'Pendiente', amountPaid: 0 }],
  ['[PEDIDOS] Cliente NO puede auto-marcarse un pedido como Pagado', 'DENY', 'update', 'orders/P-A-1', 'client1', ORDERS['P-A-1'], { ...ORDERS['P-A-1'], amountPaid: 100 }],
  ['[PEDIDOS] Cliente NO puede auto-aprobarse un pedido', 'DENY', 'update', 'orders/P-A-1', 'client1', ORDERS['P-A-1'], { ...ORDERS['P-A-1'], status: 'Aprobado' }],
  ['[PEDIDOS] Cliente puede pasar su pedido a En Verificación (al reportar abono)', 'ALLOW', 'update', 'orders/P-A-1', 'client1', ORDERS['P-A-1'], { ...ORDERS['P-A-1'], status: 'En Verificación' }],
  ['[PEDIDOS] Depósito puede leer pedidos para preparar despacho', 'ALLOW', 'get', 'orders/P-A-1', 'dep1', ORDERS['P-A-1']],
  ['[PEDIDOS] Ventas puede ver pedidos de sus clientes', 'ALLOW', 'get', 'orders/P-A-1', 'ventas1', ORDERS['P-A-1']],

  // ================= 5. MÓDULO COBRANZAS Y PAGOS =================
  ['[PAGOS] Cliente puede reportar abono pendiente en su pedido', 'ALLOW', 'create', 'orders/P-A-1/payments/PAY-1', 'client1', null, { amount: 50, status: 'pending_verification', registeredBy: 'client1' }],
  ['[PAGOS] Cliente NO puede auto-validar un pago (status: verified)', 'DENY', 'create', 'orders/P-A-1/payments/PAY-1', 'client1', null, { amount: 50, status: 'verified', registeredBy: 'client1' }],
  ['[PAGOS] Cliente NO puede registrar abonos en pedido ajeno', 'DENY', 'create', 'orders/P-B-1/payments/PAY-1', 'client1', null, { amount: 50, status: 'pending', registeredBy: 'client1' }],
  ['[PAGOS] Ventas puede registrar reporte de abono', 'ALLOW', 'create', 'orders/P-A-1/payments/PAY-1', 'ventas1', null, { amount: 50, status: 'pending', registeredBy: 'ventas1' }],
  ['[PAGOS] Ventas NO puede modificar un pago ya verificado', 'DENY', 'update', 'orders/P-A-1/payments/PAY-1', 'ventas1', { status: 'verified', amount: 50 }, { status: 'verified', amount: 100 }],
  ['[PAGOS] Admin puede conciliar y verificar pagos', 'ALLOW', 'update', 'orders/P-A-1/payments/PAY-1', 'admin1', { status: 'pending', amount: 50 }, { status: 'verified', amount: 50, verifiedBy: 'admin1' }],
  ['[PAGOS] Gerencia puede conciliar y verificar pagos', 'ALLOW', 'update', 'orders/P-A-1/payments/PAY-1', 'gerente1', { status: 'pending', amount: 50 }, { status: 'verified', amount: 50, verifiedBy: 'gerente1' }],

  // ================= 6. MÓDULO INVENTARIO Y COSTOS =================
  ['[INVENTARIO] Catálogo público es legible sin autenticación', 'ALLOW', 'get', 'products/PROD-1', null, { name: 'Balón', price: 20 }],
  ['[INVENTARIO] Cliente puede ver productos del catálogo', 'ALLOW', 'get', 'products/PROD-1', 'client1', { name: 'Balón', price: 20 }],
  ['[INVENTARIO] Cliente NO puede editar precios ni nombres de productos', 'DENY', 'update', 'products/PROD-1', 'client1', { name: 'Balón', price: 20 }, { name: 'Balón', price: 1 }],
  ['[INVENTARIO] Depósito puede actualizar stock de producto', 'ALLOW', 'update', 'products/PROD-1', 'dep1', { name: 'Balón', stock: 10 }, { name: 'Balón', stock: 15 }],
  ['[INVENTARIO] Admin puede crear nuevo producto', 'ALLOW', 'create', 'products/PROD-NEW', 'admin1', null, { name: 'Guante', price: 15 }],
  ['[INVENTARIO] Costos privados NO son legibles por Clientes', 'DENY', 'get', 'products/PROD-1/private/pricing', 'client1', { landedCost: 8 }],
  ['[INVENTARIO] Costos privados NO son legibles por Vendedores', 'DENY', 'get', 'products/PROD-1/private/pricing', 'ventas1', { landedCost: 8 }],
  ['[INVENTARIO] Costos privados SÍ son legibles por Admin', 'ALLOW', 'get', 'products/PROD-1/private/pricing', 'admin1', { landedCost: 8 }],
  ['[INVENTARIO] Costos privados SÍ son legibles por Gerencia', 'ALLOW', 'get', 'products/PROD-1/private/pricing', 'gerente1', { landedCost: 8 }],

  // ================= 7. MÓDULO COMISIONES =================
  ['[COMISIONES] Cliente NO puede leer comisiones', 'DENY', 'get', 'commissions/COMM-1', 'client1', { salespersonId: 'ventas1', amount: 10 }],
  ['[COMISIONES] Vendedor puede leer su propia comisión', 'ALLOW', 'get', 'commissions/COMM-1', 'ventas1', { salespersonId: 'ventas1', amount: 10 }],
  ['[COMISIONES] Vendedor NO puede marcarse su propia comisión como pagada', 'DENY', 'update', 'commissions/COMM-1', 'ventas1', { salespersonId: 'ventas1', status: 'pendiente' }, { salespersonId: 'ventas1', status: 'pagado' }],
  ['[COMISIONES] Admin puede liquidar comisiones a pagado', 'ALLOW', 'update', 'commissions/COMM-1', 'admin1', { salespersonId: 'ventas1', status: 'pendiente' }, { salespersonId: 'ventas1', status: 'pagado' }],

  // ================= 8. MÓDULO IMPORTACIONES / PO =================
  ['[IMPORTACIONES] Cliente NO puede leer órdenes de compra', 'DENY', 'get', 'purchaseOrders/PO-1', 'client1', { supplier: 'China', status: 'En Tránsito' }],
  ['[IMPORTACIONES] Ventas NO puede leer órdenes de compra', 'DENY', 'get', 'purchaseOrders/PO-1', 'ventas1', { supplier: 'China', status: 'En Tránsito' }],
  ['[IMPORTACIONES] Depósito puede leer órdenes de compra para recepción', 'ALLOW', 'get', 'purchaseOrders/PO-1', 'dep1', { supplier: 'China', status: 'En Tránsito' }],
  ['[IMPORTACIONES] Gerencia puede crear y gestionar órdenes de compra', 'ALLOW', 'create', 'purchaseOrders/PO-NEW', 'gerente1', null, { supplier: 'China', totalUSD: 5000 }],

  // ================= 9. MÓDULO TRANSPORTISTAS =================
  ['[DESPACHO] Cliente NO puede alterar transportistas', 'DENY', 'update', 'carriers/CARRIER-1', 'client1', { name: 'MRW' }, { name: 'Hacked' }],
  ['[DESPACHO] Depósito puede gestionar transportistas', 'ALLOW', 'update', 'carriers/CARRIER-1', 'dep1', { name: 'MRW' }, { name: 'MRW', status: 'Activo' }],
  ['[DESPACHO] Admin puede agregar transportistas', 'ALLOW', 'create', 'carriers/CARRIER-NEW', 'admin1', null, { name: 'Zoom', status: 'Activo' }],

  // ================= 10. MÓDULO TESORERÍA & PARÁMETROS =================
  ['[TESORERÍA] Cliente NO puede modificar tasa BCV ni descuentos', 'DENY', 'update', 'system/financials', 'client1', { bcvRate: 65 }, { bcvRate: 10 }],
  ['[TESORERÍA] Ventas NO puede modificar tasa BCV ni descuentos', 'DENY', 'update', 'system/financials', 'ventas1', { bcvRate: 65 }, { bcvRate: 10 }],
  ['[TESORERÍA] Depósito NO puede modificar tasa BCV', 'DENY', 'update', 'system/financials', 'dep1', { bcvRate: 65 }, { bcvRate: 10 }],
  ['[TESORERÍA] Admin puede modificar parámetros de tesorería y tasa BCV', 'ALLOW', 'update', 'system/financials', 'admin1', { bcvRate: 65 }, { bcvRate: 66 }],
  ['[TESORERÍA] Gerencia puede modificar parámetros de tesorería y tasa BCV', 'ALLOW', 'update', 'system/financials', 'gerente1', { bcvRate: 65 }, { bcvRate: 66 }],

  // ================= 11. MÓDULO AUDITORÍA =================
  ['[AUDITORÍA] Nadie, ni Superadmin, puede borrar registros de auditoría', 'DENY', 'delete', 'auditLogs/LOG-1', 'super1', { action: 'LOGIN' }],
  ['[AUDITORÍA] Ningún usuario puede sobrescribir registros de auditoría', 'DENY', 'update', 'auditLogs/LOG-1', 'super1', { action: 'LOGIN' }, { action: 'HACKED' }],
  ['[AUDITORÍA] Sistema/Staff puede agregar eventos al libro de auditoría', 'ALLOW', 'create', 'auditLogs/LOG-NEW', 'admin1', null, { action: 'PRICE_UPDATE', timestamp: '2026-10-27' }],

  // ================= 12. MÓDULO MARKETING =================
  ['[MARKETING] Cliente NO puede crear campañas de broadcast', 'DENY', 'create', 'marketing_campaigns/CAMP-1', 'client1', null, { name: 'Promo' }],
  ['[MARKETING] Ventas NO puede crear campañas masivas globales', 'DENY', 'create', 'marketing_campaigns/CAMP-1', 'ventas1', null, { name: 'Promo' }],
  ['[MARKETING] Admin SÍ puede crear y gestionar campañas', 'ALLOW', 'create', 'marketing_campaigns/CAMP-1', 'admin1', null, { name: 'Promo', status: 'draft' }],
];

async function run() {
  console.log(`Ejecutando suite exhaustiva multi-rol (${testCases.length} casos de prueba)...\n`);

  const formattedTestCases = testCases.map(([desc, expect, method, p, uid, resData, newData]) => {
    const request = { auth: auth(uid), method, path: `${DB}/${p}`, time: new Date().toISOString() };
    if (newData) request.resource = { data: newData };
    const tc = { expectation: expect, request, functionMocks: mocks() };
    if (resData) tc.resource = { data: resData };
    return tc;
  });

  const res = await fetch(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-goog-user-project': PROJECT },
    body: JSON.stringify({ 
      source: { files: [{ name: 'firestore.rules', content: source }] }, 
      testSuite: { testCases: formattedTestCases } 
    }),
  });

  const data = await res.json();
  if (data.error) {
    console.error('API ERROR:', JSON.stringify(data.error, null, 2));
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;

  data.testResults.forEach((r, i) => {
    const ok = r.state === 'SUCCESS';
    const [desc, expected] = testCases[i];
    if (ok) {
      passed++;
      console.log(`✅ OK   [${expected}] ${desc}`);
    } else {
      failed++;
      console.error(`❌ FAIL [esperado ${expected}] ${desc}`);
      console.error('   Debug:', (r.debugMessages || []).join(' | '), JSON.stringify(r.errorPosition || ''));
    }
  });

  console.log(`\n========================================`);
  console.log(`RESULTADO FINAL: ${passed}/${testCases.length} pruebas superadas.`);
  console.log(`========================================\n`);

  process.exit(failed === 0 ? 0 : 1);
}

run();
