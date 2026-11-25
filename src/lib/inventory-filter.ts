import type { Product } from './definitions';
import { roundCurrency } from './billing';

export type InventoryStockFilter = 'todos' | 'in_stock' | 'low' | 'needs_restock' | 'out';

export type InventorySortBy = 'name_asc' | 'stock_desc' | 'stock_asc' | 'brand_asc' | 'price_desc';

export interface InventoryReportFilters {
  category: string;
  brand: string;
  discipline: string;
  stockStatus: InventoryStockFilter;
  searchTerm: string;
  sortBy?: InventorySortBy;
}

const DISCIPLINE_ALIASES: Record<string, string> = {
  VELEIBOL: 'VOLEIBOL',
  VOLEIBOL: 'VOLEIBOL',
  BASKET: 'BALONCESTO',
  BASKETBALL: 'BALONCESTO',
  BALONCESTO: 'BALONCESTO',
  'PIN PONG': 'PING PONG',
  'PING PONG': 'PING PONG',
  BEISBOL: 'BÉISBOL',
  'FUTBOL CAMPO': 'FÚTBOL CAMPO',
  'FUTBOL SALA': 'FÚTBOL SALA',
  'FUTBOL 7': 'FÚTBOL 7',
  FUTSAL: 'FÚTBOL SALA',
};

