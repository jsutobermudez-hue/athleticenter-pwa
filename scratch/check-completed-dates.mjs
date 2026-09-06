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

const email = "server-agent1@athleticenter.com";
const password = "123456";

console.log("Connecting to Firebase...");
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

try {
    await signInWithEmailAndPassword(auth, email, password);
    console.log("Authenticated successfully.");

    const ordersSnap = await getDocs(collection(db, 'orders'));
    console.log(`Total orders found: ${ordersSnap.size}`);

    const validStatuses = ['Entregado', 'Completado', 'Despachado', 'Pagado'];
    const deliveredOrders = [];

    ordersSnap.forEach(d => {
        const o = d.data();
        if (validStatuses.includes(o.status)) {
            const dateVal = o.receptionDate || o.approvalDate || o.createdAt || o.orderDate;
            const dateObj = dateVal ? (dateVal.toDate ? dateVal.toDate() : new Date(dateVal)) : new Date(0);
            deliveredOrders.push({
                id: d.id,
                status: o.status,
                customer: o.customerName,
                totalAmount: o.totalAmount,
                amountPaid: o.amountPaid || 0,
                date: dateObj.toISOString()
            });
        }
    });

    console.log(`\nValid Delivered/Paid Sales Orders count: ${deliveredOrders.length}`);
    
    // Agrupar por mes
    const monthCounts = {};
    deliveredOrders.forEach(o => {
        const monthKey = o.date.substring(0, 7); // YYYY-MM
        monthCounts[monthKey] = (monthCounts[monthKey] || 0) + 1;
    });

    console.log("\n--- DELIVERED SALES ORDERS BY MONTH ---");
    console.log(monthCounts);

    // Ver últimos 15 pedidos entregados
    console.log("\n--- RECENT 15 DELIVERED SALES ORDERS ---");
    deliveredOrders.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    deliveredOrders.slice(0, 15).forEach((o, i) => {
        console.log(`[#${i+1}] ID: ${o.id.substring(0,8)} | Status: ${o.status} | Total: $${o.totalAmount} | Paid: $${o.amountPaid} | Date: ${o.date}`);
    });

} catch (err) {
    console.error("Error checking completed dates:", err);
}

process.exit(0);
