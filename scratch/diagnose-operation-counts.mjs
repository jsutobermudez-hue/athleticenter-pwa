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

async function diagnoseOperationCounts() {
  await signInWithEmailAndPassword(auth, envVars.FIREBASE_SERVER_EMAIL, envVars.FIREBASE_SERVER_PASSWORD);

  const commsSnap = await getDocs(collection(db, 'commissions'));
  console.log(`Total comisiones en Firestore: ${commsSnap.size}`);

  const byType = {
    vendedor: 0,
    gerencia: 0,
    admin: 0,
    otros: 0
  };

  const bySalesperson = {};
  const ordersWithComms = new Set();

  commsSnap.docs.forEach(docSnap => {
    const d = docSnap.data();
    const type = d.commissionType || (d.recipientRole === 'SALES_MANAGER' ? 'gerencia' : (d.recipientRole === 'ADMIN' ? 'admin' : 'vendedor'));
    byType[type] = (byType[type] || 0) + 1;

    const spId = d.salespersonId || d.recipientUserId || 'DESCONOCIDO';
    if (!bySalesperson[spId]) {
      bySalesperson[spId] = { name: d.salespersonName || d.recipientName || spId, count: 0, volumeUSD: 0, commUSD: 0, type };
    }
    bySalesperson[spId].count += 1;
    bySalesperson[spId].volumeUSD += (d.invoiceAmount || d.paymentAmountUSD || 0);
    bySalesperson[spId].commUSD += (d.salespersonCommissionAmount || d.commissionAmountUSD || 0);

    if (d.orderId) ordersWithComms.add(d.orderId);
  });

  console.log('\n--- Desglose por Tipo de Comisión ---');
  console.log(byType);

  console.log('\n--- Desglose por Beneficiario Registrado ---');
  Object.keys(bySalesperson).forEach(id => {
    const sp = bySalesperson[id];
    console.log(`- ID: ${id} | Nombre: ${sp.name} | Tipo: ${sp.type} | Ops: ${sp.count} | Vol: $${sp.volumeUSD.toFixed(2)} | Comm: $${sp.commUSD.toFixed(2)}`);
  });

  console.log(`\nTotal pedidos distintos con comisiones generadas: ${ordersWithComms.size}`);
}

diagnoseOperationCounts().catch(console.error);
