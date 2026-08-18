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

  // CÁLCULO DE VENTAS REALES REGISTRADAS ESTE MES
  const actualMonthMetrics = useMemo(() => {
    if (!monthOrders) return { salesUSD: 0, units: 0 };
    let salesUSD = 0;
    let units = 0;
    monthOrders.forEach(o => {
      if (o.status !== 'Cancelado' && o.status !== 'Rechazado') {
        salesUSD += o.totalAmount || 0;
        const orderItems = (o as any).items;
        if (orderItems && Array.isArray(orderItems)) {
          orderItems.forEach((i: any) => { units += i.quantity || 0; });
        }
      }
    });
    return { salesUSD, units };
  }, [monthOrders]);

  // EJECUCIÓN DEL MOTOR FINANCIERO REACTIVO
  const calculation = useMemo(() => {
    return calculateMultiProductBreakEven(
      catalogProducts || [],
      expenses,
      targetProfitUSD,
      globalSettings,
      customSalesMix,
      actualMonthMetrics.salesUSD,
      actualMonthMetrics.units
    );
  }, [catalogProducts, expenses, targetProfitUSD, globalSettings, customSalesMix, actualMonthMetrics]);

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

      {/* 1. TARJETAS KPI EJECUTIVAS EN TIEMPO REAL */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <Card className="border-none shadow-xl rounded-[2rem] bg-slate-900 text-white p-6 flex flex-col justify-between relative overflow-hidden">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-primary">Costos Fijos Mensuales</p>
              <h3 className="text-3xl font-black tracking-tight text-white mt-1">${summary.totalFixedExpensesUSD.toLocaleString('en-US')}</h3>
              <p className="text-[9px] font-bold text-slate-400 font-mono">Bs. {(summary.totalFixedExpensesUSD * summary.bcvRate).toLocaleString('es-VE')} (BCV)</p>
            </div>
            <div className="p-3 rounded-2xl bg-primary/20 text-primary"><Building2 className="h-6 w-6" /></div>
          </div>
          <Badge variant="outline" className="mt-4 border-slate-800 text-[8px] font-mono text-slate-400 uppercase w-fit">
            {expenses.filter(e => e.isFixed).length} Rubros Fijos Registrados
          </Badge>
        </Card>

        <Card className="border-none shadow-xl rounded-[2rem] bg-gradient-to-br from-primary to-blue-700 text-white p-6 flex flex-col justify-between relative overflow-hidden">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-white/80">Meta de Ganancia Deseada</p>
              <h3 className="text-3xl font-black tracking-tight text-white mt-1">${summary.targetProfitUSD.toLocaleString('en-US')}</h3>
              <p className="text-[9px] font-bold text-white/70 font-mono">Utilidad Neta Meta</p>
            </div>
            <div className="p-3 rounded-2xl bg-white/20 text-white"><TrendingUp className="h-6 w-6" /></div>
          </div>
          <div className="flex items-center gap-2 mt-4">
            <Input
              type="number"
              value={targetProfitUSD}
              onChange={(e) => setTargetProfitUSD(Number(e.target.value))}
              className="h-8 font-black text-center text-xs bg-white/20 border-none text-white rounded-xl placeholder:text-white/50 w-32"
            />
            <span className="text-[8px] font-black uppercase text-white/90">Ajustar Meta USD</span>
          </div>
        </Card>

        <Card className="border-none shadow-xl rounded-[2rem] bg-emerald-600 text-white p-6 flex flex-col justify-between relative overflow-hidden">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-emerald-200">Facturación Requerida Total</p>
              <h3 className="text-3xl font-black tracking-tight text-white mt-1">${summary.totalRequiredRevenueUSD.toLocaleString('en-US')}</h3>
              <p className="text-[9px] font-bold text-emerald-100 font-mono">Bs. {summary.totalRequiredRevenueVES.toLocaleString('es-VE')} (BCV)</p>
            </div>
            <div className="p-3 rounded-2xl bg-white/20 text-white"><DollarSign className="h-6 w-6" /></div>
          </div>
          <Badge className="mt-4 bg-white/20 text-white font-mono text-[9px] font-black border-none w-fit">
            {summary.totalRequiredUnits} Unidades a Vender
          </Badge>
        </Card>

        <Card className="border-none shadow-xl rounded-[2rem] bg-white p-6 flex flex-col justify-between relative overflow-hidden border border-slate-100">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Progreso Real del Mes</p>
              <h3 className="text-3xl font-black tracking-tight text-slate-900 mt-1">{summary.breakEvenProgressPercent}%</h3>
              <p className="text-[9px] font-bold text-slate-500 uppercase">${actualMonthMetrics.salesUSD.toLocaleString('en-US')} Vendidos</p>
            </div>
            <div className="p-3 rounded-2xl bg-slate-100 text-slate-700"><BarChart3 className="h-6 w-6" /></div>
          </div>
          <div className="space-y-1.5 mt-4">
            <Progress value={summary.breakEvenProgressPercent} className="h-2 bg-slate-100" />
            <div className="flex justify-between text-[8px] font-black uppercase text-slate-400">
              <span>{actualMonthMetrics.units} Unidades Reales</span>
              <span>Meta: {summary.totalRequiredUnits} Unids</span>
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
                    <div className="flex items-center justify-center gap-1">
                      <Input
                        type="number"
                        value={item.salesMixPercent}
                        onChange={(e) => updateProductSalesMix(item.product.id!, Number(e.target.value))}
                        className="h-8 w-16 text-center font-black font-mono text-xs bg-slate-50 border-slate-200 rounded-xl"
                      />
                      <span className="text-[10px] font-black text-slate-400">%</span>
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
    </div>
  );
}
