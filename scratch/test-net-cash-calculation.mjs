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

function roundCurrency(value) {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

// Improved getEffectiveCashReceived
function getEffectiveCashReceived(o) {
    if (!o) return 0;
    
    let sumPayments = 0;
    if (Array.isArray(o.payments) && o.payments.length > 0) {
        sumPayments = o.payments.reduce((s, p) => {
            if (p.status === 'verified' || !p.status) {
                return s + (Number(p.amount || p.monto || p.amountUSD) || 0);
            }
            return s;
        }, 0);
    }
    
    if (sumPayments > 0) {
        return roundCurrency(sumPayments);
    }

    const discountPct = o.bcvDiscountSnapshot ?? o.treasurySnapshot?.bcvDiscountPercent ?? 25;
    const isNet = o.incentivesApplied === true || o.isNetPrice === true;

    if (o.status === 'Pagado' || o.isPaid === true || o.paymentStatus === 'Pagado') {
        const netVal = isNet ? o.totalAmount : (o.totalAmount || 0) * (1 - (discountPct / 100));
        return roundCurrency(netVal > 0 ? netVal : o.totalAmount || 0);
    }

    const cash = typeof o.totalCashReceived === 'number' && o.totalCashReceived > 0 ? o.totalCashReceived : 0;
    const paid = typeof o.amountPaid === 'number' && o.amountPaid > 0 ? o.amountPaid : 0;
    const altPaid = o.paidAmount || o.totalPaid || o.montoPagado || 0;
    const numAltPaid = typeof altPaid === 'number' && altPaid > 0 ? altPaid : 0;

    const explicitCash = Math.max(cash, paid, numAltPaid);
    if (explicitCash > 0) {
        if (explicitCash >= (o.totalAmount || 0) && (o.totalAmount || 0) > 0) {
            const netVal = isNet ? o.totalAmount : (o.totalAmount || 0) * (1 - (discountPct / 100));
            return roundCurrency(netVal);
        }
        return roundCurrency(explicitCash);
    }

    return 0;
}

async function testNetCash() {
  await signInWithEmailAndPassword(auth, envVars.FIREBASE_SERVER_EMAIL, envVars.FIREBASE_SERVER_PASSWORD);

  const ordersSnap = await getDocs(collection(db, 'orders'));
  const commsSnap = await getDocs(collection(db, 'commissions'));

  let totalCollectedInOrders = 0;
  ordersSnap.docs.forEach(docSnap => {
    const o = docSnap.data();
    if (o.status === 'Cancelado' || o.status === 'Rechazado' || o.status === 'Borrador') return;
    totalCollectedInOrders += getEffectiveCashReceived(o);
  });

  let totalBaseInCommissions = 0;
  commsSnap.docs.forEach(docSnap => {
    const d = docSnap.data();
    const type = d.commissionType || (d.recipientRole === 'SALES_MANAGER' ? 'gerencia' : (d.recipientRole === 'ADMIN' ? 'admin' : 'vendedor'));
    if (type === 'vendedor' && d.salespersonId !== 'DESCONOCIDO') {
      totalBaseInCommissions += (d.paymentAmountUSD || d.invoiceAmount || 0);
    }
  });

  console.log(`\n=== PROBANDO CÁLCULO DE NETO CASH ===`);
  console.log(`Total Recaudado Ajustado en Orders (Panel Principal): $${totalCollectedInOrders.toFixed(2)} USD`);
  console.log(`Total Base en Comisiones (Módulo Comisiones): $${totalBaseInCommissions.toFixed(2)} USD`);
  console.log(`Diferencia: $${(totalCollectedInOrders - totalBaseInCommissions).toFixed(2)} USD`);
}

testNetCash().catch(console.error);
