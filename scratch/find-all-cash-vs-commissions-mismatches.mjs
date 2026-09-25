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

// Mirror getEffectiveCashReceived logic from billing.ts
function getEffectiveCashReceived(o) {
    if (!o) return 0;
    const cash = typeof o.totalCashReceived === 'number' && o.totalCashReceived > 0 ? o.totalCashReceived : 0;
    const paid = typeof o.amountPaid === 'number' && o.amountPaid > 0 ? o.amountPaid : 0;
    const altPaid = o.paidAmount || o.totalPaid || o.montoPagado || 0;
    const numAltPaid = typeof altPaid === 'number' && altPaid > 0 ? altPaid : 0;
    
    let sumPayments = 0;
    if (Array.isArray(o.payments)) {
        sumPayments = o.payments.reduce((s, p) => {
            if (p.status === 'verified' || !p.status) {
                return s + (Number(p.amount || p.monto || p.amountUSD) || 0);
            }
            return s;
        }, 0);
    }
    
    const explicitCash = Math.max(cash, paid, numAltPaid, sumPayments);
    if (explicitCash > 0) {
        return Math.min(explicitCash, o.totalAmount || explicitCash);
    }

    if (o.status === 'Pagado' || o.isPaid === true || o.paymentStatus === 'Pagado') {
        const discountPct = o.bcvDiscountSnapshot ?? o.treasurySnapshot?.bcvDiscountPercent ?? 25;
        const isNet = o.incentivesApplied === true || o.isNetPrice === true;
        const netVal = isNet ? o.totalAmount : (o.totalAmount || 0) * (1 - (discountPct / 100));
        return netVal > 0 ? netVal : o.totalAmount || 0;
    }

    return 0;
}

async function findMismatches() {
  await signInWithEmailAndPassword(auth, envVars.FIREBASE_SERVER_EMAIL, envVars.FIREBASE_SERVER_PASSWORD);

  const ordersSnap = await getDocs(collection(db, 'orders'));
  const commsSnap = await getDocs(collection(db, 'commissions'));

  // Group vendedor comms by orderId
  const commsByOrder = {};
  commsSnap.docs.forEach(docSnap => {
    const d = docSnap.data();
    const type = d.commissionType || (d.recipientRole === 'SALES_MANAGER' ? 'gerencia' : (d.recipientRole === 'ADMIN' ? 'admin' : 'vendedor'));
    if (type === 'vendedor' && d.salespersonId !== 'DESCONOCIDO') {
      const orderId = d.orderId;
      if (orderId) {
        if (!commsByOrder[orderId]) commsByOrder[orderId] = { totalBase: 0, count: 0, docs: [] };
        commsByOrder[orderId].totalBase += (d.paymentAmountUSD || d.invoiceAmount || 0);
        commsByOrder[orderId].count += 1;
        commsByOrder[orderId].docs.push(d);
      }
    }
  });

  console.log(`\n=== DISCREPANCIAS ENTRE MONTO COBRADO (ORDERS) Y MONTO COMISIONES (COMMISSIONS) ===`);

  let totalCollectedInOrders = 0;
  let totalBaseInCommissions = 0;
  const discrepancies = [];

  ordersSnap.docs.forEach(docSnap => {
    const o = docSnap.data();
    const orderId = docSnap.id;
    if (o.status === 'Cancelado' || o.status === 'Rechazado' || o.status === 'Borrador') return;

    const cashReceived = getEffectiveCashReceived(o);
    const commData = commsByOrder[orderId] || { totalBase: 0, count: 0, docs: [] };
    const commBase = commData.totalBase;

    totalCollectedInOrders += cashReceived;
    totalBaseInCommissions += commBase;

    const diff = Math.abs(cashReceived - commBase);
    if (diff > 0.05) {
      discrepancies.push({
        orderId,
        orderNumber: o.orderNumber || orderId,
        status: o.status,
        salespersonName: o.salespersonName || 'SIN_VENDEDOR',
        salespersonId: o.salespersonId || '',
        totalAmount: o.totalAmount,
        cashReceived,
        commBase,
        diff: cashReceived - commBase,
        commCount: commData.count,
        paymentsInOrder: o.payments || []
      });
    }
  });

  console.log(`Total Recaudado en Orders (Panel Principal): $${totalCollectedInOrders.toFixed(2)} USD`);
  console.log(`Total Base en Commissions (Módulo Comisiones): $${totalBaseInCommissions.toFixed(2)} USD`);
  console.log(`Diferencia Total: $${(totalCollectedInOrders - totalBaseInCommissions).toFixed(2)} USD`);

  console.log(`\n--- DETALLE DE PEDIDOS CON DISCREPANCIA (${discrepancies.length} Pedidos) ---`);
  discrepancies.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  discrepancies.forEach((d, idx) => {
    console.log(`\n${idx + 1}. Pedido: ${d.orderNumber} (${d.orderId})`);
    console.log(`   Estado: ${d.status} | Vendedor: ${d.salespersonName}`);
    console.log(`   Monto Total Pedido: $${d.totalAmount?.toFixed(2)} | Cobrado en Orders: $${d.cashReceived.toFixed(2)} | Base en Comisiones: $${d.commBase.toFixed(2)} | Dif: $${d.diff.toFixed(2)}`);
    console.log(`   Comisiones creadas count: ${d.commCount}`);
    if (d.paymentsInOrder.length > 0) {
      console.log(`   Pagos en Order array:`, d.paymentsInOrder.map(p => `[Amt: $${p.amountUSD || p.amount}, Status: ${p.status}, Method: ${p.method}]`).join(', '));
    }
  });
}

findMismatches().catch(console.error);
