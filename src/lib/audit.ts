'use client';

import { collection, addDoc, serverTimestamp, type Firestore } from 'firebase/firestore';
import type { AuditLog } from './definitions';

/**
 * Diccionario Ejecutivo de Traducción Humana de Acciones de Auditoría 🇪🇸
 */
export const AUDIT_ACTION_TRANSLATIONS: Record<string, { title: string; category: string; description: string }> = {
    // Inventario y Precios
    'MASS_PRICE_UPDATE': {
        title: 'Actualización Masiva de Precios',
        category: 'Inventario',
        description: 'Se modificó el catálogo de precios de productos en lote.'
    },
    'ROLLBACK_PRICE_UPDATE': {
        title: 'Restauración de Precios de Inventario',
        category: 'Inventario',
        description: 'Se revirtió un cambio masivo de precios al estado anterior.'
    },
    'EDIT_PRODUCT_PRICE': {
        title: 'Modificación Individual de Precio',
        category: 'Inventario',
        description: 'Se actualizó la tarifa de un producto en el inventario.'
    },
    'CREATE_PRODUCT': {
        title: 'Creación de Nuevo Producto',
        category: 'Inventario',
        description: 'Se registró un nuevo SKU en el catálogo de productos.'
    },
    'DELETE_PRODUCT': {
        title: 'Eliminación / Inactivación de Producto',
        category: 'Inventario',
        description: 'Se retiró un SKU del catálogo de ventas.'
    },

    // Facturación y Tesorería
    'REGISTER_PAYMENT': {
        title: 'Registro de Abono / Comprobante de Pago',
        category: 'Facturación',
        description: 'Se ingresó un pago o transferencia para conciliación.'
    },
    'BATCH_RECONCILE_PAYMENTS': {
        title: 'Conciliación Masiva de Pagos en 1-Clic',
        category: 'Facturación',
        description: 'Se liquidó el saldo total de múltiples expedientes en lote.'
    },
    'REJECT_PAYMENT': {
        title: 'Rechazo de Comprobante de Pago',
        category: 'Facturación',
        description: 'Se rechazó una transferencia bancaria o pago no válido.'
    },
    'UPDATE_BCV_RATE': {
        title: 'Ajuste de Tasa Oficial BCV',
        category: 'Facturación',
        description: 'Se actualizó la tasa de cambio de referencia BCV en el sistema.'
    },

    // Pedidos y Cotizaciones
    'CREATE_ORDER': {
        title: 'Creación de Nuevo Pedido de Venta',
        category: 'Pedidos',
        description: 'Se generó un expediente de pedido comercial.'
    },
    'UPDATE_ORDER_STATUS': {
        title: 'Cambio de Estado Logístico de Pedido',
        category: 'Pedidos',
        description: 'Se actualizó la etapa logística (Despachado, Entregado, etc.).'
    },
    'CANCEL_ORDER': {
        title: 'Anulación de Pedido Comercial',
        category: 'Pedidos',
        description: 'Se canceló un pedido y se reintegró el stock reservado.'
    },
    'CREATE_QUOTE': {
        title: 'Emisión de Presupuesto / Cotización B2B',
        category: 'Cotizaciones',
        description: 'Se generó una proforma formal para un cliente.'
    },

    // Usuarios y Configuración
    'USER_LOGIN': {
        title: 'Inicio de Sesión de Usuario',
        category: 'Seguridad',
        description: 'Un usuario accedió a la plataforma.'
    },
    'UPDATE_USER_ROLE': {
        title: 'Modificación de Rol o Permisos de Usuario',
        category: 'Usuarios',
        description: 'Se alteró el perfil jerárquico o accesos de un usuario.'
    },
    'UPDATE_COMPANY_PROFILE': {
        title: 'Modificación de Identidad Fiscal de la Empresa',
        category: 'Configuración',
        description: 'Se actualizaron datos institucionales, RIF o teléfono corporativo.'
    },
    'UPDATE_SETTINGS': {
        title: 'Ajuste de Configuración Global',
        category: 'Configuración',
        description: 'Se modificó un parámetro maestro del sistema.'
    },

    // WhatsApp y Alertas
    'DISPATCH_WHATSAPP': {
        title: 'Despacho de WhatsApp en Segundo Plano',
        category: 'WhatsApp',
        description: 'Se envió una notificación o PDF de forma 100% silenciosa.'
    }
};

/**
 * Obtiene el título en español claro para una acción técnica de auditoría
 */
export function getHumanReadableAction(actionKey: string): string {
    if (!actionKey) return 'Operación del Sistema';
    const translation = AUDIT_ACTION_TRANSLATIONS[actionKey];
    if (translation) return translation.title;
    
    // Si la clave no está explícita, formatear texto
    return actionKey
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, l => l.toUpperCase());
}

/**
 * Registra una acción administrativa crítica en el Libro de Auditoría Global.
 */
export async function logActivity(
    firestore: Firestore,
    params: {
        userId: string;
        userName: string;
        userRole?: string;
        action: string;
        resource: AuditLog['resource'];
        module?: AuditLog['module'];
        resourceId?: string;
        details: string;
        severity?: AuditLog['severity'];
        previousState?: any;
        newState?: any;
    }
) {
    try {
        const auditRef = collection(firestore, 'auditLogs');
        const humanReadableAction = getHumanReadableAction(params.action);
        
        const severity = params.severity || 'info';
        await addDoc(auditRef, {
            ...params,
            humanReadableAction,
            severity,
            createdAt: serverTimestamp(),
        });

        // Si la severidad es CRÍTICA, despachar alerta instantánea de seguridad al WhatsApp de Gerencia
        if (severity === 'critical') {
            try {
                const { sendBackgroundWhatsAppMessage } = await import('./whatsapp-gateway');
                const alertMessage = `🚨 *ALERTA DE SEGURIDAD Y AUDITORÍA CRÍTICA - ATHLETICENTER*\n\n` +
                    `Se ha ejecutado una operación de alto impacto en el sistema:\n\n` +
                    `👤 *Operario:* ${params.userName} (${params.userRole || 'Admin'})\n` +
                    `⚡ *Acción:* ${humanReadableAction}\n` +
                    `📦 *Módulo:* ${(params.module || params.resource || 'Sistema').toUpperCase()}\n` +
                    `📄 *Detalle:* ${params.details}\n` +
                    `📅 *Fecha:* ${new Date().toLocaleString('es-VE')}\n\n` +
                    `Inspeccione el registro maestro en: https://athleticenter-pwa.web.app/dashboard/audit`;

                // Despachar a la línea corporativa registrada de UltraMsg
                const targetAdminPhone = process.env.WHATSAPP_ADMIN_PHONE || '584121234567';
                await sendBackgroundWhatsAppMessage({
                    phone: targetAdminPhone,
                    message: alertMessage
                });
            } catch (secErr) {
                console.warn("[Audit] Alerta de seguridad WhatsApp diferida:", secErr);
            }
        }
    } catch (e) {
        console.warn("[Audit] Fallo al registrar log de actividad:", e);
    }
}
