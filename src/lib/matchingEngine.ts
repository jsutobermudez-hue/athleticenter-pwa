import type { Product, FinancialSettings } from './definitions';

export interface CompetitorExtractedItem {
  item: string;
  price: number;
  category?: string;
  brand?: string;
  discipline?: string;
}

export interface MatchedResultItem {
  competitorItemName: string;
  competitorPrice: number;
  competitorCategory?: string;
  competitorBrand?: string;
  competitorDiscipline?: string;
  matchedProduct: Product | null;
  similarityScore: number; // 0 a 100
  myPriceCashUSD: number;
  myPriceListBCV: number;
  priceDifferenceUSD: number;
  priceDifferencePercent: number;
  suggestedOptimalPrice: number;
  status: 'competitivo' | 'en_riesgo' | 'sin_coincidencia';
  statusLabel: string;
  marginWarning: boolean;
}

// DICCIONARIO DE SINÓNIMOS DEPORTIVOS MULTIDISCIPLINA
const SYNONYM_MAP: Record<string, string[]> = {
  // Fútbol
  futbol: ['soccer', 'futbol', 'balon', 'pelota', 'tacos', 'zapatilla', 'espinillera', 'guantes'],
  soccer: ['futbol', 'soccer', 'balon', 'pelota'],
  balon: ['pelota', 'balon', 'bola'],
  pelota: ['balon', 'pelota', 'bola'],
  // Béisbol & Softbol
  beisbol: ['baseball', 'beisbol', 'softbol', 'softball', 'bate', 'bat', 'guante', 'glove', 'guantilla', 'guantines', 'careta', 'peto'],
  baseball: ['beisbol', 'baseball', 'softbol', 'bat', 'glove'],
  bate: ['bat', 'bate'],
  bat: ['bate', 'bat'],
  guante: ['glove', 'guante', 'guantilla', 'guantines'],
  glove: ['guante', 'glove'],
  guantines: ['guantillas', 'guantines', 'gloves', 'guante'],
  // Baloncesto
  baloncesto: ['basquet', 'basketball', 'baloncesto', 'balon'],
  basquet: ['baloncesto', 'basketball', 'basquet'],
  basketball: ['baloncesto', 'basquet', 'basketball'],
  // Voleibol
  voleibol: ['volleyball', 'voley', 'voleibol', 'rodillera'],
  voley: ['voleibol', 'volleyball', 'voley'],
  // Tenis & Pádel
  tenis: ['tennis', 'tenis', 'padel', 'pádel', 'raqueta', 'pala', 'overgrip'],
  tennis: ['tenis', 'tennis', 'raqueta'],
  padel: ['pádel', 'padel', 'pala', 'raqueta'],
  raqueta: ['pala', 'raqueta', 'racket'],
  // Natación
  natacion: ['swimming', 'natacion', 'lentes', 'goggles', 'gorro', 'aletas'],
  goggles: ['lentes', 'goggles', 'gafas'],
  // Boxeo & Artes Marciales
  boxeo: ['boxing', 'boxeo', 'mma', 'guantes', 'vendas', 'bucal', 'saco'],
  boxing: ['boxeo', 'boxing'],
  // Fitness
  fitness: ['gimnasio', 'gym', 'mancuerna', 'pesa', 'kettlebell', 'liga', 'banda', 'mat'],
  mancuerna: ['pesa', 'mancuerna', 'dumbbell'],
  pesa: ['mancuerna', 'pesa', 'kettlebell']
};

const STOP_WORDS = new Set([
  'de', 'del', 'para', 'con', 'sin', 'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'talla', 'size', 'color', 'marca', 'original', 'nuevo', 'pro', 'elite', 'tipo'
]);

/**
 * Normaliza una cadena de texto eliminando acentos, caracteres especiales y stop-words.
 */
export function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Eliminar diacríticos (acentos)
    .replace(/[^a-z0-9\s]/g, ' ') // Dejar solo letras y números
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tokeniza una cadena limpia en palabras clave significativas.
 */
export function getTokens(text: string): string[] {
  const clean = normalizeText(text);
  return clean
    .split(' ')
    .filter(word => word.length > 1 && !STOP_WORDS.has(word));
}

/**
 * Calcula el coeficiente de similitud de Dice (Token Overlap) entre dos textos.
 */
export function calculateDiceSimilarity(text1: string, text2: string): number {
  const tokens1 = getTokens(text1);
  const tokens2 = getTokens(text2);

  if (tokens1.length === 0 || tokens2.length === 0) return 0;

  // Expandir con sinónimos
  const expanded1 = new Set<string>();
  tokens1.forEach(t => {
    expanded1.add(t);
    const syns = SYNONYM_MAP[t] || [];
    syns.forEach(s => expanded1.add(s));
  });

  const expanded2 = new Set<string>();
  tokens2.forEach(t => {
    expanded2.add(t);
    const syns = SYNONYM_MAP[t] || [];
    syns.forEach(s => expanded2.add(s));
  });

  let intersectionCount = 0;
  expanded1.forEach(token => {
    if (expanded2.has(token)) {
      intersectionCount++;
    }
  });

  const totalTokens = expanded1.size + expanded2.size;
  if (totalTokens === 0) return 0;

  return (2 * intersectionCount) / totalTokens;
}

