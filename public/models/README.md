# 模型资源目录（远程加载，不内嵌）

本目录用于存放 GLTF/GLB 模型与 HDR 环境贴图。**模型文件不打包进 JS Bundle**，
运行时通过 URL 远程加载（地址在 `src/config/app.config.js` 中配置）。

## 目录约定

```
public/
├─ models/
│  └─ coffee_cup.glb        # 旋转咖啡杯整机模型（需自行制作/放置）
├─ hdr/
│  └─ studio.hdr            # 厂房/影棚环境贴图（建议 1K~2K）
└─ config/
   └─ parts.info.json       # 部件科普文案（已随工程提供）
```

## 没有模型文件会怎样？

默认配置下找不到 `./models/coffee_cup.glb` 时，程序会自动切换到**内置程序化兜底模型**
（`src/model/ProceduralModel.js`），其节点命名与正式 GLTF 完全一致，
所有仿真、拾取、树、科普弹窗功能均可正常使用，便于在拿到正式模型前先行教学与开发。

## 也可以使用任意远程地址

支持绝对 URL 与运行时查询参数两种方式，无需改代码：

```text
# 方式一：修改 src/config/app.config.js 的 modelUrl / hdrUrl
modelUrl: 'https://your-cdn.example.com/models/coffee_cup.glb'

# 方式二：URL 查询参数覆盖（适合同一套部署服务多个班级/模型）
http://localhost:5173/?model=https://cdn.xxx.com/a.glb&hdr=https://cdn.xxx.com/b.hdr
```

> 跨域加载要求模型服务器返回 `Access-Control-Allow-Origin` 响应头；
> 如无法控制对方服务器，可在 `vite.config.js` 的 `server.proxy` 中配置反向代理。

模型制作的完整命名与导出要求见 `docs/模型制作规范.md`。
