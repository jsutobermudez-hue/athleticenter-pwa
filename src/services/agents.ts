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
