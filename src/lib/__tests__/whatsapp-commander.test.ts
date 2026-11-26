import assert from 'node:assert/strict';
import {
    filterValidPromotions,
    formatPromotionsForArmPrompt,
    isSuperAdminCommanderMessage,
    findMatchingCampaign,
    inferAudienceFromText,
    type ActivePromotion,
} from '../active-promotions';

const mockCampaigns = [
    {
        id: 'c1',
        title: 'Catálogo Oficial (lunes, 23 nov.)',
        message: 'Te compartimos los artículos deportivos destacados para despacho esta semana.',
        mediaType: 'image',
        mediaUrl: 'Foto de inventario',
        sentCount: 68,
        createdAt: '2026-11-23T14:00:08.623Z',
    },
    {
        id: 'c2',
        title: 'OBTEN 40% DE DESCUENTO CON LAS BICICLETAS SPARTAN CON NAVIDADES EN NOVIEMBRE',
        message: 'Promoción especial de bicicletas Spartan Rin 20 y 24 con 40% pago de contado y divisas.',
        mediaType: 'video',
        mediaUrl: '[Archivo VIDEO Base64 (3.4 MB)]',
        sentCount: 65,
        createdAt: '2026-11-09T17:42:52.684Z',
    },
    {
        id: 'c3',
        title: '🎉 ¡GRAN NOTICIA EN ATHLETICENTER! 🚛🇻🇪',
        message: 'Compartimos un gran logro institucional con nuestros clientes.',
        mediaType: 'image',
        mediaUrl: 'https://firebasestorage.googleapis.com/v0/b/example.jpg',
        sentCount: 65,
        createdAt: '2026-11-11T19:10:35.758Z',
    },
];

// 1. Búsqueda de campaña histórica
const foundBikeCampaign = findMatchingCampaign(
    'Envía de nuevo la promoción de las bicicletas donde damos el 40% pago de contado y divisas',
    mockCampaigns
);
assert.ok(foundBikeCampaign, 'Debe encontrar la campaña de bicicletas');
assert.equal(foundBikeCampaign?.id, 'c2');

// 2. Detección de mensajes del Comandante SuperAdmin vs consultas normales
assert.equal(
    isSuperAdminCommanderMessage('Envía de nuevo la promoción de las bicicletas con 40% contado y divisas'),
    true
);
assert.equal(
    isSuperAdminCommanderMessage('Crea una promo de balones Molten para clientes inactivos'),
    true
);
assert.equal(
    isSuperAdminCommanderMessage('Hola, ¿a cómo está el balón Molten V5M5000?'),
    false
);
assert.equal(isSuperAdminCommanderMessage('tasa bcv'), false);

// 3. Inferencia de audiencia
assert.equal(inferAudienceFromText('enviar a los clientes inactivos'), 'inactive');
assert.equal(inferAudienceFromText('mandar a clientes vip'), 'vips');
assert.equal(inferAudienceFromText('a todos los clientes'), 'all');

// 4. Promociones activas para el prompt de ARM
const promos: ActivePromotion[] = [
    {
        id: 'p-active',
        title: '40% Descuento Bicicletas Spartan',
        summary: '40% de descuento en bicicletas montañeras e infantiles por pago de contado y divisas.',
        category: 'BICICLETAS',
        discountPct: 40,
        conditions: 'Pago de contado y en divisas',
        expiresAt: '2099-12-31T23:59:59Z',
        active: true,
    },
    {
        id: 'p-expired',
        title: 'Promo Vieja',
        summary: 'Expirada',
        expiresAt: '2020-01-01T00:00:00Z',
        active: true,
    },
    {
        id: 'p-inactive',
        title: 'Promo Apagada',
        summary: 'Inactiva',
        active: false,
    },
];

const validPromos = filterValidPromotions(promos, new Date('2026-11-26T12:00:00Z'));
assert.equal(validPromos.length, 1);
assert.equal(validPromos[0].id, 'p-active');

const armPromptBlock = formatPromotionsForArmPrompt(validPromos);
assert.ok(armPromptBlock.includes('40% de descuento'));
assert.ok(armPromptBlock.includes('BICICLETAS'));
assert.ok(!armPromptBlock.includes('Promo Vieja'));

console.log('✅ OK: Agente Comandante, búsqueda de campañas históricas y promociones ARM verificados.');
