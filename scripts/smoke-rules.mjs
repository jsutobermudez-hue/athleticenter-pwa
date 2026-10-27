// Prueba de humo real contra Firestore producción con la cuenta del agente de servidor.
// Uso: node scripts/smoke-rules.mjs
import { readFileSync } from 'fs';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, query, limit, getDocs, doc, getDoc, addDoc, serverTimestamp, deleteDoc } from 'firebase/firestore';

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }));
const app = initializeApp({ apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY, authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID });
const auth = getAuth(app); const db = getFirestore(app);

const check = async (label, fn, expectOk = true) => {
  try { const r = await fn(); console.log(`${expectOk ? 'OK  ' : 'FAIL'} ${label}${r !== undefined ? ' -> ' + r : ''}`); }
  catch (e) { console.log(`${expectOk ? 'FAIL' : 'OK  '} ${label} -> ${e.code || e.message}`); }
};

await signInWithEmailAndPassword(auth, env.FIREBASE_SERVER_EMAIL, env.FIREBASE_SERVER_PASSWORD);
console.log('Agente autenticado:', auth.currentUser.uid);
await check('Leer pedidos', async () => (await getDocs(query(collection(db, 'orders'), limit(3)))).size + ' docs');
await check('Leer usuarios', async () => (await getDocs(query(collection(db, 'users'), limit(3)))).size + ' docs');
await check('Leer clientes', async () => (await getDocs(query(collection(db, 'customers'), limit(3)))).size + ' docs');
await check('Leer system/financials', async () => (await getDoc(doc(db, 'system', 'financials'))).exists());
await check('Leer comisiones', async () => (await getDocs(query(collection(db, 'commissions'), limit(3)))).size + ' docs');
await check('Leer campañas marketing', async () => (await getDocs(query(collection(db, 'marketing_campaigns'), limit(3)))).size + ' docs');
let logId;
await check('Crear auditLog', async () => { logId = (await addDoc(collection(db, 'auditLogs'), { action: 'RULES_SMOKE_TEST', at: serverTimestamp() })).id; return logId; });
await check('Borrar auditLog (debe NEGARSE)', async () => deleteDoc(doc(db, 'auditLogs', logId)), false);
await check('Colección no declarada (debe NEGARSE)', async () => (await getDocs(query(collection(db, 'zz_unknown'), limit(1)))).size, false);
process.exit(0);
