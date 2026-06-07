# 剧本杀门店管理系统 API 文档

## 基础信息

- 基础URL: `http://localhost:3000/api/v1`
- 响应格式: JSON

## 统一响应格式

```json
{
  "success": true,
  "message": "Success",
  "data": {},
  "timestamp": 1234567890
}
```

## 接口列表

### 1. 健康检查
- **GET** `/health`

---

### 2. 剧本管理

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/scripts` | 创建剧本 |
| GET | `/scripts` | 获取剧本列表（支持分页、关键词搜索） |
| GET | `/scripts/:id` | 获取剧本详情 |
| PUT | `/scripts/:id` | 更新剧本 |
| DELETE | `/scripts/:id` | 删除剧本 |

#### 创建剧本请求体
```json
{
  "name": "剧本名称",
  "description": "剧本描述",
  "minPlayers": 4,
  "maxPlayers": 8,
  "durationMin": 240,
  "difficulty": "MEDIUM",
  "coverImage": "https://example.com/cover.jpg",
  "isActive": true
}
```

#### 难度枚举
- `EASY` - 简单
- `MEDIUM` - 中等
- `HARD` - 困难
- `EXTREME` - 烧脑

---

### 3. 主持人管理

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/hosts` | 创建主持人 |
| GET | `/hosts` | 获取主持人列表 |
| GET | `/hosts/:id` | 获取主持人详情 |
| PUT | `/hosts/:id` | 更新主持人 |
| DELETE | `/hosts/:id` | 删除主持人 |

#### 创建主持人请求体
```json
{
  "name": "主持人姓名",
  "phone": "13800138000",
  "avatar": "https://example.com/avatar.jpg",
  "isActive": true
}
```

---

### 4. 主持人熟练度管理

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/proficiencies` | 设置熟练度 |
| GET | `/proficiencies` | 获取熟练度列表（可按hostId/scriptId筛选） |
| GET | `/proficiencies/:id` | 获取熟练度详情 |
| PUT | `/proficiencies/:id` | 更新熟练度 |
| DELETE | `/proficiencies/:id` | 删除熟练度 |

#### 熟练度等级
- `BEGINNER` - 初级
- `INTERMEDIATE` - 中级
- `PROFICIENT` - 熟练
- `EXPERT` - 专家

---

### 5. 场次管理

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/sessions` | 创建场次（自动检查主持人冲突） |
| GET | `/sessions` | 获取场次列表（支持多条件筛选） |
| GET | `/sessions/:id` | 获取场次详情 |
| PUT | `/sessions/:id` | 更新场次（自动检查主持人冲突） |
| DELETE | `/sessions/:id` | 删除场次 |
| GET | `/sessions/host/:hostId` | 获取主持人排班 |

#### 创建场次请求体
```json
{
  "scriptId": 1,
  "hostId": 1,
  "startTime": "2024-01-15T14:00:00.000Z",
  "endTime": "2024-01-15T18:00:00.000Z",
  "status": "PENDING",
  "room": "A101",
  "price": 128.00,
  "maxPlayers": 6,
  "remark": ""
}
```

#### 场次状态
- `PENDING` - 待确认
- `CONFIRMED` - 已确认
- `COMPLETED` - 已完成
- `CANCELLED` - 已取消

#### 主持人冲突检查
创建/更新场次时，系统会自动检查主持人在该时间段是否已有安排，如有冲突会返回：
```json
{
  "success": false,
  "message": "主持人时间冲突，已有场次：剧本名 (2024/1/15 14:00:00 - 2024/1/15 18:00:00)",
  "timestamp": 1234567890
}
```

---

### 6. 预约管理

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/bookings` | 创建预约 |
| GET | `/bookings` | 获取预约列表 |
| GET | `/bookings/:id` | 获取预约详情 |
| PUT | `/bookings/:id` | 更新预约 |
| DELETE | `/bookings/:id` | 取消预约 |

#### 创建预约请求体
```json
{
  "sessionId": 1,
  "customerName": "张三",
  "customerPhone": "13800138000",
  "playerCount": 4,
  "status": "PENDING",
  "remark": "需要靠窗位置"
}
```

---

### 7. 统计接口

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/stats/scripts` | 剧本场次统计（默认最近30天） |
| GET | `/stats/hosts` | 主持人场次统计 |
| GET | `/stats/overview` | 数据总览 |

#### 查询参数
- `days`: 统计天数，默认30天，最大365天
- `scriptId`: 可选，指定剧本ID

#### 剧本场次统计响应示例
```json
{
  "success": true,
  "message": "Success",
  "data": {
    "period": {
      "startDate": "2024-01-01T00:00:00.000Z",
      "endDate": "2024-01-31T23:59:59.000Z",
      "days": 30
    },
    "total": 5,
    "list": [
      {
        "script": { "id": 1, "name": "剧本1", "difficulty": "HARD" },
        "sessionCount": 15,
        "totalPlayers": 75
      }
    ]
  },
  "timestamp": 1234567890
}
```

---

## 分页参数

所有列表接口支持以下分页参数：
- `page`: 页码，默认1
- `pageSize`: 每页数量，默认10，最大100
- `keyword`: 搜索关键词（部分接口支持）

## 项目启动

1. 配置数据库连接：修改 `.env` 文件中的 `DATABASE_URL`
2. 安装依赖：`npm install`
3. 生成 Prisma Client：`npm run prisma:generate`
4. 执行数据库迁移：`npm run prisma:migrate -- --name init`
5. 启动开发服务器：`npm run dev`
