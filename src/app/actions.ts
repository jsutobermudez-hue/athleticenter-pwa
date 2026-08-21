'use server';

import { sendPasswordResetEmail } from 'firebase/auth';
import { initializeFirebaseServer, ensureServerAuth } from '@/firebase/server-init';
import { aiAnalystFlow } from '@/ai/flows/ai-analyst-flow';
import { generateWhatsAppReminder } from '@/ai/flows/whatsapp-credit-reminder';
import { generateWhatsAppStatusUpdate } from '@/ai/flows/whatsapp-status-update';
import { executeBcvRateSync } from '@/services/agents';
import { sendPushNotification } from '@/lib/web-push-server';


import { 
    collection, 
    getDocs, 
    getDoc, 
    doc, 
    setDoc, 
    writeBatch, 
    query, 
    where, 
    limit, 
    orderBy, 
    serverTimestamp 
} from 'firebase/firestore';
import { calculatePricingTier } from '@/lib/pricing';
import { logActivity } from '@/lib/audit';
import type { PriceBackupItem, PricingStrategy, Product } from '@/lib/definitions';

/**
 * ACCIONES DEL SERVIDOR v13.1 - BLINDAJE DE PRODUCCIÓN
 * Saneado: Se aseguran todas las exportaciones críticas para evitar fallos de compilación.
 */

export async function handlePasswordReset(email: string) {
    try {
        const { auth } = initializeFirebaseServer();
        await sendPasswordResetEmail(auth, email);
        return { success: true, data: 'Correo de restablecimiento enviado.' };
    } catch (error: any) {
        return { success: false, error: 'No se pudo conectar con el servicio de correos.' };
    }
}

export async function runAIAnalyst(input: any) {
    try {
        try {
            await ensureServerAuth();
        } catch (authErr) {
            console.warn("[Action Warning] ensureServerAuth soft warning:", authErr);
        }
        const result = await aiAnalystFlow(input);
        return { success: true, data: result };
    } catch (e: any) {
        console.error("[Action Error] AI Analyst failed:", e?.message || e);
        return { 
            success: false, 
            error: e?.message ? `Interrupción de red neuronal: ${e.message}` : "Error de conexión con el motor neuronal. Por favor reintenta tu consulta." 
        };
    }
}

export async function handleWhatsAppReminder(input: any) {
    try {
        const result = await generateWhatsAppReminder(input);
        return { success: true, data: result };
    } catch (e: any) {
        return { success: false, error: "Error al generar el recordatorio." };
    }
}

export async function handleWhatsAppStatusUpdate(input: any) {
    try {
        const result = await generateWhatsAppStatusUpdate(input);
        return { success: true, data: result };
    } catch (e: any) {
        return { success: false, error: "Error al generar la actualización de estado." };
    }
}

export async function syncBcvRateAction() {
    try {
        await ensureServerAuth();
        const result = await executeBcvRateSync();
        return result;
    } catch (e: any) {
        console.error("[Action Error] BCV Sync failed:", e.message);
        return { success: false, error: e.message };
    }
}

export async function triggerPushNotificationAction(
    userIds: string[], 
    payload: { title: string; body: string; url?: string }
) {
    try {
        await ensureServerAuth();
        const { firestore } = initializeFirebaseServer();
        const promises = userIds.map(uid => sendPushNotification(firestore, uid, payload));
        await Promise.all(promises);
        return { success: true };
    } catch (e: any) {
        console.error("[Action Error] Push trigger failed:", e.message);
        return { success: false, error: e.message };
    }
}

