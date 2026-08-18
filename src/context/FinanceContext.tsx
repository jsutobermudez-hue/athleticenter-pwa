'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useFirestore, useUser, useDoc, useCollection, useMemoFirebase } from '@/firebase';
import { collection, doc, setDoc, addDoc, updateDoc, deleteDoc, query, limit } from 'firebase/firestore';
import type { ExpenseItem } from '@/lib/breakEvenEngine';
import type { FinancialSettings } from '@/lib/definitions';

interface FinanceContextType {
  expenses: ExpenseItem[];
  targetProfitUSD: number;
  customSalesMix: Record<string, number>;
  isLoading: boolean;
  addExpense: (expense: Omit<ExpenseItem, 'id'>) => Promise<void>;
  updateExpense: (id: string, expense: Partial<ExpenseItem>) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;
  setTargetProfitUSD: (profit: number) => Promise<void>;
  updateProductSalesMix: (productId: string, mixPercent: number) => void;
  resetMixToDefault: () => void;
}

const FinanceContext = createContext<FinanceContextType | undefined>(undefined);

// GASTOS FIJOS OPERATIVOS POR DEFECTO (PRE-CARGADOS PARA INICIALIZAR EL SISTEMA)
const DEFAULT_INITIAL_EXPENSES: Omit<ExpenseItem, 'id'>[] = [
  { concept: 'Nómina Directiva y Administrativa', category: 'Nómina', amountUSD: 2500, isFixed: true, periodicity: 'mensual' },
  { concept: 'Alquiler Almacén Central y Galpón', category: 'Alquiler', amountUSD: 1200, isFixed: true, periodicity: 'mensual' },
  { concept: 'Servicios Básicos (Electricidad, Agua, Internet)', category: 'Servicios', amountUSD: 350, isFixed: true, periodicity: 'mensual' },
  { concept: 'Marketing y Redes Sociales B2B', category: 'Marketing', amountUSD: 400, isFixed: true, periodicity: 'mensual' },
  { concept: 'Depreciación y Mantenimiento Equipos', category: 'Depreciación', amountUSD: 250, isFixed: true, periodicity: 'mensual' },
  { concept: 'Licencias de Software y Seguridad ERP', category: 'Licencias/Software', amountUSD: 150, isFixed: true, periodicity: 'mensual' }
];

export function FinanceProvider({ children }: { children: React.ReactNode }) {
  const firestore = useFirestore();
  const { profile } = useUser();
  const canManage = profile && ['superadmin', 'admin', 'gerencia'].includes(profile.role);

  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
  const [targetProfitUSD, setTargetProfitUSDState] = useState<number>(3000);
  const [customSalesMix, setCustomSalesMix] = useState<Record<string, number>>({});

  const settingsRef = useMemoFirebase(() => (firestore && canManage ? doc(firestore, 'system', 'financials') : null), [firestore, canManage]);
  const { data: globalSettings } = useDoc<FinancialSettings>(settingsRef);

  const expensesQuery = useMemoFirebase(() => (firestore && canManage ? query(collection(firestore, 'expenses'), limit(100)) : null), [firestore, canManage]);
  const { data: firestoreExpenses, isLoading: isLoadingExpenses } = useCollection<ExpenseItem>(expensesQuery);

  // Inicializar gastos en Firestore si la colección está vacía
  useEffect(() => {
    if (firestoreExpenses && firestoreExpenses.length > 0) {
      setExpenses(firestoreExpenses);
    } else if (firestoreExpenses && firestoreExpenses.length === 0 && firestore && canManage) {
      // Cargar gastos por defecto iniciales
      DEFAULT_INITIAL_EXPENSES.forEach(async (exp) => {
        try {
          await addDoc(collection(firestore, 'expenses'), exp);
        } catch (e) {
          console.error("Error al sembrar gastos iniciales:", e);
        }
      });
    }
  }, [firestoreExpenses, firestore, canManage]);

  useEffect(() => {
    if (globalSettings && globalSettings.targetProfitUSD !== undefined) {
      setTargetProfitUSDState(globalSettings.targetProfitUSD);
    }
  }, [globalSettings]);

  const addExpense = useCallback(async (expense: Omit<ExpenseItem, 'id'>) => {
    if (!firestore) return;
    try {
      const ref = await addDoc(collection(firestore, 'expenses'), expense);
      setExpenses(prev => [...prev, { ...expense, id: ref.id }]);
    } catch (e) {
      console.error("Error al agregar gasto:", e);
    }
  }, [firestore]);

  const updateExpense = useCallback(async (id: string, updated: Partial<ExpenseItem>) => {
    if (!firestore) return;
    try {
      const docRef = doc(firestore, 'expenses', id);
      await updateDoc(docRef, updated);
      setExpenses(prev => prev.map(e => e.id === id ? { ...e, ...updated } : e));
    } catch (e) {
      console.error("Error al actualizar gasto:", e);
    }
  }, [firestore]);

  const deleteExpense = useCallback(async (id: string) => {
    if (!firestore) return;
    try {
      const docRef = doc(firestore, 'expenses', id);
      await deleteDoc(docRef);
      setExpenses(prev => prev.filter(e => e.id !== id));
    } catch (e) {
      console.error("Error al eliminar gasto:", e);
    }
  }, [firestore]);

  const setTargetProfitUSD = useCallback(async (profit: number) => {
    setTargetProfitUSDState(profit);
    if (!firestore) return;
    try {
      const docRef = doc(firestore, 'system', 'financials');
      await setDoc(docRef, { targetProfitUSD: profit }, { merge: true });
    } catch (e) {
      console.error("Error al guardar meta de ganancia:", e);
    }
  }, [firestore]);

  const updateProductSalesMix = useCallback((productId: string, mixPercent: number) => {
    setCustomSalesMix(prev => ({
      ...prev,
      [productId]: Math.max(0, mixPercent)
    }));
  }, []);

  const resetMixToDefault = useCallback(() => {
    setCustomSalesMix({});
  }, []);

  const value = useMemo(() => ({
    expenses,
    targetProfitUSD,
    customSalesMix,
    isLoading: isLoadingExpenses,
    addExpense,
    updateExpense,
    deleteExpense,
    setTargetProfitUSD,
    updateProductSalesMix,
    resetMixToDefault
  }), [
    expenses,
    targetProfitUSD,
    customSalesMix,
    isLoadingExpenses,
    addExpense,
    updateExpense,
    deleteExpense,
    setTargetProfitUSD,
    updateProductSalesMix,
    resetMixToDefault
  ]);

  return (
    <FinanceContext.Provider value={value}>
      {children}
    </FinanceContext.Provider>
  );
}

export function useFinance() {
  const context = useContext(FinanceContext);
  if (!context) {
    throw new Error('useFinance debe ser usado dentro de un FinanceProvider');
  }
  return context;
}
