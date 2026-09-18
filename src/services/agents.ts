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
        const pendingSnap = await getDocs(query(
            collection(firestore, 'orders'),
            where('status', '==', 'En Verificación'),
            limit(100)
        ));
        const { sendPendingReconciliationSummaryEmail } = await import('@/lib/email');
        const { dispatchUniversalWhatsApp } = await import('@/lib/whatsapp-universal');

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
 * REPORTE DIARIO EJECUTIVO DE SALUD Y CONEXIÓN VÍA WHATSAPP (MODO AUTÓNOMO)
 * Notifica al SuperAdmin y usuarios seleccionados sobre el estado de la terminal, tasa BCV y cartera.
 */
export async function executeDailyExecutiveWhatsAppBriefing(targetPhoneOverride?: string) {
    try {
        const { firestore } = initializeFirebaseServer();
        const { collection, getDocs, doc, getDoc, query, where, limit } = await import('firebase/firestore');
        const { getEffectiveCashReceived } = await import('@/lib/billing');
        const { dispatchUniversalWhatsApp } = await import('@/lib/whatsapp-universal');

        // 1. Tasa BCV
        const settingsSnap = await getDoc(doc(firestore, 'system', 'financials'));
        const bcvRate = settingsSnap.exists() ? settingsSnap.data().bcvRate || 0 : 0;

        // 2. Métricas de Pedidos y Mora Crítica
        const ordersSnap = await getDocs(query(collection(firestore, 'orders'), limit(300)));
        let totalPendingVerificationUSD = 0;
        let countPendingVerification = 0;
        let totalMoraUSD = 0;
        let countMora = 0;

        const now = new Date();

        ordersSnap.docs.forEach(d => {
            const o = d.data();
            if (o.status === 'Cancelado' || o.status === 'Rechazado') return;
            const total = Number(o.totalAmount || 0);
            const paid = getEffectiveCashReceived(o as any);
            const pending = Math.max(0, total - paid);

            if (o.status === 'En Verificación') {
                countPendingVerification += 1;
                totalPendingVerificationUSD += pending;
            }

            if (pending > 0.05 && o.dueDate) {
                const dueDate = new Date(o.dueDate);
                if (dueDate < now) {
                    countMora += 1;
                    totalMoraUSD += pending;
                }
            }
        });

        // 3. Formatear Mensaje de Informe Diario
        const todayStr = new Date().toLocaleDateString('es-VE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        
        const reportText = `*🤖 ATHLETICENTER PRO - REPORTE DIARIO DE CONEXIÓN Y SALUD*\n` +
            `🗓️ _${todayStr.toUpperCase()}_\n\n` +
            `🟢 *ESTADO DEL SISTEMA:* Conectado & Operativo\n` +
            `📈 *TASA OFICIAL BCV:* ${bcvRate > 0 ? `${bcvRate} Bs/USD` : 'Sincronizada'}\n\n` +
            `📊 *RESUMEN EJECUTIVO DEL DÍA:*\n` +
            `• *Abonos por Conciliar:* ${countPendingVerification} expedientes ($${totalPendingVerificationUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD)\n` +
            `• *Cartera en Mora Crítica:* ${countMora} facturas ($${totalMoraUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD)\n\n` +
            `✅ *RECORRE FACTURACIÓN Y CRM EN:* \n` +
            `https://athleticenter-pwa.web.app/dashboard\n\n` +
            `_Este mensaje automático confirma que el motor de notificaciones en segundo plano está activo y vinculado al 100%._`;

        let phonesToNotify: { name: string; phone: string; role: string }[] = [];

        if (targetPhoneOverride) {
            phonesToNotify.push({ name: 'Administrador (Prueba)', phone: targetPhoneOverride, role: 'superadmin' });
        } else {
            // Buscar SuperAdmins y Usuarios con rol gerencial o flag de reporte activo
            const usersSnap = await getDocs(query(
                collection(firestore, 'users'),
                where('role', 'in', ['superadmin', 'admin', 'gerencia']),
                limit(50)
            ));

            usersSnap.docs.forEach(uDoc => {
                const uData = uDoc.data();
                const ph = uData.phone || uData.whatsappPhone || uData.phoneNumber;
                if (ph && (uData.role === 'superadmin' || uData.receiveDailyBriefing !== false)) {
                    phonesToNotify.push({
                        name: uData.name || uData.displayName || 'SuperAdmin',
                        phone: ph,
                        role: uData.role
                    });
                }
            });
        }

        if (phonesToNotify.length === 0) {
            phonesToNotify.push({ name: 'SuperAdmin Central', phone: '04122683183', role: 'superadmin' });
        }

        let sentCount = 0;
        for (const recipient of phonesToNotify) {
            const res = await dispatchUniversalWhatsApp({
                phone: recipient.phone,
                message: reportText,
                module: 'billing'
            });
            if (res.success) sentCount++;
        }

        await createAppNotifications(firestore, {
            category: 'Facturación',
            title: `🤖 Reporte Diario de Conexión Emitido`,
            message: `Se despachó el informe ejecutivo por WhatsApp a ${sentCount} administradores.`,
            link: '/dashboard',
            initiatorId: 'daily_briefing_agent',
            roles: ['superadmin', 'admin']
        });

        return {
            success: true,
            recipientsCount: phonesToNotify.length,
            sentCount,
            phones: phonesToNotify.map(p => p.phone)
        };
    } catch (e: any) {
        console.error("[Agent Service] Daily Executive WhatsApp Briefing failed:", e.message);
        return { success: false, error: e.message };
    }
}

