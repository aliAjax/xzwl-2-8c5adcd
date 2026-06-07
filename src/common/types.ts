export interface PaginationResult<T> {
  list: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface PaginationParams {
  page: number
  pageSize: number
  keyword?: string
}

export const createPaginationResult = <T>(
  list: T[],
  total: number,
  page: number,
  pageSize: number
): PaginationResult<T> => {
  return {
    list,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  }
}
