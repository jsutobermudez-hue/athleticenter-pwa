import type { Timestamp } from 'firebase/firestore';

export type NotificationCategory = 'Pedidos' | 'Cotizaciones' | 'Clientes' | 'Inventario' | 'Facturación' | 'Despacho' | 'Usuarios' | 'Soporte';
export const notificationCategories: NotificationCategory[] = ['Pedidos' , 'Cotizaciones' , 'Clientes' , 'Inventario' , 'Facturación' , 'Despacho' , 'Usuarios' , 'Soporte'];

export const ALL_ORDER_STATUSES: OrderStatus[] = [
  'Borrador',
  'Pendiente',
  'Aprobado',
  'En Preparación',
  'Completado',
  'Despachado',
  'Entregado',
  'En Verificación',
  'Pagado',
  'Cancelado',
  'Rechazado'
];

export interface Auditable {
  id?: string;
  createdBy?: string;
  createdAt?: Timestamp;
  updatedBy?: string;
  updatedAt?: Timestamp;
}

export interface User extends Auditable {
  id: string;
  name: string;
  email: string;
  role: 'superadmin' | 'gerencia' | 'admin' | 'ventas' | 'deposito' | 'cliente';
  status: 'Activo' | 'Pendiente' | 'Inactivo';
  associatedCustomerId?: string; 
  avatarUrl?: string;
  identityCard?: string;
  phone?: string;
  address?: string;
  assignedZone?: string;
  socialMedia?: string;
  salesGoal?: number;
  commissionRate?: number;
  salesManagerId?: string;
  salesManagerName?: string;
  salesManagerCommissionRate?: number;
  pushSubscriptions?: any[];
}

export interface Product extends Auditable {
  sku: string;
  name: string;
  brand?: string;
  model?: string;
  features?: string;
  category: string;
  discipline?: string;
  stockLevel: number;
  minStockThreshold?: number;
  price: number;
  priceCashUSD: number;
  priceEarly7d?: number;
  priceEarly15d?: number;
  cost: number;
  lastPurchaseRate?: number;
  lastPurchaseDate?: Timestamp;
  imageUrl?: string;
  imageUrls?: string[];
  userId: string;
  activeOfferIds?: string[];
  hasSizes?: boolean;
  sizes?: { [key: string]: number } | null;
  warehouseLocation?: string; 
  lastSoldAt?: Timestamp; 
  totalSold?: number;
}

export interface Order extends Auditable {
  id: string;
  customerId: string;
  customerName: string;
  customerRif?: string;
  customerPhone?: string;
  salespersonId: string;
  salespersonName: string;
  orderDate: Timestamp;
  totalAmount: number;
  amountPaid: number;
  totalCashReceived?: number;
  status: OrderStatus;
  receptionDate?: Timestamp;
  approvalDate?: Timestamp;
  pickupDate?: Timestamp;
  carrier?: string;
  carrierId?: string;
  trackingNumber?: string;
  internalTrackingNumber?: string;
  trackingUrlTemplate?: string;
  salespersonCommissionRate?: number;
  packageCount?: number;
  totalWeight?: number;
  dispatchImageUrl?: string;
  deliveryImageUrl?: string;
  deliveryNotes?: string;
  alertsSent?: string[];
  stockRestored?: boolean; 
  cancellationRequested?: boolean;
  cancellationNotes?: string;
  bypassMoraReason?: string;
}

export type OrderStatus = 'Borrador' | 'Pendiente' | 'Aprobado' | 'En Preparación' | 'Completado' | 'Despachado' | 'Entregado' | 'Cancelado' | 'En Verificación' | 'Pagado' | 'Rechazado';

export interface Invoice extends Auditable {
    id: string;
    orderId: string;
    customerId: string;
    customerName: string;
    salespersonId: string;
    salespersonName?: string;
    amountTotal: number;
    amountPaid: number;
    currency: 'USD';
    dueDate: Date | Timestamp;
    status: 'En Verificación' | 'Vencido' | 'Por Vencer' | 'Pagado';
    paidAt?: Timestamp;
    remainingBalance: number;
    remainingCreditDays: number;
    discountPercentage: number;
    statusText: string;
    customerPhone?: string;
    customerRif?: string;
    creditStartDate?: Date;
}

