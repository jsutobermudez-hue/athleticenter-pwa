import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, getDoc, query, where } from 'firebase/firestore';
import fs from 'fs';

// Read .env.local
const envConfig = fs.readFileSync('.env.local', 'utf8');
envConfig.split('\n').forEach(line => {
  const [key, ...value] = line.split('=');
  if (key && value) {
    process.env[key.trim()] = value.join('=').trim();
  }
});

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(app);

async function run() {
  console.log("Searching for order P-CONV-MUS-6608 or customer MUSIC & SPORT LA LIMPIA...");
  
  const ordersSnap = await getDocs(collection(db, 'orders'));
  let targetOrder = null;
  ordersSnap.forEach(d => {
    const data = d.data();
    if (d.id.includes('MUS-6608') || (data.customerName && data.customerName.includes('MUSIC & SPORT'))) {
      targetOrder = { id: d.id, ...data };
    }
  });

  console.log("\n--- ORDER DATA ---");
  console.log(targetOrder);

  if (targetOrder && targetOrder.customerId) {
    const custDoc = await getDoc(doc(db, 'customers', targetOrder.customerId));
    console.log("\n--- CUSTOMER DOCUMENT ---");
    if (custDoc.exists()) {
      console.log(custDoc.id, custDoc.data());
    } else {
      console.log("Customer document NOT FOUND for ID:", targetOrder.customerId);
    }
  }

  // Search in customers collection by name
  const custsSnap = await getDocs(collection(db, 'customers'));
  console.log("\n--- ALL CUSTOMERS WITH 'MUSIC' IN NAME ---");
  custsSnap.forEach(d => {
    const data = d.data();
    if (data.name && data.name.toLowerCase().includes('music')) {
      console.log(d.id, data);
    }
  });
}

run().catch(console.error);
