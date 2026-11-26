/**
 * @fileOverview Servicios de ejecución para procesos automatizados (MODO ACTIVO v2.0).
 * Conecta el endpoint de Cron con los flujos de Genkit.
 */

import { automatedBillingAgentFlow } from '@/ai/flows/automated-billing-agent';
import { savingsAlertAgentFlow } from '@/ai/flows/savings-alert-agent';
import { stockOutPredictorAgentFlow } from '@/ai/flows/stock-out-predictor-agent';
import { logisticsPerformanceAgentFlow } from '@/ai/flows/logistics-performance-agent';
import { churnPreventionAgentFlow } from '@/ai/flows/churn-prevention-agent';
import { fetchLatestBcvRate } from '@/lib/bcv-fetcher';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { initializeFirebaseServer } from '@/firebase/server-init';
import { createAppNotifications } from '@/lib/notifications';

export async function executeBcvRateSync() {
    try {
        const { firestore } = initializeFirebaseServer();
        const latestRate = await fetchLatestBcvRate();
        if (!latestRate) return { success: false, error: 'No se pudo obtener la tasa de los proveedores.' };

        const settingsRef = doc(firestore, 'system', 'financials');
        const settingsSnap = await getDoc(settingsRef);
        const currentRate = settingsSnap.exists() ? settingsSnap.data().bcvRate : 0;

        // Solo actualizamos si hay una variación real (más de 0.01)
        if (Math.abs(latestRate - currentRate) > 0.01) {
            await updateDoc(settingsRef, { 
                bcvRate: latestRate, 
                lastAutoSync: serverTimestamp() 
            });

            await createAppNotifications(firestore, {
                category: 'Facturación',
                title: '📈 Tasa BCV Sincronizada',
                message: `La tasa oficial ha sido actualizada automáticamente de ${currentRate} a ${latestRate} Bs. Precios de catálogo protegidos.`,
                link: '/dashboard/treasury',
                initiatorId: 'system_bcv_agent',
                roles: ['admin', 'gerencia', 'superadmin']
            });

            return { success: true, action: 'updated', oldRate: currentRate, newRate: latestRate };
        }

        return { success: true, action: 'none', message: 'Tasa ya sincronizada.' };
    } catch (e: any) {
        console.error("[Agent Service] BCV Sync failed:", e.message);
        return { success: false, error: e.message };
    }
}

export async function executeAutomatedBilling() {
    try {
        const result = await automatedBillingAgentFlow();
        return { success: true, data: result };
    } catch (e: any) {
        console.error("[Agent Service] Billing failed:", e.message);
        return { success: false, error: e.message };
    }
}

export async function executeSavingsAlert() {
    try {
        const result = await savingsAlertAgentFlow();
        return { success: true, data: result };
    } catch (e: any) {
        console.error("[Agent Service] Savings Alert failed:", e.message);
        return { success: false, error: e.message };
    }
}

export async function executeStockOutPredictor() {
    try {
        const result = await stockOutPredictorAgentFlow();
        return { success: true, data: result };
    } catch (e: any) {
        console.error("[Agent Service] Predictor failed:", e.message);
        return { success: false, error: e.message };
    }
}

export async function executeLogisticsAudit() {
    try {
        const result = await logisticsPerformanceAgentFlow();
        return { success: true, data: result };
    } catch (e: any) {
        console.error("[Agent Service] Logistics failed:", e.message);
        return { success: false, error: e.message };
    }
}

export async function executeChurnPrevention() {
    try {
        const result = await churnPreventionAgentFlow();
        return { success: true, data: result };
    } catch (e: any) {
        console.error("[Agent Service] Churn Prevention failed:", e.message);
        return { success: false, error: e.message };
    }
}

