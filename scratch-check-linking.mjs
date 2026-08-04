import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc, collection, getDocs, query, where, limit } from 'firebase/firestore';

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

    // Buscamos un cliente por id
    const targetCustomerId = "E7MQ3jvtjGZ07l8oK7j2C53SBOH2"; // Angelo miraldi
    const cSnap = await getDoc(doc(db, 'customers', targetCustomerId));
    if (cSnap.exists()) {
        console.log("Customer found with ID matching user UID:", targetCustomerId);
    } else {
        console.log("No customer found with ID matching user UID:", targetCustomerId);
    }

    // Busquemos en la colección 'users' si hay un campo que los relacione
    const usersSnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'cliente'), limit(5)));
    usersSnap.forEach(d => {
        const u = d.data();
        console.log(`User ID: ${d.id} | Name: ${u.name} | associatedCustomerId: ${u.associatedCustomerId}`);
    });

} catch (err) {
    console.error("Error:", err.message);
}
process.exit(0);
