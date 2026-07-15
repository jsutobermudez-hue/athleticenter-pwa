'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator
} from "@/components/ui/command";
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, limit, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import type { Product, Customer, Order } from '@/lib/definitions';
import { Package, User as UserIcon, ShoppingCart, Zap, Landmark, RefreshCw, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { logActivity } from '@/lib/audit';

/**
 * MOTOR DE BÚSQUEDA GLOBAL v161.0.0 - MODO RESILIENTE
 * Saneado: Se eliminan solicitudes automáticas a 'orders' y 'customers' para evitar bloqueos de permisos.
 * El buscador ahora se centra en Inventario y Comandos Directos.
 */
export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [isProcessingCommand, setIsProcessingCommand] = useState(false);
  const router = useRouter();
  const firestore = useFirestore();
  const { profile } = useUser();
  const { toast } = useToast();
  const [shouldLoad, setShouldLoad] = useState(false);

  const isAdmin = profile && ['superadmin', 'admin', 'gerencia'].includes(profile.role);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };

    const handleOpenSearch = () => {
        setOpen(true);
        setShouldLoad(true);
    };

    document.addEventListener("keydown", down);
    window.addEventListener("open-global-search", handleOpenSearch);
    
    return () => {
        document.removeEventListener("keydown", down);
        window.removeEventListener("open-global-search", handleOpenSearch);
    };
  }, []);

  useEffect(() => {
    if (open) setShouldLoad(true);
  }, [open]);

  // Saneamiento: Solo cargamos productos para evitar colapsos de permisos en pedidos/clientes
  const productsQuery = useMemoFirebase(() => (firestore && shouldLoad) ? query(collection(firestore, 'products'), limit(100)) : null, [firestore, shouldLoad]);
  const { data: allProducts } = useCollection<Product>(productsQuery);

  const navigate = (path: string) => {
    router.push(path);
    setOpen(false);
  };

  const handleTacticCommand = async (type: 'bcv') => {
    if (!firestore || !profile || !isAdmin) return;
    
    const parts = inputValue.toLowerCase().split(" ");
    const value = parseFloat(parts[parts.length - 1]);

    if (isNaN(value) || value <= 0) {
        toast({ variant: 'destructive', title: "Formato de Comando Inválido", description: "Ejemplo: 'tasa 54.5'" });
        return;
    }

    setIsProcessingCommand(true);
    try {
        if (type === 'bcv') {
            await setDoc(doc(firestore, 'system', 'financials'), { 
                bcvRate: value, 
                updatedAt: serverTimestamp(),
                updatedBy: profile.id
            }, { merge: true });
            
            await logActivity(firestore, {
                userId: profile.id,
                userName: profile.name,
                action: 'QUICK_COMMAND_BCV',
                resource: 'system',
                details: `Ajuste rápido de tasa BCV a ${value} Bs.`,
                severity: 'warning'
            });

            toast({ title: "Tesorería Sincronizada", description: `Nueva tasa: ${value} Bs.` });
        }
        setOpen(false);
        setInputValue("");
    } catch (e) {
        toast({ variant: 'destructive', title: "Fallo de Comando" });
    } finally {
        setIsProcessingCommand(false);
    }
  };

  const isBcvCommand = inputValue.toLowerCase().includes("tasa") || inputValue.toLowerCase().includes("bcv");

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput 
        placeholder="BUSCAR EQUIPO O COMANDO (EJ: 'TASA 55')..." 
        value={inputValue}
        onValueChange={setInputValue}
      />
      <CommandList className="max-h-[450px]">
        <CommandEmpty className="p-10 text-center italic font-bold uppercase text-[10px]">Sin resultados tácticos.</CommandEmpty>
        
        {isAdmin && isBcvCommand && (
            <CommandGroup heading="COMANDOS DE MANDO">
                <CommandItem onSelect={() => handleTacticCommand('bcv')} className="gap-3 py-4 cursor-pointer bg-primary/5 border border-primary/10 rounded-xl mx-2 my-1">
                    <div className="h-10 w-10 rounded-xl bg-primary text-white flex items-center justify-center shadow-lg">
                        {isProcessingCommand ? <Loader2 className="animate-spin h-5 w-5" /> : <Landmark className="h-5 w-5" />}
                    </div>
                    <div className="flex flex-col flex-1">
                        <span className="font-black text-[11px] uppercase text-primary">EJECUTAR: Ajustar Tasa BCV</span>
                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-1">Establecer valor global a {parseFloat(inputValue.split(" ").pop() || "0") || '...'} Bs.</span>
                    </div>
                </CommandItem>
            </CommandGroup>
        )}

        {shouldLoad && <CommandSeparator />}

        <CommandGroup heading="CATÁLOGO (EQUIPOS)">
          {allProducts?.map(p => (
            <CommandItem key={p.id} value={`${p.sku} ${p.name}`} onSelect={() => navigate(`/dashboard/inventory?sku=${p.sku}`)} className="gap-3 py-3 cursor-pointer">
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary"><Package className="h-4 w-4" /></div>
              <div className="flex flex-col"><span className="font-bold uppercase text-[11px] leading-none">{p.name}</span><span className="text-[9px] font-mono text-muted-foreground mt-1">SKU: {p.sku}</span></div>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}