export function normalizeTextKey(value?: string): string {
  return (value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

export function canonicalizeCategory(raw?: string): string {
  const cleaned = (raw || '').trim().replace(/\s+/g, ' ');
  return cleaned ? cleaned.toUpperCase() : '';
}

export function canonicalizeBrand(raw?: string): string {
  const cleaned = (raw || '').trim().replace(/\s+/g, ' ');
  return cleaned ? cleaned.toUpperCase() : '';
}

export function canonicalizeDiscipline(raw?: string): string {
  const norm = normalizeTextKey(raw);
  if (!norm) return '';
  if (DISCIPLINE_ALIASES[norm]) return DISCIPLINE_ALIASES[norm];
  return (raw || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

export function getProductStock(product: Product): number {
  return Number(product.stockLevel ?? (product as any).stock ?? 0);
}

export function getProductCashPrice(product: Product, bcvDiscount: number = 25): number {
  const explicitCash = Number(product.priceCashUSD || 0);
  if (explicitCash > 0) return roundCurrency(explicitCash);
  const listPrice = Number(product.price || 0);
  return listPrice > 0 ? roundCurrency(listPrice * (1 - bcvDiscount / 100)) : 0;
}

export function formatProductSizesSummary(product: Product): string {
  if (!product.hasSizes || !product.sizes || typeof product.sizes !== 'object') return '';
  const entries = Object.entries(product.sizes)
    .map(([size, qty]) => ({ size: String(size).trim(), qty: Number(qty || 0) }))
    .filter((entry) => entry.size.length > 0 && entry.qty > 0);
  if (entries.length === 0) return '';
  entries.sort((a, b) => a.size.localeCompare(b.size, 'es', { numeric: true }));
  return entries.map((e) => `T${e.size}: ${e.qty}`).join(' · ');
}

export function extractInventoryFilterOptions(products: Product[]): {
  categories: string[];
  brands: string[];
  disciplines: string[];
} {
  const catMap = new Map<string, string>();
  const brandMap = new Map<string, string>();
  const discMap = new Map<string, string>();

  for (const p of products || []) {
    const cat = canonicalizeCategory(p.category);
    if (cat) {
      const k = normalizeTextKey(cat);
      if (!catMap.has(k)) catMap.set(k, cat);
    }

    const brand = canonicalizeBrand(p.brand);
    if (brand) {
      const k = normalizeTextKey(brand);
      if (!brandMap.has(k)) brandMap.set(k, brand);
    }

    const disc = canonicalizeDiscipline(p.discipline);
    if (disc) {
      const k = normalizeTextKey(disc);
      if (!discMap.has(k)) discMap.set(k, disc);
    }
  }

  const localeSort = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base' });
  return {
    categories: Array.from(catMap.values()).sort(localeSort),
    brands: Array.from(brandMap.values()).sort(localeSort),
    disciplines: Array.from(discMap.values()).sort(localeSort),
  };
}

export function filterInventoryProducts(
  products: Product[],
  filters: InventoryReportFilters
): Product[] {
  const targetCat = filters.category && filters.category !== 'todos' ? normalizeTextKey(filters.category) : '';
  const targetBrand = filters.brand && filters.brand !== 'todos' ? normalizeTextKey(filters.brand) : '';
  const targetDisc = filters.discipline && filters.discipline !== 'todos' ? normalizeTextKey(filters.discipline) : '';
  const termKey = normalizeTextKey(filters.searchTerm);
  const stockStatus = filters.stockStatus || 'todos';
  const sortBy = filters.sortBy || 'name_asc';

  const filtered = (products || []).filter((p) => {
    if (targetCat && normalizeTextKey(canonicalizeCategory(p.category)) !== targetCat) {
      return false;
    }
    if (targetBrand && normalizeTextKey(canonicalizeBrand(p.brand)) !== targetBrand) {
      return false;
    }
    if (targetDisc && normalizeTextKey(canonicalizeDiscipline(p.discipline)) !== targetDisc) {
      return false;
    }

    const stock = getProductStock(p);
    if (stockStatus === 'in_stock' && stock <= 0) return false;
    if (stockStatus === 'low' && (stock <= 0 || stock >= 20)) return false;
    if (stockStatus === 'needs_restock' && stock >= 20) return false;
    if (stockStatus === 'out' && stock > 0) return false;

    if (termKey) {
      const haystack = normalizeTextKey(
        [
          p.name,
          p.sku,
          canonicalizeCategory(p.category),
          canonicalizeBrand(p.brand),
          canonicalizeDiscipline(p.discipline),
          p.warehouseLocation,
        ]
          .filter(Boolean)
          .join(' ')
      );
      if (!haystack.includes(termKey)) return false;
    }

    return true;
  });

  return [...filtered].sort((a, b) => {
    if (sortBy === 'stock_desc') {
      const diff = getProductStock(b) - getProductStock(a);
      if (diff !== 0) return diff;
    } else if (sortBy === 'stock_asc') {
      const diff = getProductStock(a) - getProductStock(b);
      if (diff !== 0) return diff;
    } else if (sortBy === 'brand_asc') {
      const bA = canonicalizeBrand(a.brand) || 'ZZZ';
      const bB = canonicalizeBrand(b.brand) || 'ZZZ';
      const diff = bA.localeCompare(bB, 'es', { sensitivity: 'base' });
      if (diff !== 0) return diff;
    } else if (sortBy === 'price_desc') {
      const diff = Number(b.price || 0) - Number(a.price || 0);
      if (diff !== 0) return diff;
    }
    const nameDiff = (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' });
    if (nameDiff !== 0) return nameDiff;
    return (a.sku || '').localeCompare(b.sku || '', 'es', { sensitivity: 'base' });
  });
}

export interface InventorySelectionMetrics {
  modelsCount: number;
  totalUnits: number;
  inStockCount: number;
  lowStockCount: number;
  outOfStockCount: number;
  totalValuationBCV: number;
  totalValuationCash: number;
}

export function computeInventorySelectionMetrics(
  products: Product[],
  bcvDiscount: number = 25
): InventorySelectionMetrics {
  let modelsCount = 0;
  let totalUnits = 0;
  let inStockCount = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;
  let totalValuationBCV = 0;
  let totalValuationCash = 0;

  for (const p of products || []) {
    modelsCount++;
    const stock = getProductStock(p);
    const listPrice = Number(p.price || 0);
    const cashPrice = getProductCashPrice(p, bcvDiscount);

    totalUnits += Math.max(0, stock);
    if (stock <= 0) {
      outOfStockCount++;
    } else {
      inStockCount++;
      if (stock < 20) lowStockCount++;
      totalValuationBCV += stock * listPrice;
      totalValuationCash += stock * cashPrice;
    }
  }

  return {
    modelsCount,
    totalUnits,
    inStockCount,
    lowStockCount,
    outOfStockCount,
    totalValuationBCV: roundCurrency(totalValuationBCV),
    totalValuationCash: roundCurrency(totalValuationCash),
  };
}

const STOCK_STATUS_LABELS: Record<InventoryStockFilter, string> = {
  todos: '',
  in_stock: 'DISPONIBLES (>0)',
  low: 'BAJO STOCK (1-19)',
  needs_restock: 'REPOSICIÓN (<20)',
  out: 'AGOTADOS (0)',
};

export function buildInventoryFilterTitle(filters: InventoryReportFilters): {
  title: string;
  subtitle: string;
  filenameSlug: string;
} {
  const hasCat = filters.category && filters.category !== 'todos';
  const hasBrand = filters.brand && filters.brand !== 'todos';
  const hasDisc = filters.discipline && filters.discipline !== 'todos';
  const hasStock = filters.stockStatus && filters.stockStatus !== 'todos';
  const hasSearch = Boolean(filters.searchTerm && filters.searchTerm.trim());

  if (!hasCat && !hasBrand && !hasDisc && !hasStock && !hasSearch) {
    return {
      title: 'INVENTARIO MAESTRO COMPLETO',
      subtitle: 'CATÁLOGO COMPLETO EN ALMACÉN',
      filenameSlug: 'Inventario_Completo',
    };
  }

  let title = 'INVENTARIO FILTRADO';
  if (hasCat) title = `INVENTARIO: ${canonicalizeCategory(filters.category)}`;
  else if (hasBrand) title = `INVENTARIO MARCA: ${canonicalizeBrand(filters.brand)}`;
  else if (hasDisc) title = `INVENTARIO DISCIPLINA: ${canonicalizeDiscipline(filters.discipline)}`;
  else if (filters.stockStatus === 'needs_restock' || filters.stockStatus === 'low') title = 'REPORTE DE STOCK BAJO (<20)';
  else if (filters.stockStatus === 'out') title = 'PRODUCTOS AGOTADOS (0)';
  else if (filters.stockStatus === 'in_stock') title = 'INVENTARIO DISPONIBLE EN ALMACÉN';

  const parts: string[] = [];
  const slugParts: string[] = ['Inventario'];
  if (hasCat) {
    const c = canonicalizeCategory(filters.category);
    parts.push(`CATEGORÍA: ${c}`);
    slugParts.push(c);
  }
  if (hasBrand) {
    const b = canonicalizeBrand(filters.brand);
    parts.push(`MARCA: ${b}`);
    slugParts.push(b);
  }
  if (hasDisc) {
    const d = canonicalizeDiscipline(filters.discipline);
    parts.push(`DISCIPLINA: ${d}`);
    slugParts.push(d);
  }
  if (hasStock) {
    parts.push(`STOCK: ${STOCK_STATUS_LABELS[filters.stockStatus]}`);
    slugParts.push(filters.stockStatus.toUpperCase());
  }
  if (hasSearch) {
    parts.push(`BÚSQUEDA: "${filters.searchTerm.trim().toUpperCase()}"`);
  }

  const filenameSlug = slugParts
    .map((s) =>
      normalizeTextKey(s)
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
    )
    .filter(Boolean)
    .join('_');

  return {
    title,
    subtitle: parts.join(' · '),
    filenameSlug: filenameSlug || 'Inventario_Filtrado',
  };
}
