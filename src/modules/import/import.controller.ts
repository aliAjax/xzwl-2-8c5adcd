import { Response, NextFunction } from 'express'
import prisma from '../../prisma/client'
import { TypedRequest, InferSchemaType } from '../../common/express'
import { importBatchSchema, hostSchema, scriptSchema } from '../../common/schemas'
import { ImportPreviewResult, ImportConfirmResult, ValidatedImportData } from '../../common/types'

type ImportPreviewRequest = TypedRequest<
  Record<string, never>,
  Record<string, never>,
  InferSchemaType<typeof importBatchSchema>
>

type ImportConfirmRequest = ImportPreviewRequest

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
  const zodErrors: Map<number, string[]> = new Map()

  items.forEach((item, index) => {
    const row = index + 1
    const schema = item.type === 'script' ? scriptSchema : item.type === 'host' ? hostSchema : null
    
    if (schema) {
      const parseResult = schema.safeParse(item.data)
      if (!parseResult.success) {
        const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
        zodErrors.set(row, errors)
        result.errors.push({ row, type: item.type, errors })
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

  const [existingHosts, existingScripts] = await Promise.all([
    phoneList.length > 0 ? prisma.host.findMany({ where: { phone: { in: phoneList } }, select: { phone: true } }) : Promise.resolve([]),
    scriptNameList.length > 0 ? prisma.script.findMany({ where: { name: { in: scriptNameList } }, select: { name: true } }) : Promise.resolve([]),
  ])

  const existingPhoneSet = new Set(existingHosts.map(h => h.phone))
  const existingScriptNameSet = new Set(existingScripts.map(s => s.name))

  const addError = (row: number, type: 'script' | 'host' | 'proficiency', error: string) => {
    const existing = result.errors.find(e => e.row === row)
    if (existing) {
      if (!existing.errors.includes(error)) {
        existing.errors.push(error)
      }
    } else {
      result.errors.push({ row, type, errors: [error] })
    }
  }

  batchPhoneMap.forEach((rows, phone) => {
    if (rows.length > 1) {
      rows.forEach(row => {
        if (!zodErrors.has(row)) {
          addError(row, 'host', `批次内存在重复手机号: ${phone}`)
        }
      })
    }
    if (existingPhoneSet.has(phone)) {
      rows.forEach(row => {
        if (!zodErrors.has(row)) {
          addError(row, 'host', `手机号已存在: ${phone}`)
        }
      })
    }
  })

  batchScriptNameMap.forEach((rows, name) => {
    if (rows.length > 1) {
      rows.forEach(row => {
        if (!zodErrors.has(row)) {
          addError(row, 'script', `批次内存在重复剧本名: ${name}`)
        }
      })
    }
    if (existingScriptNameSet.has(name)) {
      rows.forEach(row => {
        if (!zodErrors.has(row)) {
          addError(row, 'script', `剧本名已存在: ${name}`)
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

  const phonesToCheck: string[] = []
  const scriptNamesToCheck: string[] = []

  items.forEach((item, index) => {
    const row = index + 1
    if (item.type !== 'proficiency') return

    const data = item.data as any
    if (data.hostPhone && !data.hostId) {
      phonesToCheck.push(data.hostPhone)
    }
    if (data.scriptName && !data.scriptId) {
      scriptNamesToCheck.push(data.scriptName)
    }
  })

  const [hostsByPhone, scriptsByName] = await Promise.all([
    phonesToCheck.length > 0 ? prisma.host.findMany({ where: { phone: { in: phonesToCheck } }, select: { id: true, phone: true } }) : Promise.resolve([]),
    scriptNamesToCheck.length > 0 ? prisma.script.findMany({ where: { name: { in: scriptNamesToCheck } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ])

  const hostPhoneToId = new Map(hostsByPhone.map(h => [h.phone, h.id]))
  const scriptNameToId = new Map(scriptsByName.map(s => [s.name, s.id]))

  items.forEach((item, index) => {
    const row = index + 1
    if (item.type !== 'proficiency') return

    const data = item.data as any
    const errors: string[] = []
    let resolvedHostId: number | undefined
    let resolvedScriptId: number | undefined

    if (data.hostId) {
      resolvedHostId = data.hostId
    } else if (data.hostPhone) {
      if (hostPhoneToId.has(data.hostPhone)) {
        resolvedHostId = hostPhoneToId.get(data.hostPhone)
      } else if (batchHostPhoneToIndex.has(data.hostPhone)) {
        const hostIndex = batchHostPhoneToIndex.get(data.hostPhone)!
        const hostRow = hostIndex + 1
        if (!validRows.has(hostRow)) {
          errors.push(`引用的主持人手机号 ${data.hostPhone} 在批次内验证失败`)
        } else {
          resolvedHostId = -1 - hostIndex
        }
      } else {
        errors.push(`主持人不存在: ${data.hostPhone}`)
      }
    }

    if (data.scriptId) {
      resolvedScriptId = data.scriptId
    } else if (data.scriptName) {
      if (scriptNameToId.has(data.scriptName)) {
        resolvedScriptId = scriptNameToId.get(data.scriptName)
      } else if (batchScriptNameToIndex.has(data.scriptName)) {
        const scriptIndex = batchScriptNameToIndex.get(data.scriptName)!
        const scriptRow = scriptIndex + 1
        if (!validRows.has(scriptRow)) {
          errors.push(`引用的剧本名 ${data.scriptName} 在批次内验证失败`)
        } else {
          resolvedScriptId = -1 - scriptIndex
        }
      } else {
        errors.push(`剧本不存在: ${data.scriptName}`)
      }
    }

    if (errors.length > 0) {
      result.errors.push({ row, type: 'proficiency', errors })
      return
    }

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
        if (existing) {
          existing.errors.push('批次内存在重复的主持人-剧本熟练度组合')
        } else {
          result.errors.push({ row, type: 'proficiency', errors: ['批次内存在重复的主持人-剧本熟练度组合'] })
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
    const items = req.body

    const validated = await validateImportData(items)

    const response: ImportPreviewResult = {
      total: items.length,
      importable: validated.scripts.length + validated.hosts.length + validated.proficiencies.length,
      errors: validated.errors,
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
    const items = req.body

    const validated = await validateImportData(items)

    if (validated.errors.length > 0) {
      res.sendError(`存在 ${validated.errors.length} 条验证错误，请先修正后再导入`, 400)
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
