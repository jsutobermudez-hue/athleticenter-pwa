import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
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

async function runCommissionsDiagnostic() {
  console.log('Iniciando sesión en Firebase Auth...');
  await signInWithEmailAndPassword(auth, envVars.FIREBASE_SERVER_EMAIL, envVars.FIREBASE_SERVER_PASSWORD);
  console.log('✅ Sesión iniciada exitosamente como:', auth.currentUser.email);

  console.log('\n====================================================');
  console.log('    AUDITORÍA COMPLETA DEL MÓDULO DE COMISIONES    ');
  console.log('====================================================\n');

  // 1. Auditar Colección 'commissions'
  const commsSnap = await getDocs(collection(db, 'commissions'));
  console.log(`[1] Total de documentos en la colección 'commissions': ${commsSnap.size}`);

  let schemaACount = 0; // Utiliza salespersonCommissionAmount, invoiceAmount, 'pendiente'
  let schemaBCount = 0; // Utiliza commissionAmountUSD, paymentAmountUSD, 'PENDING'
  let pendingCount = 0;
  let paidCount = 0;
  let totalPendingUSD = 0;
  let totalPaidUSD = 0;

  const sampleDocs = [];

  commsSnap.docs.forEach(docSnap => {
    const d = docSnap.data();
    sampleDocs.push({ id: docSnap.id, ...d });

    const isSchemaB = d.commissionAmountUSD !== undefined || d.paymentAmountUSD !== undefined || d.status === 'PENDING' || d.status === 'PAID';
    if (isSchemaB) {
      schemaBCount++;
    } else {
      schemaACount++;
    }

    const amt = d.salespersonCommissionAmount || d.commissionAmountUSD || 0;
    const st = String(d.status || '').toLowerCase();

    if (st === 'pagado' || st === 'paid') {
      paidCount++;
      totalPaidUSD += amt;
    } else {
      pendingCount++;
      totalPendingUSD += amt;
    }
  });

  console.log(`\n--- Desglose de Esquemas en Firestore ---`);
  console.log(`- Esquema A (Frontend / page.tsx: 'salespersonCommissionAmount', 'pendiente'): ${schemaACount}`);
  console.log(`- Esquema B (Backend / billing.ts: 'commissionAmountUSD', 'PENDING'): ${schemaBCount}`);
  console.log(`\n--- Estado Financiero Real de Comisiones ---`);
  console.log(`- Pendientes de Cobro: ${pendingCount} operaciones ($${totalPendingUSD.toFixed(2)} USD)`);
  console.log(`- Liquidadas/Pagadas: ${paidCount} operaciones ($${totalPaidUSD.toFixed(2)} USD)`);

  if (sampleDocs.length > 0) {
    console.log(`\n--- Muestras de Documentos Registrados ---`);
    sampleDocs.slice(0, 5).forEach((d, idx) => {
      console.log(`\nMuestra #${idx + 1} (ID: ${d.id}):`);
      console.log(`  - Order/Invoice: ${d.orderNumber || d.invoiceNumber || d.orderId}`);
      console.log(`  - Recipient: ${d.salespersonName || d.recipientName || d.salespersonId || d.recipientUserId}`);
      console.log(`  - Role/Type: ${d.recipientRole || d.commissionType || 'N/A'}`);
      console.log(`  - Status (Raw): "${d.status}"`);
      console.log(`  - Schema A Amount (salespersonCommissionAmount): ${d.salespersonCommissionAmount}`);
      console.log(`  - Schema B Amount (commissionAmountUSD): ${d.commissionAmountUSD}`);
      console.log(`  - Base Amount: ${d.invoiceAmount || d.paymentAmountUSD}`);
    });
  }

  // 2. Simular lectura desde page.tsx para evaluar Incompatibilidad
  console.log(`\n====================================================`);
  console.log('   SIMULACIÓN DE LECTURA EN FRONTEND (commissions/page.tsx)');
  console.log('====================================================\n');

  let visibleInPageCount = 0;
  let invisibleInPageCount = 0;

  sampleDocs.forEach(c => {
    const isSchemaACompliant = c.salespersonCommissionAmount !== undefined && (c.status === 'pendiente' || c.status === 'pagado');
    if (isSchemaACompliant) {
      visibleInPageCount++;
    } else {
      invisibleInPageCount++;
    }
  });

  console.log(`- Comisiones correctamente leídas por el Frontend actual: ${visibleInPageCount}`);
  console.log(`- Comisiones INVISIBLES O EN $0 por Incompatibilidad de Esquema (Schema Mismatch): ${invisibleInPageCount}`);

  // 3. Auditar Pedidos y Pagos
  const ordersSnap = await getDocs(collection(db, 'orders'));
  console.log(`\n====================================================`);
  console.log(`   AUDITORÍA DE ORIGEN: ${ordersSnap.size} PEDIDOS EN FIRESTORE`);
  console.log('====================================================\n');

  let totalOrdersWithPayments = 0;
  let totalPaymentsAmountUSD = 0;

  ordersSnap.docs.forEach(docSnap => {
    const o = docSnap.data();
    if ((o.amountPaid || 0) > 0) {
      totalOrdersWithPayments++;
      totalPaymentsAmountUSD += (o.amountPaid || 0);
    }
  });

  console.log(`- Pedidos con Recaudo Efectivo Registrado: ${totalOrdersWithPayments}`);
  console.log(`- Monto Total Recaudado en Pedidos: $${totalPaymentsAmountUSD.toFixed(2)} USD`);
  console.log(`- Comisiones Teóricas Estimadas (5% Vendedor + 5% Gerencia + 1% Admin): $${(totalPaymentsAmountUSD * 0.11).toFixed(2)} USD`);

  console.log('\n====================================================');
  console.log('              DIAGNÓSTICO COMPLETADO                ');
  console.log('====================================================');
}

runCommissionsDiagnostic().catch(console.error);
