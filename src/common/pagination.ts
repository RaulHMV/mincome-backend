/** Envoltura de las listas paginadas (contrato §2, `Page`). */
export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PageRequest {
  page: number;
  pageSize: number;
}

export function offsetOf({ page, pageSize }: PageRequest): number {
  return (page - 1) * pageSize;
}
