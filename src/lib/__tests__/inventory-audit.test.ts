import assert from 'node:assert/strict';
import type { Product } from '../definitions';
import {
    filterInventoryProducts,
    buildSoldUnitsByProductMap,
    computeProductAuditRow,
    computeInventorySelectionMetrics,
} from '../inventory-filter';

const mockProducts = [
    {
        id: 'p1',
        sku: 'BAL-001',
        name: 'Balón Fútbol Pro #5',
        category: 'Balones',
        brand: 'Molten',
        discipline: 'Fútbol Campo',
        stockLevel: 30,
        totalSold: 12,
        price: 40,
        priceCashUSD: 30,
    },
    {
        id: 'p2',
        sku: 'BAL-002',
        name: 'Balón Basket Street',
        category: 'Balones',
        brand: 'Spalding',
        discipline: 'Baloncesto',
        stockLevel: 0,
        totalSold: 25,
        price: 36,
        priceCashUSD: 27,
    },
    {
        id: 'p3',
        sku: '',
        name: 'Malla Voleibol Entrenamiento',
        category: 'Redes',
        stockLevel: undefined as unknown as number,
        price: 20,
        priceCashUSD: 15,
    },
] as unknown as Product[];

// 1. El filtro "todos" retorna el 100% de los productos (incluye stock 0, undefined y sin SKU)
const allFiltered = filterInventoryProducts(mockProducts, {
    category: 'todos',
    brand: 'todos',
    discipline: 'todos',
    stockStatus: 'todos',
    searchTerm: '',
});
assert.equal(allFiltered.length, 3, 'Debe incluir el 100% de los productos sin omitir agotados');

// 2. buildSoldUnitsByProductMap solo suma estados comprometidos/vendidos
const soldMap = buildSoldUnitsByProductMap(
    [
        { id: 'o1', status: 'Entregado' },
        { id: 'o2', status: 'Pagado' },
        { id: 'o3', status: 'Aprobado' },
        { id: 'o4', status: 'Cancelado' },
        { id: 'o5', status: 'Rechazado' },
        { id: 'o6', status: 'Borrador' },
        { id: 'o7', status: 'Pendiente' },
    ],
    [
        { orderId: 'o1', productId: 'p1', quantity: 10 },
        { orderId: 'o2', productId: 'p1', quantity: 5 },
        { orderId: 'o3', productId: 'p2', quantity: 25 },
        { orderId: 'o4', productId: 'p1', quantity: 99 },
        { orderId: 'o5', productId: 'p2', quantity: 50 },
        { orderId: 'o6', productId: 'p3', quantity: 7 },
        { orderId: 'o7', productId: 'p3', quantity: 4 },
    ]
);
assert.equal(soldMap['p1'], 15);
assert.equal(soldMap['p2'], 25);
assert.equal(soldMap['p3'] || 0, 0);

// 3. computeProductAuditRow cumple Había === Vendido + Deben Quedar
const row1 = computeProductAuditRow(mockProducts[0], soldMap);
assert.deepEqual(row1, { had: 45, sold: 15, remaining: 30 });
assert.equal(row1.had - row1.sold, row1.remaining);

const row2 = computeProductAuditRow(mockProducts[1], soldMap);
assert.deepEqual(row2, { had: 25, sold: 25, remaining: 0 });
assert.equal(row2.had - row2.sold, row2.remaining);

const row3 = computeProductAuditRow(mockProducts[2], soldMap);
assert.deepEqual(row3, { had: 0, sold: 0, remaining: 0 });

// Fallback a totalSold si no hay mapa de órdenes
const row1Fallback = computeProductAuditRow(mockProducts[0]);
assert.deepEqual(row1Fallback, { had: 42, sold: 12, remaining: 30 });

// 4. computeInventorySelectionMetrics consolida el 100% incluyendo los agotados
const metrics = computeInventorySelectionMetrics(allFiltered, 25, soldMap);
assert.equal(metrics.modelsCount, 3);
assert.equal(metrics.totalHadUnits, 70);
assert.equal(metrics.totalSoldUnits, 40);
assert.equal(metrics.totalUnits, 30);
assert.equal(metrics.inStockCount, 1);
assert.equal(metrics.outOfStockCount, 2);

console.log('✅ OK: Auditoría de inventario 100% verificada (Había / Vendido / Deben Quedar e inclusión de stock 0).');