export async function executePriceAdjustment(params: {
    adjustmentPercent: number;
    syncType: 'bcv' | 'wac';
    brandFilter: string;
    categoryFilter: string;
    modelFilter: string;
    userId: string;
    userName: string;
}) {
    try {
        await ensureServerAuth();
        const { firestore } = initializeFirebaseServer();
        
        const {
            adjustmentPercent,
            syncType,
            brandFilter,
            categoryFilter,
            modelFilter,
            userId,
            userName
        } = params;

        const settingsRef = doc(firestore, 'system', 'financials');
        const settingsSnap = await getDoc(settingsRef);
        if (!settingsSnap.exists()) {
            throw new Error("Configuraciones financieras de red no encontradas.");
        }
        const settings = settingsSnap.data();

        const productsRef = collection(firestore, 'products');
        let productsQuery = brandFilter === 'todos' 
            ? query(productsRef) 
            : query(productsRef, where('brand', '==', brandFilter));
            
        const productsSnap = await getDocs(productsQuery);
        const inflationMultiplier = 1 + (adjustmentPercent / 100);

        const targetProducts = productsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Product)).filter(p => {
            if (categoryFilter !== 'todos' && p.category !== categoryFilter) return false;
            if (modelFilter.trim() !== '') {
                const m = (p.model || '').toLowerCase();
                if (!m.includes(modelFilter.trim().toLowerCase())) return false;
            }
            return true;
        });

        if (targetProducts.length === 0) {
            return { success: true, count: 0 };
        }

        const pricingRefs = targetProducts.map(p => doc(firestore, `products/${p.id}/private/pricing`));
        const pricingPromises = pricingRefs.map(ref => getDoc(ref));
        const pricingSnaps = await Promise.all(pricingPromises);

        const backups: PriceBackupItem[] = [];
        const updatesList: Array<{
            productRef: any;
            pricingRef: any;
            productUpdate: any;
            pricingUpdate: any;
        }> = [];

        for (let i = 0; i < targetProducts.length; i++) {
            const product = targetProducts[i];
            const pricingSnap = pricingSnaps[i];

            if (pricingSnap.exists()) {
                const pricingData = pricingSnap.data();
                const strategy = pricingData.strategyDetails as PricingStrategy | undefined;
                if (strategy?.strategy === 'target_price') continue;

                const safeStrategy = strategy || {
                    strategy: 'smart_import',
                    useGlobalSettings: true,
                    costLanded: product.cost || 0,
                    importDetails: {
                        factoryCost: product.cost || 0,
                        chinaShipping: 0,
                        dimensions: { length: 10, width: 10, height: 10 },
                        unitsPerBox: 1,
                        freightRatePerCBM: 450,
                        otherExpenses: 0
                    }
                };

                const baseCost = (syncType === 'wac' && product.cost) ? product.cost : (safeStrategy.importDetails?.factoryCost || 0);
                const chinaShipping = syncType === 'wac' ? 0 : (safeStrategy.importDetails?.chinaShipping || 0);

                const newFactoryCost = baseCost * inflationMultiplier;
                const costLanded = newFactoryCost + chinaShipping;

                const adjustedStrategy: any = {
                    ...safeStrategy,
                    costLanded: costLanded,
                    importDetails: {
                        ...(safeStrategy.importDetails || { dimensions: { length: 10, width: 10, height: 10 }, unitsPerBox: 1 }),
                        factoryCost: newFactoryCost,
                        chinaShipping: chinaShipping
                    }
                };

                const newCalc = calculatePricingTier(adjustedStrategy, settings as any);
                adjustedStrategy.calculated = newCalc;

                backups.push({
                    productId: product.id!,
                    oldPrice: product.price,
                    oldPriceCashUSD: product.priceCashUSD || 0,
                    oldPriceEarly7d: product.priceEarly7d || 0,
                    oldPriceEarly15d: product.priceEarly15d || 0,
                    oldCost: product.cost || 0,
                    oldFactoryCost: safeStrategy.importDetails?.factoryCost || 0,
                    oldChinaShipping: safeStrategy.importDetails?.chinaShipping || 0
                });

                updatesList.push({
                    productRef: doc(firestore, 'products', product.id!),
                    pricingRef: pricingSnap.ref,
                    productUpdate: {
                        price: newCalc.priceListBCV,
                        priceCashUSD: newCalc.priceCashUSD,
                        priceEarly7d: newCalc.priceEarly7d,
                        priceEarly15d: newCalc.priceEarly15d,
                        cost: newCalc.landedCost,
                        updatedAt: serverTimestamp()
                    },
                    pricingUpdate: {
                        landedCost: newCalc.landedCost,
                        netProfit: newCalc.netProfitUSD,
                        strategyDetails: adjustedStrategy,
                        updatedAt: serverTimestamp()
                    }
                });
            }
        }

        if (updatesList.length === 0) {
            return { success: true, count: 0 };
        }

        const historyRef = doc(collection(firestore, 'priceAdjustmentHistory'));
        await setDoc(historyRef, {
            userId,
            userName,
            adjustmentPercent,
            syncType,
            brandFilter,
            categoryFilter,
            modelFilter,
            backups,
            createdAt: serverTimestamp(),
            isRestored: false
        });

        let batch = writeBatch(firestore);
        let batchOpCount = 0;

        for (let i = 0; i < updatesList.length; i++) {
            const updateItem = updatesList[i];
            batch.update(updateItem.productRef, updateItem.productUpdate);
            batch.update(updateItem.pricingRef, updateItem.pricingUpdate);
            batchOpCount += 2;

            if (batchOpCount >= 400 || i === updatesList.length - 1) {
                await batch.commit();
                if (i < updatesList.length - 1) {
                    batch = writeBatch(firestore);
                    batchOpCount = 0;
                }
            }
        }

        await logActivity(firestore, {
            userId,
            userName,
            action: 'MASS_PRICE_UPDATE',
            resource: 'products',
            severity: 'critical',
            details: `Ajuste masivo de precios del ${adjustmentPercent}%. Tipo: ${syncType}. F: Marca=${brandFilter}, Cat=${categoryFilter}, Mod=${modelFilter}. ${updatesList.length} prod. actualizados. Ref Historial: ${historyRef.id}`
        });

        return { success: true, count: updatesList.length };
    } catch (e: any) {
        console.error("executePriceAdjustment failed:", e.message);
        return { success: false, error: e.message };
    }
}

