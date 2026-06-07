import app from './app'
import prisma from './prisma/client'

const PORT = process.env.PORT || 3000

const startServer = async () => {
  try {
    await prisma.$connect()
    console.log('✅ 数据库连接成功')

    app.listen(PORT, () => {
      console.log(`🚀 服务器运行在 http://localhost:${PORT}`)
      console.log(`📚 API 文档: http://localhost:${PORT}/api/v1/health`)
    })
  } catch (error) {
    console.error('❌ 启动失败:', error)
    process.exit(1)
  }
}

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully')
  await prisma.$disconnect()
  process.exit(0)
})

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully')
  await prisma.$disconnect()
  process.exit(0)
})

startServer()
