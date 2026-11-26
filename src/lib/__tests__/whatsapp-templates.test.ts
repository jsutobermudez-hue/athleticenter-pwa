import assert from 'node:assert/strict';
import {
    APP_BASE_URL,
    TEAM_SIGNATURE,
    computeOrderBalanceForWhatsApp,
    welcomeMessage,
    quoteMessage,
    orderRegisteredMessage,
    orderStatusMessage,
    expedienteMessage,
    dispatchMessage,
    accountStatementMessage,
    salesGreetingMessage,
    paymentReceiptMessage,
    orderStatusChangeMessage,
    billingReminderMessage,
    debtReminderMessage,
    earlyPaymentSavingsMessage,
    internalNoticeMessage,
    commissionPaidMessage,
    commissionBalanceMessage,
    pendingReconciliationAlertMessage,
    dailyBriefingSalespersonMessage,
    dailyBriefingWarehouseMessage,
    dailyBriefingAdminMessage,
    dailyBriefingExecutiveMessage,
    morningBrainBriefingMessage,
    criticalAuditAlertMessage,
    carrierInquiryMessage,
    supplierInquiryMessage,
    clientToSalespersonMessage,
    whatsappTestMessage,
} from '../whatsapp-templates';

const FORBIDDEN_CLIENT_TERMS = [
    'EXPEDIENTE',
    'Solvente',
    'SOLVENTE',
    'Tier 5%',
    'Vos Aprobás',
    'athleticenter-pwa.web.app',
    'S/D',
    'requerimiento de reposición',
];

const FORBIDDEN_INTERNAL_TERMS = [
    'athleticenter-pwa.web.app',
    'Vos Aprobás',
    'Anti-Churn',
    'Gateway Local Online',
    'Runway',
    '584121234567',
];

// 1. Bug del cliente en $0 con historial $900
const zeroDebtStatement = accountStatementMessage({
    customerName: 'Deportes Caracas C.A.',
    rif: 'J-12345678-9',
    totalSpent: 900,
    pendingBalance: 0,
    creditLimit: 2000,
});
assert.ok(zeroDebtStatement.includes('Tu cuenta está al día'), 'Debe confirmar cuenta al día');
assert.ok(zeroDebtStatement.includes('$0.00'), 'Debe mostrar saldo $0.00');
assert.ok(!zeroDebtStatement.includes('900'), 'Nunca debe mostrar el total histórico ($900) en estado de cuenta');

const withDebtStatement = accountStatementMessage({
    customerName: 'Deportes Caracas C.A.',
    pendingBalance: 400,
    openInvoicesCount: 2,
});
assert.ok(withDebtStatement.includes('$400.00'), 'Debe mostrar saldo Lista BCV');
assert.ok(withDebtStatement.includes('$300.00'), 'Debe mostrar saldo Divisas (-25%)');
assert.ok(withDebtStatement.includes('Facturas abiertas:* 2'), 'Debe incluir cantidad de facturas abiertas');

// 2. computeOrderBalanceForWhatsApp
const paidOrderDivisas = computeOrderBalanceForWhatsApp({
    status: 'Pagado',
    totalAmount: 1200,
    amountPaid: 900,
});
assert.equal(paidOrderDivisas.isPaid, true);
assert.equal(paidOrderDivisas.isBillable, false);
assert.equal(paidOrderDivisas.pendingListUSD, 0);
assert.equal(paidOrderDivisas.pendingDivisasUSD, 0);

const settledDeliveredDivisas = computeOrderBalanceForWhatsApp({
    status: 'Entregado',
    totalAmount: 1200,
    amountPaid: 900,
});
assert.equal(settledDeliveredDivisas.isPaid, true);
assert.equal(settledDeliveredDivisas.isBillable, false);
assert.equal(settledDeliveredDivisas.pendingListUSD, 0);
assert.equal(settledDeliveredDivisas.pendingDivisasUSD, 0);

