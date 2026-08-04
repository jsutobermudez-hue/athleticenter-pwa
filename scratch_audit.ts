import fs from 'fs';
import path from 'path';

// Parse .env.local manually
try {
  const envContent = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf-8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w\.\-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      process.env[key] = value;
    }
  });
} catch (e) {
  console.error("Error reading .env.local:", e);
}

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs, doc, getDoc, query, where } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID
};

async function main() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  console.log("Authenticating server agent...");
  await signInWithEmailAndPassword(auth, process.env.FIREBASE_SERVER_EMAIL!, process.env.FIREBASE_SERVER_PASSWORD!);
  console.log("Authenticated successfully!");

  console.log("Fetching pending/draft orders...");
  const ordersRef = collection(db, 'orders');
  const q = query(ordersRef, where('status', 'in', ['Pendiente', 'Borrador']));
  const snapshot = await getDocs(q);

  console.log(`Found ${snapshot.size} pending/draft orders:`);
  for (const orderDoc of snapshot.docs) {
    const orderData = orderDoc.data();
    console.log(`\nOrder: ${orderDoc.id} | Customer: ${orderData.customerName} | Status: ${orderData.status} | Total: $${orderData.totalAmount}`);

    // Fetch orderItems
    const itemsRef = collection(db, `orders/${orderDoc.id}/orderItems`);
    const itemsSnap = await getDocs(itemsRef);
    console.log(`  Items (${itemsSnap.size}):`);

    for (const itemDoc of itemsSnap.docs) {
      const itemData = itemDoc.data();
      const productRef = doc(db, 'products', itemData.productId);
      const productSnap = await getDoc(productRef);

      if (!productSnap.exists()) {
        console.log(`    ⚠️  [ERROR] Product not found! ID: ${itemData.productId} | Qty: ${itemData.quantity} | Size: ${itemData.size}`);
      } else {
        const prodData = productSnap.data();
        const availableStock = prodData.hasSizes && itemData.size && prodData.sizes
          ? (prodData.sizes[itemData.size] || 0)
          : (prodData.stockLevel ?? prodData.stock ?? 0);
        
        console.log(`    - Product: ${prodData.name} (ID: ${itemData.productId})`);
        console.log(`      Req: ${itemData.quantity} | Available Stock: ${availableStock} | Size: ${itemData.size}`);
        if (availableStock < itemData.quantity) {
          console.log(`      ⚠️  [SHORTAGE] Insufficient stock! Needed: ${itemData.quantity}, Available: ${availableStock}`);
        }
      }
    }
  }
}

main().catch(console.error);