export interface Payment extends Auditable {
    id: string;
    orderId: string;
    amount: number;
    baseAmount: number;
    taxAmount?: number;
    discountAmount?: number;
    discountType?: 'none' | '7days' | '15days' | 'cash';
    retentionAmount?: number;
    retentionPercentage?: number;
    paymentDate: Date | Timestamp;
    method: 'Transferencia Bancaria' | 'Pago Móvil' | 'Zelle' | 'Efectivo' | 'Punto de Venta' | 'Otro';
    referenceNumber: string;
    notes?: string;
    imageUrl?: string;
    retentionImageUrl?: string;
    status: 'pending_verification' | 'verified' | 'rejected';
    registeredBy: string;
    registeredByName: string;
    documentType: 'nota' | 'factura';
    accountingBase: 'bcv' | 'cash';
    incentivesApplied: boolean;
}

export interface Customer extends Auditable {
  razonSocial: string;
  rif: string;
  address: string;
  email: string;
  phone: string;
  assignedSalespersonId: string;
  assignedSalespersonName: string;
  status: 'Activo' | 'Inactivo' | 'Pendiente';
  assignedZone?: string;
  lastOrderDate?: Timestamp;
  isTaxAgent?: boolean;
  retentionPercentage?: 75 | 100;
  creditLimit: number;
  creditUsed: number;
}

export interface AuditLog extends Auditable {
    userId: string;
    userName: string;
    action: string;
    resource: 'users' | 'products' | 'system' | 'orders' | 'quotes' | 'invoices' | 'customers' | 'notifications';
    resourceId?: string;
    details: string;
    severity: 'info' | 'warning' | 'critical';
}

export interface Quote extends Auditable {
  id: string;
  customerId: string;
  customerName: string;
  customerRif?: string;
  customerPhone?: string;
  salespersonId: string;
  salespersonName: string;
  quoteDate: Timestamp;
  expiryDate: Timestamp;
  totalAmount: number;
  status: QuoteStatus;
}

export type QuoteStatus = 'Borrador' | 'Enviada' | 'Aceptada' | 'Convertida' | 'Vencida' | 'Cancelada';

export interface FinancialSettings {
  bcvRate: number;
  ivaPercent: number;
  defaultBcvDiscount: number;
  defaultCommission: number;
  salesManagerCommission: number;
  adminCommission: number;
  defaultOverhead: number;
  earlyPayment7Days: number;
  earlyPayment15Days: number;
  roundingTolerance: number;
  overdueBlockDays: number;
  historicalDilutionFactor: number;
  stripeEnabled: boolean;
  targetProfitUSD?: number;
}

export interface OrderItem {
  id?: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  size?: string;
  picked?: boolean;
  customerId?: string;
  salespersonId?: string;
}

export interface OrderItemClient extends OrderItem {
  product: Product;
}

export interface Notification extends Auditable {
    userId: string;
    title: string;
    message: string;
    link?: string;
    isRead: boolean;
    category: NotificationCategory;
}

export interface PricingStrategy {
    costLanded: number;
    useGlobalSettings: boolean;
    strategy: 'smart_import' | 'target_price' | 'target_margin' | 'target_markup';
    targetMarginPercent?: number;
    targetMarkupPercent?: number;
    targetPriceUSD?: number;
    customCommission?: number;
    customAdminCommission?: number;
    customSalesManagerCommission?: number;
    customOverhead?: number;
    importDetails?: {
        factoryCost: number;
        chinaShipping: number;
        dimensions: { length: number, width: number, height: number };
        unitsPerBox: number;
        freightRatePerCBM: number;
        otherExpenses: number;
        customsTariffPercent?: number;
        portFeesPerUnit?: number;
        customsAgentFeesPerUnit?: number;
    };
    calculated: {
        priceListBCV: number;
        priceCashUSD: number;
        priceEarly7d: number;
        priceEarly15d: number;
        netProfitUSD: number;
        netMarginPercent: number;
        totalCommissionsUSD: number;
        adminOverheadUSD: number;
        landedCost: number;
    };
}

export interface Supplier extends Auditable {
  name: string;
  rif: string;
  email: string;
  phone: string;
  contactName: string;
  categories: string[];
  country: string;
  city: string;
  address: string;
  preferredTransport: 'Marítimo' | 'Aéreo';
  leadTimeDays: number;
  paymentTerms: string;
  bankInfo: string;
  rating: number;
  status: 'Activo' | 'Inactivo';
  website?: string;
}

