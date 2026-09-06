import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs, query, limit, orderBy } from 'firebase/firestore';

const firebaseConfig = {
  "projectId": "studio-5015730771-8ece8",
  "appId": "1:936770722730:web:4e76317700daf8277469d3",
  "apiKey": "AIzaSyCDU9nT0IpdnDu4x5wfinaxZitmwGlzcuM",
  "authDomain": "studio-5015730771-8ece8.firebaseapp.com",
  "measurementId": "G-CJ7E3L7ZXP",
  "messagingSenderId": "936770722730",
  "storageBucket": "studio-5015730771-8ece8.firebasestorage.app"
};

const email = "server-agent1@athleticenter.com";
const password = "123456";

console.log("Connecting to Firebase...");
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

try {
    await signInWithEmailAndPassword(auth, email, password);
    console.log("Authenticated successfully.");

    console.log("Fetching recent orders...");
    const ordersSnap = await getDocs(collection(db, 'orders'));
    console.log(`Total orders fetched: ${ordersSnap.size}`);

    const orders = [];
    ordersSnap.forEach(d => {
        orders.push({ id: d.id, ...d.data() });
    });

    // 1. Estadísticas generales
    const statuses = {};
    orders.forEach(o => {
        statuses[o.status] = (statuses[o.status] || 0) + 1;
    });
    console.log("\n--- ORDERS BY STATUS ---");
    console.log(statuses);

    // 2. Analizar últimos 10 pedidos pagados
    const paidOrders = orders.filter(o => o.status === 'Pagado');
    console.log(`\nPaid orders count: ${paidOrders.length}`);

    console.log("\n--- RECENT 10 PAID ORDERS DETAILS ---");
    paidOrders.slice(0, 10).forEach((o, index) => {
        const orderDateStr = o.orderDate ? (o.orderDate.toDate ? o.orderDate.toDate().toISOString() : o.orderDate) : "MISSING";
        const createdAtStr = o.createdAt ? (o.createdAt.toDate ? o.createdAt.toDate().toISOString() : o.createdAt) : "MISSING";
        console.log(`[#${index+1}] ID: ${o.id.substring(0,8)}... | salesperson: ${o.salespersonName} | totalAmount: $${o.totalAmount} | orderDate: ${orderDateStr} | createdAt: ${createdAtStr}`);
    });

    // 3. Analizar productos con totalSold
    console.log("\nFetching products with totalSold > 0...");
    const productsSnap = await getDocs(collection(db, 'products'));
    const productsWithSales = [];
    productsSnap.forEach(d => {
        const data = d.data();
        if (data.totalSold && data.totalSold > 0) {
            productsWithSales.push({ id: d.id, name: data.name, totalSold: data.totalSold, stock: data.stockLevel });
        }
    });

    console.log(`\nProducts with registered sales (totalSold > 0): ${productsWithSales.length}`);
    productsWithSales.forEach(p => {
        console.log(`- ${p.name} | Sold: ${p.totalSold} units | Stock: ${p.stock}`);
    });

} catch (err) {
    console.error("Diagnostic execution error:", err);
}

process.exit(0);