export async function executePriceRollback(params: {
    userId: string;
    userName: string;
}) {
    try {
        await ensureServerAuth();
        const { firestore } = initializeFirebaseServer();
        const { userId, userName } = params;

        const historyQuery = query(
            collection(firestore, 'priceAdjustmentHistory'),
            where('isRestored', '==', false),
            orderBy('createdAt', 'desc'),
            limit(1)
        );
        const historySnap = await getDocs(historyQuery);

        if (historySnap.empty) {
            throw new Error("No se encontró ningún ajuste pendiente por revertir.");
        }

        const historyDoc = historySnap.docs[0];
        const historyData = historyDoc.data();
        const backups = historyData.backups as PriceBackupItem[];

        const pricingPromises = backups.map(backup => {
            const pricingRef = doc(firestore, `products/${backup.productId}/private/pricing`);
            return getDoc(pricingRef);
        });
        const pricingSnaps = await Promise.all(pricingPromises);

        let batch = writeBatch(firestore);
        let batchOpCount = 0;
        let processedCount = 0;

        for (let i = 0; i < backups.length; i++) {
            const backup = backups[i];
            const pricingSnap = pricingSnaps[i];

            if (pricingSnap.exists()) {
                const pricingData = pricingSnap.data();
                const strategy = pricingData.strategyDetails as PricingStrategy | undefined;

                const safeStrategy: any = strategy || {
                    strategy: 'smart_import',
                    useGlobalSettings: true,
                    costLanded: backup.oldCost,
                    importDetails: {
                        factoryCost: backup.oldFactoryCost,
                        chinaShipping: backup.oldChinaShipping,
                        dimensions: { length: 10, width: 10, height: 10 },
                        unitsPerBox: 1,
                        freightRatePerCBM: 450,
                        otherExpenses: 0
                    }
                };

                const restoredStrategy: any = {
                    ...safeStrategy,
                    costLanded: backup.oldCost,
                    importDetails: {
                        ...(safeStrategy.importDetails || { dimensions: { length: 10, width: 10, height: 10 }, unitsPerBox: 1 }),
                        factoryCost: backup.oldFactoryCost,
                        chinaShipping: backup.oldChinaShipping
                    }
                };

                const restoredCalc = {
                    priceListBCV: backup.oldPrice,
                    priceCashUSD: backup.oldPriceCashUSD,
                    priceEarly7d: backup.oldPriceEarly7d,
                    priceEarly15d: backup.oldPriceEarly15d,
                    netProfitUSD: pricingData.netProfit || 0,
                    netMarginPercent: safeStrategy.calculated?.netMarginPercent || 0,
                    totalCommissionsUSD: safeStrategy.calculated?.totalCommissionsUSD || 0,
                    adminOverheadUSD: safeStrategy.calculated?.adminOverheadUSD || 0,
                    landedCost: backup.oldCost
                };

                restoredStrategy.calculated = restoredCalc;

                const productRef = doc(firestore, 'products', backup.productId);
                batch.update(productRef, {
                    price: backup.oldPrice,
                    priceCashUSD: backup.oldPriceCashUSD,
                    priceEarly7d: backup.oldPriceEarly7d,
                    priceEarly15d: backup.oldPriceEarly15d,
                    cost: backup.oldCost,
                    updatedAt: serverTimestamp()
                });

                batch.update(pricingSnap.ref, {
                    landedCost: backup.oldCost,
                    strategyDetails: restoredStrategy,
                    updatedAt: serverTimestamp()
                });

                batchOpCount += 2;
                processedCount++;

                if (batchOpCount >= 400 || i === backups.length - 1) {
                    await batch.commit();
                    if (i < backups.length - 1) {
                        batch = writeBatch(firestore);
                        batchOpCount = 0;
                    }
                }
            }
        }

        await setDoc(historyDoc.ref, { isRestored: true, restoredAt: serverTimestamp(), restoredBy: userId }, { merge: true });

        await logActivity(firestore, {
            userId,
            userName,
            action: 'ROLLBACK_PRICE_UPDATE',
            resource: 'products',
            severity: 'critical',
            details: `Reversión masiva del ajuste de precios. Ref Historial: ${historyDoc.id}. ${processedCount} productos restaurados.`
        });

        return { success: true, count: processedCount };
    } catch (e: any) {
        console.error("executePriceRollback failed:", e.message);
        return { success: false, error: e.message };
    }
}



