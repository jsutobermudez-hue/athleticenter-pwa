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

async function auditPaymentsVsCommissions() {
  await signInWithEmailAndPassword(auth, envVars.FIREBASE_SERVER_EMAIL, envVars.FIREBASE_SERVER_PASSWORD);

  const commsSnap = await getDocs(collection(db, 'commissions'));
  console.log(`Total comisiones en Firestore: ${commsSnap.size}`);

  const gerenciaComms = [];
  const adminComms = [];
  const vendedorComms = [];

  commsSnap.docs.forEach(docSnap => {
    const d = docSnap.data();
    const docId = docSnap.id;
    const type = d.commissionType || (d.recipientRole === 'SALES_MANAGER' ? 'gerencia' : (d.recipientRole === 'ADMIN' ? 'admin' : 'vendedor'));
    const item = { docId, ...d, type };

    if (type === 'gerencia') gerenciaComms.push(item);
    else if (type === 'admin') adminComms.push(item);
    else vendedorComms.push(item);
  });

  console.log(`Vendedor Comms: ${vendedorComms.length}`);
  console.log(`Gerencia Comms: ${gerenciaComms.length}`);
  console.log(`Admin Comms: ${adminComms.length}`);

  // Group vendedor comms by orderId / paymentId
  const vendedorByOrder = {};
  vendedorComms.forEach(c => {
    if (c.salespersonId === 'DESCONOCIDO') return; // Skip invalid
    const key = c.orderId || c.orderNumber || 'SIN_ORDER';
    if (!vendedorByOrder[key]) vendedorByOrder[key] = [];
    vendedorByOrder[key].push(c);
  });

  const gerenciaByOrder = {};
  gerenciaComms.forEach(c => {
    const key = c.orderId || c.orderNumber || 'SIN_ORDER';
    if (!gerenciaByOrder[key]) gerenciaByOrder[key] = [];
    gerenciaByOrder[key].push(c);
  });

  const adminByOrder = {};
  adminComms.forEach(c => {
    const key = c.orderId || c.orderNumber || 'SIN_ORDER';
    if (!adminByOrder[key]) adminByOrder[key] = [];
    adminByOrder[key].push(c);
  });

  console.log('\n=== REVISIÓN DE PEDIDOS CON DISCREPANCIAS ===');
  const allOrderKeys = new Set([...Object.keys(vendedorByOrder), ...Object.keys(gerenciaByOrder), ...Object.keys(adminByOrder)]);

  allOrderKeys.forEach(orderId => {
    const vCount = (vendedorByOrder[orderId] || []).length;
    const gCount = (gerenciaByOrder[orderId] || []).length;
    const aCount = (adminByOrder[orderId] || []).length;

    if (vCount !== gCount || vCount !== aCount || gCount !== aCount) {
      console.log(`- Order: ${orderId} | Vendedores: ${vCount} | Gerencia: ${gCount} | Admin: ${aCount}`);
      vendedorByOrder[orderId]?.forEach(v => {
        console.log(`   [Vendedor] CommId: ${v.docId}, PaymentId: ${v.paymentId}, Vendedor: ${v.salespersonName}, Monto: $${v.paymentAmountUSD || v.invoiceAmount}`);
      });
      gerenciaByOrder[orderId]?.forEach(g => {
        console.log(`   [Gerencia] CommId: ${g.docId}, PaymentId: ${g.paymentId}, Monto: $${g.paymentAmountUSD || g.invoiceAmount}`);
      });
      adminByOrder[orderId]?.forEach(a => {
        console.log(`   [Admin] CommId: ${a.docId}, PaymentId: ${a.paymentId}, Monto: $${a.paymentAmountUSD || a.invoiceAmount}`);
      });
    }
  });
}

auditPaymentsVsCommissions().catch(console.error);