const preDispatchOrder = computeOrderBalanceForWhatsApp({
    status: 'Aprobado',
    totalAmount: 1200,
    amountPaid: 0,
});
assert.equal(preDispatchOrder.isBillable, false);

const inPrepOrder = computeOrderBalanceForWhatsApp({
    status: 'En Preparación',
    totalAmount: 1200,
    amountPaid: 0,
});
assert.equal(inPrepOrder.isBillable, false);

const partialDeliveredOrder = computeOrderBalanceForWhatsApp({
    status: 'Entregado',
    totalAmount: 1200,
    amountPaid: 200,
});
assert.equal(partialDeliveredOrder.isBillable, true);
assert.equal(partialDeliveredOrder.pendingListUSD, 1000);
assert.equal(partialDeliveredOrder.pendingDivisasUSD, 700);

// 3. Validación de todas las plantillas a clientes
const clientMessages = [
    welcomeMessage({ name: 'Club Ávila', creditLimit: 1500 }),
    quoteMessage({ customerName: 'Club Ávila', quoteId: 'COT-1042', itemsCount: 6, total: 1000, validUntil: '30/11/2026' }),
    orderRegisteredMessage({ customerName: 'Club Ávila', orderId: 'P-2026-0412', total: 800 }),
    orderStatusMessage({
        customerName: 'Club Ávila',
        orderId: 'P-2026-0412',
        status: 'En Preparación',
        total: 800,
        pendingDebt: 0,
        isPaid: true,
    }),
    expedienteMessage({
        orderId: 'P-2026-0412',
        customerName: 'Club Ávila',
        status: 'Entregado',
        total: 800,
        pendingDebt: 400,
        paidAmount: 400,
        itemsSummary: '• Balón Molten V5M5000 x10 ($400.00)',
    }),
    dispatchMessage({ customerName: 'Club Ávila', orderId: 'P-2026-0412', carrier: 'MRW', trackingNumber: '145098231', packages: 3 }),
    zeroDebtStatement,
    withDebtStatement,
    salesGreetingMessage({ customerName: 'Club Ávila' }),
    paymentReceiptMessage({
        customerName: 'Club Ávila',
        orderId: 'P-2026-0412',
        amountPaid: 300,
        method: 'Zelle',
        referenceNumber: '849201',
        isFullyPaid: true,
        hasPdfAttachment: true,
    }),
    orderStatusChangeMessage({ customerName: 'Club Ávila', orderId: 'P-2026-0412', newStatus: 'En Preparación' }),
    billingReminderMessage({ customerName: 'Club Ávila', invoiceId: 'P-2026-0388', remainingBalance: 400, statusText: 'Vence en 5 días' }),
    debtReminderMessage({ customerName: 'Club Ávila', invoices: [{ id: 'P-2026-0388', pending: 400, days: 18 }] }),
    earlyPaymentSavingsMessage({
        customerName: 'Club Ávila',
        orderId: 'P-2026-0412',
        totalDivisasUSD: 600,
        totalContadoUSD: 540,
        deadlineLabel: '28/11',
        hoursRemaining: 20,
    }),
];

for (const msg of clientMessages) {
    assert.ok(msg.includes(TEAM_SIGNATURE), `Falta firma de equipo en mensaje cliente:\n${msg}`);
    for (const term of FORBIDDEN_CLIENT_TERMS) {
        assert.ok(!msg.includes(term), `Término prohibido "${term}" encontrado en mensaje cliente:\n${msg}`);
    }
}

