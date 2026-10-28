'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useUser, useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import { useFinance } from '@/context/FinanceContext';
import type { FinancialSettings } from '@/lib/definitions';
import type { ExpenseItem } from '@/lib/breakEvenEngine';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  Receipt,
  Building2,
  Zap,
  Plus,
  Trash2,
  DollarSign,
  Calculator,
  Landmark,
  Search,
  Filter,
  ArrowUpRight,
  Lock,
  Loader2,
  Calendar,
  CheckCircle2,
  AlertCircle,
  TrendingDown,
  PieChart
} from 'lucide-react';

export const dynamic = 'force-dynamic';

export default function GastosPage() {
  const router = useRouter();
  const firestore = useFirestore();
  const { toast } = useToast();
  const { profile: currentUser, isUserLoading } = useUser();

  const canManage = !isUserLoading && currentUser && ['superadmin', 'admin', 'gerencia'].includes(currentUser.role);

  const {
    expenses,
    isLoading: isLoadingFinance,
    addExpense,
    deleteExpense
  } = useFinance();

  const settingsRef = useMemoFirebase(() => (firestore && canManage ? doc(firestore, 'system', 'financials') : null), [firestore, canManage]);
  const { data: globalSettings } = useDoc<FinancialSettings>(settingsRef);
  const bcvRate = globalSettings?.bcvRate || 36.5;

  // ESTADOS DEL FORMULARIO DE NUEVO GASTO
  const [newConcept, setNewConcept] = useState('');
  const [newCategory, setNewCategory] = useState<ExpenseItem['category']>('Gastos Operativos');
  const [newAmountUSD, setNewAmountUSD] = useState<string>('');
  const [newExpenseDate, setNewExpenseDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [newPaymentStatus, setNewPaymentStatus] = useState<'PAID' | 'PENDING'>('PAID');
  const [newIsFixed, setNewIsFixed] = useState(true);
  const [isSubmittingExpense, setIsSubmittingExpense] = useState(false);

  // FILTROS DE LISTA
  const [activeTab, setActiveTab] = useState<'all' | 'fixed' | 'variable' | 'pending'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('TODAS');

  // HANDLER AGREGAR GASTO
  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingExpense) return;
    const amount = parseFloat(newAmountUSD);
    if (!newConcept.trim() || isNaN(amount) || amount <= 0) {
      toast({ variant: 'destructive', title: 'Datos Inválidos', description: 'Por favor ingresa un concepto y monto válido mayor a 0.' });
      return;
    }

    setIsSubmittingExpense(true);
    try {
      const amountBS = amount * bcvRate;
      await addExpense({
        concept: newConcept.trim(),
        category: newCategory,
        amountUSD: amount,
        amountBS,
        bcvRate,
        isFixed: newIsFixed,
        periodicity: newIsFixed ? 'mensual' : 'unico',
        date: newExpenseDate || new Date().toISOString().split('T')[0],
        paymentStatus: newPaymentStatus
      });
      setNewConcept('');
      setNewAmountUSD('');
      toast({ title: 'Gasto Registrado con Éxito', description: `Se añadió "${newConcept}" por $${amount.toFixed(2)} USD.` });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error al Guardar', description: err?.message || 'No se pudo guardar el gasto.' });
    } finally {
      setIsSubmittingExpense(false);
    }
  };

  const handleDelete = async (id: string, concept: string) => {
    if (!confirm(`¿Estás seguro de eliminar el gasto "${concept}"?`)) return;
    try {
      await deleteExpense(id);
      toast({ title: 'Gasto Eliminado', description: `"${concept}" ha sido removido de la estructura.` });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error al Eliminar', description: err?.message || 'No se pudo eliminar el gasto.' });
    }
  };

  // CÁLCULOS Y TOTALES REACTIVOS
  const totals = useMemo(() => {
    let totalUSD = 0;
    let totalFixedUSD = 0;
    let totalVariableUSD = 0;
    let totalPaidUSD = 0;
    let totalPendingUSD = 0;

    expenses.forEach(e => {
      const amt = Number(e.amountUSD || 0);
      totalUSD += amt;
      if (e.isFixed) totalFixedUSD += amt;
      else totalVariableUSD += amt;

      if (e.paymentStatus === 'PAID') totalPaidUSD += amt;
      else totalPendingUSD += amt;
    });

    return {
      totalUSD,
      totalBS: totalUSD * bcvRate,
      totalFixedUSD,
      totalVariableUSD,
      totalPaidUSD,
      totalPendingUSD,
      fixedCount: expenses.filter(e => e.isFixed).length,
      variableCount: expenses.filter(e => !e.isFixed).length,
      pendingCount: expenses.filter(e => e.paymentStatus === 'PENDING').length
    };
  }, [expenses, bcvRate]);

  // CATEGORÍAS DISPONIBLES
  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    expenses.forEach(e => {
      if (e.category) set.add(e.category);
    });
    return ['TODAS', ...Array.from(set)];
  }, [expenses]);

  // FILTRADO DINÁMICO DE GASTOS
  const filteredExpenses = useMemo(() => {
    let list = [...expenses];

    if (activeTab === 'fixed') {
      list = list.filter(e => e.isFixed);
    } else if (activeTab === 'variable') {
      list = list.filter(e => !e.isFixed);
    } else if (activeTab === 'pending') {
      list = list.filter(e => e.paymentStatus === 'PENDING');
    }

    if (filterCategory !== 'TODAS') {
      list = list.filter(e => e.category === filterCategory);
    }

    const term = searchTerm.toLowerCase().trim();
    if (term) {
      list = list.filter(e =>
        e.concept.toLowerCase().includes(term) ||
        (e.category || '').toLowerCase().includes(term)
      );
    }

    // Ordenar: primero los más recientes si tienen fecha
    return list.sort((a, b) => {
      const dateA = a.date ? new Date(a.date).getTime() : 0;
      const dateB = b.date ? new Date(b.date).getTime() : 0;
      return dateB - dateA;
    });
  }, [expenses, activeTab, filterCategory, searchTerm]);

  if (isUserLoading || isLoadingFinance) {
    return (
      <div className="flex flex-col h-[70vh] items-center justify-center gap-4">
        <Loader2 className="animate-spin text-primary h-12 w-12" />
        <p className="text-xs font-black uppercase tracking-widest text-slate-500">Cargando Módulo de Gastos...</p>
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 p-8 text-center bg-slate-900 text-white rounded-[2.5rem] my-10 mx-4">
        <div className="p-6 rounded-full bg-rose-500/10 text-rose-500"><Lock className="h-16 w-16" /></div>
        <h1 className="text-2xl font-black uppercase tracking-tight">Acceso Exclusivo para Administración y Gerencia</h1>
        <p className="text-slate-400 text-xs max-w-md">El Módulo de Gastos Operativos está restringido para resguardar la estructura contable de la empresa.</p>
        <Button onClick={() => router.push('/dashboard')} className="h-12 px-8 rounded-xl bg-white text-slate-900 font-black uppercase text-[10px]">Volver al Panel</Button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[1600px] mx-auto flex flex-col gap-8 pb-32 px-4 sm:px-6 lg:px-8 animate-in fade-in-50 duration-500">
      {/* CABECERA CORPORATIVA */}
      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-100 pb-6 pt-2">
        <div>
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center border border-amber-500/20">
              <Receipt className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-black uppercase tracking-tight text-slate-900 leading-none">
                Control de Gastos Operativos
              </h1>
              <p className="text-muted-foreground text-[10px] sm:text-xs font-bold uppercase tracking-[0.2em] opacity-70 mt-1">
                Estructura de Costos Fijos, Gastos Variables y Salidas Operacionales
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <Badge variant="outline" className="border-slate-200 text-slate-700 bg-slate-50 font-mono text-[10px] px-3 py-1.5 rounded-xl font-bold">
            Tasa BCV: Bs. {bcvRate.toFixed(2)}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push('/dashboard/break-even')}
            className="h-10 px-4 rounded-xl border-slate-200 font-black text-[9px] uppercase tracking-wider text-slate-800 hover:bg-slate-50"
          >
            <Calculator className="h-4 w-4 mr-1.5 text-primary" /> Punto de Equilibrio
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push('/dashboard/treasury')}
            className="h-10 px-4 rounded-xl border-slate-200 font-black text-[9px] uppercase tracking-wider text-slate-800 hover:bg-slate-50"
          >
            <Landmark className="h-4 w-4 mr-1.5 text-emerald-600" /> Tesorería
          </Button>
        </div>
      </header>

      {/* 1. TARJETAS KPI DE GASTOS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* TARJETA 1: TOTAL GASTOS */}
        <Card className="border-none shadow-xl rounded-[2rem] bg-slate-900 text-white p-6 flex flex-col justify-between relative overflow-hidden group">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-amber-400">
                Total Gastos Mes
              </p>
              <h3 className="text-3xl font-black tracking-tight text-white mt-1">
                ${totals.totalUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </h3>
              <p className="text-[9px] font-bold text-slate-400 font-mono mt-0.5">
                Bs. {totals.totalBS.toLocaleString('es-VE', { maximumFractionDigits: 0 })} (BCV)
              </p>
            </div>
            <div className="p-3 rounded-2xl bg-amber-500/20 text-amber-400">
              <DollarSign className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between text-[8px] font-bold text-slate-400 uppercase">
            <span>{expenses.length} Rubros Registrados</span>
            <span className="text-amber-400 font-black">100% Estructura</span>
          </div>
        </Card>

        {/* TARJETA 2: GASTOS FIJOS */}
        <Card 
          onClick={() => setActiveTab('fixed')}
          className={cn(
            "border-none shadow-xl rounded-[2rem] bg-white p-6 flex flex-col justify-between relative overflow-hidden cursor-pointer transition-all border group",
            activeTab === 'fixed' ? "ring-2 ring-primary border-primary bg-blue-50/20" : "hover:scale-[1.01]"
          )}
        >
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-primary flex items-center gap-1">
                Gastos Fijos Mensuales <ArrowUpRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              </p>
              <h3 className="text-3xl font-black tracking-tight text-slate-900 mt-1">
                ${totals.totalFixedUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </h3>
              <p className="text-[9px] font-bold text-slate-500 font-mono mt-0.5">
                Nómina, Alquiler, Servicios
              </p>
            </div>
            <div className="p-3 rounded-2xl bg-blue-50 text-primary">
              <Building2 className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[8px] font-bold text-slate-500 uppercase">
            <span>{totals.fixedCount} Rubros Fijos</span>
            <span className="text-primary font-black">
              {totals.totalUSD > 0 ? `${Math.round((totals.totalFixedUSD / totals.totalUSD) * 100)}% del Total` : '0%'}
            </span>
          </div>
        </Card>

        {/* TARJETA 3: GASTOS VARIABLES */}
        <Card 
          onClick={() => setActiveTab('variable')}
          className={cn(
            "border-none shadow-xl rounded-[2rem] bg-white p-6 flex flex-col justify-between relative overflow-hidden cursor-pointer transition-all border group",
            activeTab === 'variable' ? "ring-2 ring-purple-600 border-purple-600 bg-purple-50/20" : "hover:scale-[1.01]"
          )}
        >
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-purple-600 flex items-center gap-1">
                Gastos Variables <ArrowUpRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              </p>
              <h3 className="text-3xl font-black tracking-tight text-slate-900 mt-1">
                ${totals.totalVariableUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </h3>
              <p className="text-[9px] font-bold text-slate-500 font-mono mt-0.5">
                Fletes, Eventuales, Operativos
              </p>
            </div>
            <div className="p-3 rounded-2xl bg-purple-50 text-purple-600">
              <Zap className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[8px] font-bold text-slate-500 uppercase">
            <span>{totals.variableCount} Rubros Variables</span>
            <span className="text-purple-600 font-black">
              {totals.totalUSD > 0 ? `${Math.round((totals.totalVariableUSD / totals.totalUSD) * 100)}% del Total` : '0%'}
            </span>
          </div>
        </Card>

        {/* TARJETA 4: ESTADO DE PAGO (PAGADO VS PENDIENTE) */}
        <Card 
          onClick={() => setActiveTab('pending')}
          className={cn(
            "border-none shadow-xl rounded-[2rem] bg-white p-6 flex flex-col justify-between relative overflow-hidden cursor-pointer transition-all border group",
            activeTab === 'pending' ? "ring-2 ring-amber-500 border-amber-500 bg-amber-50/20" : "hover:scale-[1.01]"
          )}
        >
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-amber-600 flex items-center gap-1">
                Pendientes por Pagar <ArrowUpRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              </p>
              <h3 className="text-3xl font-black tracking-tight text-slate-900 mt-1">
                ${totals.totalPendingUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </h3>
              <p className="text-[9px] font-bold text-emerald-600 font-mono mt-0.5">
                Pagado: ${totals.totalPaidUSD.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </p>
            </div>
            <div className="p-3 rounded-2xl bg-amber-50 text-amber-600">
              <AlertCircle className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[8px] font-bold text-slate-500 uppercase">
            <span>{totals.pendingCount} Facturas / Recibos</span>
            <span className="text-amber-600 font-black">Por Conciliar</span>
          </div>
        </Card>
      </div>

      {/* 2. REGISTRO Y GESTIÓN DE GASTOS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* FORMULARIO AGREGAR GASTO */}
        <Card className="border-none shadow-xl rounded-[2.5rem] bg-white overflow-hidden lg:col-span-1 sticky top-6">
          <CardHeader className="bg-slate-50/80 py-5 px-7 border-b">
            <CardTitle className="text-xs font-black uppercase tracking-[0.3em] text-slate-900 flex items-center gap-2">
              <Plus className="h-4 w-4 text-primary" /> Registrar Nuevo Gasto
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <form onSubmit={handleAddExpense} className="space-y-4">
              {/* SELECTOR CLARO: FIJO VS VARIABLE */}
              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase text-slate-500">Tipo de Gasto</Label>
                <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setNewIsFixed(true)}
                    className={cn(
                      "py-2.5 px-3 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5",
                      newIsFixed
                        ? "bg-slate-900 text-white shadow-md font-extrabold"
                        : "text-slate-500 hover:text-slate-900"
                    )}
                  >
                    <Building2 className="h-3.5 w-3.5" /> Gasto Fijo
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewIsFixed(false)}
                    className={cn(
                      "py-2.5 px-3 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5",
                      !newIsFixed
                        ? "bg-purple-600 text-white shadow-md font-extrabold"
                        : "text-slate-500 hover:text-slate-900"
                    )}
                  >
                    <Zap className="h-3.5 w-3.5" /> Gasto Variable
                  </button>
                </div>
              </div>

              {/* CONCEPTO */}
              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase text-slate-500">Concepto del Gasto</Label>
                <Input
                  value={newConcept}
                  onChange={(e) => setNewConcept(e.target.value)}
                  placeholder={newIsFixed ? "Ej. Nómina Operativa / Alquiler" : "Ej. Flete Especial / Mantenimiento"}
                  className="h-11 font-bold text-xs rounded-xl"
                  required
                />
              </div>

              {/* CATEGORÍA Y MONTO */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[9px] font-black uppercase text-slate-500">Categoría</Label>
                  <Select value={newCategory} onValueChange={(v: any) => setNewCategory(v)}>
                    <SelectTrigger className="h-11 text-xs font-bold rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Gastos Operativos">Gastos Operativos</SelectItem>
                      <SelectItem value="Nómina">Nómina</SelectItem>
                      <SelectItem value="Alquiler">Alquiler</SelectItem>
                      <SelectItem value="Servicios">Servicios</SelectItem>
                      <SelectItem value="Marketing">Marketing</SelectItem>
                      <SelectItem value="Logística/Fletes">Logística / Fletes</SelectItem>
                      <SelectItem value="Comisiones">Comisiones</SelectItem>
                      <SelectItem value="Insumos">Insumos</SelectItem>
                      <SelectItem value="Depreciación">Depreciación</SelectItem>
                      <SelectItem value="Impuestos">Impuestos</SelectItem>
                      <SelectItem value="Flete Local">Flete Local</SelectItem>
                      <SelectItem value="Licencias/Software">Licencias / ERP</SelectItem>
                      <SelectItem value="Otros">Otros</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[9px] font-black uppercase text-slate-500">Monto ($ USD)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={newAmountUSD}
                    onChange={(e) => setNewAmountUSD(e.target.value)}
                    placeholder="0.00"
                    className="h-11 font-black text-xs rounded-xl"
                    required
                  />
                  {parseFloat(newAmountUSD) > 0 && (
                    <p className="text-[9px] font-mono text-slate-400 text-right">
                      ≈ Bs. {(parseFloat(newAmountUSD) * bcvRate).toLocaleString('es-VE', { maximumFractionDigits: 2 })}
                    </p>
                  )}
                </div>
              </div>

              {/* FECHA Y ESTADO */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[9px] font-black uppercase text-slate-500">Fecha del Gasto</Label>
                  <Input
                    type="date"
                    value={newExpenseDate}
                    onChange={(e) => setNewExpenseDate(e.target.value)}
                    className="h-11 font-bold text-xs rounded-xl"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[9px] font-black uppercase text-slate-500">Estado de Pago</Label>
                  <Select value={newPaymentStatus} onValueChange={(v: any) => setNewPaymentStatus(v)}>
                    <SelectTrigger className="h-11 text-xs font-bold rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PAID">Pagado</SelectItem>
                      <SelectItem value="PENDING">Pendiente por Pagar</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button 
                type="submit" 
                disabled={isSubmittingExpense} 
                className={cn(
                  "w-full h-12 rounded-xl text-white font-black text-xs uppercase shadow-lg flex items-center justify-center gap-2 transition-all mt-2",
                  newIsFixed ? "bg-primary hover:bg-primary/90" : "bg-purple-600 hover:bg-purple-700"
                )}
              >
                {isSubmittingExpense ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Guardando...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" /> {newIsFixed ? 'Agregar Gasto Fijo' : 'Agregar Gasto Variable'}
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* ESTRUCTURA Y TABLA DE GASTOS */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          {/* BARRA DE FILTROS Y PESTAÑAS */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-2 bg-slate-100 rounded-[1.8rem] border border-slate-200/60">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
              <button
                type="button"
                onClick={() => setActiveTab('all')}
                className={cn(
                  "px-3.5 py-2 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all whitespace-nowrap",
                  activeTab === 'all'
                    ? "bg-slate-900 text-white shadow-md font-extrabold"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50"
                )}
              >
                Todos ({expenses.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('fixed')}
                className={cn(
                  "px-3.5 py-2 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all whitespace-nowrap flex items-center gap-1",
                  activeTab === 'fixed'
                    ? "bg-slate-900 text-white shadow-md font-extrabold"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50"
                )}
              >
                <Building2 className="h-3 w-3 text-primary" /> Fijos ({totals.fixedCount})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('variable')}
                className={cn(
                  "px-3.5 py-2 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all whitespace-nowrap flex items-center gap-1",
                  activeTab === 'variable'
                    ? "bg-purple-600 text-white shadow-md font-extrabold"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50"
                )}
              >
                <Zap className="h-3 w-3 text-amber-300" /> Variables ({totals.variableCount})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('pending')}
                className={cn(
                  "px-3.5 py-2 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all whitespace-nowrap flex items-center gap-1",
                  activeTab === 'pending'
                    ? "bg-amber-600 text-white shadow-md font-extrabold"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50"
                )}
              >
                <AlertCircle className="h-3 w-3 text-white" /> Pendientes ({totals.pendingCount})
              </button>
            </div>

            <div className="flex items-center gap-2 px-1">
              <div className="relative flex-1 sm:w-48">
                <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar gasto..."
                  className="h-8 pl-8 pr-3 text-[10px] font-bold rounded-xl border-slate-300 bg-white"
                />
              </div>

              {availableCategories.length > 2 && (
                <Select value={filterCategory} onValueChange={setFilterCategory}>
                  <SelectTrigger className="h-8 text-[9px] font-bold rounded-xl w-32 bg-white border-slate-300">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableCategories.map(cat => (
                      <SelectItem key={cat} value={cat} className="text-xs">{cat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          {/* TABLA DE GASTOS */}
          <Card className="border-none shadow-xl rounded-[2.5rem] bg-white overflow-hidden">
            <CardHeader className="bg-slate-900 text-white py-4 px-6 sm:px-8 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-black uppercase tracking-[0.25em] flex items-center gap-2 text-white">
                <Receipt className="h-4 w-4 text-amber-400" /> 
                {activeTab === 'fixed' ? 'Estructura de Gastos Fijos' : activeTab === 'variable' ? 'Estructura de Gastos Variables' : activeTab === 'pending' ? 'Gastos Pendientes por Pagar' : 'Todos los Gastos Registrados'}
                <span className="text-slate-400 font-mono">({filteredExpenses.length})</span>
              </CardTitle>

              <Badge className="bg-white/10 text-white border-none text-[9px] font-mono font-black">
                Total Vista: ${filteredExpenses.reduce((sum, e) => sum + (e.amountUSD || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2 })} USD
              </Badge>
            </CardHeader>

            <CardContent className="p-0 overflow-x-auto max-h-[550px] overflow-y-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-800 text-white text-[9px] font-black uppercase tracking-widest sticky top-0 z-10">
                    <th className="p-3 pl-6 sm:pl-8">Concepto</th>
                    <th className="p-3">Tipo</th>
                    <th className="p-3">Categoría</th>
                    <th className="p-3">Fecha</th>
                    <th className="p-3 text-center">Estado</th>
                    <th className="p-3 text-right">Monto USD</th>
                    <th className="p-3 pr-6 sm:pr-8 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs font-bold text-slate-800">
                  {filteredExpenses.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-400 text-xs italic">
                        No se encontraron gastos con los filtros aplicados.
                      </td>
                    </tr>
                  ) : (
                    filteredExpenses.map((e, idx) => (
                      <tr key={e.id || idx} className="hover:bg-slate-50 transition-colors">
                        <td className="p-3 pl-6 sm:pl-8 font-black uppercase text-slate-900">
                          {e.concept}
                        </td>
                        <td className="p-3">
                          <Badge 
                            variant="secondary" 
                            className={cn(
                              "text-[8px] font-black uppercase border-none",
                              e.isFixed ? "bg-blue-50 text-blue-700" : "bg-purple-50 text-purple-700"
                            )}
                          >
                            {e.isFixed ? 'Fijo' : 'Variable'}
                          </Badge>
                        </td>
                        <td className="p-3">
                          <span className="text-[10px] font-bold text-slate-600 uppercase">
                            {e.category || 'Otros'}
                          </span>
                        </td>
                        <td className="p-3 text-slate-500 font-mono text-[10px]">
                          {e.date || '—'}
                        </td>
                        <td className="p-3 text-center">
                          <Badge 
                            className={cn(
                              "text-[8px] font-black uppercase border-none px-2 py-0.5",
                              e.paymentStatus === 'PAID' ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                            )}
                          >
                            {e.paymentStatus === 'PAID' ? 'PAGADO' : 'PENDIENTE'}
                          </Badge>
                        </td>
                        <td className="p-3 text-right font-mono font-black text-slate-900">
                          ${(e.amountUSD || 0).toFixed(2)}
                        </td>
                        <td className="p-3 pr-6 sm:pr-8 text-right">
                          {e.id && (
                            <Button 
                              size="sm" 
                              variant="ghost" 
                              onClick={() => handleDelete(e.id!, e.concept)} 
                              className="h-7 w-7 p-0 text-rose-500 hover:bg-rose-50 hover:text-rose-700 rounded-lg"
                              title="Eliminar gasto"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* VINCULACIÓN CON PUNTO DE EQUILIBRIO */}
          <div className="p-6 rounded-[2rem] bg-gradient-to-r from-slate-900 to-slate-800 text-white flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl border border-white/10">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/20 text-primary flex items-center justify-center shrink-0">
                <Calculator className="h-5 w-5" />
              </div>
              <div>
                <h4 className="text-xs font-black uppercase tracking-tight text-white">
                  Impacto en Punto de Equilibrio
                </h4>
                <p className="text-[10px] text-slate-400 font-medium">
                  Tus gastos fijos de <span className="font-bold text-white">${totals.totalFixedUSD.toLocaleString()} USD</span> determinan la meta mensual de ventas y unidades mínimas en el simulador multiproducto.
                </p>
              </div>
            </div>

            <Button
              onClick={() => router.push('/dashboard/break-even')}
              className="h-10 px-5 rounded-xl bg-primary text-white font-black uppercase text-[9px] tracking-wider shrink-0 shadow-md hover:bg-primary/90"
            >
              Simular Punto de Equilibrio ➔
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
