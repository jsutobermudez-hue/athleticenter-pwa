const fs = require('fs');
let code = fs.readFileSync('src/lib/billing.ts', 'utf8');

const regex = /export function calculateMetricsByDiscipline\(orders: Order\[\], products\?: any\[\]\): Array<\{[\s\S]*?\}\>\s*\{[\s\S]*?const currentSpSales = entry\.salespersonSales\.get\(spName\) \|\| 0;\s*entry\.salespersonSales\.set\(spName, currentSpSales \+ itemTotal\);\s*\}\);\s*\}\s*\}\);/g;

const replacement = `export function calculateMetricsByDiscipline(
    orders: Order[], 
    products?: any[],
    startDateLimit?: Date | null,
    endDateLimit?: Date | null
): Array<{
    discipline: string;
    ventas: number;
    cobranzas: number;
    moraCritica: number;
    pending: number;
    totalUnits: number;
    topSalespersonName: string;
    topSalespersonAmount: number;
    efficiencyPct: number;
}> {
    if (!orders || orders.length === 0) return [];

    const productDisciplineMap = new Map<string, string>();
    if (products) {
        products.forEach(p => {
            if (p.id && p.discipline) productDisciplineMap.set(p.id, p.discipline.trim());
            if (p.sku && p.discipline) productDisciplineMap.set(p.sku, p.discipline.trim());
        });
    }

    const disciplineMap = new Map<string, {
        discipline: string;
        ventas: number;
        cobranzas: number;
        moraCritica: number;
        pending: number;
        totalUnits: number;
        salespersonSales: Map<string, number>;
    }>();

    const VALID_STATUSES = ['Entregado', 'Completado', 'Despachado', 'Pagado', 'Aprobado', 'En Preparación', 'En Verificación'];

    orders.forEach(order => {
        if (!VALID_STATUSES.includes(order.status)) return;

        const sDate = getSalesDate(order);
        const isSaleInRange = sDate && (!startDateLimit || startOfDay(sDate) >= startOfDay(startDateLimit)) && (!endDateLimit || startOfDay(sDate) <= startOfDay(endDateLimit));
        
        let cashInRange = 0;
        if (Array.isArray((order as any).payments) && (order as any).payments.length > 0) {
            (order as any).payments.forEach((p: any) => {
                if (p.status === 'verified' || !p.status) {
                    const pDateRaw = p.paymentDate || p.createdAt || p.date;
                    const pDate = pDateRaw ? (typeof pDateRaw.toDate === 'function' ? pDateRaw.toDate() : new Date(pDateRaw)) : null;
                    if (pDate && (!startDateLimit || startOfDay(pDate) >= startOfDay(startDateLimit)) && (!endDateLimit || startOfDay(pDate) <= startOfDay(endDateLimit))) {
                        cashInRange += (Number(p.amount || p.monto) || 0);
                    }
                }
            });
        } else {
            const cDate = getCashDate(order);
            if (cDate && (!startDateLimit || startOfDay(cDate) >= startOfDay(startDateLimit)) && (!endDateLimit || startOfDay(cDate) <= startOfDay(endDateLimit))) {
                cashInRange = getEffectiveCashReceived(order);
            }
        }

        const targetMoraDate = endDateLimit || new Date();
        const mora = getHistoricalMoraAsOfDate(order, targetMoraDate);

        if (!isSaleInRange && cashInRange === 0 && mora === 0) return;

        const orderTotal = order.totalAmount || 1;
        const cashRatio = Math.min(1, cashInRange / orderTotal);
        const moraRatio = Math.min(1, mora / orderTotal);
        const spName = getSalespersonDisplayName(order);

        const items = Array.isArray((order as any).items) ? (order as any).items : [];

        if (items.length > 0) {
            items.forEach((item: any) => {
                const disc = item.discipline || productDisciplineMap.get(item.productId) || productDisciplineMap.get(item.sku) || productDisciplineMap.get(item.id) || 'General / Multideporte';
                const itemTotal = Number(item.unitPrice || 0) * Number(item.quantity || 1);
                const qty = Number(item.quantity || 1);

                if (!disciplineMap.has(disc)) {
                    disciplineMap.set(disc, {
                        discipline: disc,
                        ventas: 0,
                        cobranzas: 0,
                        moraCritica: 0,
                        pending: 0,
                        totalUnits: 0,
                        salespersonSales: new Map<string, number>()
                    });
                }

                const entry = disciplineMap.get(disc)!;
                if (isSaleInRange) {
                    entry.ventas += itemTotal;
                    entry.totalUnits += qty;
                    const totalPendingRatio = Math.max(0, 1 - (getEffectiveCashReceived(order) / orderTotal));
                    entry.pending += itemTotal * totalPendingRatio;
                }
                
                entry.cobranzas += itemTotal * cashRatio;
                entry.moraCritica += itemTotal * moraRatio;

                if (isSaleInRange) {
                    const currentSpSales = entry.salespersonSales.get(spName) || 0;
                    entry.salespersonSales.set(spName, currentSpSales + itemTotal);
                }
            });
        }
    });`;

if (regex.test(code)) {
    fs.writeFileSync('src/lib/billing.ts', code.replace(regex, replacement));
    console.log('Replaced via regex successfully');
} else {
    console.error('Regex not matched in billing.ts');
}
