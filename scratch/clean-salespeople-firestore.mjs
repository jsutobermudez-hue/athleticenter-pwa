import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs, doc, writeBatch } from 'firebase/firestore';

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

try {
  await signInWithEmailAndPassword(auth, "server-agent1@athleticenter.com", "123456");
  console.log("Authenticated successfully.");

  const ordersSnap = await getDocs(collection(db, 'orders'));
  console.log(`Processing ${ordersSnap.size} orders for salesperson name sanitization...`);

  let batch = writeBatch(db);
  let batchCount = 0;
  let updatedCount = 0;

  for (const orderDoc of ordersSnap.docs) {
    const data = orderDoc.data();
    const currentName = data.salespersonName || data.vendedor || '';
    const spId = data.salespersonId || data.vendedorId;
    
    let targetName = currentName.trim();

    if (spId === 'XYHwu2u7uuRX1BxkQkfRpgwMAXH3' || targetName.toLowerCase().includes('fabio gine') || targetName.toLowerCase().includes('fabio ginez')) {
      targetName = 'FABIO GINÉS';
    } else if (targetName.toLowerCase().includes('ernesto ortega')) {
      targetName = 'ERNESTO ORTEGA';
    } else if (targetName.toLowerCase().includes('luis') && targetName.toLowerCase().includes('gimenez')) {
      targetName = 'LUIS ALBERTO GIMÉNEZ';
    } else if (targetName.toLowerCase().includes('juan paz')) {
      targetName = 'JUAN PAZ';
    } else if (targetName.toLowerCase().includes('yeny hernandez')) {
      targetName = 'YENY HERNÁNDEZ';
    }

    if (data.salespersonName !== targetName) {
      batch.update(doc(db, 'orders', orderDoc.id), {
        salespersonName: targetName,
        vendedor: targetName
      });
      batchCount++;
      updatedCount++;

      if (batchCount >= 400) {
        await batch.commit();
        batch = writeBatch(db);
        batchCount = 0;
      }
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }

  console.log(`🎉 Sanitization completed! Updated ${updatedCount} orders.`);
} catch (e) {
  console.error("Sanitization error:", e);
}

process.exit(0);
