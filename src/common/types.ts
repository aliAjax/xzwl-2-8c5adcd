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

export interface ImportErrorItem {
  row: number
  type: 'script' | 'host' | 'proficiency'
  errors: string[]
}

export interface ImportPreviewResult {
  total: number
  importable: number
  errors: ImportErrorItem[]
  summary: {
    scripts: number
    hosts: number
    proficiencies: number
  }
}

export interface ImportConfirmResult {
  imported: number
  scripts: { count: number; ids: number[] }
  hosts: { count: number; ids: number[] }
  proficiencies: { count: number; ids: number[] }
}

export interface ValidatedImportData {
  scripts: Array<{ row: number; data: any }>
  hosts: Array<{ row: number; data: any }>
  proficiencies: Array<{ row: number; data: any; hostId?: number; scriptId?: number }>
  errors: ImportErrorItem[]
}
