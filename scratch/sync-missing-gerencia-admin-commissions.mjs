import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { readFileSync } from 'fs';

const envText = readFileSync('.env.local', 'utf8');
const envVars = {};
envText.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w_]+)\s*=\s*"?([^"]*)"?\s*$/);
  if (match) {
    envVars[match[1]] = match[2];
  }
});

const firebaseConfig = {
  apiKey: envVars.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: envVars.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: envVars.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: envVars.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: envVars.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: envVars.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const auth = getAuth(app);
const db = getFirestore(app);

async function syncCommissionsCoverage() {
  await signInWithEmailAndPassword(auth, envVars.FIREBASE_SERVER_EMAIL, envVars.FIREBASE_SERVER_PASSWORD);

  console.log('=== AUDITANDO COBERURA DE GERENCIA Y ADMINISTRACIÓN EN COMISIONES ===');

  const commsSnap = await getDocs(collection(db, 'commissions'));
  console.log(`Total documentos en 'commissions': ${commsSnap.size}`);

  // Mapear por orderId / invoiceNumber
  const ordersWithVendorComm = new Map();
  const ordersWithMgrComm = new Set();
  const ordersWithAdminComm = new Set();

  commsSnap.docs.forEach(docSnap => {
    const d = docSnap.data();
    const key = d.orderId || d.invoiceNumber || d.orderNumber;
    const type = d.commissionType || (d.recipientRole === 'SALES_MANAGER' ? 'gerencia' : (d.recipientRole === 'ADMIN' ? 'admin' : 'vendedor'));

    if (type === 'vendedor' && key) {
      ordersWithVendorComm.set(key, d);
    } else if (type === 'gerencia' && key) {
      ordersWithMgrComm.add(key);
    } else if (type === 'admin' && key) {
      ordersWithAdminComm.add(key);
    }
  });

  console.log(`- Operaciones de Vendedores Directos: ${ordersWithVendorComm.size}`);
  console.log(`- Operaciones cubiertas por Gerencia (5%): ${ordersWithMgrComm.size}`);
  console.log(`- Operaciones cubiertas por Administración (1%): ${ordersWithAdminComm.size}`);

  let missingMgrCount = 0;
  let missingAdminCount = 0;

  const batch = writeBatch(db);

  for (const [key, vComm] of ordersWithVendorComm.entries()) {
    const invoiceAmt = vComm.invoiceAmount || vComm.paymentAmountUSD || 0;
    if (invoiceAmt <= 0) continue;

    const bcvRate = vComm.bcvRate || 36.5;
    const orderNum = vComm.orderNumber || vComm.invoiceNumber || key;
    const clientName = vComm.customerName || vComm.clientName || 'Cliente B2B';
    const method = vComm.paymentMethod || 'CASH';

    // Crear comisión faltante de Gerencia (5%)
    if (!ordersWithMgrComm.has(key)) {
      missingMgrCount++;
      const mgrCommUSD = Math.round((invoiceAmt * 0.05 + Number.EPSILON) * 100) / 100;
      const mgrCommBS = Math.round((mgrCommUSD * bcvRate + Number.EPSILON) * 100) / 100;

      const mgrRef = doc(collection(db, 'commissions'));
      batch.set(mgrRef, {
        id: mgrRef.id,
        orderId: vComm.orderId || key,
        orderNumber: orderNum,
        invoiceNumber: vComm.invoiceNumber || orderNum,
        paymentId: vComm.paymentId || `SYNC-${Date.now()}`,
        customerName: clientName,
        clientName: clientName,
        salespersonId: 'GERENCIA_SALES_MANAGER',
        salespersonName: '👔 Jsutobermudez (Gerente de Ventas - Override)',
        recipientUserId: 'gerencia_ventas_override',
        recipientName: '👔 Jsutobermudez (Gerente de Ventas - Override)',
        recipientRole: 'SALES_MANAGER',
        commissionType: 'gerencia',
        paymentAmountUSD: invoiceAmt,
        invoiceAmount: invoiceAmt,
        paymentAmountBS: invoiceAmt * bcvRate,
        bcvRate,
        rateApplied: 5,
        commissionPercent: 5,
        salespersonCommissionAmount: mgrCommUSD,
        commissionAmountUSD: mgrCommUSD,
        commissionAmountBS: mgrCommBS,
        commissionDate: vComm.commissionDate || serverTimestamp(),
        collectionDate: vComm.collectionDate || serverTimestamp(),
        currency: 'USD',
        paymentMethod: method,
        status: 'pendiente',
        createdAt: serverTimestamp(),
        createdBy: 'Sincronizador Sistema'
      });
    }

    // Crear comisión faltante de Administración (1%)
    if (!ordersWithAdminComm.has(key)) {
      missingAdminCount++;
      const admCommUSD = Math.round((invoiceAmt * 0.01 + Number.EPSILON) * 100) / 100;
      const admCommBS = Math.round((admCommUSD * bcvRate + Number.EPSILON) * 100) / 100;

      const admRef = doc(collection(db, 'commissions'));
      batch.set(admRef, {
        id: admRef.id,
        orderId: vComm.orderId || key,
        orderNumber: orderNum,
        invoiceNumber: vComm.invoiceNumber || orderNum,
        paymentId: vComm.paymentId || `SYNC-${Date.now()}`,
        customerName: clientName,
        clientName: clientName,
        salespersonId: 'ADMINISTRACION',
        salespersonName: '🏢 Administración / Gestión de Cobranza',
        recipientUserId: 'admin_override',
        recipientName: '🏢 Administración / Gestión de Cobranza',
        recipientRole: 'ADMIN',
        commissionType: 'admin',
        paymentAmountUSD: invoiceAmt,
        invoiceAmount: invoiceAmt,
        paymentAmountBS: invoiceAmt * bcvRate,
        bcvRate,
        rateApplied: 1,
        commissionPercent: 1,
        salespersonCommissionAmount: admCommUSD,
        commissionAmountUSD: admCommUSD,
        commissionAmountBS: admCommBS,
        commissionDate: vComm.commissionDate || serverTimestamp(),
        collectionDate: vComm.collectionDate || serverTimestamp(),
        currency: 'USD',
        paymentMethod: method,
        status: 'pendiente',
        createdAt: serverTimestamp(),
        createdBy: 'Sincronizador Sistema'
      });
    }
  }

  console.log(`\n- Faltantes de Gerencia por generar: ${missingMgrCount}`);
  console.log(`- Faltantes de Administración por generar: ${missingAdminCount}`);

  if (missingMgrCount > 0 || missingAdminCount > 0) {
    await batch.commit();
    console.log('✅ Sincronización masiva ejecutada en Firestore.');
  } else {
    console.log('El 100% de las operaciones de venta ya están cubiertas por Gerencia y Administración.');
  }
}

syncCommissionsCoverage().catch(console.error);