export async function executeWeeklySalespersonReceivablesSummary() {
    try {
        const { firestore } = initializeFirebaseServer();
        const { collection, getDocs, query, limit } = await import('firebase/firestore');
        const { getEffectiveCashReceived } = await import('@/lib/billing');

        const ordersSnap = await getDocs(query(collection(firestore, 'orders'), limit(300)));
        const VALID_SALES = ['Entregado', 'Completado', 'Despachado', 'Pagado', 'Aprobado', 'En Preparación', 'En Verificación', 'Pendiente'];

        const salesMap: Record<string, { id: string; name: string; pendingTotalUSD: number; moraCount: number; ordersCount: number }> = {};

        ordersSnap.docs.forEach(d => {
            const o = d.data();
            if (o.status === 'Cancelado' || o.status === 'Rechazado') return;
            if (!VALID_SALES.includes(o.status)) return;

            const total = Number(o.totalAmount || 0);
            const paid = getEffectiveCashReceived(o as any);
            const pending = Math.max(0, total - paid);

            if (pending > 0.05) {
                const sName = o.salespersonName || o.vendedor || 'Venta Directa / Oficina Central';
                const sId = o.salespersonId || 'direct_sales';

                if (!salesMap[sName]) {
                    salesMap[sName] = { id: sId, name: sName, pendingTotalUSD: 0, moraCount: 0, ordersCount: 0 };
                }

                salesMap[sName].pendingTotalUSD += pending;
                salesMap[sName].ordersCount += 1;
            }
        });

        const salespeople = Object.values(salesMap);

        // Crear notificaciones internas y links de descarga
        for (const sp of salespeople) {
            const pdfUrl = `/dashboard/reports/receivables-pdf?salespersonId=${encodeURIComponent(sp.id)}&salespersonName=${encodeURIComponent(sp.name)}`;
            await createAppNotifications(firestore, {
                category: 'Facturación',
                title: `📊 Resumen Semanal de Cartera: ${sp.name}`,
                message: `Tienes $${sp.pendingTotalUSD.toFixed(2)} USD en ${sp.ordersCount} expedientes por cobrar. Descarga tu Estado de Cartera en PDF.`,
                link: pdfUrl,
                initiatorId: 'weekly_receivables_agent',
                roles: ['admin', 'gerencia', 'superadmin', 'ventas']
            });
        }

        return {
            success: true,
            salespeopleNotified: salespeople.length,
            summary: salespeople.map(s => ({ vendedor: s.name, totalPorCobrar: `$${s.pendingTotalUSD.toFixed(2)}` }))
        };
    } catch (e: any) {
        console.error("[Agent Service] Weekly Salesperson Receivables failed:", e.message);
        return { success: false, error: e.message };
    }
}

