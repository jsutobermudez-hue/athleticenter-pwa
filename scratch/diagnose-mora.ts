import { getApps, initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';

const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let app;
if (!getApps().length) {
    app = initializeApp(firebaseConfig);
} else {
    app = getApps()[0];
}
const auth = getAuth(app);
const db = getFirestore(app);

import { calculateGlobalFinancialMetrics, calculateMetricsBySalesperson, isOrderInMoraCritica, getInvoiceFromOrder } from '../src/lib/billing';

async function run() {
    console.log("Signing in...");
    await signInWithEmailAndPassword(auth, process.env.FIREBASE_SERVER_EMAIL, process.env.FIREBASE_SERVER_PASSWORD);

    console.log("Fetching orders from Firebase...");
    const snap = await getDocs(collection(db, 'orders'));
    const orders = snap.docs.map(d => ({id: d.id, ...d.data()}));
    
    console.log('Total orders:', orders.length);

    console.log("\n--- CALCULATE METRICS BY SALESPERSON ---");
    const sellerMetrics = calculateMetricsBySalesperson(orders);
    console.table(sellerMetrics.map(s => ({
        Seller: s.name,
        Sales: s.sales,
        Amount: s.amount,
        MoraCritica: s.moraCritica
    })));

    console.log("\n--- DEEP DIAGNOSIS OF MORA CRITICA ---");
    let moraCount = 0;
    let moraSellers = {};
    for (const o of orders) {
        const isMora = isOrderInMoraCritica(o);
        if (isMora) {
            moraCount++;
            const seller = o.salespersonName || 'Unknown';
            const inv = getInvoiceFromOrder(o);
            const amt = inv ? inv.remainingBalance : 0;
            moraSellers[seller] = (moraSellers[seller] || 0) + amt;
            
            console.log(`[MORA] Order: ${o.id} | Seller: ${seller} | Date: ${o.createdAt?.toDate ? o.createdAt.toDate().toISOString() : o.createdAt} | Days: ${inv?.remainingCreditDays} | Balance: ${amt}`);
        }
    }
    console.log('\nTotal Mora Orders:', moraCount);
    console.log('Mora amounts per seller (Manual calculation):', moraSellers);
    
    process.exit(0);
}
run().catch(console.error);