export interface PurchaseOrder extends Auditable {
    supplierId: string;
    supplierName: string;
    originCountry: string;
    originCity: string;
    transportMode: 'Marítimo' | 'Aéreo';
    status: 'Pendiente' | 'En Tránsito' | 'Aduana' | 'Recibido' | 'Cancelado';
    items: PurchaseOrderItem[];
    totalCost: number;
    estimatedArrival?: Timestamp | null;
    receptionDate?: Timestamp | null;
    trackingNumber?: string;
    blNumber?: string;
    containerType?: '20HQ' | '40HQ' | '45HQ' | 'LCL (Carga Suelta)';
    totalCBM?: number;
    customsTariffsAmount?: number;
    importIvaAmount?: number;
    portFeesAmount?: number;
    customsAgentFeesAmount?: number;
    otherCustomsExpenses?: number;
    downPaymentAmount?: number;
    downPaymentStatus?: 'Pendiente' | 'Pagado';
    balancePaymentAmount?: number;
    balancePaymentStatus?: 'Pendiente' | 'Pagado';
}

export interface PurchaseOrderItem {
    productId: string;
    sku: string;
    name: string;
    quantity: number;
    unitCost: number;
    landedUnitCost?: number;
    boxCount?: number;
    lengthCm?: number;
    widthCm?: number;
    heightCm?: number;
    cbmTotal?: number;
}

export interface Commission extends Auditable {
    orderId: string;
    paymentId: string;
    salespersonId: string;
    salespersonName: string;
    commissionDate: Timestamp;
    invoiceAmount: number;
    salespersonCommissionAmount: number;
    status: 'pendiente' | 'pagado';
    paymentReference?: string;
}

export interface Offer extends Auditable {
  name: string;
  discountPercentage: number;
  isActive: boolean;
}

export interface StockHistory extends Auditable {
  productId: string;
  userId: string;
  userName: string;
  previousStock: number;
  newStock: number;
  change: number;
  reason: string;
}

export interface SentMessage extends Auditable {
    senderId: string;
    senderName: string;
    senderAvatarUrl?: string;
    subject: string;
    body: string;
    recipientSummary?: string;
    isRead?: boolean;
}

export interface DirectMessage extends Auditable {
    userId: string; 
    senderId: string;
    senderName: string;
    senderAvatarUrl?: string;
    subject: string;
    body: string;
    isRead: boolean;
}

export interface SentNotification extends Auditable {
    title: string;
    message: string;
    category: NotificationCategory;
    link?: string;
    recipientSummary: string;
}

export interface CompanyProfile extends Auditable {
    companyName: string;
    companyRif: string;
    companyAddress: string;
    logoUrl?: string;
    logoFit?: 'contain' | 'cover';
    loginBackgroundType?: 'color' | 'image';
    loginBackgroundValue?: string;
    loginOverlayEnabled?: boolean;
    loginOverlayColor?: string;
    loginOverlayOpacity?: number;
    loginBackgroundFit?: 'cover' | 'contain';
    loginShowBranding?: boolean;
    headerShowLogo?: boolean;
}

export interface CarrierContact {
  name: string;
  position: string;
  phone?: string;
  email?: string;
}

export interface Carrier extends Auditable {
  id: string;
  name: string;
  contacts: CarrierContact[];
  trackingUrlTemplate?: string;
  status: 'Activo' | 'Inactivo';
}

export interface QuoteItem {
  id?: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  size?: string;
}

export interface QuoteItemClient extends QuoteItem {
  product: Product;
}

export interface PriceBackupItem {
  productId: string;
  oldPrice: number;
  oldPriceCashUSD: number;
  oldPriceEarly7d: number;
  oldPriceEarly15d: number;
  oldCost: number;
  oldFactoryCost: number;
  oldChinaShipping: number;
}

export interface PriceAdjustmentHistory {
  id?: string;
  userId: string;
  userName: string;
  adjustmentPercent: number;
  syncType: 'bcv' | 'wac';
  brandFilter: string;
  categoryFilter: string;
  modelFilter: string;
  backups: PriceBackupItem[];
  createdAt: any; // ServerTimestamp
  isRestored?: boolean;
}