export async function executePendingReconciliationAlert() {
    try {
        const { firestore } = initializeFirebaseServer();
        const { collection, getDocs, query, where, limit } = await import('firebase/firestore');
        const pendingSnap = await getDocs(query(
            collection(firestore, 'orders'),
            where('status', '==', 'En Verificación'),
            limit(100)
        ));
        const { sendPendingReconciliationSummaryEmail } = await import('@/lib/email');
        const { dispatchUniversalWhatsApp } = await import('@/lib/whatsapp-universal');
        const { pendingReconciliationAlertMessage } = await import('@/lib/whatsapp-templates');

        if (pendingSnap.empty) {
            return { success: true, pendingCount: 0, message: 'Sin abonos pendientes por conciliar.' };
        }

        const pendingItems: { orderId: string; customerName: string; amount: number }[] = [];
        let totalAmountUSD = 0;

        pendingSnap.docs.forEach(docSnap => {
            const data = docSnap.data();
            let amt = 0;
            if (Array.isArray(data.payments) && data.payments.length > 0) {
                const pendingPayments = data.payments.filter((p: any) => p?.status === 'pending');
                if (pendingPayments.length > 0) {
                    amt = pendingPayments.reduce((s: number, p: any) => s + (Number(p?.amount || p?.monto || p?.amountUSD) || 0), 0);
                }
            }
            if (amt <= 0) {
                amt = Number(data.lastPaymentAmount || data.amountPaid || data.totalAmount || 0);
            }
            totalAmountUSD += amt;
            pendingItems.push({
                orderId: docSnap.id,
                customerName: data.customerName || 'Cliente',
                amount: amt
            });
        });

        const pendingCount = pendingItems.length;

        // 1. Notificaciones Internas y Push Web Nativo (sin WhatsApp duplicado)
        await createAppNotifications(firestore, {
            category: 'Facturación',
            title: `🏛️ Alerta de Conciliación: ${pendingCount} Abonos en Verificación`,
            message: `Atención Administración: Existen ${pendingCount} abonos pendientes por conciliar que suman $${totalAmountUSD.toFixed(2)} USD en caja.`,
            link: '/dashboard/treasury',
            initiatorId: 'pending_reconciliation_agent',
            roles: ['superadmin', 'admin'],
            skipWhatsApp: true
        });

        // 2. Notificación vía Email y WhatsApp único a Administradores
        const adminsSnap = await getDocs(query(
            collection(firestore, 'users'),
            where('role', 'in', ['superadmin', 'admin']),
            limit(50)
        ));

        for (const adminDoc of adminsSnap.docs) {
            const admin = adminDoc.data();
            const email = admin.email;
            const phone = admin.phone || admin.whatsappPhone;
            const name = admin.name || admin.displayName || 'Administrador';

            if (email) {
                await sendPendingReconciliationSummaryEmail({
                    toEmail: email,
                    adminName: name,
                    pendingCount: pendingCount,
                    totalAmountUSD: totalAmountUSD,
                    itemsSummary: pendingItems
                });
            }

            if (phone) {
                const wsText = pendingReconciliationAlertMessage({
                    adminName: name,
                    pendingCount,
                    totalAmountUSD,
                    items: pendingItems
                });
                await dispatchUniversalWhatsApp({
                    phone,
                    message: wsText,
                    module: 'treasury'
                });
            }
        }

        return {
            success: true,
            pendingCount: pendingCount,
            totalAmountUSD: totalAmountUSD,
            adminsNotified: adminsSnap.size
        };
    } catch (e: any) {
        console.error("[Agent Service] Pending Reconciliation Alert failed:", e.message);
        return { success: false, error: e.message };
    }
}

/**
 * MOTOR AUTÓNOMO DE AVISOS DIARIOS PERSONALIZADOS POR ROL VÍA WHATSAPP (v30.0)
 * Despacha cada mañana notificaciones a la medida para Vendedores, Gerencia, Despacho y Tesorería.
 */