// 4. Validación de todas las plantillas internas
const internalMessages = [
    internalNoticeMessage('Nuevo pedido', 'Se registró un pedido nuevo', '/dashboard/orders'),
    commissionPaidMessage({
        salespersonName: 'Carlos',
        totalUSD: 185,
        totalBs: 12117.5,
        operationsCount: 6,
        accountName: 'Zelle Empresa',
        referenceNumber: '904812',
    }),
    commissionBalanceMessage({ salespersonName: 'Carlos', pendingUSD: 140.5 }),
    pendingReconciliationAlertMessage({
        adminName: 'María',
        pendingCount: 2,
        totalAmountUSD: 640,
        items: [
            { orderId: 'P-0412', customerName: 'Deportes Caracas', amount: 300 },
            { orderId: 'P-0415', customerName: 'Sport Center', amount: 340 },
        ],
    }),
    dailyBriefingSalespersonMessage({
        name: 'Carlos',
        dateLabel: 'miércoles 25 nov',
        pendingReceivablesUSD: 1450,
        dueSoonCount: 2,
        dueSoonUSD: 480,
        moraCount: 1,
        moraUSD: 320,
        inPreparationCount: 3,
        deliveredYesterdayCount: 2,
        deliveredYesterdayUSD: 920,
        inactiveClients: ['Deportes Miranda', 'Inversiones Gol'],
    }),
    dailyBriefingWarehouseMessage({
        name: 'Luis',
        dateLabel: 'miércoles 25 nov',
        toPrepareCount: 4,
        readyToShipCount: 2,
        missingTrackingCount: 1,
        dispatchedYesterdayCount: 5,
    }),
    dailyBriefingAdminMessage({
        name: 'María',
        dateLabel: 'miércoles 25 nov',
        bcvRate: 65.5,
        pendingVerificationCount: 3,
        pendingVerificationUSD: 840,
        paymentsYesterdayCount: 5,
        paymentsYesterdayUSD: 1620,
        moraUSD: 1150,
        moraCount: 4,
    }),
    dailyBriefingExecutiveMessage({
        name: 'Justo',
        dateLabel: 'miércoles 25 nov',
        bcvRate: 65.5,
        ordersYesterdayCount: 6,
        ordersYesterdayUSD: 3420,
        dispatchedYesterdayCount: 5,
        dispatchedYesterdayUSD: 2890,
        paymentsYesterdayCount: 4,
        paymentsYesterdayUSD: 1620,
        pendingVerificationCount: 3,
        pendingVerificationUSD: 840,
        moraCount: 4,
        moraUSD: 1150,
        lowStockCount: 5,
        firstLowStockProduct: { name: 'Balón Molten V5M5000', stock: 12 },
    }),
    morningBrainBriefingMessage({
        netWalletLiquidityUSD: 14200,
        runwayMonths: 4.5,
        totalCashVerified: 9850,
        totalPipelineUSD: 4600,
        paidExpensesThisMonthUSD: 1800,
        monthlyFixedExpensesUSD: 3100,
        totalMoneyFoundUSD: 3240,
        accountsReceivableUSD: 2100,
        overdueCount: 5,
        openQuotesPipelineUSD: 1140,
        staleQuotesCount: 4,
        approvalQueueCount: 3,
    }),
    criticalAuditAlertMessage({
        userName: 'Juan Pérez',
        userRole: 'Admin',
        actionLabel: 'Anulación de pedido',
        moduleLabel: 'PEDIDOS',
        details: 'Pedido #P-0410 anulado',
        dateLabel: '25/11/2026 04:15 p.m.',
    }),
    carrierInquiryMessage('MRW'),
    supplierInquiryMessage('Carlos'),
    clientToSalespersonMessage('Carlos', 'Deportes Caracas'),
    whatsappTestMessage('25/11/2026'),
];

const linkedInternalIndices = [0, 2, 3, 4, 5, 6, 7, 9];
for (const idx of linkedInternalIndices) {
    assert.ok(internalMessages[idx].includes(APP_BASE_URL), `Falta APP_BASE_URL en mensaje interno #${idx}`);
}

for (const msg of internalMessages) {
    for (const term of FORBIDDEN_INTERNAL_TERMS) {
        assert.ok(!msg.includes(term), `Término interno prohibido "${term}" encontrado:\n${msg}`);
    }
}

console.log(`✅ OK: ${clientMessages.length} plantillas de cliente y ${internalMessages.length} plantillas internas verificadas correctamente.`);
