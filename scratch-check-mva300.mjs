import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

try {
    await signInWithEmailAndPassword(auth, email, password);
    console.log("Authenticated successfully.");

    const sku = "V-MK05-MVA300";
    const prodSnap = await getDoc(doc(db, 'products', sku));
    console.log("Product Doc:", JSON.stringify(prodSnap.data(), null, 2));

    const priceSnap = await getDoc(doc(db, `products/${sku}/private/pricing`));
    console.log("Pricing Doc:", JSON.stringify(priceSnap.data(), null, 2));

} catch (err) {
    console.error("Error:", err.message);
}
process.exit(0);
