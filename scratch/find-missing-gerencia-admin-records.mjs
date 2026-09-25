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

async function findMissingRecords() {
  await signInWithEmailAndPassword(auth, envVars.FIREBASE_SERVER_EMAIL, envVars.FIREBASE_SERVER_PASSWORD);

  const commsSnap = await getDocs(collection(db, 'commissions'));
  
  const vendedorComms = [];
  const gerenciaCommsByPaymentKey = new Set();
  const adminCommsByPaymentKey = new Set();

  commsSnap.docs.forEach(docSnap => {
    const d = docSnap.data();
    const docId = docSnap.id;
    const type = d.commissionType || (d.recipientRole === 'SALES_MANAGER' ? 'gerencia' : (d.recipientRole === 'ADMIN' ? 'admin' : 'vendedor'));
    
    // Key by paymentId or orderId + amount
    const paymentKey = d.paymentId || (d.orderId ? `${d.orderId}_${d.paymentAmountUSD || d.invoiceAmount}` : docId);
    
    if (type === 'vendedor' && d.salespersonId !== 'DESCONOCIDO') {
      vendedorComms.push({ docId, data: d, paymentKey });
    } else if (type === 'gerencia') {
      gerenciaCommsByPaymentKey.add(paymentKey);
      if (d.paymentId) gerenciaCommsByPaymentKey.add(d.paymentId);
      if (d.orderId) gerenciaCommsByPaymentKey.add(d.orderId);
    } else if (type === 'admin') {
      adminCommsByPaymentKey.add(paymentKey);
      if (d.paymentId) adminCommsByPaymentKey.add(d.paymentId);
      if (d.orderId) adminCommsByPaymentKey.add(d.orderId);
    }
  });

  console.log(`\n=== AUDITORÍA DE REGISTROS FALTANTES ===`);
  console.log(`Total Vendedor Comms (Vendedores Directos): ${vendedorComms.length}`);
  
  const missingGerencia = [];
  const missingAdmin = [];

  vendedorComms.forEach(vc => {
    const d = vc.data;
    const paymentKey = vc.paymentKey;
    
    const hasGerencia = gerenciaCommsByPaymentKey.has(paymentKey) || (d.paymentId && gerenciaCommsByPaymentKey.has(d.paymentId)) || (d.orderId && gerenciaCommsByPaymentKey.has(d.orderId));
    const hasAdmin = adminCommsByPaymentKey.has(paymentKey) || (d.paymentId && adminCommsByPaymentKey.has(d.paymentId)) || (d.orderId && adminCommsByPaymentKey.has(d.orderId));

    if (!hasGerencia) {
      missingGerencia.push({
        vendedorCommDocId: vc.docId,
        orderId: d.orderId,
        paymentId: d.paymentId,
        salespersonName: d.salespersonName,
        paymentAmountUSD: d.paymentAmountUSD || d.invoiceAmount,
        createdAt: d.createdAt
      });
    }

    if (!hasAdmin) {
      missingAdmin.push({
        vendedorCommDocId: vc.docId,
        orderId: d.orderId,
        paymentId: d.paymentId,
        salespersonName: d.salespersonName,
        paymentAmountUSD: d.paymentAmountUSD || d.invoiceAmount,
        createdAt: d.createdAt
      });
    }
  });

  console.log(`\n--- FALTANTES EN GERENCIA (${missingGerencia.length}) ---`);
  missingGerencia.forEach((item, idx) => {
    console.log(`${idx + 1}. Order: ${item.orderId} | Payment: ${item.paymentId} | Vendedor: ${item.salespersonName} | Monto: $${item.paymentAmountUSD}`);
  });

  console.log(`\n--- FALTANTES EN ADMINISTRACIÓN (${missingAdmin.length}) ---`);
  missingAdmin.forEach((item, idx) => {
    console.log(`${idx + 1}. Order: ${item.orderId} | Payment: ${item.paymentId} | Vendedor: ${item.salespersonName} | Monto: $${item.paymentAmountUSD}`);
  });
}

findMissingRecords().catch(console.error);
