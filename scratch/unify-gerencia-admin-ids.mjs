import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, collection, getDocs, writeBatch } from 'firebase/firestore';
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

async function unifyIds() {
  await signInWithEmailAndPassword(auth, envVars.FIREBASE_SERVER_EMAIL, envVars.FIREBASE_SERVER_PASSWORD);

  const commsSnap = await getDocs(collection(db, 'commissions'));
  console.log(`Unificando IDs en ${commsSnap.size} comisiones...`);

  const batch = writeBatch(db);
  let updatedCount = 0;

  commsSnap.docs.forEach(docSnap => {
    const d = docSnap.data();
    const type = d.commissionType || (d.recipientRole === 'SALES_MANAGER' ? 'gerencia' : (d.recipientRole === 'ADMIN' ? 'admin' : 'vendedor'));

    if (type === 'gerencia' && (d.salespersonId !== 'GERENCIA_SALES_MANAGER' || d.recipientUserId !== 'GERENCIA_SALES_MANAGER')) {
      batch.update(docSnap.ref, {
        salespersonId: 'GERENCIA_SALES_MANAGER',
        recipientUserId: 'GERENCIA_SALES_MANAGER',
        salespersonName: '👔 Jsutobermudez (Gerencia de Ventas - Override)',
        recipientName: '👔 Jsutobermudez (Gerente de Ventas - Override)'
      });
      updatedCount++;
    } else if (type === 'admin' && (d.salespersonId !== 'ADMINISTRACION' || d.recipientUserId !== 'ADMINISTRACION')) {
      batch.update(docSnap.ref, {
        salespersonId: 'ADMINISTRACION',
        recipientUserId: 'ADMINISTRACION',
        salespersonName: '🏢 Administración / Gestión de Cobranza',
        recipientName: '🏢 Administración / Gestión de Cobranza'
      });
      updatedCount++;
    }
  });

  if (updatedCount > 0) {
    await batch.commit();
    console.log(`✅ ${updatedCount} comisiones unificadas bajo IDs estándar.`);
  } else {
    console.log('Todos los registros ya están unificados.');
  }
}

unifyIds().catch(console.error);