/**
 * Calcula la distancia de Levenshtein entre dos cadenas para códigos numéricos o marcas.
 */
export function calculateLevenshteinDistance(str1: string, str2: string): number {
  const s1 = normalizeText(str1);
  const s2 = normalizeText(str2);
  const track = Array(s2.length + 1).fill(null).map(() =>
    Array(s1.length + 1).fill(null)
  );

  for (let i = 0; i <= s1.length; i += 1) track[0][i] = i;
  for (let j = 0; j <= s2.length; j += 1) track[j][0] = j;

  for (let j = 1; j <= s2.length; j += 1) {
    for (let i = 1; i <= s1.length; i += 1) {
      const indicator = s1[i - 1] === s2[j - 1] ? 0 : 1;
      track[j][i] = Math.min(
        track[j][i - 1] + 1, // inserción
        track[j - 1][i] + 1, // eliminación
        track[j - 1][i - 1] + indicator // sustitución
      );
    }
  }

  const maxLength = Math.max(s1.length, s2.length);
  if (maxLength === 0) return 1.0;
  return 1 - track[s2.length][s1.length] / maxLength;
}

/**
 * Motor Híbrido de Emparejamiento (Fuzzy String Matcher).
 * Retorna un score entre 0 y 100.
 */
export function computeMatchScore(competitorName: string, catalogProduct: Product): number {
  const diceScore = calculateDiceSimilarity(competitorName, catalogProduct.name);
  const skuScore = catalogProduct.sku ? calculateLevenshteinDistance(competitorName, catalogProduct.sku) : 0;
  const brandScore = catalogProduct.brand ? calculateDiceSimilarity(competitorName, catalogProduct.brand) : 0;

  // Combinación ponderada: 60% Nombre + 25% SKU + 15% Marca
  const combined = (diceScore * 0.60) + (skuScore * 0.25) + (brandScore * 0.15);
  return Math.round(Math.min(100, Math.max(0, combined * 100)));
}

/**
 * Procesa la lista de ítems extraídos por Gemini y los empareja con el catálogo de Firestore.
 */
export function matchCompetitorCatalog(
  competitorItems: CompetitorExtractedItem[],
  catalogProducts: Product[],
  globalSettings?: FinancialSettings | null
): MatchedResultItem[] {
  const bcvDiscount = globalSettings?.defaultBcvDiscount !== undefined ? globalSettings.defaultBcvDiscount : 25;
  const products: Product[] = Array.isArray(catalogProducts) ? catalogProducts : [];

  return competitorItems.map(item => {
    let foundProduct: Product | null = null;
    let highestScore = 0;

    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      const score = computeMatchScore(item.item, p);
      if (score > highestScore) {
        highestScore = score;
        foundProduct = p;
      }
    }

    const matchedProduct: Product | null = highestScore >= 40 ? foundProduct : null;
    const competitorPrice = item.price || 0;
    const myPriceListBCV = matchedProduct ? Number(matchedProduct.price || 0) : 0;
    const myPriceCashUSD = matchedProduct ? Number(matchedProduct.priceCashUSD || (myPriceListBCV * (1 - (bcvDiscount / 100)))) : 0;

    let priceDifferenceUSD = 0;
    let priceDifferencePercent = 0;
    let status: 'competitivo' | 'en_riesgo' | 'sin_coincidencia' = 'sin_coincidencia';
    let statusLabel = 'SIN COINCIDENCIA (NUEVO MERCADO)';
    let suggestedOptimalPrice = competitorPrice > 0 ? Number((competitorPrice * 0.95).toFixed(2)) : 0;
    let marginWarning = false;

    if (matchedProduct && competitorPrice > 0) {
      priceDifferenceUSD = myPriceCashUSD - competitorPrice;
      priceDifferencePercent = Number(((priceDifferenceUSD / competitorPrice) * 100).toFixed(1));

      if (myPriceCashUSD <= competitorPrice + 0.05) {
        status = 'competitivo';
        statusLabel = '🟢 COMPETITIVO (MEJOR O IGUAL PRECIO)';
      } else {
        status = 'en_riesgo';
        statusLabel = '🔴 EN RIESGO (MÁS CARO QUE COMPETENCIA)';
      }

      const cost = Number(matchedProduct.cost || 0);
      if (cost > 0 && suggestedOptimalPrice < cost * 1.15) {
        marginWarning = true;
        suggestedOptimalPrice = Number((cost * 1.15).toFixed(2));
      }
    }

    return {
      competitorItemName: item.item,
      competitorPrice,
      competitorCategory: item.category,
      competitorBrand: item.brand,
      competitorDiscipline: item.discipline || 'General',
      matchedProduct,
      similarityScore: highestScore,
      myPriceCashUSD,
      myPriceListBCV,
      priceDifferenceUSD,
      priceDifferencePercent,
      suggestedOptimalPrice,
      status,
      statusLabel,
      marginWarning
    };
  });
}