export async function executeRoleBasedDailyWhatsAppBriefing(targetPhoneOverride?: string, targetRoleOverride?: string) {
    try {
        const { firestore } = initializeFirebaseServer();
        const { collection, getDocs, doc, getDoc, query, where, limit } = await import('firebase/firestore');
        const { getEffectiveCashReceived, getSalespersonKey, getSalespersonDisplayName } = await import('@/lib/billing');
        const { dispatchUniversalWhatsApp } = await import('@/lib/whatsapp-universal');
        const {
            computeOrderBalanceForWhatsApp,
            dailyBriefingSalespersonMessage,
            dailyBriefingWarehouseMessage,
            dailyBriefingAdminMessage,
            dailyBriefingExecutiveMessage,
        } = await import('@/lib/whatsapp-templates');

        // 1. Datos Generales de la Terminal
        const settingsSnap = await getDoc(doc(firestore, 'system', 'financials'));
        const bcvRate = settingsSnap.exists() ? settingsSnap.data().bcvRate || 0 : 0;

        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
        const endOfYesterday = new Date(startOfToday.getTime() - 1);

        const ordersSnap = await getDocs(query(collection(firestore, 'orders'), limit(400)));
        const productsSnap = await getDocs(query(collection(firestore, 'products'), limit(300)));

        // Métricas Globales (Gerencia / SuperAdmin)
        let totalOrdersCreatedYesterday = 0;
        let amountOrdersCreatedYesterdayUSD = 0;
        let totalOrdersDispatchedYesterday = 0;
        let amountOrdersDispatchedYesterdayUSD = 0;
        let totalPaymentsReportedYesterdayUSD = 0;
        let countPaymentsReportedYesterday = 0;

        let globalTotalMoraUSD = 0;
        let globalCountMora = 0;
        let globalPendingVerificationCount = 0;
        let globalPendingVerificationUSD = 0;

        // Métricas por Vendedor (agrupadas por salespersonId con respaldo por nombre)
        const salespersonMetrics: Record<string, {
            id: string;
            name: string;
            pendingReceivablesUSD: number;
            moraUSD: number;
            moraCount: number;
            dueSoonUSD: number;
            dueSoonCount: number;
            inPreparationCount: number;
            deliveredYesterdayUSD: number;
            deliveredYesterdayCount: number;
            lastOrderDateMap: Record<string, { customerName: string; lastDate: Date }>;
        }> = {};

        // Métricas de Despacho
        let dispatchPendingCount = 0;
        let dispatchReadyToShipCount = 0;
        let dispatchMissingTrackingCount = 0;

        // Evaluar Productos Críticos (<= 30 unidades)
        const lowStockProducts: { name: string; stock: number }[] = [];
        productsSnap.docs.forEach(pDoc => {
            const p = pDoc.data();
            const stock = Number(p.stockLevel || 0);
            if (stock > 0 && stock <= 30) {
                lowStockProducts.push({ name: p.name || 'Producto', stock });
            }
        });

        // Iterar Pedidos para Cálculos
        ordersSnap.docs.forEach(d => {
            const o = d.data();
            if (o.status === 'Cancelado' || o.status === 'Rechazado' || o.status === 'Borrador') return;

            const total = Number(o.totalAmount || 0);
            const paid = getEffectiveCashReceived(o as any);
            const bal = computeOrderBalanceForWhatsApp(o);
            const pending = bal.isBillable ? bal.pendingListUSD : 0;

            const createdAt = o.createdAt?.toDate ? o.createdAt.toDate() : (o.orderDate?.toDate ? o.orderDate.toDate() : null);
            const receptionAt = o.receptionDate?.toDate ? o.receptionDate.toDate() : null;

            // Pedidos creados ayer
            if (createdAt && createdAt >= startOfYesterday && createdAt <= endOfYesterday) {
                totalOrdersCreatedYesterday += 1;
                amountOrdersCreatedYesterdayUSD += total;
            }

            // Pedidos despachados ayer
            if ((o.status === 'Despachado' || o.status === 'Entregado') && receptionAt && receptionAt >= startOfYesterday && receptionAt <= endOfYesterday) {
                totalOrdersDispatchedYesterday += 1;
                amountOrdersDispatchedYesterdayUSD += total;
            }

            // Pagos reportados ayer
            if (paid > 0 && o.updatedAt?.toDate) {
                const uDate = o.updatedAt.toDate();
                if (uDate >= startOfYesterday && uDate <= endOfYesterday) {
                    countPaymentsReportedYesterday += 1;
                    totalPaymentsReportedYesterdayUSD += paid;
                }
            }

            // Globales de verificación y mora
            if (o.status === 'En Verificación') {
                globalPendingVerificationCount += 1;
                const verifyingAmt = Number(o.lastPaymentAmount || o.amountPaid || bal.pendingListUSD || o.totalAmount || 0);
                globalPendingVerificationUSD += verifyingAmt;
            }

            if (pending > 0.50) {
                const refDate = receptionAt || createdAt;
                const dueDate = o.dueDate ? new Date(o.dueDate) : (refDate ? new Date(refDate.getTime() + 30 * 86_400_000) : null);
                if (dueDate && dueDate < now) {
                    globalCountMora += 1;
                    globalTotalMoraUSD += pending;
                }
            }

            // Mapeo por Vendedor usando getSalespersonKey (salespersonId primero)
            const spKey = getSalespersonKey(o as any);
            const sName = getSalespersonDisplayName(o as any);
            if (!salespersonMetrics[spKey]) {
                salespersonMetrics[spKey] = {
                    id: String(o.salespersonId || ''),
                    name: sName,
                    pendingReceivablesUSD: 0,
                    moraUSD: 0,
                    moraCount: 0,
                    dueSoonUSD: 0,
                    dueSoonCount: 0,
                    inPreparationCount: 0,
                    deliveredYesterdayUSD: 0,
                    deliveredYesterdayCount: 0,
                    lastOrderDateMap: {}
                };
            }

            const sp = salespersonMetrics[spKey];

            if (pending > 0.50) {
                sp.pendingReceivablesUSD += pending;
                const refDate = receptionAt || createdAt;
                const dueDate = o.dueDate ? new Date(o.dueDate) : (refDate ? new Date(refDate.getTime() + 30 * 86_400_000) : null);
                if (dueDate) {
                    const diffDays = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 3600 * 24));
                    if (diffDays < 0) {
                        sp.moraCount += 1;
                        sp.moraUSD += pending;
                    } else if (diffDays <= 3) {
                        sp.dueSoonCount += 1;
                        sp.dueSoonUSD += pending;
                    }
                }
            }

            if (o.status === 'Aprobado' || o.status === 'En Preparación') {
                sp.inPreparationCount += 1;
                dispatchPendingCount += 1;
            }

            if (o.status === 'Completado') {
                dispatchReadyToShipCount += 1;
            }

            if (o.status === 'Despachado' && !o.trackingNumber) {
                dispatchMissingTrackingCount += 1;
            }

            if ((o.status === 'Entregado' || o.status === 'Completado') && receptionAt && receptionAt >= startOfYesterday && receptionAt <= endOfYesterday) {
                sp.deliveredYesterdayCount += 1;
                sp.deliveredYesterdayUSD += total;
            }

            // Rastreo de última compra por cliente
            const cName = (o.customerName || 'Cliente').trim();
            if (createdAt) {
                if (!sp.lastOrderDateMap[cName] || createdAt > sp.lastOrderDateMap[cName].lastDate) {
                    sp.lastOrderDateMap[cName] = { customerName: cName, lastDate: createdAt };
                }
            }
        });

        // 2. Obtener SOLO personal interno con teléfono configurado (NUNCA clientes)
        const STAFF_ROLES = ['superadmin', 'admin', 'gerencia', 'ventas', 'deposito'];
        const usersSnap = await getDocs(query(collection(firestore, 'users'), limit(150)));
        let usersToNotify: { id: string; name: string; phone: string; role: string; receiveBriefing: boolean }[] = [];

        usersSnap.docs.forEach(uDoc => {
            const u = uDoc.data();
            const roleLower = String(u.role || '').toLowerCase();
            if (!STAFF_ROLES.includes(roleLower)) return;

            const ph = u.phone || u.whatsappPhone || u.phoneNumber;
            if (ph) {
                const isSuper = roleLower === 'superadmin';
                const isEnabled = u.receiveDailyBriefing !== false;
                if (isSuper || isEnabled) {
                    usersToNotify.push({
                        id: uDoc.id,
                        name: u.name || u.displayName || 'Equipo',
                        phone: ph,
                        role: targetRoleOverride || roleLower,
                        receiveBriefing: isEnabled
                    });
                }
            }
        });

        if (targetPhoneOverride) {
            usersToNotify = [{
                id: 'test_override',
                name: 'Usuario de Prueba',
                phone: targetPhoneOverride,
                role: targetRoleOverride || 'superadmin',
                receiveBriefing: true
            }];
        }

        if (usersToNotify.length === 0) {
            return {
                success: true,
                sentCount: 0,
                rolesBreakdown: {},
                message: 'Sin personal interno con teléfono configurado.'
            };
        }

        const todayStr = new Date().toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'short' });
        let sentCount = 0;
        const rolesBreakdown: Record<string, number> = {};

        // 3. Despachar Plantillas de WhatsApp Personalizadas por Rol
        for (const recipient of usersToNotify) {
            let messageText = '';
            const roleKey = (recipient.role || '').toLowerCase();

            // A. PLANTILLA VENDEDORES
            if (roleKey === 'ventas' || roleKey === 'vendedor') {
                const spData =
                    salespersonMetrics[recipient.id] ||
                    Object.values(salespersonMetrics).find(m =>
                        m.name.toLowerCase().includes(recipient.name.toLowerCase()) ||
                        recipient.name.toLowerCase().includes(m.name.toLowerCase())
                    ) || {
                        id: recipient.id,
                        name: recipient.name,
                        pendingReceivablesUSD: 0,
                        moraUSD: 0,
                        moraCount: 0,
                        dueSoonUSD: 0,
                        dueSoonCount: 0,
                        inPreparationCount: 0,
                        deliveredYesterdayUSD: 0,
                        deliveredYesterdayCount: 0,
                        lastOrderDateMap: {}
                    };

                // Encontrar clientes sin pedir hace +10 días
                const inactiveClients: string[] = [];
                const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
                Object.values(spData.lastOrderDateMap).forEach(c => {
                    if (c.lastDate < tenDaysAgo) {
                        inactiveClients.push(c.customerName);
                    }
                });

                messageText = dailyBriefingSalespersonMessage({
                    name: recipient.name,
                    dateLabel: todayStr,
                    pendingReceivablesUSD: spData.pendingReceivablesUSD,
                    dueSoonCount: spData.dueSoonCount,
                    dueSoonUSD: spData.dueSoonUSD,
                    moraCount: spData.moraCount,
                    moraUSD: spData.moraUSD,
                    inPreparationCount: spData.inPreparationCount,
                    deliveredYesterdayCount: spData.deliveredYesterdayCount,
                    deliveredYesterdayUSD: spData.deliveredYesterdayUSD,
                    inactiveClients,
                });

            // B. PLANTILLA DEPÓSITO / DESPACHO
            } else if (roleKey === 'deposito' || roleKey === 'despacho' || roleKey === 'almacen' || roleKey === 'logistica') {
                messageText = dailyBriefingWarehouseMessage({
                    name: recipient.name,
                    dateLabel: todayStr,
                    toPrepareCount: dispatchPendingCount,
                    readyToShipCount: dispatchReadyToShipCount,
                    missingTrackingCount: dispatchMissingTrackingCount,
                    dispatchedYesterdayCount: totalOrdersDispatchedYesterday,
                });

            // C. PLANTILLA ADMINISTRACIÓN / TESORERÍA
            } else if (roleKey === 'admin' || roleKey === 'tesoreria' || roleKey === 'administracion') {
                messageText = dailyBriefingAdminMessage({
                    name: recipient.name,
                    dateLabel: todayStr,
                    bcvRate,
                    pendingVerificationCount: globalPendingVerificationCount,
                    pendingVerificationUSD: globalPendingVerificationUSD,
                    paymentsYesterdayCount: countPaymentsReportedYesterday,
                    paymentsYesterdayUSD: totalPaymentsReportedYesterdayUSD,
                    moraUSD: globalTotalMoraUSD,
                    moraCount: globalCountMora,
                });

            // D. PLANTILLA SUPERADMIN / GERENCIA
            } else {
                messageText = dailyBriefingExecutiveMessage({
                    name: recipient.name,
                    dateLabel: todayStr,
                    bcvRate,
                    ordersYesterdayCount: totalOrdersCreatedYesterday,
                    ordersYesterdayUSD: amountOrdersCreatedYesterdayUSD,
                    dispatchedYesterdayCount: totalOrdersDispatchedYesterday,
                    dispatchedYesterdayUSD: amountOrdersDispatchedYesterdayUSD,
                    paymentsYesterdayCount: countPaymentsReportedYesterday,
                    paymentsYesterdayUSD: totalPaymentsReportedYesterdayUSD,
                    pendingVerificationCount: globalPendingVerificationCount,
                    pendingVerificationUSD: globalPendingVerificationUSD,
                    moraCount: globalCountMora,
                    moraUSD: globalTotalMoraUSD,
                    lowStockCount: lowStockProducts.length,
                    firstLowStockProduct: lowStockProducts[0],
                });
            }

            const res = await dispatchUniversalWhatsApp({
                phone: recipient.phone,
                message: messageText,
                module: 'billing'
            });

            if (res.success) {
                sentCount++;
                rolesBreakdown[recipient.role] = (rolesBreakdown[recipient.role] || 0) + 1;
            }
        }

        await createAppNotifications(firestore, {
            category: 'Facturación',
            title: `🤖 Motor de Avisos por Rol Ejecutado`,
            message: `Se despacharon los informes de WhatsApp personalizados a ${sentCount} usuarios según su rol.`,
            link: '/dashboard',
            initiatorId: 'role_based_daily_briefing_agent',
            roles: ['superadmin', 'admin'],
            skipWhatsApp: true
        });

        return {
            success: true,
            recipientsCount: usersToNotify.length,
            sentCount,
            rolesBreakdown,
            recipients: usersToNotify.map(u => ({ name: u.name, phone: u.phone, role: u.role }))
        };
    } catch (e: any) {
        console.error("[Agent Service] Role-Based Daily WhatsApp Briefing failed:", e.message);
        return { success: false, error: e.message };
    }
}

