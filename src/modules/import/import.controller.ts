import { Response, NextFunction, Request } from 'express'
import prisma from '../../prisma/client'
import { TypedRequest, InferSchemaType } from '../../common/express'
import { importBatchSchema, importItemSchema, hostSchema, scriptSchema, importProficiencyDataSchema } from '../../common/schemas'
import { ImportPreviewResult, ImportConfirmResult, ValidatedImportData } from '../../common/types'

type ImportPreviewRequest = Request

type ImportConfirmRequest = Request

const fieldLabels: Record<string, string> = {
  name: '名称',
  description: '描述',
  minPlayers: '最小人数',
  maxPlayers: '最大人数',
  durationMin: '时长(分钟)',
  difficulty: '难度',
  coverImage: '封面图片',
  isActive: '是否启用',
  phone: '手机号',
  avatar: '头像',
  hostId: '主持人ID',
  hostPhone: '主持人手机号',
  scriptId: '剧本ID',
  scriptName: '剧本名称',
  level: '熟练度等级',
}

const formatFieldError = (field: string, message: string, value?: unknown): string => {
  const label = fieldLabels[field] || field
  const valueStr = value !== undefined ? ` (值: ${JSON.stringify(value)})` : ''
  return `${label}: ${message}${valueStr}`
}

const detectType = (item: unknown): 'script' | 'host' | 'proficiency' | 'unknown' => {
  if (item && typeof item === 'object' && 'type' in item) {
    const t = (item as any).type
    if (t === 'script' || t === 'host' || t === 'proficiency') {
      return t
    }
  }
  return 'unknown'
}

const preValidateRequest = (body: unknown): {
  valid: boolean
  items?: InferSchemaType<typeof importBatchSchema>
  errors: ValidatedImportData['errors']
  total: number
} => {
  const errors: ValidatedImportData['errors'] = []

  if (!Array.isArray(body)) {
    errors.push({
      row: 0,
      type: 'unknown',
      errors: ['请求体必须是JSON数组格式'],
      fieldErrors: [{ field: 'root', message: '请求体必须是JSON数组格式', value: body }],
    })
    return { valid: false, errors, total: 0 }
  }

  if (body.length === 0) {
    errors.push({
      row: 0,
      type: 'unknown',
      errors: ['导入数据不能为空'],
      fieldErrors: [{ field: 'root', message: '导入数据不能为空', value: [] }],
    })
    return { valid: false, errors, total: 0 }
  }

  const validItems: InferSchemaType<typeof importBatchSchema> = []

  body.forEach((item, index) => {
    const row = index + 1
    const detectedType = detectType(item)

    const parseResult = importItemSchema.safeParse(item)

    if (!parseResult.success) {
      parseResult.error.errors.forEach(e => {
        const field = e.path.join('.')
        const value = field ? (item as any)?.[field] : item
        const message = formatFieldError(field, e.message, value)

        const existing = errors.find(err => err.row === row)
        if (existing) {
          if (!existing.errors.includes(message)) {
            existing.errors.push(message)
          }
          if (field) {
            if (!existing.fieldErrors) {
              existing.fieldErrors = []
            }
            if (!existing.fieldErrors.some(fe => fe.field === field && fe.message === message)) {
              existing.fieldErrors.push({ field, message, value })
            }
          }
        } else {
          const errorItem: ValidatedImportData['errors'][0] = {
            row,
            type: detectedType === 'unknown' ? 'host' : detectedType,
            errors: [message],
          }
          if (field) {
            errorItem.fieldErrors = [{ field, message, value }]
          }
          errors.push(errorItem)
        }
      })
    } else {
      validItems.push(parseResult.data)
    }
  })

  return {
    valid: errors.length === 0,
    items: validItems,
    errors,
    total: body.length,
  }
}

const addErrorWithField = (
  result: ValidatedImportData,
  row: number,
  type: 'script' | 'host' | 'proficiency' | 'unknown',
  error: string,
  field?: string,
  value?: unknown
) => {
  const existing = result.errors.find(e => e.row === row)
  if (existing) {
    if (!existing.errors.includes(error)) {
      existing.errors.push(error)
    }
    if (field) {
      if (!existing.fieldErrors) {
        existing.fieldErrors = []
      }
      if (!existing.fieldErrors.some(fe => fe.field === field && fe.message === error)) {
        existing.fieldErrors.push({ field, message: error, value })
      }
    }
  } else {
    const errorItem: ValidatedImportData['errors'][0] = {
      row,
      type,
      errors: [error],
    }
    if (field) {
      errorItem.fieldErrors = [{ field, message: error, value }]
    }
    result.errors.push(errorItem)
  }
}

