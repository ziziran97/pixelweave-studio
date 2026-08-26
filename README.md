# PixelWeave Studio

一款轻量、专注单图工作流的浏览器图片编辑器，提供消除笔、标注、图层、指令改图与无透明通道 JPG 导出。

> React 19 + Fabric.js 7 + TypeScript + Vite

PixelWeave Studio 不依赖 Excalidraw。编辑器始终只有一张当前图片，图片尺寸就是画布尺寸；替换图片不会新增第二张底图。

## 已实现

- 默认打开一张图片，支持上传、粘贴或通过 URL 指定当前图片
- 消除笔：涂抹、框选、自由勾画圈选、逐点多边形套索四种遮罩方式；套索双击或按 Enter 闭合
- 消除接口：提交当前合成 JPG 与黑白遮罩 JPG，接口结果替换当前图片
- 测试降级：未配置消除接口时，把选区以白色写入图片
- 指令改图：输入条常驻图片下方，将合成 JPG、对象 JSON 和指令一起提交接口
- 自由画笔、调色和图层控制；文字在点击位置创建，矩形、圆形、箭头通过鼠标拖拽创建
- 图片加载和窗口尺寸变化时自动适配可用编辑区域，并保留手动缩放控制
- 图片替换、消除、指令改图和常规编辑均支持撤销/重做
- 仅导出不含透明通道的 JPG

## 启动

```bash
npm install
copy .env.example .env
npm run dev
```

默认地址：`http://127.0.0.1:4175/`

## 配置

接口地址只从 `.env` 或部署环境读取，不在前端界面展示：

```bash
VITE_ERASER_API_URL=https://api.example.com/inpaint
VITE_INSTRUCTION_EDIT_API_URL=https://api.example.com/instruction-edit
VITE_DEFAULT_IMAGE_URL=https://example.com/default.jpg
```

也可以用 `?image=https://example.com/image.jpg` 为当前页面指定默认图片。跨域图片需要资源服务器允许浏览器跨域访问。

## 消除 API 契约

```http
POST <VITE_ERASER_API_URL>
Content-Type: multipart/form-data

image=<当前合成图片，image.jpg>
mask=<黑底白区遮罩，mask.jpg；纯白消除，纯黑保留>
```

每次执行都会重新生成当前图片和对应遮罩。接口返回的新图片会被转成白色背景 JPG，替换当前图片，同时清空本次遮罩。

## 指令改图 API 契约

```http
POST <VITE_INSTRUCTION_EDIT_API_URL>
Content-Type: multipart/form-data

image=<当前图片与全部可见标注合成后的 image.jpg>
prompt=<用户输入的文字指令>
objects=<除底图和消除遮罩外的对象 JSON 数组>
```

两个接口都支持：

1. 直接返回图片 Blob；
2. JSON 返回 `url`、`imageUrl`、`resultUrl`、`image` 或 `base64`，字段也可以位于 `data` 下。

## 生产构建

```bash
npm run build
```

## License

[MIT](./LICENSE)
