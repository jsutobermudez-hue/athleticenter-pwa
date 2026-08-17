'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useCollection, useFirestore, useMemoFirebase, useUser, useDoc } from '@/firebase';
import { collection, query, limit, doc, addDoc, serverTimestamp } from 'firebase/firestore';
import type { Product, FinancialSettings } from '@/lib/definitions';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { 
    UploadCloud, 
    FileText, 
    Loader2, 
    CheckCircle2, 
    AlertTriangle, 
    TrendingDown, 
    TrendingUp, 
    Sparkles, 
    Search, 
    Filter, 
    Zap, 
    ShieldCheck, 
    Globe, 
    ArrowUpRight, 
    Building2, 
    Briefcase, 
    Plus, 
    RefreshCw, 
    Printer, 
    Lock,
    X,
    ExternalLink
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { matchCompetitorCatalog, type MatchedResultItem, type CompetitorExtractedItem } from '@/lib/matchingEngine';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

export const dynamic = 'force-dynamic';

export default function PricingIntelligencePage() {
  const router = useRouter();
  const firestore = useFirestore();
  const { toast } = useToast();
  const { profile: currentUser, isUserLoading } = useUser();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [analysisStep, setAnalysisStep] = useState<string>('');
  const [analysisProgress, setAnalysisProgress] = useState(0);

  const [extractedFileName, setExtractedFileName] = useState('');
  const [analysisResults, setAnalysisResults] = useState<MatchedResultItem[]>([]);

  // FILTROS
  const [searchTerm, setSearchTerm] = useState('');
  const [disciplineFilter, setDisciplineFilter] = useState('todas');
  const [statusFilter, setStatusFilter] = useState('todos');

  // MODAL COTIZACIÓN MATCH-PRICE
  const [selectedMatchItem, setSelectedMatchItem] = useState<MatchedResultItem | null>(null);
  const [isQuoteModalOpen, setIsQuoteModalOpen] = useState(false);
  const [clientName, setClientName] = useState('');
  const [matchDiscountPercent, setMatchDiscountPercent] = useState(3);

  // RESTRICCIÓN DE ACCESO A GERENCIA Y ADMINISTRACIÓN
  const canManage = !isUserLoading && currentUser && ['superadmin', 'admin', 'gerencia'].includes(currentUser.role);

  const settingsRef = useMemoFirebase(() => (firestore && canManage ? doc(firestore, 'system', 'financials') : null), [firestore, canManage]);
  const { data: globalSettings } = useDoc<FinancialSettings>(settingsRef);

  const productsQuery = useMemoFirebase(() => (firestore && canManage ? query(collection(firestore, 'products'), limit(300)) : null), [firestore, canManage]);
  const { data: catalogProducts, isLoading: isLoadingProducts } = useCollection<Product>(productsQuery);

  // VALIDACIÓN MULTI-FORMATO (PDF, EXCEL, CSV, IMÁGENES, TEXTO)
  const isSupportedFile = (file: File) => {
    const name = file.name.toLowerCase();
    const allowedExts = ['.pdf', '.xlsx', '.xls', '.csv', '.docx', '.txt', '.tsv', '.png', '.jpg', '.jpeg', '.webp'];
    return allowedExts.some(ext => name.endsWith(ext)) || file.type.startsWith('image/') || file.type.includes('spreadsheet') || file.type.includes('csv') || file.type === 'application/pdf';
  };

  // EVENTOS DRAG AND DROP
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (isSupportedFile(file)) {
        setSelectedFile(file);
      } else {
        toast({ variant: 'destructive', title: 'Formato No Soportado', description: 'Por favor sube un archivo PDF, Excel (.xlsx, .xls, .csv), Imagen (.png, .jpg) o Texto.' });
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (isSupportedFile(file)) {
        setSelectedFile(file);
      } else {
        toast({ variant: 'destructive', title: 'Formato No Soportado', description: 'Por favor sube un archivo PDF, Excel (.xlsx, .xls, .csv), Imagen (.png, .jpg) o Texto.' });
      }
    }
  };

  // PROCESAR ARCHIVO CON GEMINI Y EMPAREJAR
  const handleProcessPDF = async () => {
    if (!selectedFile) return;
    setIsProcessing(true);
    setAnalysisStep('Subiendo archivo y conectando con Gemini AI...');
    setAnalysisProgress(20);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      setAnalysisStep('Gemini 2.5 Flash analizando tabla y lista de precios...');
      setAnalysisProgress(50);

      const response = await fetch('/api/process-competitor-pdf', {
        method: 'POST',
        body: formData
      });

      const resData = await response.json();

      if (!response.ok || !resData.success) {
        throw new Error(resData.error || 'No se pudo procesar la lista de precios.');
      }

      setAnalysisStep('Ejecutando Motor Fuzzy Matcher con Inventario...');
      setAnalysisProgress(85);

      const extractedItems: CompetitorExtractedItem[] = resData.items || [];
      const matched = matchCompetitorCatalog(extractedItems, catalogProducts || [], globalSettings);

      setExtractedFileName(resData.fileName || selectedFile.name);
      setAnalysisResults(matched);

      setAnalysisProgress(100);
      toast({
        title: '¡Análisis Completado!',
        description: `Se extrajeron ${matched.length} productos y se compararon con tu inventario.`
      });
    } catch (e: any) {
      toast({
        variant: 'destructive',
        title: 'Error en Análisis de Archivo',
        description: e.message || 'Fallo de conexión al procesar la lista.'
      });
    } finally {
      setIsProcessing(false);
      setAnalysisProgress(0);
      setAnalysisStep('');
    }
  };

  // FILTRADO DE RESULTADOS EN TABLA
  const filteredResults = useMemo(() => {
    let list = [...analysisResults];

    if (disciplineFilter !== 'todas') {
      list = list.filter(r => (r.competitorDiscipline || '').toLowerCase() === disciplineFilter.toLowerCase());
    }

    if (statusFilter !== 'todos') {
      list = list.filter(r => r.status === statusFilter);
    }

    const term = searchTerm.toLowerCase().trim();
    if (term) {
      list = list.filter(r => 
        r.competitorItemName.toLowerCase().includes(term) ||
        (r.matchedProduct?.name || '').toLowerCase().includes(term) ||
        (r.matchedProduct?.sku || '').toLowerCase().includes(term) ||
        (r.competitorBrand || '').toLowerCase().includes(term)
      );
    }

    return list;
  }, [analysisResults, disciplineFilter, statusFilter, searchTerm]);

  // MÉTRICAS KPI
  const kpiMetrics = useMemo(() => {
    const total = analysisResults.length;
    let competitive = 0;
    let inRisk = 0;
    let noMatch = 0;

    analysisResults.forEach(r => {
      if (r.status === 'competitivo') competitive++;
      else if (r.status === 'en_riesgo') inRisk++;
      else noMatch++;
    });

    return { total, competitive, inRisk, noMatch };
  }, [analysisResults]);

  // DISCIPLINAS ÚNICAS
  const uniqueDisciplines = useMemo(() => {
    const setDis = new Set<string>();
    analysisResults.forEach(r => {
      if (r.competitorDiscipline) setDis.add(r.competitorDiscipline);
    });
    return Array.from(setDis).sort();
  }, [analysisResults]);

  // GENERAR COTIZACIÓN MATCH-PRICE B2B EN FIRESTORE
  const handleCreateMatchQuote = async () => {
    if (!selectedMatchItem || !selectedMatchItem.matchedProduct || !firestore || !currentUser) return;
    try {
      const discountedPrice = Number((selectedMatchItem.competitorPrice * (1 - matchDiscountPercent / 100)).toFixed(2));

      await addDoc(collection(firestore, 'quotes'), {
        customerName: clientName || 'CLIENTE MAYORISTA B2B',
        customerPhone: '',
        status: 'Borrador',
        items: [
          {
            productId: selectedMatchItem.matchedProduct.id,
            productName: selectedMatchItem.matchedProduct.name,
            quantity: 1,
            unitPrice: discountedPrice,
            product: selectedMatchItem.matchedProduct
          }
        ],
        totalAmount: discountedPrice,
        salespersonId: currentUser.id,
        salespersonName: currentUser.name,
        notes: `Cotización Match-Price B2B (-${matchDiscountPercent}% respecto a la competencia $${selectedMatchItem.competitorPrice})`,
        createdAt: serverTimestamp()
      });

      toast({ title: 'Cotización B2B Creada', description: `Se aplicó precio especial de $${discountedPrice} USD.` });
      setIsQuoteModalOpen(false);
      setSelectedMatchItem(null);
      setClientName('');
      router.push('/dashboard/quotes');
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error al Cotizar', description: e.message });
    }
  };

  if (isUserLoading || isLoadingProducts) {
    return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-primary h-10 w-10" /></div>;
  }

  if (!canManage) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 p-8 text-center bg-slate-900 text-white rounded-[2.5rem] my-10 mx-4">
        <div className="p-6 rounded-full bg-rose-500/10 text-rose-500"><Lock className="h-16 w-16" /></div>
        <h1 className="text-2xl font-black uppercase tracking-tight">Acceso Exclusivo para Administración y Gerencia</h1>
        <p className="text-slate-400 text-xs max-w-md">La Inteligencia de Precios está restringida para proteger los márgenes y estrategias B2B corporativas.</p>
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
            <Sparkles className="h-8 w-8 text-primary" /> Pricing Intelligence PRO
          </h1>
          <p className="text-muted-foreground text-[10px] sm:text-xs font-black italic uppercase tracking-[0.3em] opacity-60 mt-1">
            Auditoría Multideporte de Listas en PDF vs Inventario Athleticenter.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => router.push('/dashboard/treasury')} className="h-10 px-4 rounded-xl border-slate-200 font-black text-[9px] uppercase tracking-wider">
            <Building2 className="h-4 w-4 mr-1.5 text-primary" /> TESORERÍA
          </Button>
          <Button variant="outline" size="sm" onClick={() => router.push('/dashboard/inventory/pricing-calculator')} className="h-10 px-4 rounded-xl border-slate-200 font-black text-[9px] uppercase tracking-wider">
            <Zap className="h-4 w-4 mr-1.5 text-primary" /> CALCULADORA SMART
          </Button>
        </div>
      </header>

      {/* 1. ZONA DE CARGA DRAG & DROP Y ESTADOS */}
      <Card className="border-none shadow-xl rounded-[2.5rem] bg-white overflow-hidden">
        <CardHeader className="bg-slate-50/50 py-5 px-8 border-b flex flex-row items-center justify-between">
          <CardTitle className="text-xs font-black uppercase tracking-[0.3em] text-primary flex items-center gap-2">
            <UploadCloud className="h-5 w-5" /> 1. Carga de Lista de Precios (PDF, Excel, Capturas, Texto)
          </CardTitle>
          {selectedFile && (
            <Button variant="ghost" size="sm" onClick={() => setSelectedFile(null)} className="h-8 text-rose-500 font-black text-[9px] uppercase">
              <X className="h-3.5 w-3.5 mr-1" /> Quitar Archivo
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-8 space-y-6">
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              "border-2 border-dashed rounded-[2rem] p-10 flex flex-col items-center justify-center text-center transition-all duration-300 cursor-pointer relative overflow-hidden",
              isDragOver ? "border-primary bg-primary/5 scale-[1.01]" : "border-slate-200 bg-slate-50/50 hover:bg-slate-50 hover:border-slate-300"
            )}
          >
            <input
              type="file"
              accept=".pdf,.xlsx,.xls,.csv,.docx,.txt,.tsv,image/*"
              onChange={handleFileChange}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
            <div className="p-5 rounded-full bg-primary/10 text-primary mb-4 shadow-sm">
              <FileText className="h-10 w-10" />
            </div>
            {selectedFile ? (
              <div className="space-y-2">
                <Badge className="bg-primary text-white font-mono text-[10px] px-3 py-1 uppercase">{selectedFile.name}</Badge>
                <p className="text-[10px] text-slate-400 font-mono">{(selectedFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                <p className="text-xs font-bold text-emerald-600 uppercase">¡Archivo listo para análisis con IA Gemini!</p>
              </div>
            ) : (
              <div className="space-y-2 max-w-md">
                <h3 className="text-sm font-black uppercase text-slate-900 tracking-wider">Arrastra aquí la lista de precios de la competencia</h3>
                <p className="text-[10px] font-medium text-slate-400 uppercase leading-relaxed">
                  Soporta archivos <strong>PDF</strong>, Hojas de Excel (<strong>.xlsx, .xls, .csv</strong>), Fotos/Capturas (<strong>.png, .jpg</strong>) y Documentos de texto.
                </p>
                <Badge variant="outline" className="border-slate-200 text-[8px] font-bold text-slate-500 uppercase mt-2">SELECCIONAR EXCEL, PDF O IMAGEN</Badge>
              </div>
            )}
          </div>

          {isProcessing && (
            <div className="space-y-3 p-6 bg-slate-900 text-white rounded-2xl animate-in fade-in duration-300">
              <div className="flex justify-between items-center text-xs font-black uppercase">
                <span className="flex items-center gap-2 text-primary"><Loader2 className="animate-spin h-4 w-4" /> {analysisStep}</span>
                <span className="text-primary font-mono">{analysisProgress}%</span>
              </div>
              <Progress value={analysisProgress} className="h-2 bg-slate-800" />
            </div>
          )}

          <div className="flex justify-end">
            <Button
              onClick={handleProcessPDF}
              disabled={!selectedFile || isProcessing}
              className="h-14 px-10 rounded-2xl bg-primary hover:bg-primary/90 text-white font-black uppercase tracking-[0.2em] text-xs shadow-2xl transition-all active:scale-95"
            >
              {isProcessing ? <Loader2 className="animate-spin h-5 w-5 mr-3" /> : <Sparkles className="h-5 w-5 mr-3" />}
              PROCESAR Y COMPARE CON IA GEMINI
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 2. TABLERO DE RESULTADOS Y MÉTRICAS */}
      {analysisResults.length > 0 && (
        <div className="space-y-8 animate-in fade-in-50 duration-500">
          {/* MÉTRICAS KPI */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="border-none shadow-sm rounded-2xl bg-white p-5 flex items-center justify-between">
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Total Extraídos</p>
                <h3 className="text-3xl font-black text-slate-900 tracking-tight">{kpiMetrics.total}</h3>
                <p className="text-[9px] font-bold text-slate-500 uppercase">Productos en PDF</p>
              </div>
              <div className="p-3 rounded-2xl bg-slate-100 text-slate-700"><FileText className="h-6 w-6" /></div>
            </Card>

            <Card className="border-none shadow-sm rounded-2xl bg-white p-5 flex items-center justify-between">
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Competitivos</p>
                <h3 className="text-3xl font-black text-emerald-600 tracking-tight">{kpiMetrics.competitive}</h3>
                <p className="text-[9px] font-bold text-emerald-600 uppercase">Mejor / Igual Precio</p>
              </div>
              <div className="p-3 rounded-2xl bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-6 w-6" /></div>
            </Card>

            <Card className="border-none shadow-sm rounded-2xl bg-white p-5 flex items-center justify-between">
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">En Riesgo</p>
                <h3 className="text-3xl font-black text-rose-600 tracking-tight">{kpiMetrics.inRisk}</h3>
                <p className="text-[9px] font-bold text-rose-600 uppercase">Más Caro que Competencia</p>
              </div>
              <div className="p-3 rounded-2xl bg-rose-50 text-rose-600"><AlertTriangle className="h-6 w-6" /></div>
            </Card>

            <Card className="border-none shadow-sm rounded-2xl bg-white p-5 flex items-center justify-between">
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Brechas Catálogo</p>
                <h3 className="text-3xl font-black text-amber-500 tracking-tight">{kpiMetrics.noMatch}</h3>
                <p className="text-[9px] font-bold text-amber-600 uppercase">Oportunidad Importación</p>
              </div>
              <div className="p-3 rounded-2xl bg-amber-50 text-amber-500"><Globe className="h-6 w-6" /></div>
            </Card>
          </div>

          {/* FILTROS TÁCTICOS */}
          <Card className="border-none shadow-sm rounded-2xl bg-white p-5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
              <div className="space-y-1">
                <Label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Búsqueda Rápida</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <Input
                    placeholder="PRODUCTO / SKU / MARCA..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9 h-10 text-[10px] font-bold uppercase bg-slate-50 border-none rounded-xl"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Disciplina Deportiva</Label>
                <Select value={disciplineFilter} onValueChange={setDisciplineFilter}>
                  <SelectTrigger className="h-10 text-[10px] font-bold uppercase bg-slate-50 border-none rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas" className="text-[10px] font-bold uppercase">TODAS LAS DISCIPLINAS</SelectItem>
                    {uniqueDisciplines.map(d => (
                      <SelectItem key={d} value={d} className="text-[10px] font-bold uppercase">{d.toUpperCase()}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Estado de Competitividad</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-10 text-[10px] font-bold uppercase bg-slate-50 border-none rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos" className="text-[10px] font-bold uppercase">TODOS LOS ESTADOS</SelectItem>
                    <SelectItem value="competitivo" className="text-[10px] font-bold uppercase text-emerald-600">🟢 COMPETITIVOS</SelectItem>
                    <SelectItem value="en_riesgo" className="text-[10px] font-bold uppercase text-rose-600">🔴 EN RIESGO</SelectItem>
                    <SelectItem value="sin_coincidencia" className="text-[10px] font-bold uppercase text-amber-600">🟡 SIN COINCIDENCIA</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </Card>

          {/* TABLA COMPARATIVA CORPORATIVA */}
          <Card className="border-none shadow-2xl rounded-[2.5rem] bg-white overflow-hidden">
            <CardHeader className="bg-slate-50/50 py-5 px-8 border-b flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-black uppercase tracking-[0.3em] text-slate-900 flex items-center gap-2">
                <Building2 className="h-4 w-4 text-primary" /> Matriz Comparativa: Competencia vs Athleticenter ({filteredResults.length})
              </CardTitle>
              <Badge variant="outline" className="border-slate-200 text-[8px] font-mono uppercase text-slate-500">{extractedFileName}</Badge>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest">
                    <th className="p-4 pl-8">Producto Competencia</th>
                    <th className="p-4">Mi Producto Emparejado</th>
                    <th className="p-4 text-center">Coincidencia</th>
                    <th className="p-4 text-right">Mi Precio Cash</th>
                    <th className="p-4 text-right">Precio Competencia</th>
                    <th className="p-4 text-center">Diferencia (%)</th>
                    <th className="p-4 text-right">Precio Sugerido</th>
                    <th className="p-4 text-center">Estado</th>
                    <th className="p-4 pr-8 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs font-bold text-slate-800">
                  {filteredResults.map((item, idx) => {
                    const isCompetitive = item.status === 'competitivo';
                    const isRisk = item.status === 'en_riesgo';
                    const isNoMatch = item.status === 'sin_coincidencia';

                    return (
                      <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                        <td className="p-4 pl-8">
                          <div className="space-y-0.5">
                            <p className="font-black text-slate-900 uppercase leading-tight">{item.competitorItemName}</p>
                            <span className="text-[8px] font-black uppercase text-primary tracking-wider">{item.competitorDiscipline}</span>
                          </div>
                        </td>

                        <td className="p-4">
                          {item.matchedProduct ? (
                            <div className="space-y-0.5">
                              <p className="font-black text-slate-900 uppercase truncate max-w-[200px]">{item.matchedProduct.name}</p>
                              <p className="text-[8px] font-mono text-slate-400">SKU: {item.matchedProduct.sku} | {item.matchedProduct.brand}</p>
                            </div>
                          ) : (
                            <span className="text-[9px] font-bold text-amber-500 uppercase italic">Sin coincidencia en catálogo</span>
                          )}
                        </td>

                        <td className="p-4 text-center">
                          <Badge className={cn("font-mono text-[9px] font-black border-none", item.similarityScore >= 80 ? "bg-emerald-100 text-emerald-700" : item.similarityScore >= 50 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600")}>
                            {item.similarityScore}%
                          </Badge>
                        </td>

                        <td className="p-4 text-right font-mono font-black text-slate-900">
                          {item.matchedProduct ? `$${item.myPriceCashUSD.toFixed(2)}` : '—'}
                        </td>

                        <td className="p-4 text-right font-mono font-black text-blue-700">
                          ${item.competitorPrice.toFixed(2)}
                        </td>

                        <td className="p-4 text-center">
                          {item.matchedProduct ? (
                            <span className={cn("font-mono text-xs font-black px-2 py-0.5 rounded-lg", isCompetitive ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600")}>
                              {item.priceDifferencePercent >= 0 ? `+${item.priceDifferencePercent}` : item.priceDifferencePercent}%
                            </span>
                          ) : '—'}
                        </td>

                        <td className="p-4 text-right font-mono font-black text-emerald-600">
                          {item.matchedProduct ? `$${item.suggestedOptimalPrice.toFixed(2)}` : '—'}
                          {item.marginWarning && <p className="text-[7px] text-amber-600 uppercase">Protegido (WAC)</p>}
                        </td>

                        <td className="p-4 text-center">
                          <Badge className={cn("text-[8px] font-black uppercase border-none px-2.5 py-1", isCompetitive ? "bg-emerald-600 text-white" : isRisk ? "bg-rose-600 text-white" : "bg-amber-500 text-white")}>
                            {isCompetitive ? '🟢 COMPETITIVO' : isRisk ? '🔴 EN RIESGO' : '🟡 OPORTUNIDAD'}
                          </Badge>
                        </td>

                        <td className="p-4 pr-8 text-right">
                          <div className="flex justify-end gap-1.5">
                            {item.matchedProduct ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => router.push(`/dashboard/inventory/pricing-calculator?sku=${item.matchedProduct?.sku}`)}
                                  className="h-8 px-2 rounded-xl text-[8px] font-black uppercase text-primary hover:bg-primary/10"
                                >
                                  <Zap className="h-3 w-3 mr-1" /> Ajustar
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => { setSelectedMatchItem(item); setIsQuoteModalOpen(true); }}
                                  className="h-8 px-2 rounded-xl bg-slate-900 text-white text-[8px] font-black uppercase hover:bg-primary"
                                >
                                  <Briefcase className="h-3 w-3 mr-1" /> Match-Quote
                                </Button>
                              </>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => router.push('/dashboard/purchase-orders')}
                                className="h-8 px-2 rounded-xl border-amber-200 text-amber-700 bg-amber-50 text-[8px] font-black uppercase hover:bg-amber-100"
                              >
                                <Globe className="h-3 w-3 mr-1" /> Pedir Importación
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* MODAL GENERADOR COTIZACIÓN MATCH-PRICE B2B */}
      <Dialog open={isQuoteModalOpen} onOpenChange={setIsQuoteModalOpen}>
        <DialogContent className="sm:max-w-md rounded-[2.5rem] border-none shadow-2xl overflow-hidden p-8">
          <DialogHeader className="space-y-2">
            <DialogTitle className="text-xl font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
              <Briefcase className="h-5 w-5 text-primary" /> Generar Cotización Match-Price B2B
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 font-medium leading-relaxed">
              Crea una oferta comercial B2B superando el precio de la competencia.
            </DialogDescription>
          </DialogHeader>

          {selectedMatchItem && (
            <div className="space-y-6 py-4">
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-1">
                <span className="text-[8px] font-black uppercase text-slate-400">Producto Seleccionado</span>
                <p className="text-xs font-black uppercase text-slate-900">{selectedMatchItem.matchedProduct?.name}</p>
                <div className="flex justify-between text-[9px] font-bold text-slate-500 pt-1">
                  <span>Precio Competencia: ${selectedMatchItem.competitorPrice}</span>
                  <span>Mi Precio CASH: ${selectedMatchItem.myPriceCashUSD}</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-[9px] font-black uppercase text-slate-500">Nombre del Cliente B2B</Label>
                <Input
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Ej. Tienda Deportiva El Campeón C.A."
                  className="h-11 font-bold text-xs rounded-xl"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-[9px] font-black uppercase text-slate-500">Descuento Adicional sobre Competencia (%)</Label>
                <Input
                  type="number"
                  value={matchDiscountPercent}
                  onChange={(e) => setMatchDiscountPercent(Number(e.target.value))}
                  className="h-11 font-black text-center text-lg rounded-xl"
                />
              </div>

              <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-100 text-center space-y-1">
                <span className="text-[8px] font-black uppercase text-emerald-600">Precio Final Ofertado al Cliente</span>
                <p className="text-2xl font-black text-emerald-700 font-mono">
                  ${(selectedMatchItem.competitorPrice * (1 - matchDiscountPercent / 100)).toFixed(2)} USD
                </p>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setIsQuoteModalOpen(false)} className="h-12 rounded-xl font-black text-xs uppercase">Cancelar</Button>
            <Button onClick={handleCreateMatchQuote} className="h-12 px-6 rounded-xl bg-primary text-white font-black text-xs uppercase shadow-xl">
              Emitir Cotización B2B
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
