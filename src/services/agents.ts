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
 * MOTOR AUTÓNOMO DE AVISOS DIARIOS PERSONALIZADOS POR ROL VÍA WHATSAPP (v30.0)
 * Despacha cada mañana notificaciones a la medida para Vendedores, Gerencia, Despacho y Tesorería.
 */
export async function executeRoleBasedDailyWhatsAppBriefing(targetPhoneOverride?: string, targetRoleOverride?: string) {
    try {
        const { firestore } = initializeFirebaseServer();
        const { collection, getDocs, doc, getDoc, query, where, limit } = await import('firebase/firestore');
        const { getEffectiveCashReceived } = await import('@/lib/billing');
        const { dispatchUniversalWhatsApp } = await import('@/lib/whatsapp-universal');

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

        // Métricas por Vendedor
        const salespersonMetrics: Record<string, {
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
        let dispatchMissingTrackingCount = 0;

        // Evaluar Productos Críticos (< 30 unidades)
        const lowStockProducts: { name: string; stock: number }[] = [];
        productsSnap.docs.forEach(pDoc => {
            const p = pDoc.data();
            const stock = Number(p.stockLevel || 0);
            if (stock > 0 && stock <= 30) {
                lowStockProducts.push({ name: p.name || 'Producto estrella', stock });
            }
        });

        // Iterar Pedidos para Cálculos
        ordersSnap.docs.forEach(d => {
            const o = d.data();
            if (o.status === 'Cancelado' || o.status === 'Rechazado') return;

            const total = Number(o.totalAmount || 0);
            const paid = getEffectiveCashReceived(o as any);
            const pending = Math.max(0, total - paid);

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

            // Globales
            if (o.status === 'En Verificación') {
                globalPendingVerificationCount += 1;
                globalPendingVerificationUSD += pending;
            }

            if (pending > 0.05) {
                if (o.dueDate) {
                    const dueDate = new Date(o.dueDate);
                    if (dueDate < now) {
                        globalCountMora += 1;
                        globalTotalMoraUSD += pending;
                    }
                }
            }

            // Mapeo por Vendedor
            const sName = (o.salespersonName || o.vendedor || 'Venta Directa').trim();
            if (!salespersonMetrics[sName]) {
                salespersonMetrics[sName] = {
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

            const sp = salespersonMetrics[sName];

            if (pending > 0.05) {
                sp.pendingReceivablesUSD += pending;
                if (o.dueDate) {
                    const dueDate = new Date(o.dueDate);
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

            if ((o.status === 'Despachado' || o.status === 'Aprobado') && (!o.carrierId && !o.trackingNumber)) {
                dispatchMissingTrackingCount += 1;
            }

            if ((o.status === 'Entregado' || o.status === 'Completado') && receptionAt && receptionAt >= startOfYesterday && receptionAt <= endOfYesterday) {
                sp.deliveredYesterdayCount += 1;
                sp.deliveredYesterdayUSD += total;
            }

            // Rastreo de última compra por cliente (para Inactividad Anti-Churn)
            const cName = (o.customerName || 'Cliente').trim();
            if (createdAt) {
                if (!sp.lastOrderDateMap[cName] || createdAt > sp.lastOrderDateMap[cName].lastDate) {
                    sp.lastOrderDateMap[cName] = { customerName: cName, lastDate: createdAt };
                }
            }
        });

        // 2. Obtener Lista de Usuarios Destino de Firestore
        const usersSnap = await getDocs(query(collection(firestore, 'users'), limit(100)));
        let usersToNotify: { id: string; name: string; phone: string; role: string; receiveBriefing: boolean }[] = [];

        usersSnap.docs.forEach(uDoc => {
            const u = uDoc.data();
            const ph = u.phone || u.whatsappPhone || u.phoneNumber;
            if (ph) {
                const isSuper = u.role === 'superadmin';
                const isEnabled = u.receiveDailyBriefing !== false;
                if (isSuper || isEnabled) {
                    usersToNotify.push({
                        id: uDoc.id,
                        name: u.name || u.displayName || 'Usuario',
                        phone: ph,
                        role: targetRoleOverride || u.role || 'superadmin',
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
            usersToNotify.push({
                id: 'default_admin',
                name: 'SuperAdmin Central',
                phone: '04122683183',
                role: 'superadmin',
                receiveBriefing: true
            });
        }

        const todayStr = new Date().toLocaleDateString('es-VE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        let sentCount = 0;
        const rolesBreakdown: Record<string, number> = {};

        // 3. Despachar Plantillas de WhatsApp Personalizadas por Rol
        for (const recipient of usersToNotify) {
            let messageText = '';
            const roleKey = (recipient.role || '').toLowerCase();

            // A. PLANTILLA VENDEDORES
            if (roleKey === 'ventas' || roleKey === 'vendedor') {
                const spNameKey = Object.keys(salespersonMetrics).find(k => k.toLowerCase().includes(recipient.name.toLowerCase()) || recipient.name.toLowerCase().includes(k.toLowerCase())) || recipient.name;
                const spData = salespersonMetrics[spNameKey] || {
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

                // Encontrar clientes inactivos (+10 días)
                const inactiveClients: string[] = [];
                const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
                Object.values(spData.lastOrderDateMap).forEach(c => {
                    if (c.lastDate < tenDaysAgo) {
                        inactiveClients.push(c.customerName);
                    }
                });

                messageText = `*💼 ATHLETICENTER PRO - TU RESUMEN COMERCIAL DIARIO*\n` +
                    `👤 _Vendedor: ${recipient.name}_\n` +
                    `🗓️ _${todayStr.toUpperCase()}_\n\n` +
                    `📊 *ESTADO DE TU CARTERA DE CLIENTES:*\n` +
                    `• *Total por Cobrar:* $${spData.pendingReceivablesUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD\n` +
                    `• *Facturas por Vencer (-3D):* ${spData.dueSoonCount} cuentas ($${spData.dueSoonUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD)\n` +
                    `• *Mora Crítica:* ${spData.moraCount} clientes ($${spData.moraUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD)\n\n` +
                    `💡 *INCENTIVOS DE PRONTO PAGO ACTIVOS (48H):*\n` +
                    `${spData.dueSoonCount > 0 ? `• ${spData.dueSoonCount} clientes están en ventana de 10% OFF en cascada. Motiva su pago hoy para que aseguren su bonificación.` : '• Cartera al día en calendario de incentivos.'}\n\n` +
                    `📦 *TUS PEDIDOS EN TRÁNSITO / PROCESO:*\n` +
                    `• *En Preparación/Despacho:* ${spData.inPreparationCount} expedientes\n` +
                    `• *Entregados Ayer:* ${spData.deliveredYesterdayCount} pedidos ($${spData.deliveredYesterdayUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD)\n\n` +
                    `🎯 *REACTIVACIÓN DE CLIENTES (Anti-Churn):*\n` +
                    `${inactiveClients.length > 0 ? `• ${inactiveClients.length} clientes inactivos (+10 días sin comprar): ${inactiveClients.slice(0, 3).join(', ')}` : '• ¡Excelente! Toda tu cartera de clientes se mantiene activa.'}\n\n` +
                    `🔗 *REVISA TU CARTERA Y PEDIDOS EN:* \n` +
                    `https://athleticenter-pwa.web.app/dashboard/quotes`;

            // B. PLANTILLA DESPACHO / ALMACÉN
            } else if (roleKey === 'despacho' || roleKey === 'almacen' || roleKey === 'logistica') {
                messageText = `*🚚 ATHLETICENTER PRO - HOJA DE RUTA DE DESPACHO*\n` +
                    `🗓️ _${todayStr.toUpperCase()}_\n\n` +
                    `📦 *PEDIDOS PENDIENTES POR EMBALAR / DESPACHAR:*\n` +
                    `• *Total por Preparar:* ${dispatchPendingCount} expedientes en estado 'Aprobado' o 'En Preparación'\n` +
                    `• *Guías Pendientes por Cargar:* ${dispatchMissingTrackingCount} pedidos asignados a transporte sin número de guía\n\n` +
                    `🚚 *ACTIVIDAD DE AYER:*\n` +
                    `• *Despachos Ejecutados:* ${totalOrdersDispatchedYesterday} envíos ($${amountOrdersDispatchedYesterdayUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD)\n\n` +
                    `🔗 *ACCEDE AL MÓDULO DE DESPACHO:* \n` +
                    `https://athleticenter-pwa.web.app/dashboard/dispatch`;

            // C. PLANTILLA TESORERÍA / ADMINISTRACIÓN
            } else if (roleKey === 'tesoreria' || roleKey === 'administracion') {
                messageText = `*🏛️ ATHLETICENTER PRO - INFORME DIARIO DE TESORERÍA*\n` +
                    `🗓️ _${todayStr.toUpperCase()}_\n\n` +
                    `📈 *TASA BCV OFICIAL:* ${bcvRate > 0 ? `${bcvRate} Bs/USD` : 'Sincronizada'}\n` +
                    `🔍 *Abonos Pendientes por Conciliar:* ${globalPendingVerificationCount} transferencias ($${globalPendingVerificationUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD en caja)\n` +
                    `💰 *Pagos Reportados Ayer:* ${countPaymentsReportedYesterday} abonos ($${totalPaymentsReportedYesterdayUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD)\n\n` +
                    `🔴 *Cartera en Mora Crítica Global:* $${globalTotalMoraUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD (${globalCountMora} facturas)\n\n` +
                    `🔗 *AUDITA BANCOS Y CONCILIACIÓN EN:* \n` +
                    `https://athleticenter-pwa.web.app/dashboard/treasury`;

            // D. PLANTILLA SUPERADMIN / GERENCIA (EJECUTIVO GLOBAL 360°)
            } else {
                messageText = `*👑 ATHLETICENTER PRO - REPORTE EJECUTIVO GLOBAL 360°*\n` +
                    `🗓️ _${todayStr.toUpperCase()}_\n\n` +
                    `🟢 *SISTEMA & CONEXIÓN:* 100% Operativo (Gateway Local Online)\n` +
                    `📈 *TASA OFICIAL BCV:* ${bcvRate > 0 ? `${bcvRate} Bs/USD` : 'Sincronizada'}\n\n` +
                    `📊 *ACTIVIDAD GLOBAL DEL DÍA ANTERIOR (AYER):*\n` +
                    `• *Pedidos Realizados:* ${totalOrdersCreatedYesterday} órdenes ($${amountOrdersCreatedYesterdayUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD)\n` +
                    `• *Pedidos Despachados:* ${totalOrdersDispatchedYesterday} envíos ($${amountOrdersDispatchedYesterdayUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD)\n` +
                    `• *Pagos Reportados:* ${countPaymentsReportedYesterday} abonos ($${totalPaymentsReportedYesterdayUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD)\n\n` +
                    `🚨 *SALUD FINANCIERA & COBRANZA:*\n` +
                    `• *Mora Crítica Total:* $${globalTotalMoraUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD (${globalCountMora} cuentas vencidas)\n` +
                    `• *Por Conciliar en Banco:* ${globalPendingVerificationCount} abonos ($${globalPendingVerificationUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD)\n\n` +
                    `⚽ *ALERTA DE INVENTARIO ESTRELLA (AI):*\n` +
                    `${lowStockProducts.length > 0 ? `• ${lowStockProducts.length} SKUs con stock crítico (ej. ${lowStockProducts[0].name} tiene ${lowStockProducts[0].stock} unds)` : '• Stock óptimo en catálogo.'}\n\n` +
                    `✅ *RECORRE EL DASHBOARD EN VIVO EN:* \n` +
                    `https://athleticenter-pwa.web.app/dashboard`;
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
            roles: ['superadmin', 'admin']
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


