import { User, OrderStatus, Order } from './definitions';

export type UserRole = User['role'];

export type Resource = 
  | 'users' 
  | 'products' 
  | 'inventory' 
  | 'orders' 
  | 'quotes' 
  | 'customers' 
  | 'payments' 
  | 'commissions' 
  | 'reports'
  | 'settings';

export type Action = 'create' | 'read' | 'update' | 'delete' | 'approve' | 'dispatch' | 'verify_payment' | 'view_cost';

const ROLES_HIERARCHY: Record<UserRole, number> = {
  superadmin: 100,
  gerencia: 90,
  admin: 80,
  ventas: 50,
  deposito: 40,
  cliente: 10,
};

/**
 * Verifica si un usuario tiene permiso para realizar una acción sobre un recurso.
 */
export function hasPermission(user: User | null | undefined, resource: Resource, action: Action): boolean {
  if (!user || !user.role) return false;

  const role = user.role;

  // Superadmin y Gerencia tienen acceso casi total
  if (role === 'superadmin' || role === 'gerencia') return true;

  switch (resource) {
    case 'users':
      // Solo admins pueden gestionar usuarios, ventas puede ver su perfil
      return role === 'admin' && action !== 'delete';
    
    case 'products':
      // Ventas y clientes solo pueden leer. Deposito puede actualizar stock (inventory).
      if (action === 'read') return true;
      if (action === 'view_cost') return role === 'admin'; // Solo admin ve costos
      return role === 'admin';

    case 'inventory':
      // Deposito y Admin gestionan inventario
      return role === 'admin' || role === 'deposito';

    case 'orders':
      if (action === 'read') return true; // Todos leen (con filtros aplicados en la query)
      if (action === 'create') return role === 'ventas' || role === 'admin' || role === 'cliente';
      if (action === 'update') return role === 'ventas' || role === 'admin' || role === 'deposito';
      if (action === 'approve') return role === 'admin';
      if (action === 'dispatch') return role === 'deposito' || role === 'admin';
      return false;

    case 'quotes':
      if (action === 'read' || action === 'create') return role === 'ventas' || role === 'admin';
      return role === 'admin';

    case 'customers':
      if (action === 'read') return true;
      if (action === 'create' || action === 'update') return role === 'ventas' || role === 'admin';
      return false;

    case 'payments':
      if (action === 'create') return role === 'ventas' || role === 'cliente' || role === 'admin';
      if (action === 'verify_payment') return role === 'admin';
      return role === 'admin' || role === 'ventas';

    case 'settings':
      return false; // Solo superadmin/gerencia (manejado arriba)

    default:
      return false;
  }
}

/**
 * Lógica específica para transiciones de estado de pedidos.
 * Evita que un rol incorrecto mueva un pedido a un estado inválido.
 */
export function canChangeOrderStatus(user: User, currentStatus: OrderStatus, newStatus: OrderStatus): boolean {
  if (!user || !user.role) return false;
  const role = user.role;
  
  if (role === 'superadmin' || role === 'gerencia') return true;

  // Flujo: Pendiente -> Aprobado (Solo Admin)
  if (currentStatus === 'Pendiente' && newStatus === 'Aprobado') {
    return role === 'admin';
  }

  // Flujo: Aprobado -> En Preparación -> Despachado (Deposito)
  if (['Aprobado', 'En Preparación'].includes(currentStatus) && 
      ['En Preparación', 'Despachado', 'Completado'].includes(newStatus)) {
    return role === 'deposito' || role === 'admin';
  }

  // Flujo: Cancelación (Admin o Ventas si aún no está aprobado)
  if (newStatus === 'Cancelado') {
    if (currentStatus === 'Pendiente') return role === 'ventas' || role === 'admin';
    return role === 'admin';
  }

  // Flujo: Pagos
  if (newStatus === 'Pagado' || newStatus === 'En Verificación') {
    return role === 'admin';
  }

  return false;
}

/**
 * Verifica si un pedido puede ser editado (modificar items, cantidades, etc.)
 * basándose en su estado actual y el rol del usuario.
 */
export function canEditOrder(user: User, order: Order): boolean {
  if (!user || !user.role) return false;
  const role = user.role;

  if (role === 'superadmin' || role === 'gerencia') return true;

  // Admin puede editar casi siempre, excepto quizás si ya está pagado/cerrado (opcional)
  if (role === 'admin') return true;

  // Deposito solo puede editar (ej: notas de entrega) si lo está procesando
  if (role === 'deposito') {
    return ['Aprobado', 'En Preparación'].includes(order.status);
  }

  // Ventas y Clientes SOLO pueden editar si el pedido está Pendiente (Borrador)
  if (role === 'ventas' || role === 'cliente') {
    return order.status === 'Pendiente';
  }

  return false;
}