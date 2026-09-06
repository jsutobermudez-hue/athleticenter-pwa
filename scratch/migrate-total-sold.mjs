import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';

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

    console.log("Fetching all orders to calculate totalSold...");
    const ordersSnap = await getDocs(collection(db, 'orders'));
    console.log(`Total orders found: ${ordersSnap.size}`);

    const salesMap = {}; // productId -> quantity

    // Procesar cada pedido
    for (const orderDoc of ordersSnap.docs) {
        const order = orderDoc.data();
        // Solo acumular ventas si el pedido está en un estado facturado/pagado
        if (['Pagado', 'Completado', 'Despachado', 'Entregado'].includes(order.status)) {
            const itemsSnap = await getDocs(collection(db, `orders/${orderDoc.id}/orderItems`));
            itemsSnap.forEach(itemDoc => {
                const item = itemDoc.data();
                if (item.productId && item.quantity > 0) {
                    salesMap[item.productId] = (salesMap[item.productId] || 0) + Number(item.quantity);
                }
            });
        }
    }

    console.log("\nSales aggregation complete. Calculated products sales count:", Object.keys(salesMap).length);

    console.log("Updating products in Firestore with totalSold values...");
    const productsSnap = await getDocs(collection(db, 'products'));
    let updatedCount = 0;

    for (const productDoc of productsSnap.docs) {
        const productId = productDoc.id;
        const totalSoldVal = salesMap[productId] || 0;
        
        console.log(`Updating product "${productDoc.data().name || productId}" -> totalSold: ${totalSoldVal}`);
        await updateDoc(doc(db, 'products', productId), {
            totalSold: totalSoldVal
        });
        updatedCount++;
    }

    console.log(`\nSuccessfully updated ${updatedCount} products with their historic totalSold values!`);

} catch (err) {
    console.error("Migration failed with error:", err);
}

process.exit(0);