const validateImportData = async (
  items: InferSchemaType<typeof importBatchSchema>
): Promise<ValidatedImportData> => {
  const result: ValidatedImportData = {
    scripts: [],
    hosts: [],
    proficiencies: [],
    errors: [],
  }

  const batchPhoneMap = new Map<string, number[]>()
  const batchScriptNameMap = new Map<string, number[]>()
  const batchProficiencyKeyMap = new Map<string, number[]>()
  const zodErrorRows = new Set<number>()

  items.forEach((item, index) => {
    const row = index + 1
    let schema = null
    if (item.type === 'script') {
      schema = scriptSchema
    } else if (item.type === 'host') {
      schema = hostSchema
    } else if (item.type === 'proficiency') {
      schema = importProficiencyDataSchema
    }
    
    if (schema) {
      const parseResult = schema.safeParse(item.data)
      if (!parseResult.success) {
        zodErrorRows.add(row)
        parseResult.error.errors.forEach(e => {
          const field = e.path.join('.')
          const message = formatFieldError(field, e.message, (item.data as any)[field])
          addErrorWithField(result, row, item.type, message, field, (item.data as any)[field])
        })
      }
    }

    if (item.type === 'host') {
      const phone = (item.data as any).phone
      if (phone) {
        if (!batchPhoneMap.has(phone)) {
          batchPhoneMap.set(phone, [])
        }
        batchPhoneMap.get(phone)!.push(row)
      }
    } else if (item.type === 'script') {
      const name = (item.data as any).name
      if (name) {
        if (!batchScriptNameMap.has(name)) {
          batchScriptNameMap.set(name, [])
        }
        batchScriptNameMap.get(name)!.push(row)
      }
    }
  })

  const phoneList = Array.from(batchPhoneMap.keys())
  const scriptNameList = Array.from(batchScriptNameMap.keys())

  const hostIdsToCheck = new Set<number>()
  const scriptIdsToCheck = new Set<number>()
  const proficiencyHostPhonesToCheck = new Set<string>()
  const proficiencyScriptNamesToCheck = new Set<string>()

  items.forEach((item, index) => {
    if (item.type !== 'proficiency') return
    const data = item.data as any
    if (data.hostId) hostIdsToCheck.add(data.hostId)
    if (data.scriptId) scriptIdsToCheck.add(data.scriptId)
    if (data.hostPhone) proficiencyHostPhonesToCheck.add(data.hostPhone)
    if (data.scriptName) proficiencyScriptNamesToCheck.add(data.scriptName)
  })

  const [
    existingHostsByPhone,
    existingScriptsByName,
    existingHostsById,
    existingScriptsById,
    proficiencyHostsByPhone,
    proficiencyScriptsByName,
  ] = await Promise.all([
    phoneList.length > 0 ? prisma.host.findMany({ where: { phone: { in: phoneList } }, select: { phone: true } }) : Promise.resolve([]),
    scriptNameList.length > 0 ? prisma.script.findMany({ where: { name: { in: scriptNameList } }, select: { name: true } }) : Promise.resolve([]),
    hostIdsToCheck.size > 0 ? prisma.host.findMany({ where: { id: { in: Array.from(hostIdsToCheck) } }, select: { id: true } }) : Promise.resolve([]),
    scriptIdsToCheck.size > 0 ? prisma.script.findMany({ where: { id: { in: Array.from(scriptIdsToCheck) } }, select: { id: true } }) : Promise.resolve([]),
    proficiencyHostPhonesToCheck.size > 0 ? prisma.host.findMany({ where: { phone: { in: Array.from(proficiencyHostPhonesToCheck) } }, select: { id: true, phone: true } }) : Promise.resolve([]),
    proficiencyScriptNamesToCheck.size > 0 ? prisma.script.findMany({ where: { name: { in: Array.from(proficiencyScriptNamesToCheck) } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ])

  const existingPhoneSet = new Set(existingHostsByPhone.map(h => h.phone))
  const existingScriptNameSet = new Set(existingScriptsByName.map(s => s.name))
  const existingHostIdSet = new Set(existingHostsById.map(h => h.id))
  const existingScriptIdSet = new Set(existingScriptsById.map(s => s.id))
  const proficiencyHostPhoneToId = new Map(proficiencyHostsByPhone.map(h => [h.phone, h.id]))
  const proficiencyScriptNameToId = new Map(proficiencyScriptsByName.map(s => [s.name, s.id]))

  batchPhoneMap.forEach((rows, phone) => {
    if (rows.length > 1) {
      rows.forEach(row => {
        if (!zodErrorRows.has(row)) {
          const message = `批次内存在重复手机号: ${phone}`
          addErrorWithField(result, row, 'host', message, 'phone', phone)
        }
      })
    }
    if (existingPhoneSet.has(phone)) {
      rows.forEach(row => {
        if (!zodErrorRows.has(row)) {
          const message = `手机号已存在: ${phone}`
          addErrorWithField(result, row, 'host', message, 'phone', phone)
        }
      })
    }
  })

  batchScriptNameMap.forEach((rows, name) => {
    if (rows.length > 1) {
      rows.forEach(row => {
        if (!zodErrorRows.has(row)) {
          const message = `批次内存在重复剧本名: ${name}`
          addErrorWithField(result, row, 'script', message, 'name', name)
        }
      })
    }
    if (existingScriptNameSet.has(name)) {
      rows.forEach(row => {
        if (!zodErrorRows.has(row)) {
          const message = `剧本名已存在: ${name}`
          addErrorWithField(result, row, 'script', message, 'name', name)
        }
      })
    }
  })

  const validRows = new Set(items.map((_, i) => i + 1))
  result.errors.forEach(e => validRows.delete(e.row))

  const batchHostPhoneToIndex = new Map<string, number>()
  const batchScriptNameToIndex = new Map<string, number>()

  items.forEach((item, index) => {
    const row = index + 1
    if (!validRows.has(row)) return

    if (item.type === 'host') {
      batchHostPhoneToIndex.set((item.data as any).phone, index)
      result.hosts.push({ row, data: item.data })
    } else if (item.type === 'script') {
      batchScriptNameToIndex.set((item.data as any).name, index)
      result.scripts.push({ row, data: item.data })
    }
  })

  items.forEach((item, index) => {
    const row = index + 1
    if (item.type !== 'proficiency') return

    const data = item.data as any
    let resolvedHostId: number | undefined
    let resolvedScriptId: number | undefined

    if (data.hostId) {
      if (existingHostIdSet.has(data.hostId)) {
        resolvedHostId = data.hostId
      } else {
        const message = `主持人ID不存在: ${data.hostId}`
        addErrorWithField(result, row, 'proficiency', message, 'hostId', data.hostId)
      }
    } else if (data.hostPhone) {
      if (proficiencyHostPhoneToId.has(data.hostPhone)) {
        resolvedHostId = proficiencyHostPhoneToId.get(data.hostPhone)
      } else if (batchHostPhoneToIndex.has(data.hostPhone)) {
        const hostIndex = batchHostPhoneToIndex.get(data.hostPhone)!
        const hostRow = hostIndex + 1
        if (!validRows.has(hostRow)) {
          const message = `引用的主持人手机号 ${data.hostPhone} 在批次内验证失败`
          addErrorWithField(result, row, 'proficiency', message, 'hostPhone', data.hostPhone)
        } else {
          resolvedHostId = -1 - hostIndex
        }
      } else {
        const message = `主持人不存在: ${data.hostPhone}`
        addErrorWithField(result, row, 'proficiency', message, 'hostPhone', data.hostPhone)
      }
    }

    if (data.scriptId) {
      if (existingScriptIdSet.has(data.scriptId)) {
        resolvedScriptId = data.scriptId
      } else {
        const message = `剧本ID不存在: ${data.scriptId}`
        addErrorWithField(result, row, 'proficiency', message, 'scriptId', data.scriptId)
      }
    } else if (data.scriptName) {
      if (proficiencyScriptNameToId.has(data.scriptName)) {
        resolvedScriptId = proficiencyScriptNameToId.get(data.scriptName)
      } else if (batchScriptNameToIndex.has(data.scriptName)) {
        const scriptIndex = batchScriptNameToIndex.get(data.scriptName)!
        const scriptRow = scriptIndex + 1
        if (!validRows.has(scriptRow)) {
          const message = `引用的剧本名 ${data.scriptName} 在批次内验证失败`
          addErrorWithField(result, row, 'proficiency', message, 'scriptName', data.scriptName)
        } else {
          resolvedScriptId = -1 - scriptIndex
        }
      } else {
        const message = `剧本不存在: ${data.scriptName}`
        addErrorWithField(result, row, 'proficiency', message, 'scriptName', data.scriptName)
      }
    }

    const hasErrors = result.errors.some(e => e.row === row)
    if (hasErrors) return

    const profKey = `${resolvedHostId}-${resolvedScriptId}`
    if (!batchProficiencyKeyMap.has(profKey)) {
      batchProficiencyKeyMap.set(profKey, [])
    }
    batchProficiencyKeyMap.get(profKey)!.push(row)

    result.proficiencies.push({
      row,
      data,
      hostId: resolvedHostId,
      scriptId: resolvedScriptId,
    })
  })

  batchProficiencyKeyMap.forEach((rows, key) => {
    if (rows.length > 1) {
      rows.forEach(row => {
        const existing = result.errors.find(e => e.row === row)
        const message = '批次内存在重复的主持人-剧本熟练度组合'
        if (existing) {
          if (!existing.errors.includes(message)) {
            existing.errors.push(message)
          }
        } else {
          addErrorWithField(result, row, 'proficiency', message)
        }
      })
      result.proficiencies = result.proficiencies.filter(p => !rows.includes(p.row))
    }
  })

  const invalidRowSet = new Set(result.errors.map(e => e.row))
  result.hosts = result.hosts.filter(h => !invalidRowSet.has(h.row))
  result.scripts = result.scripts.filter(s => !invalidRowSet.has(s.row))
  result.proficiencies = result.proficiencies.filter(p => !invalidRowSet.has(p.row))

  return result
}

export const previewImport = async (req: ImportPreviewRequest, res: Response, next: NextFunction) => {
  try {
    const preValidation = preValidateRequest(req.body)

    if (preValidation.items === undefined || preValidation.items.length === 0) {
      const response: ImportPreviewResult = {
        total: preValidation.total,
        importable: 0,
        errors: preValidation.errors,
        summary: {
          scripts: 0,
          hosts: 0,
          proficiencies: 0,
        },
      }
      res.sendSuccess(response, '导入预览完成')
      return
    }

    const validated = await validateImportData(preValidation.items)

    const allErrors = [...preValidation.errors, ...validated.errors]

    const response: ImportPreviewResult = {
      total: preValidation.total,
      importable: validated.scripts.length + validated.hosts.length + validated.proficiencies.length,
      errors: allErrors,
      summary: {
        scripts: validated.scripts.length,
        hosts: validated.hosts.length,
        proficiencies: validated.proficiencies.length,
      },
    }

    res.sendSuccess(response, '导入预览完成')
  } catch (error) {
    next(error)
  }
}

export const confirmImport = async (req: ImportConfirmRequest, res: Response, next: NextFunction) => {
  try {
    const preValidation = preValidateRequest(req.body)

    if (preValidation.items === undefined) {
      res.sendError('请求格式错误，请检查数据格式', 400)
      return
    }

    const validated = await validateImportData(preValidation.items)

    const allErrors = [...preValidation.errors, ...validated.errors]

    if (allErrors.length > 0) {
      res.sendError(`存在 ${allErrors.length} 条验证错误，请先修正后再导入`, 400)
      return
    }

    const scriptIds: number[] = []
    const hostIds: number[] = []
    const proficiencyIds: number[] = []

    const indexToScriptId = new Map<number, number>()
    const indexToHostId = new Map<number, number>()

    await prisma.$transaction(async (tx) => {
      for (const scriptItem of validated.scripts) {
        const script = await tx.script.create({ data: scriptItem.data })
        scriptIds.push(script.id)
        const batchIndex = scriptItem.row - 1
        indexToScriptId.set(batchIndex, script.id)
      }

      for (const hostItem of validated.hosts) {
        const host = await tx.host.create({ data: hostItem.data })
        hostIds.push(host.id)
        const batchIndex = hostItem.row - 1
        indexToHostId.set(batchIndex, host.id)
      }

      for (const profItem of validated.proficiencies) {
        let hostId = profItem.hostId!
        let scriptId = profItem.scriptId!

        if (hostId < 0) {
          const batchIndex = -1 - hostId
          hostId = indexToHostId.get(batchIndex)!
        }
        if (scriptId < 0) {
          const batchIndex = -1 - scriptId
          scriptId = indexToScriptId.get(batchIndex)!
        }

        const existing = await tx.hostProficiency.findUnique({
          where: { hostId_scriptId: { hostId, scriptId } },
        })

        if (existing) {
          const proficiency = await tx.hostProficiency.update({
            where: { id: existing.id },
            data: { level: profItem.data.level },
          })
          proficiencyIds.push(proficiency.id)
        } else {
          const proficiency = await tx.hostProficiency.create({
            data: {
              hostId,
              scriptId,
              level: profItem.data.level,
            },
          })
          proficiencyIds.push(proficiency.id)
        }
      }
    })

    const response: ImportConfirmResult = {
      imported: scriptIds.length + hostIds.length + proficiencyIds.length,
      scripts: { count: scriptIds.length, ids: scriptIds },
      hosts: { count: hostIds.length, ids: hostIds },
      proficiencies: { count: proficiencyIds.length, ids: proficiencyIds },
    }

    res.sendSuccess(response, '导入成功')
  } catch (error) {
    next(error)
  }
}
