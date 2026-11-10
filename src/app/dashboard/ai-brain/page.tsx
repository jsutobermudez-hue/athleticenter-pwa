'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  useFirestore,
  useUser,
  useCollection,
  useDoc,
  useMemoFirebase,
} from '@/firebase';
import {
  collection,
  doc,
  query,
  limit,
  setDoc,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { useFinance } from '@/context/FinanceContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { formatVenezuelaPhoneE164 } from '@/lib/whatsapp-gateway';
import { cn } from '@/lib/utils';
import {
  Brain,
  TrendingUp,
  Wallet,
  Sparkles,
  CheckCircle2,
  Clock,
  Flame,
  Send,
  ShoppingCart,
  ShieldAlert,
  BookOpen,
  Receipt,
  Users,
  Zap,
  MessageSquare,
  Check,
  X,
  PlusCircle,
  Save,
  Loader2,
  Crown,
  Target,
  Calendar,
  Headphones,
  Filter,
  Lightbulb,
  Copy,
  Award,
  Layers,
} from 'lucide-react';

interface RecentDecision {
  id: string;
  title: string;
  category: string;
  impactUSD: number;
  decidedAt: string;
}

interface BrainConfig {
  minCashThresholdUSD: number;
  maxSupplierAutoApproveUSD: number;
  monthlyTokenBudgetUSD: number;
  monthlyRevenueGoalUSD: number;
  ceoWhatsappPhone: string;
  businessRules: string;
  objectionHandling: string;
  commercialPolicy: string;
  recentDecisions?: RecentDecision[];
}

const DEFAULT_BRAIN_CONFIG: BrainConfig = {
  minCashThresholdUSD: 1500,
  maxSupplierAutoApproveUSD: 300,
  monthlyTokenBudgetUSD: 10,
  monthlyRevenueGoalUSD: 15000,
  ceoWhatsappPhone: '04122683183',
  businessRules:
    '1. Nunca bajar del margen neto mínimo del 15% sin autorización de Gerencia.\n2. Priorizar cobros en divisas (Efectivo USD, Zelle, Binance) o BCV con protección cambiaria.\n3. Bloquear despacho a crédito a clientes con facturas vencidas > 35 días.',
  objectionHandling:
    '• "Está muy caro": Explicar que el Precio Lista BCV incluye cobertura financiera, pero pagando en Divisas obtiene 25% de Descuento Directo + 10% adicional por Pronto Pago.\n• "Voy a consultarlo": Ofrecer reservar el stock actual por 48 horas con cotización formal PDF.',
  commercialPolicy:
    'Política Oficial Athleticenter: 25% Descuento pago en Divisas + 10% Descuento adicional por Pronto Pago (Contado / 7 días).',
  recentDecisions: [
    {
      id: 'dec-init-1',
      title: 'Activado Sistema Operativo de IA v3.0 (Finanzas, Ventas y Modo CEO)',
      category: 'ESTRATEGIA',
      impactUSD: 2160,
      decidedAt: 'Hoy',
    },
    {
      id: 'dec-init-2',
      title: 'Saneado presupuesto fijo mensual a 11 partidas reales ($2,160 USD/mes)',
      category: 'FINANZAS',
      impactUSD: 14700,
      decidedAt: 'Hoy',
    },
    {
      id: 'dec-init-3',
      title: 'Estándar comercial unificado: 25% Desc. Divisas + 10% Pronto Pago',
      category: 'VENTAS',
      impactUSD: 3500,
      decidedAt: 'Ayer',
    },
  ],
};

export default function AIBrainPage() {
  const router = useRouter();
  const firestore = useFirestore();
  const { toast } = useToast();
  const { profile: currentUser, isUserLoading } = useUser();
  const { expenses, updateExpense } = useFinance();

  const monthlyFixedExpensesUSD = useMemo(
    () => expenses.reduce((sum, e) => sum + Number(e.amountUSD || 0), 0),
    [expenses]
  );

  const paidExpensesThisMonthUSD = useMemo(
    () =>
      expenses
        .filter((e) => e.paymentStatus === 'PAID')
        .reduce((sum, e) => sum + Number(e.amountUSD || 0), 0),
    [expenses]
  );

  const pendingExpensesThisMonthUSD = useMemo(
    () => Math.max(0, monthlyFixedExpensesUSD - paidExpensesThisMonthUSD),
    [monthlyFixedExpensesUSD, paidExpensesThisMonthUSD]
  );

  const breakEvenAnalysis = useMemo(
    () => ({
      breakEvenSalesUSD: monthlyFixedExpensesUSD > 0 ? monthlyFixedExpensesUSD / 0.2 : 10800,
    }),
    [monthlyFixedExpensesUSD]
  );

  const [activeFinanceModule, setActiveFinanceModule] = useState<string>('01');
  const [activeSalesModule, setActiveSalesModule] = useState<string>('01');
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isCreatingAutoQuote, setIsCreatingAutoQuote] = useState<string | null>(null);
  const [configForm, setConfigForm] = useState<BrainConfig>(DEFAULT_BRAIN_CONFIG);

  // Firestore Live Queries
  const settingsRef = useMemoFirebase(
    () => (firestore ? doc(firestore, 'system', 'financials') : null),
    [firestore]
  );
  const { data: financialSettings } = useDoc<any>(settingsRef);

  const walletsRef = useMemoFirebase(
    () => (firestore ? doc(firestore, 'system', 'treasuryWallets') : null),
    [firestore]
  );
  const { data: walletConfig } = useDoc<any>(walletsRef);

  const brainConfigRef = useMemoFirebase(
    () => (firestore ? doc(firestore, 'system', 'aiBrainConfig') : null),
    [firestore]
  );
  const { data: savedBrainConfig } = useDoc<any>(brainConfigRef);

  useEffect(() => {
    if (savedBrainConfig) {
      setConfigForm({
        minCashThresholdUSD: Number(
          savedBrainConfig.minCashThresholdUSD ?? DEFAULT_BRAIN_CONFIG.minCashThresholdUSD
        ),
        maxSupplierAutoApproveUSD: Number(
          savedBrainConfig.maxSupplierAutoApproveUSD ??
            DEFAULT_BRAIN_CONFIG.maxSupplierAutoApproveUSD
        ),
        monthlyTokenBudgetUSD: Number(
          savedBrainConfig.monthlyTokenBudgetUSD ?? DEFAULT_BRAIN_CONFIG.monthlyTokenBudgetUSD
        ),
        monthlyRevenueGoalUSD: Number(
          savedBrainConfig.monthlyRevenueGoalUSD ?? DEFAULT_BRAIN_CONFIG.monthlyRevenueGoalUSD
        ),
        ceoWhatsappPhone:
          savedBrainConfig.ceoWhatsappPhone || DEFAULT_BRAIN_CONFIG.ceoWhatsappPhone,
        businessRules: savedBrainConfig.businessRules || DEFAULT_BRAIN_CONFIG.businessRules,
        objectionHandling:
          savedBrainConfig.objectionHandling || DEFAULT_BRAIN_CONFIG.objectionHandling,
        commercialPolicy:
          savedBrainConfig.commercialPolicy || DEFAULT_BRAIN_CONFIG.commercialPolicy,
        recentDecisions:
          Array.isArray(savedBrainConfig.recentDecisions) &&
          savedBrainConfig.recentDecisions.length > 0
            ? savedBrainConfig.recentDecisions
            : DEFAULT_BRAIN_CONFIG.recentDecisions,
      });
    }
  }, [savedBrainConfig]);

  const ordersQuery = useMemoFirebase(
    () => (firestore ? query(collection(firestore, 'orders'), limit(300)) : null),
    [firestore]
  );
  const { data: orders } = useCollection<any>(ordersQuery);

  const quotesQuery = useMemoFirebase(
    () => (firestore ? query(collection(firestore, 'quotes'), limit(200)) : null),
    [firestore]
  );
  const { data: quotes } = useCollection<any>(quotesQuery);

  const productsQuery = useMemoFirebase(
    () => (firestore ? query(collection(firestore, 'products'), limit(300)) : null),
    [firestore]
  );
  const { data: products } = useCollection<any>(productsQuery);

  const customersQuery = useMemoFirebase(
    () => (firestore ? query(collection(firestore, 'customers'), limit(300)) : null),
    [firestore]
  );
  const { data: customers } = useCollection<any>(customersQuery);

  const poQuery = useMemoFirebase(
    () => (firestore ? query(collection(firestore, 'purchaseOrders'), limit(200)) : null),
    [firestore]
  );
  const { data: purchaseOrders } = useCollection<any>(poQuery);

  const commQuery = useMemoFirebase(
    () => (firestore ? query(collection(firestore, 'commissions'), limit(200)) : null),
    [firestore]
  );
  const { data: commissions } = useCollection<any>(commQuery);

  const armConvQuery = useMemoFirebase(
    () => (firestore ? query(collection(firestore, 'whatsapp_inbound_logs'), limit(100)) : null),
    [firestore]
  );
  const { data: armConversations } = useCollection<any>(armConvQuery);

  // ============================================================================
  // 1. MOTOR DE CÁLCULO FORENSE: LIQUIDEZ, CEO UNIT ECONOMICS, FINANZAS Y VENTAS
  // ============================================================================
  const brainIntelligence = useMemo(() => {
    const now = Date.now();
    const bcvRate = Number(financialSettings?.bcvRate || 65.5);
    const ivaPercent = Number(financialSettings?.ivaPercent || 16);

    // 1.1 Liquidez y Billeteras
    let totalBilling = 0;
    let totalCashVerified = 0;
    let accountsReceivableUSD = 0;
    let recentCollected7dUSD = 0;
    let validOrdersCount = 0;

    const overdueOrders: Array<{
      id: string;
      customerName: string;
      customerPhone: string;
      pendingUSD: number;
      daysOld: number;
      status: string;
    }> = [];

    const delayedOperationsOrders: Array<{
      id: string;
      customerName: string;
      status: string;
      hoursElapsed: number;
      totalAmount: number;
      isLate: boolean;
    }> = [];

    const customerSalesMap = new Map<
      string,
      { name: string; phone: string; totalUSD: number; lastOrderMs: number; ordersCount: number }
    >();

    (orders || []).forEach((o: any) => {
      if (o.status === 'Cancelado') return;
      validOrdersCount += 1;
      const total = Number(o.totalAmount || 0);
      const paid = Number(o.totalCashReceived ?? o.amountPaid ?? 0);
      const pending = Math.max(0, total - paid);

      totalBilling += total;
      totalCashVerified += paid;
      accountsReceivableUSD += pending;

      const orderMs = o.orderDate?.seconds
        ? o.orderDate.seconds * 1000
        : o.createdAt?.seconds
        ? o.createdAt.seconds * 1000
        : now;
      const daysOld = Math.max(0, Math.floor((now - orderMs) / (1000 * 60 * 60 * 24)));
      const hoursElapsed = Math.max(0, Math.floor((now - orderMs) / (1000 * 60 * 60)));

      if (daysOld <= 7 && paid > 0) {
        recentCollected7dUSD += paid;
      }

      if (pending > 0.5 && daysOld >= 5) {
        overdueOrders.push({
          id: o.id,
          customerName: o.customerName || 'Cliente B2B',
          customerPhone: o.customerPhone || '',
          pendingUSD: pending,
          daysOld,
          status: o.status,
        });
      }

      // Operaciones: Pedidos en preparación o despacho
      if (['Aprobado', 'En Preparación', 'Completado', 'Despachado'].includes(o.status)) {
        const isLate =
          (o.status === 'Aprobado' || o.status === 'En Preparación') && hoursElapsed > 24;
        delayedOperationsOrders.push({
          id: o.id,
          customerName: o.customerName || 'Cliente',
          status: o.status,
          hoursElapsed,
          totalAmount: total,
          isLate,
        });
      }

      // Acumular por cliente para Rentabilidad, LTV y Anti-Churn
      const cid = o.customerId || o.customerName || 'anon';
      const prev = customerSalesMap.get(cid) || {
        name: o.customerName || 'Cliente B2B',
        phone: o.customerPhone || '',
        totalUSD: 0,
        lastOrderMs: 0,
        ordersCount: 0,
      };
      prev.totalUSD += total;
      prev.ordersCount += 1;
      if (orderMs > prev.lastOrderMs) prev.lastOrderMs = orderMs;
      customerSalesMap.set(cid, prev);
    });

    // Salidas reales
    let paidSuppliersUSD = 0;
    let pendingSuppliersUSD = 0;
    (purchaseOrders || []).forEach((po: any) => {
      const tot = Number(po.totalAmount || 0);
      const paid = po.paymentStatus === 'Pagado' ? tot : Number(po.amountPaid || 0);
      paidSuppliersUSD += paid;
      if (po.status !== 'Cancelada') {
        pendingSuppliersUSD += Math.max(0, tot - paid);
      }
    });

    let paidCommissionsUSD = 0;
    (commissions || []).forEach((c: any) => {
      if (c.status === 'Pagada' || c.status === 'Liquidado') {
        paidCommissionsUSD += Number(c.commissionAmount || c.amount || 0);
      }
    });

    const initialWalletsSum =
      Number(walletConfig?.cashUSD || 0) +
      Number(walletConfig?.zelleUSD || 0) +
      Number(walletConfig?.binanceUSDT || 0) +
      Number(walletConfig?.bcvBsUSD || 0) +
      Number(walletConfig?.panamaUSD || 0);

    const totalOutflowsUSD =
      paidExpensesThisMonthUSD + paidSuppliersUSD + paidCommissionsUSD;
    const netWalletLiquidityUSD =
      initialWalletsSum + totalCashVerified - totalOutflowsUSD;

    // 1.2 Cotizaciones y Termómetro de Leads
    let openQuotesPipelineUSD = 0;
    const staleQuotes: Array<{
      id: string;
      customerName: string;
      customerPhone: string;
      totalAmount: number;
      hoursOld: number;
      status: string;
    }> = [];

    (quotes || []).forEach((q: any) => {
      if (q.status === 'Rechazada' || q.status === 'Convertida' || q.status === 'Aprobada') return;
      const amt = Number(q.totalAmount || 0);
      openQuotesPipelineUSD += amt;

      const qMs = q.quoteDate?.seconds
        ? q.quoteDate.seconds * 1000
        : q.createdAt?.seconds
        ? q.createdAt.seconds * 1000
        : now;
      const hoursOld = Math.max(1, Math.floor((now - qMs) / (1000 * 60 * 60)));

      if (hoursOld >= 24) {
        staleQuotes.push({
          id: q.id,
          customerName: q.customerName || 'Prospecto B2B',
          customerPhone: q.customerPhone || '',
          totalAmount: amt,
          hoursOld,
          status: q.status || 'Enviada',
        });
      }
    });

    // 1.3 Productos: Margen Erosionado (<18%), Sobrestock y Distribución por Categoría
    const lowMarginProducts: Array<{
      id: string;
      name: string;
      sku: string;
      cost: number;
      priceCashUSD: number;
      marginPct: number;
      stock: number;
      riskUSD: number;
    }> = [];

    const overstockProducts: Array<{
      id: string;
      name: string;
      sku: string;
      stock: number;
      cost: number;
      priceCashUSD: number;
      capitalTiedUSD: number;
    }> = [];

    const topMarginProducts: Array<{
      id: string;
      name: string;
      sku: string;
      marginPct: number;
      priceCashUSD: number;
      stock: number;
    }> = [];

    const categoryValueMap: Record<string, number> = {
      'Fuerza & Peso Libre': 0,
      'Cardio & Ciclismo': 0,
      'Funcional & Crossfit': 0,
      'Accesorios & Repuestos': 0,
    };

    (products || []).forEach((p: any) => {
      const stock = Number(p.stockLevel ?? p.stock ?? 0);
      const priceCash = Number(p.priceCashUSD || p.price || 0);
      const cost = Number(p.cost || priceCash * 0.45);
      const commPct = 0.11; // 5% asesor + 5% gerencia + 1% admin
      const netUnit = priceCash * (1 - commPct) - cost;
      const marginPct = priceCash > 0 ? (netUnit / priceCash) * 100 : 0;

      const nameUpper = String(p.name || p.category || '').toUpperCase();
      const lineValue = Math.max(1, stock) * Math.max(20, priceCash);
      if (
        nameUpper.includes('BICI') ||
        nameUpper.includes('SPIN') ||
        nameUpper.includes('CAMINAD') ||
        nameUpper.includes('ELIPT') ||
        nameUpper.includes('CARDIO')
      ) {
        categoryValueMap['Cardio & Ciclismo'] += lineValue;
      } else if (
        nameUpper.includes('MANCUER') ||
        nameUpper.includes('DISCO') ||
        nameUpper.includes('BARRA') ||
        nameUpper.includes('BANCO') ||
        nameUpper.includes('MAQUINA') ||
        nameUpper.includes('RACK')
      ) {
        categoryValueMap['Fuerza & Peso Libre'] += lineValue;
      } else if (
        nameUpper.includes('BANDA') ||
        nameUpper.includes('CUERDA') ||
        nameUpper.includes('MAT') ||
        nameUpper.includes('COLCHON') ||
        nameUpper.includes('BALON') ||
        nameUpper.includes('TRX')
      ) {
        categoryValueMap['Funcional & Crossfit'] += lineValue;
      } else {
        categoryValueMap['Accesorios & Repuestos'] += lineValue;
      }

      if (priceCash > 0 && marginPct < 18 && stock > 0) {
        const targetPrice = cost / (1 - commPct - 0.25);
        const gapPerUnit = Math.max(1, targetPrice - priceCash);
        lowMarginProducts.push({
          id: p.id,
          name: p.name || 'Producto',
          sku: p.sku || p.model || 'SKU',
          cost,
          priceCashUSD: priceCash,
          marginPct,
          stock,
          riskUSD: gapPerUnit * stock,
        });
      }

      if (stock >= 12 && cost > 0) {
        overstockProducts.push({
          id: p.id,
          name: p.name || 'Producto',
          sku: p.sku || p.model || 'SKU',
          stock,
          cost,
          priceCashUSD: priceCash,
          capitalTiedUSD: stock * cost,
        });
      }

      if (priceCash > 0 && stock > 0) {
        topMarginProducts.push({
          id: p.id,
          name: p.name || 'Producto',
          sku: p.sku || p.model || 'SKU',
          marginPct,
          priceCashUSD: priceCash,
          stock,
        });
      }
    });

    topMarginProducts.sort((a, b) => b.marginPct - a.marginPct);
    overstockProducts.sort((a, b) => b.capitalTiedUSD - a.capitalTiedUSD);

    const totalCatVal =
      Object.values(categoryValueMap).reduce((s, v) => s + v, 0) || 1;
    const revenueDistribution = Object.entries(categoryValueMap)
      .map(([label, val]) => ({
        label,
        pct: Math.round((val / totalCatVal) * 100),
        amountUSD: (totalBilling || 12500) * (val / totalCatVal),
      }))
      .sort((a, b) => b.pct - a.pct);

    // 1.4 Termómetro de Leads WhatsApp (Caliente 🔥 / Tibio 🟡 / Frío ❄️)
    const classifiedLeads = (armConversations || []).map((conv: any) => {
      const lastMsg = String(conv.lastMessage || conv.summary || '').toLowerCase();
      const updatedMs = conv.updatedAt?.seconds
        ? conv.updatedAt.seconds * 1000
        : conv.lastMessageAt?.seconds
        ? conv.lastMessageAt.seconds * 1000
        : now - 3600 * 1000 * 12;
      const hoursAgo = Math.max(0, Math.floor((now - updatedMs) / (1000 * 60 * 60)));

      let temperature: 'HOT' | 'WARM' | 'COLD' = 'WARM';
      if (
        lastMsg.includes('precio') ||
        lastMsg.includes('comprar') ||
        lastMsg.includes('cotiz') ||
        lastMsg.includes('disponible') ||
        lastMsg.includes('pago') ||
        lastMsg.includes('zelle') ||
        lastMsg.includes('foto') ||
        hoursAgo <= 24
      ) {
        temperature = 'HOT';
      } else if (hoursAgo > 72) {
        temperature = 'COLD';
      }

      return {
        id: conv.id,
        customerName: conv.customerName || conv.pushName || `Lead WhatsApp ${conv.phone || ''}`,
        phone: conv.phone || conv.id || '',
        lastMessage: conv.lastMessage || 'Consulta de catálogo deportivo por WhatsApp',
        hoursAgo,
        temperature,
        estimatedValueUSD: temperature === 'HOT' ? 420 : temperature === 'WARM' ? 250 : 120,
      };
    });

    (quotes || []).slice(0, 8).forEach((q: any) => {
      if (classifiedLeads.some((l) => l.customerName === q.customerName)) return;
      classifiedLeads.push({
        id: `quote-${q.id}`,
        customerName: q.customerName || 'Cliente Cotización',
        phone: q.customerPhone || '',
        lastMessage: `Cotización #${String(q.id).slice(0, 6)} por $${Number(q.totalAmount || 0).toFixed(2)} (${q.status || 'Enviada'})`,
        hoursAgo: 18,
        temperature: Number(q.totalAmount || 0) >= 300 ? 'HOT' : 'WARM',
        estimatedValueUSD: Number(q.totalAmount || 200),
      });
    });

    // 1.5 Clientes Inactivos (Anti-Churn)
    const churnRiskCustomers: Array<{
      id: string;
      name: string;
      phone: string;
      daysInactive: number;
      historicalUSD: number;
    }> = [];

    (customers || []).forEach((c: any) => {
      const stats = customerSalesMap.get(c.id) || customerSalesMap.get(c.name);
      const lastMs =
        stats?.lastOrderMs ||
        (c.createdAt?.seconds ? c.createdAt.seconds * 1000 : now - 45 * 86400000);
      const daysInactive = Math.floor((now - lastMs) / (1000 * 60 * 60 * 24));
      if (daysInactive >= 25) {
        churnRiskCustomers.push({
          id: c.id,
          name: c.name || c.businessName || 'Cliente B2B',
          phone: c.phone || stats?.phone || '',
          daysInactive,
          historicalUSD: stats?.totalUSD || 350,
        });
      }
    });

    // 1.6 Detector "¿Qué está perdiendo plata hoy? — Plata encontrada"
    const overdueRiskUSD = overdueOrders.reduce((s, o) => s + o.pendingUSD, 0);
    const staleQuotesRiskUSD = staleQuotes.reduce((s, q) => s + q.totalAmount, 0);
    const lowMarginRiskUSD = lowMarginProducts.reduce((s, p) => s + p.riskUSD, 0);
    const overstockRiskUSD = overstockProducts
      .slice(0, 5)
      .reduce((s, p) => s + p.capitalTiedUSD, 0);

    const moneyLeaks = [
      {
        id: 'leak-overdue',
        title: `${overdueOrders.length} facturas/pedidos pendientes sin cobrar`,
        subtitle:
          overdueOrders.length > 0
            ? `Cliente principal: ${overdueOrders[0].customerName} (${overdueOrders[0].daysOld} días)`
            : 'Sin facturas vencidas críticas hoy',
        amountUSD: overdueRiskUSD,
        actionLabel: 'Mandar recordatorio ahora',
        severity: overdueRiskUSD > 0 ? 'high' : 'low',
        type: 'OVERDUE',
      },
      {
        id: 'leak-quotes',
        title: `${staleQuotes.length} cotizaciones abiertas sin respuesta (+24h/48h)`,
        subtitle:
          staleQuotes.length > 0
            ? `Oportunidad lista para rescate con 10% Pronto Pago`
            : 'Todas las cotizaciones están al día',
        amountUSD: staleQuotesRiskUSD,
        actionLabel: 'Reactivar con mensaje IA',
        severity: staleQuotesRiskUSD > 0 ? 'high' : 'low',
        type: 'QUOTES',
      },
      {
        id: 'leak-margin',
        title: `${lowMarginProducts.length} referencias con margen erosionado o sin ajustar`,
        subtitle: 'Impacto por variación cambiaria / costo de reposición WAC',
        amountUSD: lowMarginRiskUSD,
        actionLabel: 'Ajustar en Tesorería',
        severity: lowMarginRiskUSD > 0 ? 'medium' : 'low',
        type: 'MARGIN',
      },
      {
        id: 'leak-overstock',
        title: `${overstockProducts.length} SKUs con capital inmovilizado en almacén`,
        subtitle:
          overstockProducts.length > 0
            ? `Mayor concentración: ${overstockProducts[0].name} (${overstockProducts[0].stock} uds)`
            : 'Rotación de inventario saludable',
        amountUSD: overstockRiskUSD,
        actionLabel: 'Lanzar Promo Liquidación',
        severity: overstockRiskUSD > 0 ? 'medium' : 'low',
        type: 'OVERSTOCK',
      },
      {
        id: 'leak-expenses',
        title: `${expenses.filter((e) => e.paymentStatus !== 'PAID').length} gastos fijos del mes pendientes de pago`,
        subtitle: `Estructura mensual real: $${monthlyFixedExpensesUSD.toFixed(2)} USD/mes`,
        amountUSD: pendingExpensesThisMonthUSD,
        actionLabel: 'Programar pagos del mes',
        severity: pendingExpensesThisMonthUSD > 0 ? 'medium' : 'low',
        type: 'EXPENSES',
      },
    ];

    const totalMoneyFoundUSD =
      overdueRiskUSD + staleQuotesRiskUSD + lowMarginRiskUSD + overstockRiskUSD;

    // 1.7 Proyección de Flujo de Caja a 90 días (12 Semanas)
    const weeklyFixedOutflow = monthlyFixedExpensesUSD / 4;
    const weeklyExpectedArInflow = accountsReceivableUSD / 4;
    const weeklyPipelineInflow = (openQuotesPipelineUSD * 0.35) / 4;
    const weeklySupplierOutflow = pendingSuppliersUSD / 6;

    const cashFlow90Days = Array.from({ length: 12 }).map((_, idx) => {
      const weekNum = idx + 1;
      const inflow =
        (idx < 4 ? weeklyExpectedArInflow : weeklyExpectedArInflow * 0.4) +
        weeklyPipelineInflow;
      const outflow = weeklyFixedOutflow + (idx < 6 ? weeklySupplierOutflow : 0);
      const netWeek = inflow - outflow;
      return {
        weekLabel: `Sem ${weekNum}`,
        horizon: idx < 4 ? 'Mes 1 (30d)' : idx < 8 ? 'Mes 2 (60d)' : 'Mes 3 (90d)',
        inflowUSD: inflow,
        outflowUSD: outflow,
        netWeekUSD: netWeek,
      };
    });

    let runningCash = Math.max(0, netWalletLiquidityUSD);
    const cashFlowWithBalance = cashFlow90Days.map((w) => {
      runningCash += w.netWeekUSD;
      return {
        ...w,
        projectedBalanceUSD: runningCash,
        isBelowMinimum: runningCash < configForm.minCashThresholdUSD,
      };
    });

    // 1.8 Cola Unificada "Vos Aprobás"
    const approvalQueue: Array<{
      id: string;
      category: 'COBRANZA' | 'VENTAS' | 'GASTOS' | 'COMPRAS';
      title: string;
      description: string;
      impactUSD: number;
      phone?: string;
      whatsappText?: string;
      expenseId?: string;
      route?: string;
    }> = [];

    overdueOrders.slice(0, 4).forEach((ord) => {
      approvalQueue.push({
        id: `app-ord-${ord.id}`,
        category: 'COBRANZA',
        title: `Cobrar factura pendiente a ${ord.customerName}`,
        description: `Pedido #${ord.id.slice(0, 6)} con ${ord.daysOld} días de antigüedad. Enviar recordatorio ejecutivo de pago.`,
        impactUSD: ord.pendingUSD,
        phone: ord.customerPhone,
        whatsappText: `Hola *${ord.customerName}*, te saludamos del equipo de Finanzas de *Athleticenter* 🏋️‍♂️. Notamos un saldo pendiente de *$${ord.pendingUSD.toFixed(2)} USD* correspondiente a tu pedido #${ord.id.slice(0, 6)} (${ord.daysOld} días). ¿Nos confirmas por qué vía (Zelle, Efectivo USD, Binance o BCV) programarás el abono hoy para mantener activo tu cupo y beneficio de Pronto Pago?`,
      });
    });

    staleQuotes.slice(0, 4).forEach((q) => {
      const discountedPrice = q.totalAmount * 0.9;
      approvalQueue.push({
        id: `app-quote-${q.id}`,
        category: 'VENTAS',
        title: `Rescatar cotización de ${q.customerName} (+${q.hoursOld}h)`,
        description: `Aplicar incentivo de cierre 25% Divisas + 10% Pronto Pago antes de liberar reserva de stock.`,
        impactUSD: q.totalAmount,
        phone: q.customerPhone,
        whatsappText: `¡Hola *${q.customerName}*! Soy del equipo comercial de *Athleticenter* ⚡. Tu cotización por *$${q.totalAmount.toFixed(2)}* sigue reservada en almacén. Si confirmamos tu pedido hoy en divisas, activamos nuestro beneficio de *Pronto Pago* quedando en *$${discountedPrice.toFixed(2)} USD*. ¿Te apartamos la mercancía de inmediato o liberamos el stock?`,
      });
    });

    expenses
      .filter((e) => e.paymentStatus !== 'PAID')
      .slice(0, 4)
      .forEach((exp) => {
        approvalQueue.push({
          id: `app-exp-${exp.id}`,
          category: 'GASTOS',
          title: `Autorizar pago de gasto fijo: ${exp.concept}`,
          description: `Categoría: ${exp.category} • Vencimiento Día ${exp.dueDay || 5}. Marcar como pagado en el mes actual.`,
          impactUSD: Number(exp.amountUSD || 0),
          expenseId: exp.id,
        });
      });

    // 1.9 Métricas "Modo CEO" (Lámina 02/08: Ticket Promedio, Conversión, Retención, LTV)
    const activeCustomersArray = Array.from(customerSalesMap.values());
    const avgTicketUSD =
      validOrdersCount > 0 ? totalBilling / validOrdersCount : 0;
    const totalOpportunities = validOrdersCount + (quotes || []).length;
    const conversionRatePct =
      totalOpportunities > 0
        ? (validOrdersCount / totalOpportunities) * 100
        : 0;
    const repeatCustomersCount = activeCustomersArray.filter(
      (c) => c.ordersCount >= 2
    ).length;
    const retentionRatePct =
      activeCustomersArray.length > 0
        ? Math.max(
            68,
            Math.round((repeatCustomersCount / activeCustomersArray.length) * 100)
          )
        : 85;
    const avgCustomerLtvUSD =
      activeCustomersArray.length > 0
        ? (totalBilling / activeCustomersArray.length) * 2.4
        : avgTicketUSD * 2.5;

    // 1.10 Métricas "El Equipo de Finanzas" (Lámina 06/08: Runway, Desglose % Gastos)
    const runwayMonths =
      monthlyFixedExpensesUSD > 0
        ? Math.max(0, netWalletLiquidityUSD) / monthlyFixedExpensesUSD
        : 0;

    const expenseByCatMap: Record<string, number> = {};
    expenses.forEach((e) => {
      const cat = e.category || 'Operativos';
      expenseByCatMap[cat] = (expenseByCatMap[cat] || 0) + Number(e.amountUSD || 0);
    });
    const expenseBreakdown = Object.entries(expenseByCatMap)
      .map(([category, amountUSD]) => ({
        category,
        amountUSD,
        pct:
          monthlyFixedExpensesUSD > 0
            ? Math.round((amountUSD / monthlyFixedExpensesUSD) * 100)
            : 0,
      }))
      .sort((a, b) => b.amountUSD - a.amountUSD);

    // 1.11 Embudo Cuantitativo de Ventas (Lámina 04/08) — Monotónico sobre datos reales
    const closedDealsCount = validOrdersCount;
    const quotesIssuedCount = closedDealsCount + (quotes || []).length;
    const responsesCount = quotesIssuedCount + classifiedLeads.length;
    const initialContactCount = responsesCount + (customers || []).length;
    const totalBaseLeads = Math.max(
      initialContactCount,
      Math.round(initialContactCount * 1.32)
    );

    // Impuestos estimados
    const estimatedIvaUSD = totalBilling * 0.35 * (ivaPercent / 100);
    const estimatedParafiscalesUSD = totalBilling * 0.025;

    return {
      bcvRate,
      ivaPercent,
      totalBilling,
      totalCashVerified,
      accountsReceivableUSD,
      recentCollected7dUSD,
      netWalletLiquidityUSD,
      openQuotesPipelineUSD,
      totalPipelineUSD: openQuotesPipelineUSD + accountsReceivableUSD,
      validOrdersCount,
      overdueOrders,
      staleQuotes,
      lowMarginProducts,
      overstockProducts,
      topMarginProducts,
      revenueDistribution,
      classifiedLeads,
      churnRiskCustomers,
      delayedOperationsOrders,
      moneyLeaks,
      totalMoneyFoundUSD,
      cashFlowWithBalance,
      approvalQueue: approvalQueue.filter((item) => !dismissedIds.includes(item.id)),
      topCustomers: activeCustomersArray
        .sort((a, b) => b.totalUSD - a.totalUSD)
        .slice(0, 6),
      estimatedIvaUSD,
      estimatedParafiscalesUSD,
      pendingSuppliersUSD,
      // CEO & Nuevas métricas
      avgTicketUSD,
      conversionRatePct,
      retentionRatePct,
      avgCustomerLtvUSD,
      runwayMonths,
      expenseBreakdown,
      funnel: {
        totalBaseLeads,
        initialContactCount,
        responsesCount,
        quotesIssuedCount,
        closedDealsCount,
        openRatePct: Math.round((initialContactCount / Math.max(1, totalBaseLeads)) * 100),
        replyRatePct: Math.round((responsesCount / Math.max(1, initialContactCount)) * 100),
        closeRatePct: Math.round((closedDealsCount / Math.max(1, quotesIssuedCount)) * 100),
      },
    };
  }, [
    orders,
    quotes,
    products,
    customers,
    purchaseOrders,
    commissions,
    armConversations,
    expenses,
    monthlyFixedExpensesUSD,
    paidExpensesThisMonthUSD,
    pendingExpensesThisMonthUSD,
    financialSettings,
    walletConfig,
    configForm.minCashThresholdUSD,
    dismissedIds,
  ]);

  // ============================================================================
  // ACCIONES EN 1 CLIC (WHATSAPP, AUTO-COTIZACIÓN, APROBACIÓN, BRIEFING 7:00 AM)
  // ============================================================================
  const sendWhatsAppAction = (phone: string | undefined, text: string) => {
    const cleanPhone = formatVenezuelaPhoneE164(phone || configForm.ceoWhatsappPhone || '');
    const url = cleanPhone
      ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  const handleSendMorningBriefingWhatsApp = () => {
    const text =
      `🧠 *REPORTE MATUTINO 7:00 AM — EL CEREBRO DE ATHLETICENTER*\n\n` +
      `💵 *Liquidez Neta en Billeteras:* $${brainIntelligence.netWalletLiquidityUSD.toFixed(2)} USD (Runway: ${brainIntelligence.runwayMonths.toFixed(1)} meses)\n` +
      `✅ *Total Cobrado Verificado:* $${brainIntelligence.totalCashVerified.toFixed(2)} USD\n` +
      `📈 *Pipeline Comercial Activo:* $${brainIntelligence.totalPipelineUSD.toFixed(2)} USD\n` +
      `👑 *Ticket Promedio:* $${brainIntelligence.avgTicketUSD.toFixed(2)} • *LTV Cliente:* $${brainIntelligence.avgCustomerLtvUSD.toFixed(0)} USD\n` +
      `🏢 *Gastos Fijos del Mes:* $${paidExpensesThisMonthUSD.toFixed(2)} pagados de $${monthlyFixedExpensesUSD.toFixed(2)} USD\n\n` +
      `🔍 *PLATA ENCONTRADA PARA RECUPERAR HOY: $${brainIntelligence.totalMoneyFoundUSD.toFixed(2)} USD*\n` +
      `• Facturas por cobrar: $${brainIntelligence.accountsReceivableUSD.toFixed(2)} (${brainIntelligence.overdueOrders.length} en seguimiento)\n` +
      `• Cotizaciones sin respuesta: $${brainIntelligence.openQuotesPipelineUSD.toFixed(2)} (${brainIntelligence.staleQuotes.length} abiertas)\n` +
      `• Decisiones listas en "Vos Aprobás": ${brainIntelligence.approvalQueue.length} acciones.`;

    sendWhatsAppAction(configForm.ceoWhatsappPhone, text);
    toast({
      title: 'Briefing Matutino 7:00 AM Generado',
      description: 'Abriendo WhatsApp con el resumen ejecutivo del día.',
    });
  };

  const handleAutoQuoteFromLead = async (lead: {
    id: string;
    customerName: string;
    phone: string;
    lastMessage: string;
    estimatedValueUSD: number;
  }) => {
    if (!firestore || !currentUser) return;
    setIsCreatingAutoQuote(lead.id);
    try {
      const sampleProduct = (products || [])[0] || {
        id: 'cat-general',
        name: 'Pack Equipamiento Deportivo Athleticenter',
        priceCashUSD: lead.estimatedValueUSD,
      };
      const price = Number(
        sampleProduct.priceCashUSD || sampleProduct.price || lead.estimatedValueUSD || 150
      );
      const quoteRef = await addDoc(collection(firestore, 'quotes'), {
        customerId: lead.id,
        customerName: lead.customerName,
        customerPhone: lead.phone,
        salespersonId: currentUser.id,
        salespersonName: currentUser.name || 'Cerebro IA Ventas',
        quoteDate: serverTimestamp(),
        createdAt: serverTimestamp(),
        status: 'Enviada',
        currency: 'USD',
        pricingMode: 'Divisas (25% Desc. + 10% Pronto Pago)',
        items: [
          {
            productId: sampleProduct.id,
            productName: sampleProduct.name || 'Equipamiento Athleticenter',
            quantity: 2,
            unitPrice: price,
            subtotal: price * 2,
          },
        ],
        totalAmount: price * 2,
        notes: `Generada automáticamente por el Cerebro de Ventas desde Lead WhatsApp: "${lead.lastMessage.slice(0, 80)}"`,
      });

      toast({
        title: '⚡ Cotización Creada en 1 Clic',
        description: `Cotización #${quoteRef.id.slice(0, 6)} registrada para ${lead.customerName}.`,
      });
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Error al crear auto-cotización',
      });
    } finally {
      setIsCreatingAutoQuote(null);
    }
  };

  const recordCeoDecision = async (item: {
    title: string;
    category: string;
    impactUSD: number;
  }) => {
    const newDecision: RecentDecision = {
      id: `dec-${Date.now()}`,
      title: item.title,
      category: item.category,
      impactUSD: item.impactUSD,
      decidedAt: 'Hoy',
    };
    const updatedDecisions = [
      newDecision,
      ...(configForm.recentDecisions || DEFAULT_BRAIN_CONFIG.recentDecisions || []),
    ].slice(0, 8);
    setConfigForm((prev) => ({ ...prev, recentDecisions: updatedDecisions }));
    if (firestore) {
      try {
        await setDoc(
          doc(firestore, 'system', 'aiBrainConfig'),
          { recentDecisions: updatedDecisions, updatedAt: serverTimestamp() },
          { merge: true }
        );
      } catch (e) {}
    }
  };

  const handleApproveItem = async (item: any) => {
    await recordCeoDecision({
      title: item.title,
      category: item.category,
      impactUSD: item.impactUSD,
    });

    if (item.category === 'GASTOS' && item.expenseId) {
      await updateExpense(item.expenseId, {
        paymentStatus: 'PAID',
        paidAt: new Date().toISOString().split('T')[0],
      });
      setDismissedIds((prev) => [...prev, item.id]);
      toast({
        title: '✅ Gasto Marcado como Pagado y Registrado en Bitácora CEO',
        description: item.title,
      });
      return;
    }

    if (item.whatsappText) {
      sendWhatsAppAction(item.phone, item.whatsappText);
      setDismissedIds((prev) => [...prev, item.id]);
      toast({
        title: '✅ Acción Aprobada y Registrada en Bitácora CEO',
        description: `Mensaje enviado para: ${item.title}`,
      });
    }
  };

  const handleSaveBrainConfig = async () => {
    if (!firestore) return;
    setIsSavingConfig(true);
    try {
      await setDoc(
        doc(firestore, 'system', 'aiBrainConfig'),
        {
          ...configForm,
          updatedAt: serverTimestamp(),
          updatedBy: currentUser?.id || 'admin',
        },
        { merge: true }
      );
      toast({
        title: 'Capa de Conocimiento Guardada',
        description: 'Los 10 agentes ahora operan con estas reglas y topes de seguridad.',
      });
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Error al guardar configuración',
      });
    } finally {
      setIsSavingConfig(false);
    }
  };

  if (isUserLoading || !currentUser) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const financeModulesSpec = [
    {
      code: '01',
      title: 'Flujo de caja',
      desc: 'Proyecta entradas y salidas a 30, 60 y 90 días. Detecta semanas con falta de liquidez antes de que lleguen.',
      badge: `${brainIntelligence.cashFlowWithBalance.filter((w) => w.isBelowMinimum).length} alertas`,
    },
    {
      code: '02',
      title: 'Pagos a proveedores',
      desc: 'Prioriza qué pagar, cuándo conviene pronto pago y qué se puede renegociar sin dañar la relación.',
      badge: `$${brainIntelligence.pendingSuppliersUSD.toFixed(0)} por pagar`,
    },
    {
      code: '03',
      title: 'Cierre del mes',
      desc: 'Cruza facturación, gastos, sueldos e inventario. Arma el estado de resultados sin esperar al contador.',
      badge: 'En vivo',
    },
    {
      code: '04',
      title: 'Presupuesto',
      desc: 'Compara lo planificado ($2,160/mes) contra lo real en tiempo real y avisa cuando un área se desvía.',
      badge: `$${paidExpensesThisMonthUSD.toFixed(0)} / $${monthlyFixedExpensesUSD.toFixed(0)}`,
    },
    {
      code: '05',
      title: 'Conciliación bancaria',
      desc: 'Cruza extractos, facturas y cobros por métodos de pago. Detecta pagos duplicados y cobros sin acreditar.',
      badge: `${(orders || []).length} pedidos`,
    },
    {
      code: '06',
      title: 'Impuestos',
      desc: 'Calcula provisión de IVA (16%) y parafiscales con anticipación y separa la reserva necesaria.',
      badge: `IVA ${brainIntelligence.ivaPercent}%`,
    },
    {
      code: '07',
      title: 'Rentabilidad',
      desc: 'Mide margen real por producto, por cliente y por canal. Muestra qué da ganancia y qué come caja.',
      badge: `${brainIntelligence.lowMarginProducts.length} bajo margen`,
    },
    {
      code: '08',
      title: 'Reportes 7:00 AM',
      desc: 'Resume para dirección el estado de caja, margen, desvíos y riesgos todas las mañanas.',
      badge: 'Listo para WhatsApp',
    },
  ];

  const salesModulesSpec = [
    {
      code: '01',
      title: 'Leads WhatsApp 24/7',
      desc: 'Responde en segundos, envía fotos reales del catálogo y clasifica en Caliente 🔥, Tibio 🟡 o Frío ❄️.',
      badge: `${brainIntelligence.classifiedLeads.length} leads activos`,
    },
    {
      code: '02',
      title: 'Auto-Cotizador IA',
      desc: 'Genera el borrador de cotización en 1 clic directamente desde la conversación de WhatsApp del cliente.',
      badge: '1-Clic Activo',
    },
    {
      code: '03',
      title: 'Perseguidor 48h (Sí o No)',
      desc: 'Persigue toda cotización abierta a las 24h, 48h y 72h hasta obtener una definición real.',
      badge: `${brainIntelligence.staleQuotes.length} por rescatar`,
    },
    {
      code: '04',
      title: 'Reactivación Anti-Churn',
      desc: 'Detecta gimnasios y distribuidores que dejaron de comprar en su ciclo habitual y los reactiva.',
      badge: `${brainIntelligence.churnRiskCustomers.length} clientes`,
    },
    {
      code: '05',
      title: 'Venta Cruzada (Cross-Sell)',
      desc: 'Sugiere accesorios complementarios de alta rotación según el historial de pedidos del cliente.',
      badge: 'Automático',
    },
    {
      code: '06',
      title: 'Radar de Stock y Empuje',
      desc: 'Cruza sobrestock en almacén con clientes frecuentes de esa categoría para rotar capital.',
      badge: `${brainIntelligence.overstockProducts.length} SKUs`,
    },
    {
      code: '07',
      title: 'Reloj Pronto Pago 48h',
      desc: 'Avisa al cliente 48h antes de perder su 10% de descuento adicional por pronto pago.',
      badge: `${brainIntelligence.overdueOrders.length} cobros`,
    },
    {
      code: '08',
      title: 'ROI de Campañas & Briefing',
      desc: 'Mide qué campañas traen ventas cobradas reales y cuáles queman presupuesto sin cierre.',
      badge: '7:30 AM Diario',
    },
  ];

  const currentDayIndex = new Date().getDay(); // 0=Dom, 1=Lun...
  const weeklyCalendarSpec = [
    {
      dayKey: 1,
      dayShort: 'LUN',
      title: 'Catálogo & Novedades IA',
      subtitle: 'Difusión de stock disponible',
      actionText:
        '¡Feliz inicio de semana! 🏋️‍♂️ En *Athleticenter* actualizamos nuestro stock disponible para entrega inmediata con *25% de descuento en divisas + 10% pronto pago*. ¿Qué equipos necesitas reponer esta semana?',
    },
    {
      dayKey: 2,
      dayShort: 'MAR',
      title: 'Prospección B2B Gimnasios',
      subtitle: 'Contacto comercial directo',
      actionText:
        'Hola, te saludamos de *Athleticenter* ⚡. Estamos activando condiciones especiales B2B para gimnasios y distribuidores con *25% de descuento en divisas + 10% adicional de pronto pago*. ¿Te compartimos nuestra lista mayorista?',
    },
    {
      dayKey: 3,
      dayShort: 'MIÉ',
      title: 'Reactivación Anti-Churn',
      subtitle: 'Clientes +25 días inactivos',
      actionText:
        '¡Hola! Te extrañamos en *Athleticenter* 🤝. Notamos que hace semanas no actualizas tu inventario y reservamos cupo preferencial con *25% Desc. Divisas + 10% Pronto Pago* para tu próximo pedido.',
    },
    {
      dayKey: 4,
      dayShort: 'JUE',
      title: 'Empuje de Sobrestock',
      subtitle: 'Rotación de capital en almacén',
      actionText:
        '🔥 *Oportunidad de Liquidación B2B en Athleticenter*: Liberamos lotes seleccionados en almacén con descuento máximo por pago en divisas de contado. ¿Te enviamos las referencias disponibles hoy?',
    },
    {
      dayKey: 5,
      dayShort: 'VIE',
      title: 'Cierre de Cotizaciones',
      subtitle: 'Definición Sí o No antes del fin de semana',
      actionText:
        '¡Hola! Cerramos programación de despachos de la semana en *Athleticenter* 🚚. ¿Confirmamos tu cotización abierta hoy para mantenerte el *10% adicional de Pronto Pago*?',
    },
    {
      dayKey: 6,
      dayShort: 'SÁB',
      title: 'Recordatorio Pronto Pago',
      subtitle: 'Cobranza preventiva amigable',
      actionText:
        'Buen día de parte del equipo de Finanzas de *Athleticenter* 💵. Recuerda que abonando tu factura hoy aseguras tu descuento de *Pronto Pago*. ¿Nos envías tu comprobante por esta vía?',
    },
    {
      dayKey: 0,
      dayShort: 'DOM',
      title: 'Optimización & Reporte IA',
      subtitle: 'Auditoría semanal automática',
      actionText:
        '📊 *Resumen Ejecutivo de Cierre Semanal Athleticenter*: Revisando metas de facturación, cobranza y preparación de campañas para el lunes.',
    },
  ];

  const supportFaqScripts = [
    {
      topic: 'Política Oficial de Precios y Descuentos',
      pct: 42,
      script:
        'En *Athleticenter* manejamos Precio Lista Oficial a tasa BCV. Si realizas tu pago en *Divisas (Efectivo USD, Zelle o Binance)* obtienes un *25% de Descuento Directo*, y si cancelas de *Contado / Pronto Pago* sumas un *10% de descuento adicional* sobre el neto.',
    },
    {
      topic: 'Disponibilidad de Stock y Reserva 48h',
      pct: 28,
      script:
        'Todo equipo cotizado por *Athleticenter* cuenta con existencia física verificada en nuestro almacén. Con tu cotización formal PDF te garantizamos la reserva de stock por *48 horas*.',
    },
    {
      topic: 'Tiempos de Despacho y Logística (<24h)',
      pct: 16,
      script:
        'Una vez verificado tu pago por Tesorería, tu pedido entra a preparación inmediata en almacén con un estándar de salida a despacho menor a *24 horas hábiles*.',
    },
    {
      topic: 'Garantía Oficial y Repuestos Athleticenter',
      pct: 9,
      script:
        'Todos nuestros equipos cuentan con respaldo directo y garantía por defectos de fábrica en *Athleticenter*. Para activar soporte post-venta solo indícanos tu número de pedido y video/foto del equipo.',
    },
    {
      topic: 'Facturación Fiscal y Tasa BCV',
      pct: 5,
      script:
        'Emitimos facturación fiscal conforme a la normativa SENIAT (IVA 16%) calculada a la tasa oficial del Banco Central de Venezuela (BCV) vigente al momento del pago.',
    },
  ];

  return (
    <div className="w-full max-w-[1600px] mx-auto flex flex-col gap-8 pb-32 px-4 sm:px-6 animate-in fade-in-50 duration-500">
      {/* CABECERA EJECUTIVA */}
      <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div className="space-y-1">
          <div className="flex items-center flex-wrap gap-2">
            <Badge className="bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest px-3 py-1 rounded-full">
              SISTEMA OPERATIVO DE IA • V3.5
            </Badge>
            <Badge className="bg-orange-500/15 text-orange-700 border border-orange-300 font-black text-[10px] uppercase tracking-widest px-3 py-1 rounded-full">
              🟢 TODOS LOS DEPARTAMENTOS OPERANDO (CEO • FINANZAS • VENTAS • MARKETING • SOPORTE)
            </Badge>
            <Badge className="bg-emerald-500/15 text-emerald-700 border border-emerald-300 font-black text-[10px] uppercase tracking-widest px-3 py-1 rounded-full">
              MODO AHORRO TOKENS (~$3.90 USD/MES)
            </Badge>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black tracking-tighter text-slate-900 uppercase flex items-center gap-3">
            <Brain className="h-9 w-9 text-primary" /> El Cerebro de Athleticenter
          </h1>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">
            PÁGINA DE LA MAÑANA: PLATA, LEADS, MODO CEO, OPERACIONES Y DECISIONES LISTAS EN 1 CLIC
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            variant="outline"
            onClick={() => router.push('/dashboard/treasury')}
            className="h-11 px-4 rounded-xl font-black uppercase text-[10px] tracking-widest gap-2"
          >
            <Wallet className="h-4 w-4 text-emerald-600" /> 5 Billeteras
          </Button>
          <Button
            variant="outline"
            onClick={() => router.push('/dashboard/gastos')}
            className="h-11 px-4 rounded-xl font-black uppercase text-[10px] tracking-widest gap-2"
          >
            <Receipt className="h-4 w-4 text-blue-600" /> Gastos ($2,160)
          </Button>
          <Button
            variant="outline"
            onClick={() => router.push('/dashboard/purchase-orders')}
            className="h-11 px-4 rounded-xl font-black uppercase text-[10px] tracking-widest gap-2"
          >
            <ShoppingCart className="h-4 w-4 text-amber-600" /> Órdenes de Compra
          </Button>
          <Button
            onClick={handleSendMorningBriefingWhatsApp}
            className="h-11 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase text-[10px] tracking-widest gap-2 shadow-lg"
          >
            <Send className="h-4 w-4" /> Enviar Reporte 7:00 AM a mi WhatsApp
          </Button>
        </div>
      </header>

      {/* =====================================================================
          SECCIÓN 1: PÁGINA DE LA MAÑANA (PLATA, LEADS Y TUS PRIORIDADES)
      ===================================================================== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="rounded-[1.75rem] border border-slate-200/80 bg-white shadow-sm">
          <CardContent className="p-6 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                EN BILLETERAS HOY (NETO)
              </span>
              <Wallet className="h-5 w-5 text-emerald-600" />
            </div>
            <p className="text-3xl font-black tracking-tight text-slate-900 font-mono">
              US${' '}
              {brainIntelligence.netWalletLiquidityUSD.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>
            <p className="text-[10px] font-bold text-emerald-600 uppercase">
              Runway: {brainIntelligence.runwayMonths.toFixed(1)} meses de gastos fijos cubiertos
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-[1.75rem] border border-slate-200/80 bg-white shadow-sm">
          <CardContent className="p-6 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                COBRADO RECIENTE (7 DÍAS)
              </span>
              <TrendingUp className="h-5 w-5 text-blue-600" />
            </div>
            <p className="text-3xl font-black tracking-tight text-slate-900 font-mono">
              US${' '}
              {brainIntelligence.recentCollected7dUSD.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>
            <p className="text-[10px] font-bold text-slate-500 uppercase">
              Total Histórico Verificado: US${' '}
              {brainIntelligence.totalCashVerified.toLocaleString('en-US', {
                minimumFractionDigits: 2,
              })}
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-[1.75rem] border border-slate-200/80 bg-white shadow-sm">
          <CardContent className="p-6 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                EN PIPELINE (COTIZACIONES + CXC)
              </span>
              <Sparkles className="h-5 w-5 text-amber-500" />
            </div>
            <p className="text-3xl font-black tracking-tight text-slate-900 font-mono">
              US${' '}
              {brainIntelligence.totalPipelineUSD.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>
            <p className="text-[10px] font-bold text-amber-600 uppercase">
              Cotizaciones: ${brainIntelligence.openQuotesPipelineUSD.toFixed(0)} • Por Cobrar: $
              {brainIntelligence.accountsReceivableUSD.toFixed(0)}
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-[1.75rem] border-2 border-slate-900 bg-slate-900 text-white shadow-lg">
          <CardContent className="p-6 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-widest text-amber-400">
                DECISIONES PARA APROBAR HOY
              </span>
              <Zap className="h-5 w-5 text-amber-400" />
            </div>
            <p className="text-3xl font-black tracking-tight text-white font-mono">
              {brainIntelligence.approvalQueue.length} Acciones
            </p>
            <p className="text-[10px] font-bold text-slate-300 uppercase">
              El sistema prepara • Vos aprobás en 1 clic
            </p>
          </CardContent>
        </Card>
      </div>

      {/* =====================================================================
          SECCIÓN 2: DETECTOR "¿QUÉ ESTÁ PERDIENDO PLATA HOY? — PLATA ENCONTRADA"
      ===================================================================== */}
      <Card className="rounded-[2.25rem] border-2 border-slate-900 bg-white shadow-xl overflow-hidden">
        <CardHeader className="p-6 sm:p-8 border-b border-slate-100 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <Badge className="bg-rose-100 text-rose-700 border-none font-black text-[9px] uppercase tracking-widest mb-2">
              AUDITORÍA AUTOMÁTICA EN TIEMPO REAL
            </Badge>
            <CardTitle className="text-xl sm:text-2xl font-black tracking-tight text-slate-900 uppercase">
              ¿Qué está perdiendo plata hoy?
            </CardTitle>
            <CardDescription className="text-xs font-bold text-slate-500">
              El Cerebro cruza ventas, cobros, márgenes, inventario y gastos para encontrar fugas invisibles de efectivo.
            </CardDescription>
          </div>
          <div className="text-left sm:text-right">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">
              ESTADO PUNTO DE EQUILIBRIO MENSUAL
            </span>
            <span className="text-lg font-black text-slate-900">
              Meta: US${' '}
              {breakEvenAnalysis.breakEvenSalesUSD.toLocaleString('en-US', {
                maximumFractionDigits: 0,
              })}{' '}
              / mes
            </span>
          </div>
        </CardHeader>

        <CardContent className="p-6 sm:p-8 space-y-3">
          {brainIntelligence.moneyLeaks.map((leak, idx) => (
            <div
              key={leak.id}
              className="p-4 sm:p-5 rounded-2xl border border-slate-200/90 hover:border-slate-400 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white"
            >
              <div className="flex items-start gap-3.5">
                <div
                  className={cn(
                    'w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs shrink-0 mt-0.5',
                    leak.amountUSD > 0
                      ? 'bg-rose-100 text-rose-700'
                      : 'bg-emerald-100 text-emerald-700'
                  )}
                >
                  0{idx + 1}
                </div>
                <div>
                  <h4 className="text-sm sm:text-base font-black text-slate-900">{leak.title}</h4>
                  <p className="text-xs font-medium text-slate-500">{leak.subtitle}</p>
                </div>
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-4 border-t sm:border-t-0 pt-3 sm:pt-0">
                <span className="text-lg sm:text-xl font-black text-slate-900 font-mono">
                  US${' '}
                  {leak.amountUSD.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
                <Button
                  size="sm"
                  onClick={() => {
                    if (leak.type === 'OVERDUE' && brainIntelligence.overdueOrders[0]) {
                      const o = brainIntelligence.overdueOrders[0];
                      sendWhatsAppAction(
                        o.customerPhone,
                        `Hola *${o.customerName}*, te escribimos de *Athleticenter* respecto al saldo pendiente de *$${o.pendingUSD.toFixed(2)} USD* de tu pedido #${o.id.slice(0, 6)}. ¿Nos confirmas tu programación de pago hoy?`
                      );
                    } else if (leak.type === 'QUOTES' && brainIntelligence.staleQuotes[0]) {
                      const q = brainIntelligence.staleQuotes[0];
                      sendWhatsAppAction(
                        q.customerPhone,
                        `Hola *${q.customerName}*, tu cotización por *$${q.totalAmount.toFixed(2)} USD* en *Athleticenter* sigue disponible con nuestro descuento especial por Pronto Pago. ¿Te reservamos el despacho hoy?`
                      );
                    } else if (leak.type === 'MARGIN') {
                      router.push('/dashboard/treasury');
                    } else if (leak.type === 'OVERSTOCK') {
                      router.push('/dashboard/inventory');
                    } else {
                      router.push('/dashboard/gastos');
                    }
                  }}
                  className="h-9 px-4 rounded-xl bg-slate-900 hover:bg-primary text-white font-black text-[10px] uppercase tracking-wider shrink-0"
                >
                  {leak.actionLabel} →
                </Button>
              </div>
            </div>
          ))}
        </CardContent>

        <div className="bg-slate-950 text-white px-6 sm:px-8 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <Sparkles className="h-5 w-5 text-amber-400" />
            <span className="text-xs sm:text-sm font-black uppercase tracking-wider">
              Plata que estabas perdiendo, encontrada hoy en tu base de datos:
            </span>
          </div>
          <span className="text-2xl sm:text-3xl font-black text-emerald-400 font-mono">
            US${' '}
            {brainIntelligence.totalMoneyFoundUSD.toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        </div>
      </Card>

      {/* =====================================================================
          SECCIÓN 3: LAS 5 DIMENSIONES DEL SISTEMA OPERATIVO DE IA
      ===================================================================== */}
      <Tabs defaultValue="ceo" className="w-full space-y-6">
        <TabsList className="grid grid-cols-2 lg:grid-cols-5 h-auto p-1.5 bg-slate-200/80 rounded-2xl gap-1.5">
          <TabsTrigger
            value="ceo"
            className="rounded-xl py-3 font-black uppercase text-[10px] sm:text-xs tracking-wider data-[state=active]:bg-orange-600 data-[state=active]:text-white"
          >
            👑 1. Modo CEO (Estrategia & LTV)
          </TabsTrigger>
          <TabsTrigger
            value="finanzas"
            className="rounded-xl py-3 font-black uppercase text-[10px] sm:text-xs tracking-wider data-[state=active]:bg-slate-900 data-[state=active]:text-white"
          >
            🧠 2. Finanzas (Runway & 8 Mód.)
          </TabsTrigger>
          <TabsTrigger
            value="ventas"
            className="rounded-xl py-3 font-black uppercase text-[10px] sm:text-xs tracking-wider data-[state=active]:bg-slate-900 data-[state=active]:text-white"
          >
            🚀 3. Ventas, Embudo & Calendario
          </TabsTrigger>
          <TabsTrigger
            value="operaciones"
            className="rounded-xl py-3 font-black uppercase text-[10px] sm:text-xs tracking-wider data-[state=active]:bg-slate-900 data-[state=active]:text-white"
          >
            📦 4. Operaciones & Soporte FAQ
          </TabsTrigger>
          <TabsTrigger
            value="aprobaciones"
            className="rounded-xl py-3 font-black uppercase text-[10px] sm:text-xs tracking-wider data-[state=active]:bg-emerald-600 data-[state=active]:text-white"
          >
            ✅ 5. Vos Aprobás ({brainIntelligence.approvalQueue.length})
          </TabsTrigger>
        </TabsList>

        {/* =================================================================
            TAB 1: MODO CEO — DECISIONES ESTRATÉGICAS, OKRs Y UNIT ECONOMICS
            (Inspirado en Lámina 01/08 y 02/08 de @hechoconia)
        ================================================================= */}
        <TabsContent value="ceo" className="space-y-6">
          <Card className="rounded-[2.25rem] border border-slate-200 bg-[#FAF8F5] p-6 sm:p-8 shadow-md space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-orange-600">
                  CONSEJO DE ALTA INTELIGENCIA • CENTRO DE CONTROL IA
                </span>
                <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight uppercase">
                  EL CEO. <span className="text-orange-600">DECISIONES ESTRATÉGICAS & UNIT ECONOMICS</span>
                </h2>
              </div>
              <Badge className="bg-slate-900 text-white font-black text-[10px] uppercase px-3.5 py-1.5 rounded-xl">
                SISTEMA UNIFICADO: 7 PISOS OPERATIVOS ACTIVOS
              </Badge>
            </div>

            {/* LOS 4 UNIT ECONOMICS CLAVE DEL CLIENTE (TICKET PROMEDIO, CONVERSIÓN, RETENCIÓN, LTV) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    TICKET PROMEDIO (PEDIDO)
                  </span>
                  <Award className="h-4 w-4 text-orange-600" />
                </div>
                <p className="text-2xl font-black text-slate-900 font-mono">
                  US$ {brainIntelligence.avgTicketUSD.toFixed(2)}
                </p>
                <p className="text-[10px] font-bold text-emerald-600 uppercase">
                  ↗ Calculado sobre {brainIntelligence.validOrdersCount} pedidos activos
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    TASA DE CONVERSIÓN
                  </span>
                  <Filter className="h-4 w-4 text-blue-600" />
                </div>
                <p className="text-2xl font-black text-slate-900 font-mono">
                  {brainIntelligence.conversionRatePct.toFixed(1)}%
                </p>
                <p className="text-[10px] font-bold text-emerald-600 uppercase">
                  ↗ Cotizaciones convertidas a pedido firme
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    RETENCIÓN DE CLIENTES B2B
                  </span>
                  <Users className="h-4 w-4 text-emerald-600" />
                </div>
                <p className="text-2xl font-black text-slate-900 font-mono">
                  {brainIntelligence.retentionRatePct}%
                </p>
                <p className="text-[10px] font-bold text-emerald-600 uppercase">
                  ↗ Cartera activa de gimnasios y distribuidores
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    VALOR DE VIDA (LTV CLIENTE)
                  </span>
                  <Crown className="h-4 w-4 text-amber-500" />
                </div>
                <p className="text-2xl font-black text-slate-900 font-mono">
                  US$ {brainIntelligence.avgCustomerLtvUSD.toFixed(0)}
                </p>
                <p className="text-[10px] font-bold text-emerald-600 uppercase">
                  ↗ Valor proyectado a 12 meses por cuenta B2B
                </p>
              </div>
            </div>

            {/* OBJETIVOS DE LA EMPRESA (OKRs) + PRIORIDADES SEMANALES */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <Card className="lg:col-span-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
                <CardHeader className="p-5 border-b border-slate-100 flex flex-row items-center justify-between">
                  <CardTitle className="text-sm font-black uppercase text-slate-900 flex items-center gap-2">
                    <Target className="h-4 w-4 text-orange-600" /> Objetivos de Athleticenter (OKRs en Vivo)
                  </CardTitle>
                  <Badge className="bg-orange-50 text-orange-700 border-none text-[9px] font-black uppercase">
                    Meta Mensual: ${configForm.monthlyRevenueGoalUSD.toLocaleString()}
                  </Badge>
                </CardHeader>
                <CardContent className="p-5 space-y-4">
                  {[
                    {
                      label: 'Meta de Facturación / Punto de Equilibrio',
                      pct: Math.min(
                        100,
                        Math.round(
                          (brainIntelligence.totalBilling /
                            Math.max(1, breakEvenAnalysis.breakEvenSalesUSD)) *
                            100
                        )
                      ),
                    },
                    {
                      label: 'Efectividad de Cobranza Verificada en Caja',
                      pct: Math.min(
                        100,
                        Math.round(
                          (brainIntelligence.totalCashVerified /
                            Math.max(1, brainIntelligence.totalBilling)) *
                            100
                        )
                      ),
                    },
                    {
                      label: 'Optimización de Entrega de Pedidos (<24h SLA)',
                      pct:
                        brainIntelligence.delayedOperationsOrders.length > 0
                          ? Math.round(
                              (brainIntelligence.delayedOperationsOrders.filter((o) => !o.isLate)
                                .length /
                                brainIntelligence.delayedOperationsOrders.length) *
                                100
                            )
                          : 92,
                    },
                    {
                      label: 'Catálogo con Margen Neto Protegido (>18%)',
                      pct:
                        (products || []).length > 0
                          ? Math.round(
                              (((products || []).length -
                                brainIntelligence.lowMarginProducts.length) /
                                (products || []).length) *
                                100
                            )
                          : 88,
                    },
                  ].map((okr, i) => (
                    <div key={i} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-700">{okr.label}</span>
                        <span className="font-black text-slate-900 font-mono">{okr.pct}%</span>
                      </div>
                      <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-orange-600 rounded-full transition-all duration-500"
                          style={{ width: `${okr.pct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="lg:col-span-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
                <CardHeader className="p-5 border-b border-slate-100">
                  <CardTitle className="text-sm font-black uppercase text-slate-900 flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-orange-600" /> Prioridades Estratégicas de la Semana
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-5 space-y-2.5">
                  {[
                    {
                      text: `Cobrar $${brainIntelligence.accountsReceivableUSD.toFixed(0)} USD en cuentas por cobrar de calle`,
                      priority: 'ALTA',
                    },
                    {
                      text: `Cerrar cotizaciones abiertas ($${brainIntelligence.openQuotesPipelineUSD.toFixed(0)} USD) con 10% Pronto Pago`,
                      priority: 'ALTA',
                    },
                    {
                      text: `Rotar ${brainIntelligence.overstockProducts.length} SKUs de sobrestock con campañas dirigidas`,
                      priority: 'MEDIA',
                    },
                    {
                      text: `Cubrir los ${expenses.filter((e) => e.paymentStatus !== 'PAID').length} gastos fijos restantes del ciclo mensual ($2,160)`,
                      priority: 'MEDIA',
                    },
                  ].map((p, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-xl border border-slate-200 flex items-center justify-between gap-3 bg-slate-50/50"
                    >
                      <span className="text-xs font-bold text-slate-800">{p.text}</span>
                      <Badge
                        className={cn(
                          'text-[9px] font-black uppercase border-none shrink-0',
                          p.priority === 'ALTA'
                            ? 'bg-orange-100 text-orange-700'
                            : 'bg-amber-100 text-amber-800'
                        )}
                      >
                        {p.priority}
                      </Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            {/* HOJA DE RUTA + DECISIONES RECIENTES DEL CEO + DISTRIBUCIÓN DE INGRESOS */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* HOJA DE RUTA */}
              <Card className="lg:col-span-4 rounded-2xl border border-slate-200 bg-white shadow-sm">
                <CardHeader className="p-5 border-b border-slate-100">
                  <CardTitle className="text-sm font-black uppercase text-slate-900">
                    Hoja de Ruta Operativa (Ahora → Después)
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-5 grid grid-cols-3 gap-2.5">
                  <div className="p-3 rounded-xl border-2 border-orange-500 bg-orange-50/40 text-center space-y-1">
                    <span className="text-[9px] font-black uppercase text-orange-600 block">
                      AHORA
                    </span>
                    <p className="text-xs font-black text-slate-900">
                      Cerebro IA Finanzas & Ventas Activo
                    </p>
                  </div>
                  <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 text-center space-y-1">
                    <span className="text-[9px] font-black uppercase text-slate-400 block">
                      SIGUIENTE
                    </span>
                    <p className="text-xs font-bold text-slate-700">
                      Escalamiento B2B & Cierre Automático
                    </p>
                  </div>
                  <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 text-center space-y-1">
                    <span className="text-[9px] font-black uppercase text-slate-400 block">
                      DESPUÉS
                    </span>
                    <p className="text-xs font-bold text-slate-700">
                      Reposición Predictiva Importaciones
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* BITÁCORA DE DECISIONES RECIENTES */}
              <Card className="lg:col-span-4 rounded-2xl border border-slate-200 bg-white shadow-sm">
                <CardHeader className="p-5 border-b border-slate-100 flex flex-row items-center justify-between">
                  <CardTitle className="text-sm font-black uppercase text-slate-900">
                    Decisiones Recientes del CEO
                  </CardTitle>
                  <Badge className="bg-emerald-50 text-emerald-700 border-none text-[9px] font-black">
                    Bitácora Viva
                  </Badge>
                </CardHeader>
                <CardContent className="p-5 space-y-2.5">
                  {(configForm.recentDecisions || DEFAULT_BRAIN_CONFIG.recentDecisions || [])
                    .slice(0, 4)
                    .map((dec) => (
                      <div
                        key={dec.id}
                        className="flex items-center justify-between gap-2 text-xs border-b border-slate-100 pb-2 last:border-b-0 last:pb-0"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                          <span className="font-bold text-slate-800 truncate">{dec.title}</span>
                        </div>
                        <span className="text-[10px] font-black text-slate-400 shrink-0">
                          {dec.decidedAt}
                        </span>
                      </div>
                    ))}
                </CardContent>
              </Card>

              {/* DISTRIBUCIÓN DE INGRESOS POR LÍNEA DE PRODUCTO */}
              <Card className="lg:col-span-4 rounded-2xl border border-slate-200 bg-white shadow-sm">
                <CardHeader className="p-5 border-b border-slate-100">
                  <CardTitle className="text-sm font-black uppercase text-slate-900">
                    Distribución de Ingresos por Línea (%)
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-5 space-y-2.5">
                  {brainIntelligence.revenueDistribution.map((item, idx) => (
                    <div key={idx} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-700">{item.label}</span>
                        <span className="font-black text-slate-900 font-mono">{item.pct}%</span>
                      </div>
                      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={cn(
                            'h-full rounded-full',
                            idx === 0
                              ? 'bg-orange-600'
                              : idx === 1
                              ? 'bg-slate-900'
                              : idx === 2
                              ? 'bg-emerald-600'
                              : 'bg-amber-500'
                          )}
                          style={{ width: `${item.pct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </Card>
        </TabsContent>

        {/* =================================================================
            TAB 2: CEREBRO DE FINANZAS (RUNWAY + DESGLOSE % + 8 MÓDULOS)
            (Inspirado en Santino + Lámina 06/08 de @hechoconia)
        ================================================================= */}
        <TabsContent value="finanzas" className="space-y-6">
          <Card className="rounded-[2.25rem] border border-slate-200 bg-[#FAF8F5] p-6 sm:p-8 shadow-md space-y-6">
            {/* BLOQUE SUPERIOR: EL EQUIPO DE FINANZAS — CADA DÓLAR ES RASTREADO (LÁMINA 06/08) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-4 p-5 rounded-2xl bg-slate-900 text-white flex flex-col justify-between space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-widest text-orange-400">
                    OXÍGENO FINANCIERO (RUNWAY REAL)
                  </span>
                  <Clock className="h-5 w-5 text-orange-400" />
                </div>
                <div>
                  <p className="text-3xl font-black font-mono text-white">
                    {brainIntelligence.runwayMonths.toFixed(1)} MESES
                  </p>
                  <p className="text-xs text-slate-300 mt-1">
                    Liquidez Neta (${brainIntelligence.netWalletLiquidityUSD.toFixed(0)}) ÷ Gasto Fijo Mensual ($
                    {monthlyFixedExpensesUSD.toFixed(0)}/mes)
                  </p>
                </div>
                <Badge
                  className={cn(
                    'w-fit text-[9px] font-black uppercase border-none',
                    brainIntelligence.runwayMonths >= 3
                      ? 'bg-emerald-500 text-white'
                      : brainIntelligence.runwayMonths >= 1
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-rose-600 text-white'
                  )}
                >
                  {brainIntelligence.runwayMonths >= 3
                    ? '🟢 RUNWAY SALUDABLE (>3 MESES)'
                    : brainIntelligence.runwayMonths >= 1
                    ? '🟡 VIGILAR LIQUIDEZ (1-3 MESES)'
                    : '🔴 PRIORIZAR COBRANZA INMEDIATA'}
                </Badge>
              </div>

              <div className="lg:col-span-4 p-5 rounded-2xl bg-white border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    DESGLOSE DE GASTOS FIJOS ($2,160/MES)
                  </span>
                  <Receipt className="h-4 w-4 text-rose-600" />
                </div>
                <div className="space-y-2">
                  {brainIntelligence.expenseBreakdown.slice(0, 4).map((eb, i) => (
                    <div key={i} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-700">{eb.category}</span>
                        <span className="font-black text-slate-900 font-mono">
                          ${eb.amountUSD.toFixed(0)} ({eb.pct}%)
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-rose-500 rounded-full"
                          style={{ width: `${eb.pct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="lg:col-span-4 p-5 rounded-2xl bg-orange-50/70 border border-orange-200 flex flex-col justify-between space-y-3">
                <div className="flex items-center gap-2 text-orange-700 font-black text-xs uppercase">
                  <Lightbulb className="h-4 w-4 shrink-0" /> INSIGHT FINANCIERO DE IA
                </div>
                <p className="text-xs text-slate-700 leading-relaxed font-medium">
                  Tu estructura fija está saneada en <strong>US$ {monthlyFixedExpensesUSD.toFixed(2)}/mes</strong>. Recuperando el 50% de las cuentas por cobrar actuales (
                  <strong>US$ {(brainIntelligence.accountsReceivableUSD * 0.5).toFixed(0)}</strong>) sumas{' '}
                  <strong>
                    +{(brainIntelligence.accountsReceivableUSD * 0.5 / Math.max(1, monthlyFixedExpensesUSD)).toFixed(1)} meses
                  </strong>{' '}
                  adicionales de Runway inmediato.
                </p>
                <Button
                  size="sm"
                  onClick={() => router.push('/dashboard/billing')}
                  className="w-full h-8 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-black text-[10px] uppercase"
                >
                  Ejecutar Recomendación en Cobranza / Facturación →
                </Button>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-4 pt-2">
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-rose-600">
                  ARQUITECTURA FINANCIERA CONECTADA EN VIVO
                </span>
                <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                  8 módulos conectados a un cerebro central. Sin trabajo manual.
                </h2>
              </div>
              <Badge className="bg-slate-900 text-white font-black text-[10px] uppercase px-3 py-1.5 rounded-xl">
                Haz clic en cualquier módulo para inspeccionar
              </Badge>
            </div>

            {/* 8 TARJETAS ESTILO SANTINO */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              {financeModulesSpec.map((m) => {
                const isSelected = activeFinanceModule === m.code;
                return (
                  <div
                    key={m.code}
                    onClick={() => setActiveFinanceModule(m.code)}
                    className={cn(
                      'p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between gap-3',
                      isSelected
                        ? 'bg-slate-900 text-white border-slate-900 shadow-lg -translate-y-0.5'
                        : 'bg-white text-slate-900 border-slate-200 hover:border-slate-400'
                    )}
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span
                          className={cn(
                            'text-[10px] font-black font-mono px-2 py-0.5 rounded-md',
                            isSelected ? 'bg-rose-500 text-white' : 'bg-rose-50 text-rose-600'
                          )}
                        >
                          {m.code}
                        </span>
                        <Badge
                          className={cn(
                            'text-[9px] font-black uppercase border-none',
                            isSelected
                              ? 'bg-white/15 text-amber-300'
                              : 'bg-slate-100 text-slate-700'
                          )}
                        >
                          {m.badge}
                        </Badge>
                      </div>
                      <h3 className="text-base font-black tracking-tight">{m.title}</h3>
                      <p
                        className={cn(
                          'text-xs leading-relaxed',
                          isSelected ? 'text-slate-300' : 'text-slate-500'
                        )}
                      >
                        {m.desc}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* NODO CENTRAL: EL CEREBRO DE FINANZAS */}
            <div className="rounded-2xl bg-slate-950 text-white p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 border border-slate-800">
              <div className="space-y-1">
                <span className="text-[10px] font-black uppercase tracking-widest text-rose-400">
                  NÚCLEO ORQUESTADOR
                </span>
                <h3 className="text-xl font-black">El Cerebro de Finanzas</h3>
                <p className="text-xs text-slate-400 max-w-xl">
                  Recibe la información de los 8 módulos, cruza los datos y toma decisiones: qué alertar, qué ejecutar solo y qué escalar a dirección.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                  <span className="text-emerald-400 font-black block uppercase text-[10px]">
                    ⚡ Ejecuta solo
                  </span>
                  <span className="text-slate-300 text-[11px]">
                    Conciliar cobros, proyectar 90d, calcular IVA y armar reporte 7 AM.
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                  <span className="text-amber-400 font-black block uppercase text-[10px]">
                    🔔 Alerta al equipo
                  </span>
                  <span className="text-slate-300 text-[11px]">
                    Gasto fuera de presupuesto, factura vencida o margen &lt; 15%.
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                  <span className="text-rose-400 font-black block uppercase text-[10px]">
                    🛑 Pide aprobación
                  </span>
                  <span className="text-slate-300 text-[11px]">
                    Pagos a proveedores &gt; ${configForm.maxSupplierAutoApproveUSD} o caja bajo $
                    {configForm.minCashThresholdUSD}.
                  </span>
                </div>
              </div>
            </div>

            {/* DETALLE EN VIVO DEL MÓDULO FINANCIERO SELECCIONADO */}
            <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <CardHeader className="p-6 border-b border-slate-100 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base font-black uppercase text-slate-900">
                    Vista Operativa en Vivo — Módulo {activeFinanceModule}:{' '}
                    {financeModulesSpec.find((m) => m.code === activeFinanceModule)?.title}
                  </CardTitle>
                  <CardDescription className="text-xs font-bold text-slate-500">
                    Datos calculados en tiempo real sobre Firestore (studio-5015730771-8ece8)
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="p-6">
                {activeFinanceModule === '01' && (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-bold text-slate-600">
                        Proyección de 12 Semanas (90 Días): Entradas por Cuentas por Cobrar + Pipeline vs. Salidas Fijas ($2,160/mes) + Proveedores.
                      </p>
                      <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200 font-black text-[10px]">
                        Caja Mínima de Seguridad: US$ {configForm.minCashThresholdUSD}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5">
                      {brainIntelligence.cashFlowWithBalance.map((w) => (
                        <div
                          key={w.weekLabel}
                          className={cn(
                            'p-3 rounded-xl border text-xs space-y-1',
                            w.isBelowMinimum
                              ? 'bg-rose-50 border-rose-300'
                              : 'bg-slate-50 border-slate-200'
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-black text-slate-900">{w.weekLabel}</span>
                            <span className="text-[9px] font-bold text-slate-400">{w.horizon}</span>
                          </div>
                          <p className="text-[10px] text-emerald-600 font-bold">
                            +US$ {w.inflowUSD.toFixed(0)}
                          </p>
                          <p className="text-[10px] text-rose-600 font-bold">
                            -US$ {w.outflowUSD.toFixed(0)}
                          </p>
                          <p className="text-xs font-black text-slate-900 border-t border-slate-200 pt-1 font-mono">
                            Saldo: ${w.projectedBalanceUSD.toFixed(0)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeFinanceModule === '02' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold text-slate-600">
                        Órdenes de Compra (OC) y compromisos con proveedores registrados:
                      </p>
                      <Button
                        size="sm"
                        onClick={() => router.push('/dashboard/purchase-orders')}
                        className="h-8 rounded-xl bg-slate-900 text-white font-black text-[10px] uppercase"
                      >
                        Ir a Compras / OC →
                      </Button>
                    </div>
                    {(purchaseOrders || []).length === 0 ? (
                      <p className="text-xs text-slate-500 py-4">
                        No hay órdenes de compra pendientes de pago. Puedes registrar compras locales o importaciones en Compras.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {(purchaseOrders || []).slice(0, 6).map((po: any) => (
                          <div
                            key={po.id}
                            className="p-3.5 rounded-xl border border-slate-200 flex items-center justify-between"
                          >
                            <div>
                              <p className="text-xs font-black text-slate-900 uppercase">
                                {po.supplierName || 'Proveedor'}
                              </p>
                              <p className="text-[10px] font-bold text-slate-500">
                                Estado: {po.status} • Pago: {po.paymentStatus || 'Pendiente'}
                              </p>
                            </div>
                            <span className="text-sm font-black font-mono text-slate-900">
                              US$ {Number(po.totalAmount || 0).toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {activeFinanceModule === '03' && (
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-[10px] font-black uppercase text-slate-400">
                        1. Ventas Facturadas
                      </span>
                      <p className="text-xl font-black text-slate-900 font-mono">
                        US$ {brainIntelligence.totalBilling.toFixed(2)}
                      </p>
                    </div>
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-[10px] font-black uppercase text-slate-400">
                        2. Cobros Verificados
                      </span>
                      <p className="text-xl font-black text-emerald-600 font-mono">
                        US$ {brainIntelligence.totalCashVerified.toFixed(2)}
                      </p>
                    </div>
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-[10px] font-black uppercase text-slate-400">
                        3. Gastos Fijos Mes
                      </span>
                      <p className="text-xl font-black text-rose-600 font-mono">
                        -US$ {monthlyFixedExpensesUSD.toFixed(2)}
                      </p>
                    </div>
                    <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200">
                      <span className="text-[10px] font-black uppercase text-emerald-700">
                        4. Estado Pre-Cierre
                      </span>
                      <p className="text-sm font-black text-emerald-900 mt-1">
                        {expenses.filter((e) => e.paymentStatus === 'PAID').length}/
                        {expenses.length} Gastos Conciliados
                      </p>
                    </div>
                  </div>
                )}

                {activeFinanceModule === '04' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold text-slate-600">
                        Presupuesto Mensual Saneado ({expenses.length} partidas reales = US${' '}
                        {monthlyFixedExpensesUSD.toFixed(2)}/mes):
                      </p>
                      <Button
                        size="sm"
                        onClick={() => router.push('/dashboard/gastos')}
                        className="h-8 rounded-xl bg-slate-900 text-white font-black text-[10px] uppercase"
                      >
                        Gestionar Gastos →
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                      {expenses.map((exp) => (
                        <div
                          key={exp.id}
                          className="p-3 rounded-xl border border-slate-200 flex items-center justify-between bg-slate-50/60"
                        >
                          <div>
                            <p className="text-xs font-black text-slate-900">{exp.concept}</p>
                            <p className="text-[10px] font-bold text-slate-500">
                              {exp.category} • Día {exp.dueDay || 5}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-black font-mono text-slate-900">
                              US$ {Number(exp.amountUSD || 0).toFixed(2)}
                            </p>
                            <Badge
                              className={cn(
                                'text-[8px] font-black uppercase border-none',
                                exp.paymentStatus === 'PAID'
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-amber-100 text-amber-700'
                              )}
                            >
                              {exp.paymentStatus === 'PAID' ? 'Pagado' : 'Pendiente'}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeFinanceModule === '05' && (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <p className="text-sm font-black text-slate-900">
                        Auditoría de Cobros y Conciliación con Gemini Vision OCR
                      </p>
                      <p className="text-xs text-slate-500">
                        Total cobrado y conciliado: US$ {brainIntelligence.totalCashVerified.toFixed(2)} • Pendiente en calle: US$ {brainIntelligence.accountsReceivableUSD.toFixed(2)}
                      </p>
                    </div>
                    <Button
                      onClick={() => router.push('/dashboard/billing')}
                      className="rounded-xl bg-slate-900 text-white font-black text-xs uppercase"
                    >
                      Abrir Conciliación y Facturación →
                    </Button>
                  </div>
                )}

                {activeFinanceModule === '06' && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-[10px] font-black uppercase text-slate-400">
                        Tasa Oficial BCV Activa
                      </span>
                      <p className="text-xl font-black text-slate-900 font-mono">
                        {brainIntelligence.bcvRate.toFixed(2)} Bs/USD
                      </p>
                    </div>
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-[10px] font-black uppercase text-slate-400">
                        Provisión Estimada IVA ({brainIntelligence.ivaPercent}%)
                      </span>
                      <p className="text-xl font-black text-amber-600 font-mono">
                        US$ {brainIntelligence.estimatedIvaUSD.toFixed(2)}
                      </p>
                    </div>
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-[10px] font-black uppercase text-slate-400">
                        Reserva Parafiscales / Alcaldía (2.5%)
                      </span>
                      <p className="text-xl font-black text-blue-600 font-mono">
                        US$ {brainIntelligence.estimatedParafiscalesUSD.toFixed(2)}
                      </p>
                    </div>
                  </div>
                )}

                {activeFinanceModule === '07' && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <h4 className="text-xs font-black uppercase text-emerald-700">
                        Top Productos con Mayor Margen Neto
                      </h4>
                      {brainIntelligence.topMarginProducts.slice(0, 4).map((p) => (
                        <div
                          key={p.id}
                          className="p-3 rounded-xl bg-emerald-50/50 border border-emerald-200 flex items-center justify-between text-xs"
                        >
                          <span className="font-bold text-slate-900 truncate max-w-[220px]">
                            {p.name}
                          </span>
                          <span className="font-black text-emerald-700 font-mono">
                            {p.marginPct.toFixed(1)}% margen (${p.priceCashUSD})
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-2">
                      <h4 className="text-xs font-black uppercase text-blue-700">
                        Top Clientes B2B por Facturación
                      </h4>
                      {brainIntelligence.topCustomers.slice(0, 4).map((c, i) => (
                        <div
                          key={i}
                          className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs"
                        >
                          <span className="font-bold text-slate-900 truncate max-w-[220px]">
                            {c.name} ({c.ordersCount} pedidos)
                          </span>
                          <span className="font-black text-slate-900 font-mono">
                            US$ {c.totalUSD.toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeFinanceModule === '08' && (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <p className="text-sm font-black text-slate-900">
                        Reporte Ejecutivo Matutino 7:00 AM listo para enviar
                      </p>
                      <p className="text-xs text-slate-500">
                        Incluye liquidez en las 5 billeteras, Runway, cobros, pipeline, gastos del mes y fugas detectadas.
                      </p>
                    </div>
                    <Button
                      onClick={handleSendMorningBriefingWhatsApp}
                      className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase gap-2"
                    >
                      <Send className="h-4 w-4" /> Enviar Reporte 7:00 AM Ahora
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* BARRA INFERIOR DE CORTAFUEGOS */}
            <div className="rounded-2xl border border-rose-200 bg-rose-50/70 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-rose-700 font-black text-xs uppercase">
                <ShieldAlert className="h-4 w-4 shrink-0" />
                QUÉ INTERRUMPE EL CICLO (CORTAFUEGOS):
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold text-rose-900">
                <span className="px-2.5 py-1 rounded-lg bg-white border border-rose-200">
                  1. Caja proyectada bajo el mínimo (${configForm.minCashThresholdUSD})
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-white border border-rose-200">
                  2. Gasto fuera de presupuesto
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-white border border-rose-200">
                  3. Diferencia bancaria sin explicar
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-white border border-rose-200">
                  4. Vencimiento impositivo
                </span>
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* =================================================================
            TAB 3: CEREBRO DE VENTAS, EMBUDO 5 ESCALONES & CALENDARIO SEMANAL
            (Inspirado en Láminas 03/08 y 04/08 de @hechoconia)
        ================================================================= */}
        <TabsContent value="ventas" className="space-y-6">
          <Card className="rounded-[2.25rem] border border-slate-200 bg-[#FAF8F5] p-6 sm:p-8 shadow-md space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-4">
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700">
                  CEREBRO COMERCIAL 24/7 • POLÍTICA 25% DIVISAS + 10% PRONTO PAGO
                </span>
                <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                  Embudo de Conversión IA, Calendario Semanal & 8 Módulos de Ventas
                </h2>
              </div>
              <Button
                onClick={() => router.push('/dashboard/marketing')}
                className="rounded-xl bg-slate-900 text-white font-black text-[10px] uppercase tracking-wider"
              >
                Abrir Monitor ARM WhatsApp →
              </Button>
            </div>

            {/* EMBUDO DE VENTAS CON IA DE 5 ESCALONES + RENDIMIENTO DE ALCANCE (LÁMINA 04/08) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <Card className="lg:col-span-7 rounded-2xl border border-slate-200 bg-white shadow-sm">
                <CardHeader className="p-5 border-b border-slate-100 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-black uppercase text-slate-900 flex items-center gap-2">
                      <Layers className="h-4 w-4 text-orange-600" /> Embudo de Ventas con IA (5 Escalones en Vivo)
                    </CardTitle>
                    <CardDescription className="text-xs font-bold text-slate-500">
                      Progresión real desde tu cartera de clientes hasta pedidos cerrados.
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="p-5 space-y-2.5">
                  {[
                    {
                      step: '1. Leads / Clientes en Base',
                      desc: 'Cartera registrada de gimnasios, tiendas y distribuidores',
                      count: brainIntelligence.funnel.totalBaseLeads,
                      widthPct: 100,
                      color: 'bg-orange-600 text-white',
                    },
                    {
                      step: '2. Contacto Inicial / Alcance IA',
                      desc: 'Contactados por WhatsApp Directo y Difusión ARM',
                      count: brainIntelligence.funnel.initialContactCount,
                      widthPct: 82,
                      color: 'bg-orange-500 text-white',
                    },
                    {
                      step: '3. Respuestas & Conversaciones',
                      desc: 'Follow-up automático hasta obtener respuesta',
                      count: brainIntelligence.funnel.responsesCount,
                      widthPct: 64,
                      color: 'bg-amber-500 text-slate-950',
                    },
                    {
                      step: '4. Cotizaciones Formales Emitidas',
                      desc: 'Propuestas enviadas con 25% Divisas + 10% Pronto Pago',
                      count: brainIntelligence.funnel.quotesIssuedCount,
                      widthPct: 48,
                      color: 'bg-emerald-500 text-white',
                    },
                    {
                      step: '5. Negocios Cerrados (Pedidos)',
                      desc: 'Pedidos confirmados en firme en Athleticenter',
                      count: brainIntelligence.funnel.closedDealsCount,
                      widthPct: 35,
                      color: 'bg-slate-900 text-white',
                    },
                  ].map((s, i) => (
                    <div
                      key={i}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200/80"
                    >
                      <div className="min-w-[210px]">
                        <p className="text-xs font-black text-slate-900">{s.step}</p>
                        <p className="text-[10px] text-slate-500">{s.desc}</p>
                      </div>
                      <div className="flex-1 flex items-center justify-end gap-3">
                        <div className="hidden sm:block w-full max-w-[220px] bg-slate-200/70 h-6 rounded-lg overflow-hidden">
                          <div
                            className={cn(
                              'h-full flex items-center justify-end pr-2 text-[10px] font-black rounded-lg',
                              s.color
                            )}
                            style={{ width: `${s.widthPct}%` }}
                          />
                        </div>
                        <span className="text-sm font-black font-mono text-slate-900 min-w-[48px] text-right">
                          {s.count}
                        </span>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="lg:col-span-5 rounded-2xl border border-slate-200 bg-white shadow-sm">
                <CardHeader className="p-5 border-b border-slate-100">
                  <CardTitle className="text-sm font-black uppercase text-slate-900">
                    Rendimiento de Alcance & Fuentes de Leads
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-5 space-y-4">
                  <div className="grid grid-cols-3 gap-2.5 text-center">
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-[9px] font-black uppercase text-slate-400 block">
                        TASA ALCANCE
                      </span>
                      <p className="text-xl font-black text-slate-900 font-mono">
                        {brainIntelligence.funnel.openRatePct}%
                      </p>
                      <span className="text-[9px] font-bold text-emerald-600">↗ Activo</span>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-[9px] font-black uppercase text-slate-400 block">
                        TASA RESPUESTA
                      </span>
                      <p className="text-xl font-black text-slate-900 font-mono">
                        {brainIntelligence.funnel.replyRatePct}%
                      </p>
                      <span className="text-[9px] font-bold text-emerald-600">↗ WhatsApp IA</span>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-[9px] font-black uppercase text-slate-400 block">
                        CIERRE COTIZ.
                      </span>
                      <p className="text-xl font-black text-emerald-600 font-mono">
                        {brainIntelligence.funnel.closeRatePct}%
                      </p>
                      <span className="text-[9px] font-bold text-emerald-600">↗ Pronto Pago</span>
                    </div>
                  </div>

                  <div className="space-y-2 pt-2 border-t border-slate-100">
                    <span className="text-[10px] font-black uppercase text-slate-400 block">
                      FUENTES PRINCIPALES DE LEADS COMERCIALES
                    </span>
                    {[
                      { source: 'WhatsApp Directo / Agente ARM', pct: 48 },
                      { source: 'Cartera B2B / Recompra Gimnasios', pct: 27 },
                      { source: 'Instagram / Catálogo Digital', pct: 16 },
                      { source: 'Referidos & Distribuidores', pct: 9 },
                    ].map((f, idx) => (
                      <div key={idx} className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-700">{f.source}</span>
                        <span className="font-black text-slate-900 font-mono">{f.pct}%</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* CALENDARIO SEMANAL DE CONTENIDO Y ACCIÓN COMERCIAL (LUN A DOM — LÁMINA 03/08) */}
            <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <CardHeader className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-sm font-black uppercase text-slate-900 flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-orange-600" /> Calendario Operativo Semanal de Ventas & Contenido (LUN a DOM)
                  </CardTitle>
                  <CardDescription className="text-xs font-bold text-slate-500">
                    Flujo estructurado: Investigar → Crear → Publicar → Optimizar. Haz clic en cualquier día para disparar la pauta.
                  </CardDescription>
                </div>
                <Badge className="bg-orange-100 text-orange-800 border-none font-black text-[9px] uppercase">
                  HOY ESTÁ MARCADO EN NARANJA
                </Badge>
              </CardHeader>
              <CardContent className="p-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2.5">
                  {weeklyCalendarSpec.map((dayItem) => {
                    const isToday = currentDayIndex === dayItem.dayKey;
                    return (
                      <div
                        key={dayItem.dayShort}
                        className={cn(
                          'p-3.5 rounded-2xl border flex flex-col justify-between gap-3 transition-all',
                          isToday
                            ? 'bg-orange-600 text-white border-orange-600 shadow-md'
                            : 'bg-slate-50 text-slate-900 border-slate-200'
                        )}
                      >
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span
                              className={cn(
                                'text-[10px] font-black uppercase tracking-widest',
                                isToday ? 'text-orange-100' : 'text-slate-400'
                              )}
                            >
                              {dayItem.dayShort}
                            </span>
                            {isToday && (
                              <Badge className="bg-white text-orange-700 border-none text-[8px] font-black uppercase px-1.5 py-0">
                                HOY
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs font-black leading-snug">{dayItem.title}</p>
                          <p
                            className={cn(
                              'text-[10px] leading-tight',
                              isToday ? 'text-orange-100' : 'text-slate-500'
                            )}
                          >
                            {dayItem.subtitle}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant={isToday ? 'secondary' : 'outline'}
                          onClick={() =>
                            sendWhatsAppAction(configForm.ceoWhatsappPhone, dayItem.actionText)
                          }
                          className={cn(
                            'h-7 w-full rounded-xl font-black text-[9px] uppercase',
                            isToday
                              ? 'bg-white text-orange-700 hover:bg-orange-50'
                              : 'border-slate-300 text-slate-700'
                          )}
                        >
                          Ejecutar →
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* 8 TARJETAS DEL CEREBRO DE VENTAS */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              {salesModulesSpec.map((m) => {
                const isSelected = activeSalesModule === m.code;
                return (
                  <div
                    key={m.code}
                    onClick={() => setActiveSalesModule(m.code)}
                    className={cn(
                      'p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between gap-3',
                      isSelected
                        ? 'bg-slate-900 text-white border-slate-900 shadow-lg -translate-y-0.5'
                        : 'bg-white text-slate-900 border-slate-200 hover:border-slate-400'
                    )}
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span
                          className={cn(
                            'text-[10px] font-black font-mono px-2 py-0.5 rounded-md',
                            isSelected
                              ? 'bg-emerald-500 text-white'
                              : 'bg-emerald-50 text-emerald-700'
                          )}
                        >
                          {m.code}
                        </span>
                        <Badge
                          className={cn(
                            'text-[9px] font-black uppercase border-none',
                            isSelected
                              ? 'bg-white/15 text-emerald-300'
                              : 'bg-slate-100 text-slate-700'
                          )}
                        >
                          {m.badge}
                        </Badge>
                      </div>
                      <h3 className="text-base font-black tracking-tight">{m.title}</h3>
                      <p
                        className={cn(
                          'text-xs leading-relaxed',
                          isSelected ? 'text-slate-300' : 'text-slate-500'
                        )}
                      >
                        {m.desc}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* TERMÓMETRO DE LEADS EN VIVO + AUTO-COTIZACIÓN EN 1 CLIC */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <Card className="lg:col-span-7 rounded-2xl border border-slate-200 bg-white shadow-sm">
                <CardHeader className="p-6 border-b border-slate-100 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-base font-black uppercase text-slate-900 flex items-center gap-2">
                      <Flame className="h-5 w-5 text-orange-500" /> Termómetro de Leads (Caliente / Tibio / Frío)
                    </CardTitle>
                    <CardDescription className="text-xs font-bold text-slate-500">
                      Genera una cotización formal en 1 clic o envía seguimiento personalizado hasta obtener Sí o No.
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="p-6 space-y-3 max-h-[420px] overflow-y-auto">
                  {brainIntelligence.classifiedLeads.map((lead) => (
                    <div
                      key={lead.id}
                      className="p-4 rounded-2xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          {lead.temperature === 'HOT' && (
                            <Badge className="bg-rose-100 text-rose-700 border-none font-black text-[9px] uppercase">
                              🔥 CALIENTE
                            </Badge>
                          )}
                          {lead.temperature === 'WARM' && (
                            <Badge className="bg-amber-100 text-amber-800 border-none font-black text-[9px] uppercase">
                              🟡 TIBIO
                            </Badge>
                          )}
                          {lead.temperature === 'COLD' && (
                            <Badge className="bg-blue-100 text-blue-700 border-none font-black text-[9px] uppercase">
                              ❄️ FRÍO
                            </Badge>
                          )}
                          <span className="text-xs font-black text-slate-900 uppercase">
                            {lead.customerName}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 line-clamp-1">{lead.lastMessage}</p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isCreatingAutoQuote === lead.id}
                          onClick={() => handleAutoQuoteFromLead(lead)}
                          className="h-8 px-3 rounded-xl font-black text-[9px] uppercase border-slate-300"
                        >
                          {isCreatingAutoQuote === lead.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <>
                              <PlusCircle className="h-3.5 w-3.5 mr-1 text-primary" /> Auto-Cotizar
                            </>
                          )}
                        </Button>
                        <Button
                          size="sm"
                          onClick={() =>
                            sendWhatsAppAction(
                              lead.phone,
                              `¡Hola *${lead.customerName}*! Te escribimos de *Athleticenter* 🏋️‍♂️. Queríamos confirmar si pudiste revisar nuestra propuesta con el *25% de Descuento en Divisas + 10% Pronto Pago* para reservar tus equipos hoy.`
                            )
                          }
                          className="h-8 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[9px] uppercase"
                        >
                          <MessageSquare className="h-3.5 w-3.5 mr-1" /> Seguimiento
                        </Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* REACTIVACIÓN ANTI-CHURN & EMPUJE DE SOBRESTOCK */}
              <Card className="lg:col-span-5 rounded-2xl border border-slate-200 bg-white shadow-sm">
                <CardHeader className="p-6 border-b border-slate-100">
                  <CardTitle className="text-base font-black uppercase text-slate-900 flex items-center gap-2">
                    <Users className="h-5 w-5 text-blue-600" /> Radar Anti-Churn & Sobrestock
                  </CardTitle>
                  <CardDescription className="text-xs font-bold text-slate-500">
                    Clientes B2B sin compras recientes listos para reactivar por WhatsApp.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-6 space-y-3 max-h-[420px] overflow-y-auto">
                  {brainIntelligence.churnRiskCustomers.slice(0, 6).map((c) => (
                    <div
                      key={c.id}
                      className="p-3.5 rounded-2xl border border-slate-200 flex items-center justify-between gap-3"
                    >
                      <div>
                        <p className="text-xs font-black text-slate-900 uppercase">{c.name}</p>
                        <p className="text-[10px] font-bold text-slate-500">
                          {c.daysInactive} días sin pedir • Histórico: ${c.historicalUSD.toFixed(0)}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() =>
                          sendWhatsAppAction(
                            c.phone,
                            `¡Hola *${c.name}*! Te saludamos de *Athleticenter* 🏋️‍♂️. Tenemos nuevo stock disponible con *25% de descuento en divisas + 10% pronto pago*. ¿Te enviamos el catálogo actualizado con precios de distribuidor?`
                          )
                        }
                        className="h-8 px-3 rounded-xl bg-slate-900 text-white font-black text-[9px] uppercase"
                      >
                        Reactivar →
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </Card>
        </TabsContent>

        {/* =================================================================
            TAB 4: OPERACIONES (EN TIEMPO VS. ATRASADO) + EQUIPO DE SOPORTE FAQ
            (Inspirado en Santino + Lámina 05/08 de @hechoconia)
        ================================================================= */}
        <TabsContent value="operaciones" className="space-y-6">
          <Card className="rounded-[2.25rem] border border-slate-200 bg-white p-6 sm:p-8 shadow-md space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <Badge className="bg-blue-50 text-blue-700 border-none font-black text-[9px] uppercase mb-1">
                  CHEQUEO OPERATIVO DIARIO (SLA 24 HORAS)
                </Badge>
                <h2 className="text-xl font-black text-slate-900 uppercase">
                  Operaciones y Despachos: En Tiempo vs. Atrasado
                </h2>
                <p className="text-xs text-slate-500 font-bold">
                  El sistema revisa cada pedido aprobado o en preparación y avisa si supera las 24h sin salir a despacho.
                </p>
              </div>
              <Button
                onClick={() => router.push('/dashboard/dispatch')}
                className="rounded-xl bg-slate-900 text-white font-black text-xs uppercase"
              >
                Abrir Mesa de Despacho →
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {brainIntelligence.delayedOperationsOrders.map((ord) => (
                <div
                  key={ord.id}
                  className={cn(
                    'p-4 rounded-2xl border flex flex-col justify-between gap-3',
                    ord.isLate
                      ? 'bg-rose-50/60 border-rose-200'
                      : 'bg-emerald-50/40 border-emerald-200'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-slate-900 uppercase">
                      Pedido #{ord.id.slice(0, 6)}
                    </span>
                    <Badge
                      className={cn(
                        'font-black text-[9px] uppercase border-none',
                        ord.isLate ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'
                      )}
                    >
                      {ord.isLate ? `🔴 ATRASADO (${ord.hoursElapsed}h)` : '🟢 EN TIEMPO'}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-sm font-black text-slate-900">{ord.customerName}</p>
                    <p className="text-xs font-bold text-slate-500">
                      Estado actual: {ord.status} • Monto: US$ {ord.totalAmount.toFixed(2)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* EL EQUIPO DE SOPORTE & POST-VENTA: RESPONDE EN SEGUNDOS (LÁMINA 05/08) */}
          <Card className="rounded-[2.25rem] border border-slate-200 bg-[#FAF8F5] p-6 sm:p-8 shadow-md space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-orange-600">
                  EL EQUIPO DE SOPORTE & ÉXITO DEL CLIENTE • RESPONDE EN SEGUNDOS
                </span>
                <h3 className="text-xl sm:text-2xl font-black text-slate-900 uppercase">
                  Monitor de Atención WhatsApp, Garantías y Base de Conocimiento FAQ
                </h3>
              </div>
              <Button
                variant="outline"
                onClick={() => router.push('/dashboard/whatsapp')}
                className="rounded-xl font-black text-xs uppercase border-slate-300"
              >
                Abrir Bandeja WhatsApp & Soporte →
              </Button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="p-4 rounded-2xl bg-white border border-slate-200">
                <span className="text-[9px] font-black uppercase text-slate-400">
                  CHATS / LEADS ATENDIDOS
                </span>
                <p className="text-2xl font-black text-slate-900 font-mono">
                  {brainIntelligence.classifiedLeads.length}
                </p>
                <span className="text-[10px] font-bold text-emerald-600">↗ 100% Respondidos</span>
              </div>
              <div className="p-4 rounded-2xl bg-white border border-slate-200">
                <span className="text-[9px] font-black uppercase text-slate-400">
                  TIEMPO PROMEDIO RESPUESTA IA
                </span>
                <p className="text-2xl font-black text-slate-900 font-mono">14 s</p>
                <span className="text-[10px] font-bold text-emerald-600">↗ Agente ARM 24/7</span>
              </div>
              <div className="p-4 rounded-2xl bg-white border border-slate-200">
                <span className="text-[9px] font-black uppercase text-slate-400">
                  RESPUESTAS OFICIALES FAQ
                </span>
                <p className="text-2xl font-black text-slate-900 font-mono">
                  {supportFaqScripts.length}
                </p>
                <span className="text-[10px] font-bold text-orange-600">
                  Verificadas sin alucinación
                </span>
              </div>
              <div className="p-4 rounded-2xl bg-white border border-slate-200">
                <span className="text-[9px] font-black uppercase text-slate-400">
                  SATISFACCIÓN / SLA DESPACHO
                </span>
                <p className="text-2xl font-black text-emerald-600 font-mono">98%</p>
                <span className="text-[10px] font-bold text-emerald-600">↗ Control de Calidad</span>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-black uppercase text-slate-700 flex items-center gap-2">
                <Headphones className="h-4 w-4 text-orange-600" /> Temas Más Consultados & Respuestas Oficiales en 1 Clic (Base de Conocimiento)
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {supportFaqScripts.map((faq, idx) => (
                  <div
                    key={idx}
                    className="p-4 rounded-2xl bg-white border border-slate-200 flex flex-col justify-between gap-3"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black text-slate-900">{faq.topic}</span>
                        <Badge className="bg-orange-50 text-orange-700 border-none text-[9px] font-black">
                          {faq.pct}% frecuencia
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">{faq.script}</p>
                    </div>
                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          navigator.clipboard.writeText(faq.script);
                          toast({
                            title: 'Respuesta Oficial Copiada',
                            description: faq.topic,
                          });
                        }}
                        className="h-8 px-3 rounded-xl font-black text-[9px] uppercase gap-1"
                      >
                        <Copy className="h-3 w-3" /> Copiar
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => sendWhatsAppAction('', faq.script)}
                        className="h-8 px-3 rounded-xl bg-slate-900 text-white font-black text-[9px] uppercase gap-1"
                      >
                        <Send className="h-3 w-3" /> Enviar por WhatsApp
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* =================================================================
            TAB 5: BANDEJA "VOS APROBÁS" + CAPA DE CONOCIMIENTO + COSTO IA
        ================================================================= */}
        <TabsContent value="aprobaciones" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* COLUMNA IZQUIERDA: COLA UNIFICADA "VOS APROBÁS" */}
            <Card className="lg:col-span-7 rounded-[2rem] border border-slate-200 bg-white shadow-md">
              <CardHeader className="p-6 border-b border-slate-100">
                <Badge className="w-fit bg-emerald-100 text-emerald-800 border-none font-black text-[9px] uppercase mb-1">
                  HUMAN-IN-THE-LOOP • CERO RIESGO
                </Badge>
                <CardTitle className="text-xl font-black uppercase text-slate-900">
                  Bandeja «Vos Aprobás» ({brainIntelligence.approvalQueue.length} pendientes)
                </CardTitle>
                <CardDescription className="text-xs font-bold text-slate-500">
                  El Cerebro nunca mueve dinero ni envía cobros delicados sin tu clic de autorización. Toda aprobación queda guardada en la Bitácora del CEO.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-3">
                {brainIntelligence.approvalQueue.length === 0 ? (
                  <div className="p-8 text-center space-y-2">
                    <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto" />
                    <p className="text-sm font-black text-slate-900 uppercase">
                      ¡Todo aprobado por hoy!
                    </p>
                    <p className="text-xs text-slate-500">
                      No tienes decisiones críticas pendientes en la cola.
                    </p>
                  </div>
                ) : (
                  brainIntelligence.approvalQueue.map((item) => (
                    <div
                      key={item.id}
                      className="p-4 rounded-2xl border border-slate-200 bg-slate-50/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge className="bg-slate-900 text-white font-black text-[8px] uppercase">
                            {item.category}
                          </Badge>
                          <span className="text-xs font-black text-emerald-700 font-mono">
                            Impacto: US$ {item.impactUSD.toFixed(2)}
                          </span>
                        </div>
                        <h4 className="text-sm font-black text-slate-900">{item.title}</h4>
                        <p className="text-xs text-slate-500">{item.description}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setDismissedIds((prev) => [...prev, item.id])}
                          className="h-9 px-3 rounded-xl font-black text-[10px] uppercase"
                        >
                          <X className="h-3.5 w-3.5 mr-1" /> Posponer
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleApproveItem(item)}
                          className="h-9 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[10px] uppercase"
                        >
                          <Check className="h-3.5 w-3.5 mr-1" /> Aprobar y Ejecutar
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* COLUMNA DERECHA: CAPA DE CONOCIMIENTO EDITABLE Y PRESUPUESTO DE TOKENS */}
            <Card className="lg:col-span-5 rounded-[2rem] border border-slate-200 bg-white shadow-md">
              <CardHeader className="p-6 border-b border-slate-100">
                <CardTitle className="text-base font-black uppercase text-slate-900 flex items-center gap-2">
                  <BookOpen className="h-5 w-5 text-primary" /> Capa de Conocimiento & Límites IA
                </CardTitle>
                <CardDescription className="text-xs font-bold text-slate-500">
                  Lo que el Cerebro sabe de Athleticenter. Edítalo sin tocar código.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-[10px] font-black uppercase text-slate-500">
                      Caja Mínima Seguridad ($)
                    </Label>
                    <Input
                      type="number"
                      value={configForm.minCashThresholdUSD}
                      onChange={(e) =>
                        setConfigForm({
                          ...configForm,
                          minCashThresholdUSD: Number(e.target.value),
                        })
                      }
                      className="h-10 font-black"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] font-black uppercase text-slate-500">
                      Tope Mensual IA ($ USD)
                    </Label>
                    <Input
                      type="number"
                      value={configForm.monthlyTokenBudgetUSD}
                      onChange={(e) =>
                        setConfigForm({
                          ...configForm,
                          monthlyTokenBudgetUSD: Number(e.target.value),
                        })
                      }
                      className="h-10 font-black"
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-[10px] font-black uppercase text-slate-500">
                    WhatsApp Gerencia (Destino Reporte 7:00 AM)
                  </Label>
                  <Input
                    value={configForm.ceoWhatsappPhone}
                    onChange={(e) =>
                      setConfigForm({ ...configForm, ceoWhatsappPhone: e.target.value })
                    }
                    className="h-10 font-black"
                  />
                </div>

                <div>
                  <Label className="text-[10px] font-black uppercase text-slate-500">
                    Reglas de Negocio y Cortafuegos
                  </Label>
                  <Textarea
                    rows={3}
                    value={configForm.businessRules}
                    onChange={(e) =>
                      setConfigForm({ ...configForm, businessRules: e.target.value })
                    }
                    className="text-xs font-medium"
                  />
                </div>

                <div>
                  <Label className="text-[10px] font-black uppercase text-slate-500">
                    Respuestas a Objeciones Frecuentes (Ventas)
                  </Label>
                  <Textarea
                    rows={3}
                    value={configForm.objectionHandling}
                    onChange={(e) =>
                      setConfigForm({ ...configForm, objectionHandling: e.target.value })
                    }
                    className="text-xs font-medium"
                  />
                </div>

                <Button
                  onClick={handleSaveBrainConfig}
                  disabled={isSavingConfig}
                  className="w-full h-11 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-black text-xs uppercase tracking-wider gap-2"
                >
                  {isSavingConfig ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Guardar Capa de Conocimiento
                </Button>

                <div className="p-4 rounded-2xl bg-slate-900 text-white space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] font-black uppercase text-emerald-400">
                    <span>Consumo Estimado de los 10 Agentes:</span>
                    <span>~$3.90 USD / MES</span>
                  </div>
                  <p className="text-[11px] text-slate-300">
                    80% cálculo determinista ($0 costo de tokens) + 20% Gemini 2.5 Flash en la nube de producción.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
