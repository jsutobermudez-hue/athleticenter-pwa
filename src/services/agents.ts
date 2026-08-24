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
            const pdfUrl = `/api/reports/salesperson-receivables-pdf?salespersonId=${encodeURIComponent(sp.id)}&salespersonName=${encodeURIComponent(sp.name)}`;
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
        const { sendPendingReconciliationSummaryEmail } = await import('@/lib/email');
        const { sendWhatsAppMessage } = await import('@/lib/whatsapp');

        const pendingSnap = await getDocs(query(
            collection(firestore, 'orders'),
            where('status', '==', 'En Verificación'),
            limit(100)
        ));

        if (pendingSnap.empty) {
            return { success: true, pendingCount: 0, message: 'Sin abonos pendientes por conciliar.' };
        }

        const pendingItems: { orderId: string; customerName: string; amount: number }[] = [];
        let totalAmountUSD = 0;

        pendingSnap.docs.forEach(docSnap => {
            const data = docSnap.data();
            const amt = Number(data.amountPaid || data.totalCashReceived || data.totalAmount || 0);
            totalAmountUSD += amt;
            pendingItems.push({
                orderId: docSnap.id,
                customerName: data.customerName || 'Cliente',
                amount: amt
            });
        });

        const pendingCount = pendingItems.length;

        // 1. Notificaciones Internas y Push Web Nativo
        await createAppNotifications(firestore, {
            category: 'Facturación',
            title: `🏛️ Alerta de Conciliación: ${pendingCount} Abonos en Verificación`,
            message: `Atención Administración: Existen ${pendingCount} abonos pendientes por conciliar que suman $${totalAmountUSD.toFixed(2)} USD en caja.`,
            link: '/dashboard/treasury',
            initiatorId: 'pending_reconciliation_agent',
            roles: ['superadmin', 'admin']
        });

        // 2. Notificación vía Email y WhatsApp a Administradores
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
                const wsText = `*🏛️ ALERTA DE CONCILIACIÓN BANCARIA - ATHLETICENTER PRO*\n\n` +
                    `Estimado(a) *${name}*,\n\n` +
                    `Le informamos que existen *${pendingCount} abonos pendientes por conciliar* en el sistema por un monto total de *$${totalAmountUSD.toFixed(2)} USD*.\n\n` +
                    `Por favor ingrese al módulo de Tesorería para auditar los asientos bancarios:\n` +
                    `https://athleticenter-pwa.web.app/dashboard/treasury`;
                await sendWhatsAppMessage(phone, wsText);
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

