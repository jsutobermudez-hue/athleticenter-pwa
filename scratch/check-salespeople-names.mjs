import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

const firebaseConfig = {
  "projectId": "studio-5015730771-8ece8",
  "appId": "1:936770722730:web:4e76317700daf8277469d3",
  "apiKey": "AIzaSyCDU9nT0IpdnDu4x5wfinaxZitmwGlzcuM",
  "authDomain": "studio-5015730771-8ece8.firebaseapp.com",
  "measurementId": "G-CJ7E3L7ZXP",
  "messagingSenderId": "936770722730",
  "storageBucket": "studio-5015730771-8ece8.firebasestorage.app"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

await signInWithEmailAndPassword(auth, "server-agent1@athleticenter.com", "123456");

const ordersSnap = await getDocs(collection(db, 'orders'));
const orders = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

console.log("=== AUDIT DE VENDEDORES EN ÓRDENES ===");
const spSummary = {};

orders.forEach(o => {
  const rawId = o.salespersonId || o.vendedorId || 'SIN_ID';
  const rawName = o.salespersonName || o.vendedor || 'SIN_NOMBRE';
  
  const key = `ID: [${rawId}] | NAME: [${rawName}]`;
  if (!spSummary[key]) {
    spSummary[key] = { count: 0, totalAmount: 0, statuses: {} };
  }
  spSummary[key].count++;
  spSummary[key].totalAmount += (o.totalAmount || 0);
  spSummary[key].statuses[o.status] = (spSummary[key].statuses[o.status] || 0) + 1;
});

console.log(JSON.stringify(spSummary, null, 2));

process.exit(0);
