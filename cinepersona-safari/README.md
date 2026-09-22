# CinePersona Safari

这是从本仓库根目录的扩展源码打包出来的 Safari Web Extension 工程，包含：

- `CinePersona Safari (macOS)`：macOS Safari 容器和扩展目标
- `CinePersona Safari (iOS)`：iPhone/iPad Safari 容器和扩展目标

Safari 工程里的 `Shared (Extension)/Resources` 是当前扩展代码的副本；Edge/Chrome 仍以仓库根目录的扩展源码为准。更新扩展逻辑后，需要重新运行 Safari Web Extension Packager 或重新复制资源，再构建本工程。

## 本地构建

Xcode beta 安装在 `/Applications/Xcode-beta.app` 时：

```sh
DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer \
xcodebuild \
  -project "cinepersona-safari/CinePersona Safari/CinePersona Safari.xcodeproj" \
  -scheme "CinePersona Safari (macOS)" \
  -configuration Debug \
  -sdk macosx \
  build
```

iOS Simulator：

```sh
DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer \
xcodebuild \
  -project "cinepersona-safari/CinePersona Safari/CinePersona Safari.xcodeproj" \
  -scheme "CinePersona Safari (iOS)" \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination "generic/platform=iOS Simulator" \
  build
```

## macOS Safari 临时安装

不需要 App Store：

1. 在 Safari 设置的高级选项中开启开发者功能，然后在「开发」菜单中允许未签名扩展。
2. 打开 Safari 扩展设置，选择添加临时扩展，选中网站下载包解压后的文件夹；该文件夹的根目录必须直接包含 `manifest.json`、`background.js`、`popup/` 和 `content/`。
3. 在扩展设置中启用 CinePersona，并按 Safari 的提示授予需要使用的网站权限。

临时扩展会在退出 Safari 或经过一段时间后被移除；需要长期安装时，使用 Xcode 构建并运行 `CinePersona Safari (macOS)` 容器 App。

## iOS Safari 测试

iOS Safari 不能像 macOS 一样直接加载 ZIP。使用 Xcode 运行 `CinePersona Safari (iOS)` 到模拟器或已配置的真机，然后在「设置 > Safari > 扩展」中启用 CinePersona。

模拟器可以先做功能验证；真机安装需要可用的 Apple 开发签名。不上架 App Store 不影响本地开发和测试。

## Safari 兼容性说明

- Safari 支持现有代码使用的 `chrome.*` 命名空间，也支持 `browser.*`，所以不需要为所有 API 重写一套代码。
- 豆瓣连接器仍是用户主动授权功能。Safari 需要用户对豆瓣页面授予网站访问权限，Cookie 读取只用于当前用户自己的会话。
- Safari 的 `storage.sync` 不提供跨设备同步；观影库和 CSV 备份使用本地存储。Safari 副本声明了 `unlimitedStorage`，避免完整豆瓣库受默认存储上限影响。
- 当前扩展使用 Declarative Net Request 处理豆瓣请求头；Safari 支持该能力，但仍会根据网站权限要求用户授权。
- iOS Safari 的测试和权限体验与 macOS 不同，尤其是扩展入口、网站访问授权和 Cookie 会话，需要在真机上单独验收。

## 重新生成工程

以下命令从仓库根目录运行；首次生成使用：

```sh
DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer \
xcrun safari-web-extension-packager cinepersona-extension \
  --project-location cinepersona-safari \
  --app-name "CinePersona Safari" \
  --bundle-identifier com.gawyn.cinepersona.safari \
  --swift \
  --copy-resources \
  --no-open \
  --no-prompt
```

重新生成或更新资源后，需要再次确认 Safari 副本中的 `manifest.json` 保留 `unlimitedStorage`。网站提供的 `cinepersona-safari-extension-latest.zip` 就是这个 `Resources` 文件夹的临时安装包。