export async function executeDailyPricingAudit() {
    try {
        const { firestore } = initializeFirebaseServer();
        const { collection, getDocs, query, limit } = await import('firebase/firestore');
        const ordersRef = collection(firestore, 'orders');
        const snap = await getDocs(query(ordersRef, limit(300)));

        let unshieldedCount = 0;

        for (const docSnap of snap.docs) {
            const data = docSnap.data();
            const total = Number(data.totalAmount || 0);
            const isNet = data.isNetPrice === true || data.incentivesApplied === true;
            const hasFractionalDecimals = (total % 1 !== 0) && (total.toString().split('.')[1]?.length > 2);

            if (!isNet && hasFractionalDecimals) {
                unshieldedCount++;
            }
        }

        return { success: true, totalAudited: snap.size, unshieldedCount };
    } catch (e: any) {
        console.error("[Agent Service] Daily Pricing Audit failed:", e.message);
        return { success: false, error: e.message };
    }
}




/**
 * BOT DE TESORERÍA: COBRANZA AUTOMÁTICA
 * Escanea órdenes impagas y envía UN solo recordatorio por cliente (con todas sus facturas),
 * con tono según antigüedad y un mínimo de 7 días entre avisos.
 */
export async function executeAutomatedDebtCollection(opts: { dryRun?: boolean; testPhone?: string } = {}) {
  const MIN_DAYS_BETWEEN_REMINDERS = 7; // Anti-fatiga: máximo un aviso por cliente cada 7 días
  const MIN_INVOICE_AGE_DAYS = 7;       // Solo facturas con 7+ días
  const dryRun = opts.dryRun === true;
  try {
    const { firestore } = initializeFirebaseServer();
    // Las reglas de Firestore exigen request.auth != null para leer órdenes
    const { ensureServerAuth } = await import('@/firebase/server-init');
    await ensureServerAuth();
    const { collection, getDocs, query, where, doc, getDoc, updateDoc, serverTimestamp } = await import('firebase/firestore');
    const { dispatchUniversalWhatsApp } = await import('@/lib/whatsapp-universal');
    const { debtReminderMessage, debtToneForAge, computeOrderBalanceForWhatsApp, BILLABLE_ORDER_STATUSES } = await import('@/lib/whatsapp-templates');

    const ordersSnap = await getDocs(query(collection(firestore, 'orders'), where('status', 'in', [...BILLABLE_ORDER_STATUSES])));
    const now = new Date();
    const toDate = (v: any): Date | null => {
      if (!v) return null;
      if (typeof v.toDate === 'function') return v.toDate();
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    };

    // 1) Agrupar las facturas pendientes por cliente (UN solo mensaje por cliente)
    type Group = { customerId: string; customerName: string; phone: string; invoices: { id: string; pending: number; days: number }[] };
    const groups = new Map<string, Group>();
    for (const d of ordersSnap.docs) {
      const o: any = d.data();
      const bal = computeOrderBalanceForWhatsApp(o);
      if (!bal.isBillable || bal.pendingListUSD <= 0.50) continue;
      const refDate = toDate(o.receptionDate) || toDate(o.approvalDate) || toDate(o.createdAt) || toDate(o.orderDate);
      if (!refDate) continue;
      const days = Math.floor((now.getTime() - refDate.getTime()) / 86_400_000);
      if (days < MIN_INVOICE_AGE_DAYS) continue;
      const key = String(o.customerId || o.customerPhone || o.customerName || d.id);
      const g: Group = groups.get(key) || { customerId: String(o.customerId || ''), customerName: o.customerName || 'Cliente', phone: o.customerPhone || '', invoices: [] };
      if (!g.phone && o.customerPhone) g.phone = o.customerPhone;
      g.invoices.push({ id: d.id, pending: bal.pendingListUSD, days });
      groups.set(key, g);
    }

    let sentCount = 0;
    const preview: { customer: string; invoices: number; tone: string; skipped?: string }[] = [];

    for (const g of groups.values()) {
      const oldest = g.invoices.reduce((m, i) => Math.max(m, i.days), 0);
      const tone = debtToneForAge(oldest);
      if (!g.phone && !opts.testPhone) { preview.push({ customer: g.customerName, invoices: g.invoices.length, tone, skipped: 'sin teléfono' }); continue; }

      // 2) Memoria anti-fatiga por cliente
      if (g.customerId) {
        try {
          const cs = await getDoc(doc(firestore, 'customers', g.customerId));
          const last = toDate(cs.exists() ? (cs.data() as any).lastDebtReminderAt : null);
          if (last && Math.floor((now.getTime() - last.getTime()) / 86_400_000) < MIN_DAYS_BETWEEN_REMINDERS) {
            preview.push({ customer: g.customerName, invoices: g.invoices.length, tone, skipped: 'avisado hace menos de 7 días' });
            continue;
          }
        } catch { /* si no se puede leer, seguimos */ }
      }

      const message = debtReminderMessage({ customerName: g.customerName, invoices: g.invoices, tone });
      preview.push({ customer: g.customerName, invoices: g.invoices.length, tone });
      if (dryRun) continue;

      const res = await dispatchUniversalWhatsApp({ phone: opts.testPhone || g.phone, message, module: 'treasury' });
      if (res?.success) {
        sentCount++;
        if (g.customerId && !opts.testPhone) {
          try { await updateDoc(doc(firestore, 'customers', g.customerId), { lastDebtReminderAt: serverTimestamp(), lastDebtReminderTone: tone }); } catch { /* no bloquea */ }
        }
      }
    }
    console.log('[Debt Agent] Cobranza automática finalizada (' + (dryRun ? 'SIMULACIÓN' : 'EN VIVO') + '). Clientes con deuda: ' + groups.size + ', avisos enviados: ' + sentCount);
    return dryRun ? { dryRun: true, customers: groups.size, preview } : sentCount;
  } catch (e) {
    console.error('[Debt Agent] Fallo en la cobranza automática:', e);
    return 0;
  }
}
