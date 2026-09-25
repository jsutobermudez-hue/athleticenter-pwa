import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc, collection, getDocs, writeBatch } from 'firebase/firestore';
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

async function fixAdminCommissionRate() {
  console.log('Iniciando sesión en Firebase Auth...');
  await signInWithEmailAndPassword(auth, envVars.FIREBASE_SERVER_EMAIL, envVars.FIREBASE_SERVER_PASSWORD);
  console.log('✅ Sesión iniciada.');

  // 1. Actualizar system/financials
  const finRef = doc(db, 'system', 'financials');
  const finSnap = await getDoc(finRef);
  console.log('Documento system/financials actual:', finSnap.exists() ? finSnap.data() : 'No existe');

  await setDoc(finRef, {
    adminCommission: 1
  }, { merge: true });

  console.log('✅ Documento system/financials actualizado con adminCommission: 1%');

  // 2. Recalcular comisiones de Administración al 1% en la colección 'commissions'
  const commsSnap = await getDocs(collection(db, 'commissions'));
  console.log(`Auditando ${commsSnap.size} comisiones para corregir tasa de Administración...`);

  let updatedCount = 0;
  const batch = writeBatch(db);

  commsSnap.docs.forEach(docSnap => {
    const data = docSnap.data();
    const type = data.commissionType || (data.recipientRole === 'ADMIN' ? 'admin' : '');
    const isAdminComm = type === 'admin' || data.salespersonId === 'ADMINISTRACION' || data.recipientUserId === 'admin_override';

    if (isAdminComm) {
      const invoiceAmt = data.invoiceAmount || data.paymentAmountUSD || 0;
      const bcvRate = data.bcvRate || 36.5;
      const newCommUSD = Math.round((invoiceAmt * 0.01 + Number.EPSILON) * 100) / 100;
      const newCommBS = Math.round((newCommUSD * bcvRate + Number.EPSILON) * 100) / 100;

      batch.update(docSnap.ref, {
        commissionPercent: 1,
        rateApplied: 1,
        salespersonCommissionAmount: newCommUSD,
        commissionAmountUSD: newCommUSD,
        commissionAmountBS: newCommBS
      });
      updatedCount++;
    }
  });

  if (updatedCount > 0) {
    await batch.commit();
    console.log(`✅ ${updatedCount} comisiones de Administración recalculadas al 1% en Firestore.`);
  } else {
    console.log('No se requirió actualizar comisiones de administración existentes.');
  }
}

fixAdminCommissionRate().catch(console.error);
