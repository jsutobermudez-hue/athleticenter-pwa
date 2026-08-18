'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useCollection, useFirestore, useMemoFirebase, useUser, useDoc } from '@/firebase';
import { collection, query, limit, doc } from 'firebase/firestore';
import type { Product, FinancialSettings, Order } from '@/lib/definitions';
import { useFinance } from '@/context/FinanceContext';
import { calculateMultiProductBreakEven, type ExpenseItem } from '@/lib/breakEvenEngine';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { 
    Calculator, 
    DollarSign, 
    TrendingUp, 
    Landmark, 
    Plus, 
    Trash2, 
    Sparkles, 
    Boxes, 
    Zap, 
    CheckCircle2, 
    AlertTriangle, 
    Lock, 
    Building2, 
    PieChart, 
    BarChart3,
    ArrowUpRight,
    RefreshCw,
    Search,
    ShieldCheck,
    FileText
} from 'lucide-react';

export const dynamic = 'force-dynamic';

export default function BreakEvenPage() {
  const router = useRouter();
  const firestore = useFirestore();
  const { toast } = useToast();
  const { profile: currentUser, isUserLoading } = useUser();

  const canManage = !isUserLoading && currentUser && ['superadmin', 'admin', 'gerencia'].includes(currentUser.role);

  const {
    expenses,
    targetProfitUSD,
    customSalesMix,
    isLoading: isLoadingFinance,
    addExpense,
    deleteExpense,
    setTargetProfitUSD,
    updateProductSalesMix,
    resetMixToDefault
  } = useFinance();

  const settingsRef = useMemoFirebase(() => (firestore && canManage ? doc(firestore, 'system', 'financials') : null), [firestore, canManage]);
  const { data: globalSettings } = useDoc<FinancialSettings>(settingsRef);

  const productsQuery = useMemoFirebase(() => (firestore && canManage ? query(collection(firestore, 'products'), limit(300)) : null), [firestore, canManage]);
  const { data: catalogProducts, isLoading: isLoadingProducts } = useCollection<Product>(productsQuery);

  const ordersQuery = useMemoFirebase(() => (firestore && canManage ? query(collection(firestore, 'orders'), limit(200)) : null), [firestore, canManage]);
  const { data: monthOrders } = useCollection<Order>(ordersQuery);

  // FORMULARIO DE NUEVO GASTO
  const [newConcept, setNewConcept] = useState('');
  const [newCategory, setNewCategory] = useState<ExpenseItem['category']>('Nómina');
  const [newAmountUSD, setNewAmountUSD] = useState<string>('');
  const [newIsFixed, setNewIsFixed] = useState(true);

  // FILTRO BÚSQUEDA DATA GRID
  const [searchTerm, setSearchTerm] = useState('');

  // MODALES INTERACTIVOS DE LAS TARJETAS KPI
  const [isExpensesModalOpen, setIsExpensesModalOpen] = useState(false);
  const [isScenarioModalOpen, setIsScenarioModalOpen] = useState(false);
  const [isBreakEvenDetailModalOpen, setIsBreakEvenDetailModalOpen] = useState(false);
  const [isProgressModalOpen, setIsProgressModalOpen] = useState(false);

  // CÁLCULO DE VENTAS REALES REGISTRADAS (MES, SEMANA, HISTÓRICO Y SEMANAS INDIVIDUALES)
  const actualSalesMetrics = useMemo(() => {
    if (!monthOrders) return { 
      salesMonthUSD: 0, 
      unitsMonth: 0, 
      salesWeekUSD: 0, 
      unitsWeek: 0,
      salesTotalAllTimeUSD: 0,
      unitsTotalAllTime: 0,
      weeklyBreakdown: [
        { name: 'Semana 1 (Días 1 - 7)', salesUSD: 0, units: 0 },
        { name: 'Semana 2 (Días 8 - 14)', salesUSD: 0, units: 0 },
        { name: 'Semana 3 (Días 15 - 21)', salesUSD: 0, units: 0 },
        { name: 'Semana 4 (Días 22 - Fin de Mes)', salesUSD: 0, units: 0 }
      ]
    };

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - 7);

    let salesMonthUSD = 0;
    let unitsMonth = 0;
    let salesWeekUSD = 0;
    let unitsWeek = 0;
    let salesTotalAllTimeUSD = 0;
    let unitsTotalAllTime = 0;

    const weeklyMap = { 1: 0, 2: 0, 3: 0, 4: 0 };
    const weeklyUnitsMap = { 1: 0, 2: 0, 3: 0, 4: 0 };

    monthOrders.forEach(o => {
      if (o.status !== 'Cancelado' && o.status !== 'Rechazado') {
        const amount = Number(o.totalAmount || 0);
        let units = 0;
        const orderItems = (o as any).items;
        if (orderItems && Array.isArray(orderItems)) {
          orderItems.forEach((i: any) => { units += Number(i.quantity || 0); });
        }

        salesTotalAllTimeUSD += amount;
        unitsTotalAllTime += units;

        // Extraer fecha del pedido
        let orderDate: Date | null = null;
        if (o.orderDate) {
          if (typeof (o.orderDate as any).toDate === 'function') {
            orderDate = (o.orderDate as any).toDate();
          } else if ((o.orderDate as any).seconds) {
            orderDate = new Date((o.orderDate as any).seconds * 1000);
          } else {
            orderDate = new Date(o.orderDate as any);
          }
        }

        if (orderDate && !isNaN(orderDate.getTime())) {
          // Filtrar por Mes Actual
          if (orderDate.getMonth() === currentMonth && orderDate.getFullYear() === currentYear) {
            salesMonthUSD += amount;
            unitsMonth += units;

            const day = orderDate.getDate();
            let weekNum: 1 | 2 | 3 | 4 = 1;
            if (day > 21) weekNum = 4;
            else if (day > 14) weekNum = 3;
            else if (day > 7) weekNum = 2;

            weeklyMap[weekNum] += amount;
            weeklyUnitsMap[weekNum] += units;
          }

          // Filtrar por Semana Actual (últimos 7 días)
          if (orderDate >= startOfWeek) {
            salesWeekUSD += amount;
            unitsWeek += units;
          }
        } else {
          // Si no tiene fecha válida, contar en el mes por defecto
          salesMonthUSD += amount;
          unitsMonth += units;
        }
      }
    });

    const weeklyBreakdown = [
      { name: 'Semana 1 (Días 1 - 7)', salesUSD: weeklyMap[1], units: weeklyUnitsMap[1] },
      { name: 'Semana 2 (Días 8 - 14)', salesUSD: weeklyMap[2], units: weeklyUnitsMap[2] },
      { name: 'Semana 3 (Días 15 - 21)', salesUSD: weeklyMap[3], units: weeklyUnitsMap[3] },
      { name: 'Semana 4 (Días 22 - Fin de Mes)', salesUSD: weeklyMap[4], units: weeklyUnitsMap[4] }
    ];

    return {
      salesMonthUSD,
      unitsMonth,
      salesWeekUSD,
      unitsWeek,
      salesTotalAllTimeUSD,
      unitsTotalAllTime,
      weeklyBreakdown
    };
  }, [monthOrders]);

  // EJECUCIÓN DEL MOTOR FINANCIERO REACTIVO CON CÁLCULO DE MIX AUTOMÁTICO POR VENTAS REALES
  const calculation = useMemo(() => {
    return calculateMultiProductBreakEven(
      catalogProducts || [],
      expenses,
      targetProfitUSD,
      globalSettings,
      customSalesMix,
      actualSalesMetrics.salesMonthUSD,
      actualSalesMetrics.unitsMonth,
      monthOrders || undefined
    );
  }, [catalogProducts, expenses, targetProfitUSD, globalSettings, customSalesMix, actualSalesMetrics, monthOrders]);

  const { items, summary } = calculation;

  // HANDLER AGREGAR GASTO
  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(newAmountUSD);
    if (!newConcept.trim() || isNaN(amount) || amount <= 0) {
      toast({ variant: 'destructive', title: 'Datos Inválidos', description: 'Ingresa un concepto y monto válido.' });
      return;
    }
    await addExpense({
      concept: newConcept.trim(),
      category: newCategory,
      amountUSD: amount,
      isFixed: newIsFixed,
      periodicity: 'mensual'
    });
    setNewConcept('');
    setNewAmountUSD('');
    toast({ title: 'Gasto Registrado', description: `Se añadió "${newConcept}" por $${amount} USD.` });
  };

  // FILTRADO EN DATA GRID
  const filteredItems = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return items;
    return items.filter(i => 
      i.product.name.toLowerCase().includes(term) ||
      (i.product.sku || '').toLowerCase().includes(term) ||
      (i.product.brand || '').toLowerCase().includes(term)
    );
  }, [items, searchTerm]);

  if (isUserLoading || isLoadingProducts || isLoadingFinance) {
    return <div className="flex h-screen items-center justify-center"><RefreshCw className="animate-spin text-primary h-10 w-10" /></div>;
  }

  if (!canManage) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 p-8 text-center bg-slate-900 text-white rounded-[2.5rem] my-10 mx-4">
        <div className="p-6 rounded-full bg-rose-500/10 text-rose-500"><Lock className="h-16 w-16" /></div>
        <h1 className="text-2xl font-black uppercase tracking-tight">Acceso Exclusivo para Administración y Gerencia</h1>
        <p className="text-slate-400 text-xs max-w-md">El Control Financiero y Punto de Equilibrio está protegido para resguardar las metas operativas corporativas.</p>
        <Button onClick={() => router.push('/dashboard')} className="h-12 px-8 rounded-xl bg-white text-slate-900 font-black uppercase text-[10px]">Volver al Inicio</Button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[1600px] mx-auto flex flex-col gap-8 pb-32 px-4 sm:px-6 lg:px-8 animate-in fade-in-50 duration-500">
      {/* CABECERA CORPORATIVA */}
      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-100 pb-6">
        <div>
          <h1 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter text-slate-900 leading-none flex items-center gap-3">
            <Calculator className="h-8 w-8 text-primary" /> Punto de Equilibrio & Control de Gastos
          </h1>
          <p className="text-muted-foreground text-[10px] sm:text-xs font-black italic uppercase tracking-[0.3em] opacity-60 mt-1">
            Simulador Multiproducto B2B, Estructura de Costos y Metas de Venta.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => router.push('/dashboard/treasury')} className="h-10 px-4 rounded-xl border-slate-200 font-black text-[9px] uppercase tracking-wider">
            <Landmark className="h-4 w-4 mr-1.5 text-primary" /> TESORERÍA
          </Button>
          <Button variant="outline" size="sm" onClick={() => router.push('/dashboard/inventory/pricing-calculator')} className="h-10 px-4 rounded-xl border-slate-200 font-black text-[9px] uppercase tracking-wider">
            <Zap className="h-4 w-4 mr-1.5 text-primary" /> CALCULADORA SMART
          </Button>
        </div>
      </header>

      {/* 1. TARJETAS KPI EJECUTIVAS EN TIEMPO REAL - INTERACTIVAS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* TARJETA 1: COSTOS FIJOS MENSUALES */}
        <Card 
          onClick={() => setIsExpensesModalOpen(true)}
          className="border-none shadow-xl rounded-[2rem] bg-slate-900 text-white p-6 flex flex-col justify-between relative overflow-hidden cursor-pointer hover:scale-[1.02] hover:shadow-2xl transition-all duration-300 group"
        >
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-primary flex items-center gap-1">
                Costos Fijos Mensuales <ArrowUpRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              </p>
              <h3 className="text-3xl font-black tracking-tight text-white mt-1">${summary.totalFixedExpensesUSD.toLocaleString('en-US')}</h3>
              <p className="text-[9px] font-bold text-slate-400 font-mono">Bs. {(summary.totalFixedExpensesUSD * summary.bcvRate).toLocaleString('es-VE')} (BCV)</p>
            </div>
            <div className="p-3 rounded-2xl bg-primary/20 text-primary group-hover:bg-primary group-hover:text-white transition-colors"><Building2 className="h-6 w-6" /></div>
          </div>
          <div className="flex items-center justify-between mt-4">
            <Badge variant="outline" className="border-slate-800 text-[8px] font-mono text-slate-400 uppercase">
              {expenses.filter(e => e.isFixed).length} Rubros Fijos Registrados
            </Badge>
            <span className="text-[8px] font-black uppercase text-primary tracking-widest group-hover:underline">VER DETALLE ➔</span>
          </div>
        </Card>

        {/* TARJETA 2: META DE GANANCIA DESEADA */}
        <Card 
          onClick={() => setIsScenarioModalOpen(true)}
          className="border-none shadow-xl rounded-[2rem] bg-gradient-to-br from-primary to-blue-700 text-white p-6 flex flex-col justify-between relative overflow-hidden cursor-pointer hover:scale-[1.02] hover:shadow-2xl transition-all duration-300 group"
        >
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-white/80 flex items-center gap-1">
                Meta de Ganancia Deseada <ArrowUpRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              </p>
              <h3 className="text-3xl font-black tracking-tight text-white mt-1">${summary.targetProfitUSD.toLocaleString('en-US')}</h3>
              <p className="text-[9px] font-bold text-white/70 font-mono">Utilidad Neta Meta Mensual</p>
            </div>
            <div className="p-3 rounded-2xl bg-white/20 text-white group-hover:bg-white group-hover:text-primary transition-colors"><TrendingUp className="h-6 w-6" /></div>
          </div>
          <div className="flex items-center gap-2 mt-4" onClick={(e) => e.stopPropagation()}>
            <Input
              type="number"
              value={targetProfitUSD}
              onChange={(e) => setTargetProfitUSD(Number(e.target.value))}
              className="h-8 font-black text-center text-xs bg-white/20 border-none text-white rounded-xl placeholder:text-white/50 w-28"
            />
            <span className="text-[8px] font-black uppercase text-white/90">Ajustar Meta USD</span>
          </div>
        </Card>

        {/* TARJETA 3: FACTURACIÓN REQUERIDA TOTAL */}
        <Card 
          onClick={() => setIsBreakEvenDetailModalOpen(true)}
          className="border-none shadow-xl rounded-[2rem] bg-emerald-600 text-white p-6 flex flex-col justify-between relative overflow-hidden cursor-pointer hover:scale-[1.02] hover:shadow-2xl transition-all duration-300 group"
        >
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-emerald-200 flex items-center gap-1">
                Facturación Requerida Total <ArrowUpRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              </p>
              <h3 className="text-3xl font-black tracking-tight text-white mt-1">${summary.totalRequiredRevenueUSD.toLocaleString('en-US')}</h3>
              <p className="text-[9px] font-bold text-emerald-100 font-mono">Bs. {summary.totalRequiredRevenueVES.toLocaleString('es-VE')} (BCV)</p>
            </div>
            <div className="p-3 rounded-2xl bg-white/20 text-white group-hover:bg-white group-hover:text-emerald-700 transition-colors"><DollarSign className="h-6 w-6" /></div>
          </div>
          <div className="flex items-center justify-between mt-4">
            <Badge className="bg-white/20 text-white font-mono text-[9px] font-black border-none">
              {summary.totalRequiredUnits} Unidades a Vender
            </Badge>
            <span className="text-[8px] font-black uppercase text-emerald-100 tracking-widest group-hover:underline">FÓRMULA ➔</span>
          </div>
        </Card>

        {/* TARJETA 4: PROGRESO REAL & RITMO DE VENTAS (MES Y SEMANA) */}
        <Card 
          onClick={() => setIsProgressModalOpen(true)}
          className="border-none shadow-xl rounded-[2rem] bg-white p-6 flex flex-col justify-between relative overflow-hidden border border-slate-100 cursor-pointer hover:scale-[1.02] hover:shadow-2xl transition-all duration-300 group"
        >
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-1">
                Progreso Real del Mes <ArrowUpRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              </p>
              <h3 className="text-3xl font-black tracking-tight text-slate-900 mt-1">{summary.breakEvenProgressPercent}%</h3>
              <p className="text-[9px] font-bold text-slate-500 uppercase">${actualSalesMetrics.salesMonthUSD.toLocaleString('en-US')} Vendidos Este Mes</p>
            </div>
            <div className="p-3 rounded-2xl bg-slate-100 text-slate-700 group-hover:bg-primary group-hover:text-white transition-colors"><BarChart3 className="h-6 w-6" /></div>
          </div>

          <div className="space-y-2 mt-3">
            <Progress value={summary.breakEvenProgressPercent} className="h-2 bg-slate-100" />
            <div className="grid grid-cols-2 gap-1 text-[8px] font-black uppercase text-slate-500 font-mono">
              <span className="bg-slate-50 p-1 rounded-md">📅 Semana: ${actualSalesMetrics.salesWeekUSD.toLocaleString('en-US')}</span>
              <span className="bg-slate-50 p-1 rounded-md text-right">🗓️ Mes: ${actualSalesMetrics.salesMonthUSD.toLocaleString('en-US')}</span>
            </div>
          </div>
        </Card>
      </div>

      {/* 2. REGISTRO Y CONTROL DE GASTOS FIJOS Y VARIABLES */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* FORMULARIO AGREGAR GASTO */}
        <Card className="border-none shadow-xl rounded-[2.5rem] bg-white overflow-hidden lg:col-span-1">
          <CardHeader className="bg-slate-50/50 py-5 px-8 border-b">
            <CardTitle className="text-xs font-black uppercase tracking-[0.3em] text-slate-900 flex items-center gap-2">
              <Plus className="h-4 w-4 text-primary" /> Registrar Nuevo Gasto
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <form onSubmit={handleAddExpense} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase text-slate-500">Concepto del Gasto</Label>
                <Input
                  value={newConcept}
                  onChange={(e) => setNewConcept(e.target.value)}
                  placeholder="Ej. Nómina Operativa / Mantenimiento Camión"
                  className="h-11 font-bold text-xs rounded-xl"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[9px] font-black uppercase text-slate-500">Categoría</Label>
                  <Select value={newCategory} onValueChange={(v: any) => setNewCategory(v)}>
                    <SelectTrigger className="h-11 text-xs font-bold rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Nómina">Nómina</SelectItem>
                      <SelectItem value="Alquiler">Alquiler</SelectItem>
                      <SelectItem value="Servicios">Servicios</SelectItem>
                      <SelectItem value="Marketing">Marketing</SelectItem>
                      <SelectItem value="Depreciación">Depreciación</SelectItem>
                      <SelectItem value="Impuestos">Impuestos</SelectItem>
                      <SelectItem value="Flete Local">Flete Local</SelectItem>
                      <SelectItem value="Licencias/Software">Licencias</SelectItem>
                      <SelectItem value="Otros">Otros</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[9px] font-black uppercase text-slate-500">Monto ($ USD)</Label>
                  <Input
                    type="number"
                    value={newAmountUSD}
                    onChange={(e) => setNewAmountUSD(e.target.value)}
                    placeholder="0.00"
                    className="h-11 font-black text-xs rounded-xl"
                    required
                  />
                </div>
              </div>

              <div className="flex items-center justify-between p-4 rounded-2xl bg-slate-50 border border-slate-100">
                <span className="text-xs font-black uppercase text-slate-700">¿Es Gasto Fijo Mensual?</span>
                <Button
                  type="button"
                  size="sm"
                  variant={newIsFixed ? 'default' : 'outline'}
                  onClick={() => setNewIsFixed(!newIsFixed)}
                  className={cn("h-8 px-4 rounded-xl text-[9px] font-black uppercase border-none", newIsFixed ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-600")}
                >
                  {newIsFixed ? 'SI (FIJO)' : 'NO (VARIABLE)'}
                </Button>
              </div>

              <Button type="submit" className="w-full h-12 rounded-xl bg-primary hover:bg-primary/90 text-white font-black text-xs uppercase shadow-lg">
                <Plus className="h-4 w-4 mr-2" /> Agregar a Estructura de Costos
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* TABLA DE GASTOS REGISTRADOS */}
        <Card className="border-none shadow-xl rounded-[2.5rem] bg-white overflow-hidden lg:col-span-2">
          <CardHeader className="bg-slate-50/50 py-5 px-8 border-b flex flex-row items-center justify-between">
            <CardTitle className="text-xs font-black uppercase tracking-[0.3em] text-slate-900 flex items-center gap-2">
              <Landmark className="h-4 w-4 text-primary" /> Estructura Operativa de Gastos ({expenses.length})
            </CardTitle>
            <Badge variant="outline" className="border-slate-200 text-[8px] font-mono uppercase text-slate-500">Total Fijos: ${summary.totalFixedExpensesUSD}</Badge>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto max-h-[360px] overflow-y-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest sticky top-0 z-10">
                  <th className="p-4 pl-8">Concepto</th>
                  <th className="p-4">Categoría</th>
                  <th className="p-4 text-center">Tipo</th>
                  <th className="p-4 text-right">Monto ($ USD)</th>
                  <th className="p-4 pr-8 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs font-bold text-slate-800">
                {expenses.map((e, idx) => (
                  <tr key={e.id || idx} className="hover:bg-slate-50 transition-colors">
                    <td className="p-4 pl-8 font-black uppercase text-slate-900">{e.concept}</td>
                    <td className="p-4"><Badge variant="secondary" className="bg-slate-100 text-slate-700 text-[8px] font-black uppercase border-none">{e.category}</Badge></td>
                    <td className="p-4 text-center">
                      <Badge className={cn("text-[8px] font-black uppercase border-none px-2 py-0.5", e.isFixed ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700")}>
                        {e.isFixed ? 'FIJO' : 'VARIABLE'}
                      </Badge>
                    </td>
                    <td className="p-4 text-right font-mono font-black text-slate-900">${e.amountUSD.toFixed(2)}</td>
                    <td className="p-4 pr-8 text-right">
                      {e.id && (
                        <Button size="sm" variant="ghost" onClick={() => deleteExpense(e.id!)} className="h-8 w-8 p-0 text-rose-500 hover:bg-rose-50 rounded-xl">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* 3. DATA GRID MULTIPRODUCTO DINÁMICO */}
      <Card className="border-none shadow-2xl rounded-[2.5rem] bg-white overflow-hidden">
        <CardHeader className="bg-slate-50/50 py-5 px-8 border-b flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <CardTitle className="text-xs font-black uppercase tracking-[0.3em] text-slate-900 flex items-center gap-2">
              <Boxes className="h-5 w-5 text-primary" /> Matrix Multiproducto: Ventas Requeridas por Artículo ({filteredItems.length})
            </CardTitle>
            <p className="text-[10px] text-slate-400 font-medium uppercase mt-0.5">Recálculo reactivo según la meta de ganancia y estructura de gastos.</p>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <Input
                placeholder="BUSCAR PRODUCTO / SKU..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 h-10 text-[10px] font-bold uppercase bg-slate-50 border-none rounded-xl"
              />
            </div>
            <Button variant="outline" size="sm" onClick={resetMixToDefault} className="h-10 text-[9px] font-black uppercase border-slate-200 rounded-xl">
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Reset % Mix
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest">
                <th className="p-4 pl-8">Producto / SKU</th>
                <th className="p-4 text-right">Costo Landed</th>
                <th className="p-4 text-right">Precio Cash</th>
                <th className="p-4 text-right">Margen Neto Unit</th>
                <th className="p-4 text-center">% Mix Participación</th>
                <th className="p-4 text-center font-bold text-amber-300">Unidades Req / Mes</th>
                <th className="p-4 text-right font-bold text-emerald-300">Ventas Req ($ USD)</th>
                <th className="p-4 text-right">Ventas Req (Bs. BCV)</th>
                <th className="p-4 pr-8 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs font-bold text-slate-800">
              {filteredItems.map((item, idx) => (
                <tr key={item.product.id || idx} className="hover:bg-slate-50/80 transition-colors">
                  <td className="p-4 pl-8">
                    <div className="space-y-0.5">
                      <p className="font-black text-slate-900 uppercase leading-tight">{item.product.name}</p>
                      <p className="text-[8px] font-mono text-slate-400">SKU: {item.product.sku} | Marca: {item.product.brand || 'N/A'}</p>
                    </div>
                  </td>

                  <td className="p-4 text-right font-mono font-black text-slate-700">${item.landedCost.toFixed(2)}</td>
                  <td className="p-4 text-right font-mono font-black text-blue-700">${item.priceCashUSD.toFixed(2)}</td>

                  <td className="p-4 text-right font-mono font-black text-emerald-600">
                    +${item.netProfitUSD.toFixed(2)}
                    <span className="block text-[8px] text-slate-400 font-mono">({item.netMarginPercent.toFixed(1)}%)</span>
                  </td>

                  <td className="p-4 text-center">
                    <div className="flex flex-col items-center justify-center gap-1">
                      <div className="flex items-center justify-center gap-1">
                        <Input
                          type="number"
                          value={item.salesMixPercent}
                          onChange={(e) => updateProductSalesMix(item.product.id!, Number(e.target.value))}
                          className="h-8 w-16 text-center font-black font-mono text-xs bg-slate-50 border-slate-200 rounded-xl"
                        />
                        <span className="text-[10px] font-black text-slate-400">%</span>
                      </div>
                      <Badge variant="outline" className={cn("text-[7px] font-mono border-none px-1.5 py-0.5", item.isAutoMix ? "bg-emerald-50 text-emerald-600" : "bg-purple-50 text-purple-600")}>
                        {item.isAutoMix ? `🤖 Auto (${item.historicalUnitsSold} vend.)` : '✏️ Manual'}
                      </Badge>
                    </div>
                  </td>

                  <td className="p-4 text-center font-mono font-black text-amber-600 bg-amber-50/50">
                    <span className="text-sm">{item.requiredUnitsMonth}</span> <span className="text-[8px] uppercase">unid</span>
                  </td>

                  <td className="p-4 text-right font-mono font-black text-emerald-700 bg-emerald-50/30">
                    ${item.requiredRevenueUSDMonth.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </td>

                  <td className="p-4 text-right font-mono font-black text-slate-600">
                    Bs. {item.requiredRevenueVESMonth.toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                  </td>

                  <td className="p-4 pr-8 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => router.push(`/dashboard/inventory/pricing-calculator?sku=${item.product.sku}`)}
                      className="h-8 px-3 rounded-xl text-[8px] font-black uppercase text-primary hover:bg-primary/10"
                    >
                      <Zap className="h-3 w-3 mr-1" /> Calculadora Smart
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* MODAL 1: DETALLE DE COSTOS FIJOS POR CATEGORÍA */}
      <Dialog open={isExpensesModalOpen} onOpenChange={setIsExpensesModalOpen}>
        <DialogContent className="sm:max-w-xl rounded-[2.5rem] border-none shadow-2xl overflow-hidden p-8">
          <DialogHeader className="space-y-2">
            <DialogTitle className="text-xl font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" /> Auditoría de Costos Fijos Mensuales
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 font-medium">
              Origen de datos: Colección <code>expenses</code> en Firestore (Filtrado por <code>isFixed: true</code>).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="p-4 rounded-2xl bg-slate-900 text-white flex justify-between items-center">
              <div>
                <span className="text-[8px] font-black uppercase text-primary tracking-widest">Total Gastos Fijos</span>
                <h3 className="text-2xl font-black text-white">${summary.totalFixedExpensesUSD.toLocaleString('en-US')} USD</h3>
              </div>
              <Badge className="bg-primary/20 text-primary font-mono text-[9px] border-none">
                Bs. {(summary.totalFixedExpensesUSD * summary.bcvRate).toLocaleString('es-VE')} BCV
              </Badge>
            </div>

            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
              {expenses.filter(e => e.isFixed).map((exp, i) => (
                <div key={i} className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100 flex justify-between items-center text-xs font-bold text-slate-800">
                  <div>
                    <p className="font-black text-slate-900 uppercase">{exp.concept}</p>
                    <span className="text-[8px] font-black text-slate-400 uppercase">{exp.category}</span>
                  </div>
                  <span className="font-mono font-black text-slate-900">${exp.amountUSD.toFixed(2)} USD</span>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button onClick={() => setIsExpensesModalOpen(false)} className="h-11 px-6 rounded-xl bg-slate-900 text-white font-black text-xs uppercase">
              Cerrar Auditoría
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL 2: SIMULADOR DE ESCENARIOS DE GANANCIA */}
      <Dialog open={isScenarioModalOpen} onOpenChange={setIsScenarioModalOpen}>
        <DialogContent className="sm:max-w-md rounded-[2.5rem] border-none shadow-2xl overflow-hidden p-8">
          <DialogHeader className="space-y-2">
            <DialogTitle className="text-xl font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" /> Simulador de Escenarios de Ganancia Meta
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 font-medium">
              Origen de datos: Documento <code>system/financials</code> en Firestore (Propiedad <code>targetProfitUSD</code>).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <p className="text-xs font-bold text-slate-700 uppercase">Selecciona un escenario rápido de proyección mensual:</p>
            <div className="grid grid-cols-3 gap-3">
              <Button
                variant="outline"
                onClick={() => { setTargetProfitUSD(2000); setIsScenarioModalOpen(false); }}
                className="h-20 flex flex-col items-center justify-center rounded-2xl border-slate-200 hover:border-primary hover:bg-primary/5"
              >
                <span className="text-[8px] font-black uppercase text-slate-400">Conservador</span>
                <span className="text-sm font-black text-slate-900">$2,000</span>
              </Button>
              <Button
                variant="outline"
                onClick={() => { setTargetProfitUSD(5000); setIsScenarioModalOpen(false); }}
                className="h-20 flex flex-col items-center justify-center rounded-2xl border-primary bg-primary/5"
              >
                <span className="text-[8px] font-black uppercase text-primary">Moderado</span>
                <span className="text-sm font-black text-primary">$5,000</span>
              </Button>
              <Button
                variant="outline"
                onClick={() => { setTargetProfitUSD(10000); setIsScenarioModalOpen(false); }}
                className="h-20 flex flex-col items-center justify-center rounded-2xl border-emerald-500 hover:bg-emerald-50"
              >
                <span className="text-[8px] font-black uppercase text-emerald-600">Agresivo</span>
                <span className="text-sm font-black text-emerald-700">$10,000</span>
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsScenarioModalOpen(false)} className="h-11 rounded-xl font-black text-xs uppercase">Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL 3: FÓRMULA Y DESGLOSE DE FACTURACIÓN REQUERIDA */}
      <Dialog open={isBreakEvenDetailModalOpen} onOpenChange={setIsBreakEvenDetailModalOpen}>
        <DialogContent className="sm:max-w-lg rounded-[2.5rem] border-none shadow-2xl overflow-hidden p-8">
          <DialogHeader className="space-y-2">
            <DialogTitle className="text-xl font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-emerald-600" /> Matemática del Punto de Equilibrio
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 font-medium">
              Origen de datos: Calculado por el motor <code>breakEvenEngine.ts</code> utilizando las comisiones de Tesorería (15%) y Overhead (10%).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-100 text-center space-y-1">
              <span className="text-[8px] font-black uppercase text-emerald-600">Fórmula Aplicada</span>
              <p className="text-xs font-mono font-black text-emerald-900">
                PE Unidades = (Costos Fijos $ + Ganancia Deseada $) / Margen Ponderado (MCP)
              </p>
              <p className="text-xl font-black text-emerald-700 font-mono pt-2">
                PE = (${summary.totalFixedExpensesUSD} + ${summary.targetProfitUSD}) / ${summary.weightedContributionMargin} = {summary.totalRequiredUnits} Unids
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-2">
              <div className="flex justify-between text-xs font-bold text-slate-700">
                <span>Facturación Requerida USD:</span>
                <span className="font-mono font-black text-slate-900">${summary.totalRequiredRevenueUSD.toLocaleString('en-US')}</span>
              </div>
              <div className="flex justify-between text-xs font-bold text-slate-700">
                <span>Facturación Requerida BCV:</span>
                <span className="font-mono font-black text-slate-900">Bs. {summary.totalRequiredRevenueVES.toLocaleString('es-VE')}</span>
              </div>
              <div className="flex justify-between text-xs font-bold text-slate-700">
                <span>Tasa Oficial BCV Aplicada:</span>
                <span className="font-mono font-black text-primary">Bs. {summary.bcvRate.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button onClick={() => setIsBreakEvenDetailModalOpen(false)} className="h-11 px-6 rounded-xl bg-slate-900 text-white font-black text-xs uppercase">
              Entendido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL 4: DETALLE DE PROGRESO REAL, VENTAS SEMANALES Y MENSUALES */}
      <Dialog open={isProgressModalOpen} onOpenChange={setIsProgressModalOpen}>
        <DialogContent className="sm:max-w-xl rounded-[2.5rem] border-none shadow-2xl overflow-hidden p-8">
          <DialogHeader className="space-y-2">
            <DialogTitle className="text-xl font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" /> Auditoría y Ritmo de Ventas (Semanal / Mensual)
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 font-medium">
              Origen de datos: Pedidos procesados en la colección <code>orders</code> de Firestore.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-4">
            {/* TARJETAS RESUMEN: MES, SEMANA E HISTÓRICO */}
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3.5 rounded-2xl bg-blue-50 border border-blue-100 text-center">
                <span className="text-[8px] font-black uppercase text-blue-600">Ventas Este Mes</span>
                <h4 className="text-base font-black text-blue-900 font-mono mt-0.5">${actualSalesMetrics.salesMonthUSD.toLocaleString('en-US')}</h4>
                <span className="text-[8px] font-bold text-blue-700 font-mono">{actualSalesMetrics.unitsMonth} Unids</span>
              </div>

              <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-100 text-center">
                <span className="text-[8px] font-black uppercase text-emerald-600">Últimos 7 Días</span>
                <h4 className="text-base font-black text-emerald-900 font-mono mt-0.5">${actualSalesMetrics.salesWeekUSD.toLocaleString('en-US')}</h4>
                <span className="text-[8px] font-bold text-emerald-700 font-mono">{actualSalesMetrics.unitsWeek} Unids</span>
              </div>

              <div className="p-3.5 rounded-2xl bg-purple-50 border border-purple-100 text-center">
                <span className="text-[8px] font-black uppercase text-purple-600">Total Histórico</span>
                <h4 className="text-base font-black text-purple-900 font-mono mt-0.5">${actualSalesMetrics.salesTotalAllTimeUSD.toLocaleString('en-US')}</h4>
                <span className="text-[8px] font-bold text-purple-700 font-mono">{actualSalesMetrics.unitsTotalAllTime} Unids</span>
              </div>
            </div>

            {/* TABLA DE DESGLOSE POR SEMANAS DEL MES */}
            <div className="space-y-2">
              <h4 className="text-xs font-black uppercase text-slate-700 tracking-wider">Desglose por Semanas del Mes Corriente</h4>
              <div className="rounded-2xl border border-slate-100 overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900 text-white text-[8px] font-black uppercase tracking-widest">
                    <tr>
                      <th className="p-3 pl-4">Semana</th>
                      <th className="p-3 text-center">Unidades</th>
                      <th className="p-3 text-right">Monto ($ USD)</th>
                      <th className="p-3 pr-4 text-right">Monto (Bs. BCV)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-bold text-slate-800">
                    {actualSalesMetrics.weeklyBreakdown.map((w, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="p-3 pl-4 font-black uppercase text-slate-900">{w.name}</td>
                        <td className="p-3 text-center font-mono">{w.units} unids</td>
                        <td className="p-3 text-right font-mono font-black text-emerald-700">${w.salesUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                        <td className="p-3 pr-4 text-right font-mono font-black text-slate-600">Bs. {(w.salesUSD * summary.bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setIsProgressModalOpen(false); router.push('/dashboard/orders'); }} className="h-11 px-6 rounded-xl font-black text-xs uppercase">
              Ver Todos los Pedidos
            </Button>
            <Button onClick={() => setIsProgressModalOpen(false)} className="h-11 px-6 rounded-xl bg-slate-900 text-white font-black text-xs uppercase">
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
