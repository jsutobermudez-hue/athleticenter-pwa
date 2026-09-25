import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc, Timestamp } from 'firebase/firestore';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { readFileSync } from 'fs';

const envText = readFileSync('.env.local', 'utf8');
const envVars = {};
envText.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w_]+)\s*=\s*"?([^"]*)"?\s*$/);
  if (match) {
    envVars[match[1]] = match[2];
  }
});

const firebaseConfig = {
  apiKey: envVars.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: envVars.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: envVars.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: envVars.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: envVars.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: envVars.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const auth = getAuth(app);
const db = getFirestore(app);

async function sync2MissingOrders() {
  await signInWithEmailAndPassword(auth, envVars.FIREBASE_SERVER_EMAIL, envVars.FIREBASE_SERVER_PASSWORD);

  // 1. Ahn0dJliOYz9cb0fRM4R (Luis)
  const o1Id = 'Ahn0dJliOYz9cb0fRM4R';
  const o1Snap = await getDocs(collection(db, 'orders'));
  const o1Doc = o1Snap.docs.find(d => d.id === o1Id);
  
  if (o1Doc) {
    const d = o1Doc.data();
    const baseAmt = 854.75;
    
    // Vendedor comm
    const vRef = doc(collection(db, 'commissions'));
    await setDoc(vRef, {
      id: vRef.id,
      orderId: o1Id,
      orderNumber: d.orderNumber || o1Id,
      paymentId: `${o1Id}_paid`,
      salespersonId: d.salespersonId || 'EMCjRVWo10awrn9Jb6Ls35ztywY2',
      salespersonName: d.salespersonName || 'LUIS ALBERTO GIMÉNEZ',
      recipientUserId: d.salespersonId || 'EMCjRVWo10awrn9Jb6Ls35ztywY2',
      recipientName: d.salespersonName || 'LUIS ALBERTO GIMÉNEZ',
      recipientRole: 'SALES',
      commissionType: 'vendedor',
      customerName: d.customerName || 'Cliente B2B',
      paymentMethod: 'EFECTIVO',
      invoiceAmount: baseAmt,
      paymentAmountUSD: baseAmt,
      salespersonCommissionRate: 0.05,
      salespersonCommissionAmount: Number((baseAmt * 0.05).toFixed(2)),
      commissionAmountUSD: Number((baseAmt * 0.05).toFixed(2)),
      status: 'pendiente',
      commissionDate: d.createdAt || Timestamp.now(),
      createdAt: d.createdAt || Timestamp.now()
    });

    // Gerencia comm
    const gRef = doc(collection(db, 'commissions'));
    await setDoc(gRef, {
      id: gRef.id,
      orderId: o1Id,
      orderNumber: d.orderNumber || o1Id,
      paymentId: `${o1Id}_paid`,
      salespersonId: 'GERENCIA_SALES_MANAGER',
      salespersonName: '👔 Jsutobermudez (Gerencia de Ventas - Override)',
      recipientUserId: 'GERENCIA_SALES_MANAGER',
      recipientName: '👔 Jsutobermudez (Gerencia de Ventas - Override)',
      recipientRole: 'SALES_MANAGER',
      commissionType: 'gerencia',
      customerName: d.customerName || 'Cliente B2B',
      paymentMethod: 'EFECTIVO',
      invoiceAmount: baseAmt,
      paymentAmountUSD: baseAmt,
      salespersonCommissionRate: 0.05,
      salespersonCommissionAmount: Number((baseAmt * 0.05).toFixed(2)),
      commissionAmountUSD: Number((baseAmt * 0.05).toFixed(2)),
      status: 'pendiente',
      commissionDate: d.createdAt || Timestamp.now(),
      createdAt: d.createdAt || Timestamp.now()
    });

    // Admin comm
    const aRef = doc(collection(db, 'commissions'));
    await setDoc(aRef, {
      id: aRef.id,
      orderId: o1Id,
      orderNumber: d.orderNumber || o1Id,
      paymentId: `${o1Id}_paid`,
      salespersonId: 'ADMINISTRACION',
      salespersonName: '🏢 Administración / Gestión de Cobranza',
      recipientUserId: 'ADMINISTRACION',
      recipientName: '🏢 Administración / Gestión de Cobranza',
      recipientRole: 'ADMIN',
      commissionType: 'admin',
      customerName: d.customerName || 'Cliente B2B',
      paymentMethod: 'EFECTIVO',
      invoiceAmount: baseAmt,
      paymentAmountUSD: baseAmt,
      salespersonCommissionRate: 0.01,
      salespersonCommissionAmount: Number((baseAmt * 0.01).toFixed(2)),
      commissionAmountUSD: Number((baseAmt * 0.01).toFixed(2)),
      status: 'pendiente',
      commissionDate: d.createdAt || Timestamp.now(),
      createdAt: d.createdAt || Timestamp.now()
    });

    console.log(`[+] Creadas comisiones Vendedor, Gerencia y Admin para Pedido ${o1Id} ($854.75 USD)`);
  }

  // 2. 9RdkSFEBNcHcw0f8h3Pm (Victor Vargas)
  const o2Id = '9RdkSFEBNcHcw0f8h3Pm';
  const o2Doc = o1Snap.docs.find(d => d.id === o2Id);

  if (o2Doc) {
    const d = o2Doc.data();
    const baseAmt = 350.00;
    
    // Vendedor comm
    const vRef = doc(collection(db, 'commissions'));
    await setDoc(vRef, {
      id: vRef.id,
      orderId: o2Id,
      orderNumber: d.orderNumber || o2Id,
      paymentId: `${o2Id}_paid`,
      salespersonId: d.salespersonId || 'VICTOR_VARGAS',
      salespersonName: d.salespersonName || 'VICTOR VARGAS',
      recipientUserId: d.salespersonId || 'VICTOR_VARGAS',
      recipientName: d.salespersonName || 'VICTOR VARGAS',
      recipientRole: 'SALES',
      commissionType: 'vendedor',
      customerName: d.customerName || 'Cliente B2B',
      paymentMethod: 'EFECTIVO',
      invoiceAmount: baseAmt,
      paymentAmountUSD: baseAmt,
      salespersonCommissionRate: 0.05,
      salespersonCommissionAmount: Number((baseAmt * 0.05).toFixed(2)),
      commissionAmountUSD: Number((baseAmt * 0.05).toFixed(2)),
      status: 'pendiente',
      commissionDate: d.createdAt || Timestamp.now(),
      createdAt: d.createdAt || Timestamp.now()
    });

    // Gerencia comm
    const gRef = doc(collection(db, 'commissions'));
    await setDoc(gRef, {
      id: gRef.id,
      orderId: o2Id,
      orderNumber: d.orderNumber || o2Id,
      paymentId: `${o2Id}_paid`,
      salespersonId: 'GERENCIA_SALES_MANAGER',
      salespersonName: '👔 Jsutobermudez (Gerencia de Ventas - Override)',
      recipientUserId: 'GERENCIA_SALES_MANAGER',
      recipientName: '👔 Jsutobermudez (Gerencia de Ventas - Override)',
      recipientRole: 'SALES_MANAGER',
      commissionType: 'gerencia',
      customerName: d.customerName || 'Cliente B2B',
      paymentMethod: 'EFECTIVO',
      invoiceAmount: baseAmt,
      paymentAmountUSD: baseAmt,
      salespersonCommissionRate: 0.05,
      salespersonCommissionAmount: Number((baseAmt * 0.05).toFixed(2)),
      commissionAmountUSD: Number((baseAmt * 0.05).toFixed(2)),
      status: 'pendiente',
      commissionDate: d.createdAt || Timestamp.now(),
      createdAt: d.createdAt || Timestamp.now()
    });

    // Admin comm
    const aRef = doc(collection(db, 'commissions'));
    await setDoc(aRef, {
      id: aRef.id,
      orderId: o2Id,
      orderNumber: d.orderNumber || o2Id,
      paymentId: `${o2Id}_paid`,
      salespersonId: 'ADMINISTRACION',
      salespersonName: '🏢 Administración / Gestión de Cobranza',
      recipientUserId: 'ADMINISTRACION',
      recipientName: '🏢 Administración / Gestión de Cobranza',
      recipientRole: 'ADMIN',
      commissionType: 'admin',
      customerName: d.customerName || 'Cliente B2B',
      paymentMethod: 'EFECTIVO',
      invoiceAmount: baseAmt,
      paymentAmountUSD: baseAmt,
      salespersonCommissionRate: 0.01,
      salespersonCommissionAmount: Number((baseAmt * 0.01).toFixed(2)),
      commissionAmountUSD: Number((baseAmt * 0.01).toFixed(2)),
      status: 'pendiente',
      commissionDate: d.createdAt || Timestamp.now(),
      createdAt: d.createdAt || Timestamp.now()
    });

    console.log(`[+] Creadas comisiones Vendedor, Gerencia y Admin para Pedido ${o2Id} ($350.00 USD)`);
  }
}

sync2MissingOrders().catch(console.error);
