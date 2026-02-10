import type { Timestamp } from 'firebase/firestore';

export type NotificationCategory = 'Pedidos' | 'Cotizaciones' | 'Clientes' | 'Inventario' | 'Facturación' | 'Despacho' | 'Usuarios' | 'Soporte';
export const notificationCategories: NotificationCategory[] = ['Pedidos', 'Cotizaciones', 'Clientes', 'Inventario', 'Facturación', 'Despacho', 'Usuarios', 'Soporte'];

export interface Auditable {
  id?: string;
  createdBy?: string;
  createdAt?: Timestamp;
  updatedBy?: string;
  updatedAt?: Timestamp;
}

export interface User extends Auditable {
  id: string; // Firebase Auth UID
  
  // Campos del nuevo modelo
  name: string;
  email: string;
  role: 'superadmin' | 'gerencia' | 'admin' | 'ventas' | 'deposito' | 'cliente';
  status: 'Activo' | 'Pendiente' | 'Inactivo';
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
  pushSubscriptions?: any[];

  // Campos de compatibilidad (Legacy) para evitar errores en componentes existentes
  uid?: string; 
  displayName?: string | null;
  photoURL?: string | null;
  phoneNumber?: string | null;
}

export interface Product extends Auditable {
  sku: string;
  name: string;
  brand?: string;
  model?: string;
  features?: string;
  category: string;
  discipline?: string;
  stock: number;
  minStockThreshold?: number;
  price: number;
  cost: number;
  imageUrl?: string;
  userId: string;
  activeOfferIds?: string[];
}

export interface Offer extends Auditable {
  name: string;
  discountPercentage: number;
  isActive: boolean;
}

export interface StockHistory extends Auditable {
  productId: string;
  type: 'sale' | 'adjustment' | 'return' | 'initial';
  quantityChange: number;
  reason?: string;
  userId: string;
}

export interface Customer extends Auditable {
  razonSocial: string;
  rif: string;
  address: string;
  email: string;
  phone: string;
  instagram?: string;
  twitter?: string;
  website?: string;
  assignedSalespersonId: string;
  assignedSalespersonName: string;
  status: 'Activo' | 'Inactivo' | 'Pendiente';
  orderCount: number;
  assignedZone?: string;
  socialMedia?: string;
  // Compatibilidad
  name?: string;
}

export type OrderStatus = 'Pendiente' | 'Aprobado' | 'En Preparación' | 'Completado' | 'Despachado' | 'Entregado' | 'Cancelado' | 'En Verificación' | 'Pagado';
export const ALL_ORDER_STATUSES: OrderStatus[] = ['Pendiente', 'Aprobado', 'En Preparación', 'Completado', 'Despachado', 'Entregado', 'En Verificación', 'Pagado', 'Cancelado'];


export interface Order extends Auditable {
  id: string;
  sourceQuoteId?: string;
  customerId: string;
  customerName: string;
  customerPhone?: string;
  salespersonId: string;
  salespersonName: string;
  salespersonCommissionRate?: number;
  salesManagerId?: string;
  salesManagerName?: string;
  salesManagerCommissionRate?: number;
  orderDate: Timestamp;
  approvalDate?: Timestamp;
  approvedBy?: string;
  approvedByName?: string;
  approvalNotes?: string;
  pickupDate?: Timestamp;
  eta?: Timestamp;
  receptionDate?: Timestamp;
  totalAmount: number;
  status: OrderStatus;
  carrier?: string | null;
  trackingNumber?: string | null;
  deliveryNotes?: string;
}


export interface OrderItem {
  id?: string;
  productId: string;
  quantity: number;
  unitPrice: number;
}

// Client-side only version of OrderItem that includes the full product object for display purposes
export interface OrderItemClient extends OrderItem {
    product: Product;
}

export type QuoteStatus = 'Borrador' | 'Enviada' | 'Aceptada' | 'Convertida' | 'Vencida' | 'Cancelada';

export interface Quote extends Auditable {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone?: string;
  salespersonId: string;
  salespersonName: string;
  quoteDate: Timestamp;
  expiryDate: Timestamp;
  totalAmount: number;
  status: QuoteStatus;
}

export interface QuoteItem {
  id?: string;
  productId: string;
  quantity: number;
  unitPrice: number;
}

export interface QuoteItemClient extends QuoteItem {
    product: Product;
}


export interface Invoice {
    id: string;
    customerName: string;
    customerId: string;
    salespersonId: string;
    salespersonName: string;
    customerPhone: string;
    amount: number;
    dueDate: Date;
    status: 'Por Vencer' | 'Vencido' | 'Pagado' | 'En Verificación';
    statusText: string;
    remainingCreditDays: number;
    discountPercentage: number;
}

export interface Payment extends Auditable {
  orderId: string;
  amount: number;
  paymentDate: Date;
  method: 'Transferencia Bancaria' | 'Pago Móvil' | 'Zelle' | 'Efectivo' | 'Punto de Venta' | 'Binance' | 'Otro';
  referenceNumber?: string;
  bankName?: string;
  notes?: string;
  sourcePhoneNumber?: string;
  sourceIdentityCard?: string;
  sourceName?: string;
  sourceEmail?: string;
  registeredBy: string; // UID of the user who registered the payment
  registeredByName: string;
  status: 'pending_verification' | 'verified';
  imageUrl?: string;
}


export interface Notification extends Auditable {
    userId: string;
    title: string;
    message: string;
    link?: string;
    isRead: boolean;
    category: NotificationCategory;
}

export interface SentNotification extends Auditable {
    title: string;
    message: string;
    category: NotificationCategory;
    link?: string;
    recipientSummary: string;
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

export interface SentMessage extends Auditable {
    subject: string;
    body: string;
    recipientSummary: string;
}


export interface Carrier extends Auditable {
    name: string;
    contactName?: string;
    phone?: string;
    email?: string;
    trackingUrlTemplate?: string;
    status: 'Activo' | 'Inactivo';
}

export interface CompanyProfile extends Auditable {
    id: string;
    logoUrl?: string;
    logoFit?: 'contain' | 'cover';
    loginBackgroundType?: 'color' | 'image';
    loginBackgroundValue?: string;
    companyName?: string;
    companyRif?: string;
    companyAddress?: string;
    companyPhone?: string;
    companyEmail?: string;
}

export interface SupportTicket extends Auditable {
  userId: string;
  userName: string;
  userEmail: string;
  subject: string;
  message: string;
  status: 'Abierto' | 'En Progreso' | 'Cerrado';
}

export interface MonthlySale {
    month: string;
    sales: number;
}

export interface Commission extends Auditable {
  orderId: string;
  paymentId: string;
  commissionDate: Timestamp;
  invoiceAmount: number;
  salespersonId: string;
  salespersonName: string;
  salespersonCommissionAmount: number;
  salesManagerId?: string;
  salesManagerName?: string;
  salesManagerCommissionAmount?: number;
}