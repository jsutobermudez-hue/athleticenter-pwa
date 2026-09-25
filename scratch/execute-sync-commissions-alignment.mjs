import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc, Timestamp } from 'firebase/firestore';
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

async function syncCommissions() {
  await signInWithEmailAndPassword(auth, envVars.FIREBASE_SERVER_EMAIL, envVars.FIREBASE_SERVER_PASSWORD);

  const commsSnap = await getDocs(collection(db, 'commissions'));
  
  const vendedorComms = [];
  const gerenciaCommsByPaymentId = new Set();
  const adminCommsByPaymentId = new Set();

  commsSnap.docs.forEach(docSnap => {
    const d = docSnap.data();
    const docId = docSnap.id;
    const type = d.commissionType || (d.recipientRole === 'SALES_MANAGER' ? 'gerencia' : (d.recipientRole === 'ADMIN' ? 'admin' : 'vendedor'));
    
    if (docId === 'wvEiXYfKIvKoIAe9ANoF' || d.salespersonId === 'DESCONOCIDO') {
      // Orphan invalid document
      console.log(`Eliminando documento inválido huérfano: ${docId}`);
      deleteDoc(doc(db, 'commissions', docId));
      return;
    }

    if (type === 'vendedor') {
      vendedorComms.push({ docId, data: d });
    } else if (type === 'gerencia') {
      if (d.paymentId) gerenciaCommsByPaymentId.add(d.paymentId);
    } else if (type === 'admin') {
      if (d.paymentId) adminCommsByPaymentId.add(d.paymentId);
    }
  });

  console.log(`Vendedores directos analizados: ${vendedorComms.length}`);
  let addedGerencia = 0;
  let addedAdmin = 0;

  for (const vc of vendedorComms) {
    const d = vc.data;
    const paymentId = d.paymentId;
    if (!paymentId) continue;

    const baseAmount = d.paymentAmountUSD || d.invoiceAmount || 0;
    const baseBs = d.paymentAmountBS || d.invoiceAmountBs || 0;
    const bcvRate = d.bcvRate || 1;
    const dateVal = d.commissionDate || d.createdAt || Timestamp.now();

    // 1. Check Gerencia
    if (!gerenciaCommsByPaymentId.has(paymentId)) {
      const gRef = doc(collection(db, 'commissions'));
      const gCommAmountUSD = Number((baseAmount * 0.05).toFixed(2));
      const gCommAmountBS = Number((baseBs * 0.05).toFixed(2));

      const gData = {
        id: gRef.id,
        orderId: d.orderId || '',
        orderNumber: d.orderNumber || '',
        paymentId: paymentId,
        salespersonId: 'GERENCIA_SALES_MANAGER',
        salespersonName: '👔 Jsutobermudez (Gerencia de Ventas - Override)',
        recipientUserId: 'GERENCIA_SALES_MANAGER',
        recipientName: '👔 Jsutobermudez (Gerencia de Ventas - Override)',
        recipientRole: 'SALES_MANAGER',
        commissionType: 'gerencia',
        customerName: d.customerName || 'Cliente B2B',
        paymentMethod: d.paymentMethod || 'EFECTIVO',
        invoiceAmount: baseAmount,
        paymentAmountUSD: baseAmount,
        paymentAmountBS: baseBs,
        bcvRate: bcvRate,
        salespersonCommissionRate: 0.05,
        salespersonCommissionAmount: gCommAmountUSD,
        commissionAmountUSD: gCommAmountUSD,
        commissionAmountBS: gCommAmountBS,
        status: d.status || 'pendiente',
        commissionDate: dateVal,
        createdAt: dateVal,
        synced: true
      };

      await setDoc(gRef, gData);
      console.log(`[+] Gerencia creada: ${gRef.id} para Pago ${paymentId} | Monto Base: $${baseAmount} | Comisión (5%): $${gCommAmountUSD}`);
      addedGerencia++;
    }

    // 2. Check Admin
    if (!adminCommsByPaymentId.has(paymentId)) {
      const aRef = doc(collection(db, 'commissions'));
      const aCommAmountUSD = Number((baseAmount * 0.01).toFixed(2));
      const aCommAmountBS = Number((baseBs * 0.01).toFixed(2));

      const aData = {
        id: aRef.id,
        orderId: d.orderId || '',
        orderNumber: d.orderNumber || '',
        paymentId: paymentId,
        salespersonId: 'ADMINISTRACION',
        salespersonName: '🏢 Administración / Gestión de Cobranza',
        recipientUserId: 'ADMINISTRACION',
        recipientName: '🏢 Administración / Gestión de Cobranza',
        recipientRole: 'ADMIN',
        commissionType: 'admin',
        customerName: d.customerName || 'Cliente B2B',
        paymentMethod: d.paymentMethod || 'EFECTIVO',
        invoiceAmount: baseAmount,
        paymentAmountUSD: baseAmount,
        paymentAmountBS: baseBs,
        bcvRate: bcvRate,
        salespersonCommissionRate: 0.01,
        salespersonCommissionAmount: aCommAmountUSD,
        commissionAmountUSD: aCommAmountUSD,
        commissionAmountBS: aCommAmountBS,
        status: d.status || 'pendiente',
        commissionDate: dateVal,
        createdAt: dateVal,
        synced: true
      };

      await setDoc(aRef, aData);
      console.log(`[+] Admin creada: ${aRef.id} para Pago ${paymentId} | Monto Base: $${baseAmount} | Comisión (1%): $${aCommAmountUSD}`);
      addedAdmin++;
    }
  }

  console.log(`\n=== RESUMEN DE SINCRONIZACIÓN ===`);
  console.log(`Nuevas comisiones de Gerencia creadas: ${addedGerencia}`);
  console.log(`Nuevas comisiones de Administración creadas: ${addedAdmin}`);
}

syncCommissions().catch(console.error);
