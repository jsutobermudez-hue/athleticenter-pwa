import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
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

async function auditPagosVsCommissions() {
  await signInWithEmailAndPassword(auth, envVars.FIREBASE_SERVER_EMAIL, envVars.FIREBASE_SERVER_PASSWORD);

  // 1. Fetch all orders
  const ordersSnap = await getDocs(collection(db, 'orders'));
  console.log(`Total pedidos en Firestore: ${ordersSnap.size}`);

  let totalCollectedInOrders = 0;
  let totalPaymentsInOrdersCount = 0;
  const allOrderPayments = [];

  ordersSnap.docs.forEach(docSnap => {
    const o = docSnap.data();
    const orderId = docSnap.id;
    const orderNumber = o.orderNumber || orderId;
    const salespersonId = o.salespersonId;
    const salespersonName = o.salespersonName;

    // Sum amountPaid or payments array
    if (o.payments && Array.isArray(o.payments)) {
      o.payments.forEach((p, idx) => {
        totalPaymentsInOrdersCount++;
        const amtUSD = p.amountUSD || p.amount || 0;
        totalCollectedInOrders += amtUSD;
        allOrderPayments.push({
          orderId,
          orderNumber,
          salespersonId,
          salespersonName,
          paymentId: p.id || p.paymentId || `${orderId}_pay_${idx}`,
          amountUSD: amtUSD,
          paymentMethod: p.method || p.paymentMethod || 'EFECTIVO',
          date: p.date || p.createdAt || o.createdAt,
          status: p.status || 'aprobado'
        });
      });
    } else if (o.amountPaid && o.amountPaid > 0) {
      totalPaymentsInOrdersCount++;
      totalCollectedInOrders += o.amountPaid;
      allOrderPayments.push({
        orderId,
        orderNumber,
        salespersonId,
        salespersonName,
        paymentId: `${orderId}_amountPaid`,
        amountUSD: o.amountPaid,
        paymentMethod: 'DESCONOCIDO',
        date: o.createdAt,
        status: 'aprobado'
      });
    }
  });

  console.log(`\n=== PAGOS REGISTRADOS EN PEDIDOS (ORDERS) ===`);
  console.log(`Total Pagos Registrados en Orders: ${totalPaymentsInOrdersCount}`);
  console.log(`Monto Total Recaudado en Orders: $${totalCollectedInOrders.toFixed(2)} USD`);

  // 2. Fetch all commissions
  const commsSnap = await getDocs(collection(db, 'commissions'));
  console.log(`\nTotal comisiones en Firestore: ${commsSnap.size}`);

  const commsByPaymentId = new Set();
  const commsByOrderId = new Set();
  let vendedorCommsTotalVol = 0;
  let vendedorCommsCount = 0;

  commsSnap.docs.forEach(docSnap => {
    const d = docSnap.data();
    const type = d.commissionType || (d.recipientRole === 'SALES_MANAGER' ? 'gerencia' : (d.recipientRole === 'ADMIN' ? 'admin' : 'vendedor'));
    if (type === 'vendedor' && d.salespersonId !== 'DESCONOCIDO') {
      vendedorCommsCount++;
      vendedorCommsTotalVol += (d.paymentAmountUSD || d.invoiceAmount || 0);
      if (d.paymentId) commsByPaymentId.add(d.paymentId);
      if (d.orderId) commsByOrderId.add(d.orderId);
    }
  });

  console.log(`\n=== COMISIONES DE VENDEDORES (COMMISSIONS) ===`);
  console.log(`Total Ops Comisiones Vendedores: ${vendedorCommsCount}`);
  console.log(`Monto Total Volumen en Comisiones Vendedores: $${vendedorCommsTotalVol.toFixed(2)} USD`);

  // 3. Find order payments missing from commissions collection!
  console.log(`\n=== PAGOS REGISTRADOS QUE NO TIENEN COMISIÓN GENERADA ===`);
  const missingCommsList = [];
  let missingVolUSD = 0;

  allOrderPayments.forEach(p => {
    const hasComm = commsByPaymentId.has(p.paymentId) || commsByOrderId.has(p.orderId);
    if (!hasComm) {
      missingCommsList.push(p);
      missingVolUSD += p.amountUSD;
    }
  });

  console.log(`Pagos sin comisión generada: ${missingCommsList.length} pagos`);
  console.log(`Volumen sin comisión generada: $${missingVolUSD.toFixed(2)} USD`);

  missingCommsList.forEach((item, idx) => {
    console.log(`${idx + 1}. Pedido: ${item.orderNumber} (${item.orderId}) | Vendedor: ${item.salespersonName || item.salespersonId || 'SIN_VENDEDOR'} | Pago ID: ${item.paymentId} | Monto: $${item.amountUSD.toFixed(2)} USD | Método: ${item.paymentMethod}`);
  });
}

auditPagosVsCommissions().catch(console.error);
