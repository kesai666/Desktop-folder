> Windows 桌面小工具：**外观是 iPhone 主屏文件夹，内里是真实目录**。
> 一个进程里可以同时摆多个小组件，每个指向不同文件夹；拖文件进去真的移入，双击用默认程序打开，删除进应用回收站，Ctrl+Z 可撤销。

![收起态](shots/13-compact-final.png)
![展开态](shots/15-expanded-noring.png)
![排列模式](shots/18-arrange.png)
![磁吸高亮](shots/20-magnet.png)
![进子文件夹](shots/10-subfolder.png)

## 下载

[![build](https://github.com/kesai666/Desktop-folder/actions/workflows/build.yml/badge.svg)](https://github.com/kesai666/Desktop-folder/actions/workflows/build.yml)
[![release](https://img.shields.io/github/v/release/kesai666/Desktop-folder)](https://github.com/kesai666/Desktop-folder/releases)

- [下载最新版](https://github.com/kesai666/Desktop-folder/releases/latest)
- 安装版：`iOS.Folder.Widget.Setup.<版本>.exe`
- 便携版：`iOS.Folder.Widget.<版本>.exe`（双击即用，不写注册表）

## 它是什么

iPhone 的文件夹是「图标的分组视图」，Windows 的文件夹是「真实目录」。这个工具把两者接在一起：

| 你看到的 | 实际发生的事 |
|---|---|
| 圆角磨砂玻璃、3×3 九宫格预览、下方小字名字 | 窗口自绘的玻璃外观（圆角、模糊、霜白叠层） |
| 点一下原地放大成多行面板 | 窗口从小图标尺寸放大到面板尺寸，内容浮出 |
| 里面的每个图标 | 目录里的真实文件 / 子文件夹 |
| 拖文件进面板 | 真的移动到该目录（同名自动改 `a (2).txt`） |
| 把图标拖出去 | 真的拖到桌面 / 资源管理器（原生拖放） |
| 删除 | 进应用回收站，`Ctrl+Z` 撤销，7 天后自动清理 |
| 右键 | 打开 / 在资源管理器中显示 / 重命名 / 删除 |

## 运行

环境：Windows 11（磨砂与圆角依赖系统的 DPI/合成能力），Node 20+。

```powershell
# 安装依赖（走国内镜像）。本机没有系统 npm，用 DSH 自带的 Node + pnpm：
$node = "C:\Users\k\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
$pnpm = "C:\Users\k\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.cjs"
$env:npm_config_registry = 'https://registry.npmmirror.com'
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
& $node $pnpm install

# 启动（指定要展示的目录）
$env:ELECTRON_RUN_AS_NODE = $null      # 关键：DSH 环境会设这个变量，不清掉 Electron 会退化成 node
node_modules\electron\dist\electron.exe . --folder "C:\Users\k\Desktop"

# 或指定窗口位置（DIP），方便固定在桌面某个位置
node_modules\electron\dist\electron.exe . --folder "C:\Users\k\Desktop" --pos 120,400
```

- 不传 `--folder` 时：用上次选择过的目录，否则默认用桌面。
- 位置会记住（`%APPDATA%\ios-folder-widget\config.json`）。
- 托盘图标（右下角）常驻：列出所有小组件（点一下展开对应文件夹）、新建文件夹小组件、**开机自启动开关**、退出。窗口本身不进任务栏。
- **默认开机自启动**：首次启动会写入 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`（值名 `com.local.ios-folder-widget`）。开发态不直接指向项目目录，而是指向固定的启动器 `%LOCALAPPDATA%\ios-folder-widget\launch.ps1`；它先读 `%APPDATA%\ios-folder-widget\install.json` 里的当前路径，找不到就扫描 `Documents` / `Desktop` / `Downloads` 下的 `ios-folder-widget` 目录。**项目搬家后不需要重新勾选**（除非搬到这三个目录之外）。打包后则直接指向 exe 自身。开关状态存在 `config.json` 的 `autoStart`。
- 若双击启动后看不到窗口：先确认没有 `ELECTRON_RUN_AS_NODE` 环境变量残留（见上）。

## 多个小组件

- **新建**：托盘 →「新建文件夹小组件…」，或右键任意小组件 →「新建文件夹小组件…」。**不弹目录选择框**：直接在桌面建一个「新建文件夹」（重名自动 (2)）并绑成新小组件。建出来的真实文件夹会被设为**隐藏**，资源管理器默认不显示，所以桌面上只看到 iPhone 风格图标；想绑已有目录，可以带 `--folder` 再启动一次。
- **管理**：托盘菜单按目录名列出每个小组件，点哪个就展开哪个；右键小组件 →「移除这个小组件」（只移除窗口，不删文件夹）。
- **持久化**：每个小组件的目录和位置分别保存，重启后原样恢复。
- **不重叠**：新建的小组件会优先贴在已有组件的右侧/下方，没有空位就扫描桌面网格找位置，不会叠在一起。
- **磁吸**：拖动时靠近另一个组件的边缘 12px 内会自动吸附，并**留出 10px 空隙**（不会完全贴在一起）；吸附瞬间两个组件边缘会亮起蓝色高亮。松手时只有压住对方约四分之一以上才按最小位移推开。

## 检查更新

- 更新源：`package.json` 的 `repository` 指向 GitHub 仓库，或启动时设 `IOS_UPDATE_REPO=owner/repo`；
- 右键 →「设置」→「检查更新…」，或设置窗口里的「检查更新」按钮；
- 会请求 GitHub Releases 的 latest，版本更高时弹窗并打开下载页；不会自动下载/安装；
- 未配置仓库时会提示先填更新源。

## 首次使用

首次启动会弹一个简短说明，并问一次「要不要开机自动启动」。托盘图标可能被 Windows 收进右下角的 `^` 里，展开后把它拖到任务栏固定即可。之后所有设置都在右键 →「设置」里。

## 安全与可靠性

- **配置不会被写坏**：`config.json` 用「同目录临时文件 + rename」原子写入，写前保留 `.bak`；主文件损坏时自动读备份。
- **拖出移动不靠猜**：不再用「同大小 + 同时间」判断，改为对目标文件做 **SHA-256** 内容校验，一致才把源文件移进回收站；校验失败/目标不是文件夹时保留源文件（等价于复制）。
- **空目录会回收**：工具自动创建的「新建文件夹」在移除组件时，如果还是空的，会一起删掉；有内容则保留。
- **可撤销删除**：删除先进应用回收站（`%APPDATA%\ios-folder-widget\trash`），`Ctrl+Z` 恢复；默认保留 7 天，设置里可打开/清空。
- **有日志可查**：主进程异常、托盘、启动等写入 `%APPDATA%\ios-folder-widget\logs\main.log`；右键 →「设置」→「打开日志文件夹」。
- **首次引导**：新用户会看到欢迎说明和开机启动选择，不会再出现“托盘图标去哪了”的问题。

## 分发给别人

```powershell
$node = "C:\Users\k\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
$pnpm = "C:\Users\k\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.cjs"
$env:npm_config_registry = 'https://registry.npmmirror.com'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
& $node $pnpm install
& $node $pnpm run dist
```

`pnpm install` 的 `postinstall` 会检查 `electron/dist` 是否完整，缺了就补跑 Electron 的安装脚本，避免打包时没有 `electron.exe`。

产物在 `dist/`：

- `iOS Folder Widget Setup 0.1.0.exe`：安装版，可选安装目录，带桌面/开始菜单快捷方式和卸载；
- `iOS Folder Widget 0.1.0.exe`：便携版，双击即用，不需要安装 Node。

发给别人时，发 `Setup.exe` 或便携版其中之一即可；对方双击安装/运行，不需要 Node 或源码。

> 构建时 exe 的图标和版本信息由 `scripts/after-pack.js` 调 `rcedit` 写入。electron-builder 默认走 winCodeSign，解压其中 macOS 符号链接需要管理员权限，普通账户会报 `Cannot create symbolic link`，所以 `build.win.signAndEditExecutable` 设为 `false`，改由 afterPack 处理。

对使用者的说明：

- 系统只需要 Windows 10/11 x64，不需要 Node、不需要源码目录；
- 打包版默认**不会**自动写开机启动，需要时在托盘菜单勾「开机自启动」；
- 配置在 `%APPDATA%\ios-folder-widget\config.json`，卸载不会删除；
- exe 未做代码签名，首次运行 SmartScreen 会提示「更多信息 → 仍要运行」；
- 如果只发便携版，移动 exe 后需要在托盘里重新勾一次开机自启动；安装版没有这个问题。

## 交互

| 操作 | 行为 |
|---|---|
| 单击小文件夹 | 原地放大成面板 |
| 拖动小文件夹 | 缓动跟随；进入对齐点/吸附点的瞬间直接落位并弹一下（咔哒）；按可见图标限制在桌面内，磁吸留 10px 空隙 |
| ESC / 点窗口外 / × / 切到别的窗口 | 收起 |
| 双击条目 | 文件夹进入下一级，文件用默认程序打开 |
| Backspace / 左上 ‹ | 返回上一级 |
| 方向键 · Enter · F2 · Delete | 选择 · 打开 · 重命名 · 删到应用回收站 |
| Ctrl+Z | 撤销上一次删除（从应用回收站恢复） |
| Ctrl / Shift + 单击 | 多选（Ctrl 点选、Shift 连选）；标题下显示「已选 N 项」 |
| Ctrl+C / Ctrl+X / Ctrl+V | 应用内复制 / 剪切 / 粘贴；剪贴板只在小工具内部有效 |
| Ctrl+F | 搜索当前文件夹；Esc 清空并关闭搜索 |
| 右键 →「设置」→「排序」 | 按名称 / 修改时间 / 大小 / 类型排序；手动排列后切回自定义顺序 |
| 选中条目 / 点空白 | 标题下的地址栏显示该条目的完整路径；取消选中后回到当前文件夹路径。路径过长时不省略，下方出现横向滚动条，可拖动查看/复制，不能编辑 |
| 点「排列」 | 进入抖动模式，拖动图标换位置，顺序按目录保存 |
| 右键 →「按名称重新排序」 | 清掉自定义顺序，恢复文件夹优先 + 名称排序 |
| 右键 →「新建文件夹」/ Ctrl+Shift+N | 在当前目录建真实文件夹，直接进入重命名 |
| 右键 →「新建文件夹小组件…」/ 托盘同名项 | 在桌面新建隐藏的「新建文件夹」并绑成新小组件（只显示 iPhone 图标） |
| 右键 →「设置」→「换个文件夹…」 | 把这个组件重新绑到已有目录；移除组件时不会再删这个目录 |
| 右键 →「设置」→「设置文件夹壁纸…」/「清除文件夹壁纸」 | 给这个小组件单独换背景图，随组件保存，重启恢复 |
| 右键 →「设置」→「打开设置窗口…」 | 独立设置窗口：模糊/霜白/壁纸模糊、开机启动、日志与回收站、检查更新、移除组件，拖动即时生效 |
| 右键 →「设置」→「开机自启动」/「打开日志文件夹」 | 开关开机启动；日志在 `%APPDATA%\ios-folder-widget\logs\main.log` |
| 右键 →「设置」→「撤销上一次删除」/「打开应用回收站」/「清空应用回收站」 | 应用回收站在 `%APPDATA%\ios-folder-widget\trash`，默认保留 7 天 |
| 右键 →「移除这个小组件」 | 只关窗口；如果是工具创建的空文件夹，会一并清理 |
| 从资源管理器拖入 | 移动到当前目录（有虚线提示） |
| 把条目拖出到桌面 / 已打开的资源管理器窗口 | **移动**：系统先复制，应用对目标做 SHA-256 内容校验，一致才把源文件移到回收站 |
| 把条目拖出到其他应用（邮件、聊天等） | 复制（目标不是可识别的文件夹，源文件保留） |
| 右键 | 原生菜单 |

## 实现要点

- **玻璃是自绘的**：窗口透明，里面一层「当前壁纸 + CSS `blur(26px) saturate(1.65)`」被圆角容器裁切，再叠一层霜白渐变和高光。这样能任意圆角、任意模糊强度——Windows 原生 Mica/Acrylic 材质只能画矩形，做不出 iPhone 的大圆角。
- **窗口尺寸随状态变化**：收起时窗口就是小图标大小（160×184，含阴影留白），展开时才放大到 600×640（580×620 面板 + 10px 阴影边）。**不用 `setIgnoreMouseEvents` 做点击穿透**——那套在后台启动的进程上会丢点击（本项目实测过），窗口大小贴合内容更稳。
- **位置不出桌面，但可以贴边**：钳制的是**可见图标 + 名字**的外框，不是整个窗口，所以图标能贴着屏幕边缘，30px 透明留白允许伸出屏幕外；任务栏之外、显示器拔掉/分辨率变化都会自动校正。
- **多小组件**：进程内维护一张 `widgets` 表（每个 = 一个 BrowserWindow + 自己的 rootDir/位置/目录监听）；所有 IPC 通过 `event.sender` 反查所属窗口，互不串台。配置存成 `config.json` 的 `widgets` 数组（旧的单窗口配置会自动迁移），托盘菜单随小组件增删实时重建。新建小组件不弹目录选择框：直接在桌面创建「新建文件夹」（重名自动编号）并绑定；建出来的真实文件夹用 `attrib +h` 设为隐藏，桌面只显示 iPhone 风格图标。
- **独立设置窗口**：`settings.html` 里可调玻璃模糊、霜白强度、自定义壁纸模糊，开关开机启动，打开日志/应用回收站、清空回收站、移除组件；拖动滑杆实时通过 IPC 推给对应小组件，配置按组件写入 `blur/frost/customBlur`。
- **磁吸与防重叠**：拖动时按可见内容计算位置，靠近其他组件边缘 12px 内自动吸附并留 10px 空隙（左右或上下并排），两个组件同时亮蓝色高亮；松手时若重叠面积超过约 25% 才按最小位移推开；新建组件优先贴在已有组件右侧/下方（同样留空隙），没有空位则扫描桌面网格找不重叠的位置。
- **拖动丝滑 + 咔哒吸附**：拖动位置用缓动跟随（8ms 一帧，向目标插值）；被拖动组件刚进入同一行/列（顶边或左边 8px 内），或刚进入磁吸范围时，不做停顿，而是**直接落位到对齐/吸附点**，同时两个组件做一次 180ms 的缩放回弹（`1 → 1.06 → 0.985 → 1`），像卡扣"咔哒"扣上；之后继续跟手。松手时也会按略宽的范围（14px）再对齐一次，避免"拖动时咔哒了、放手又差几像素"。没有额外的引导线窗口。
- **拖出＝移动的实现**：Electron 的 `webContents.startDrag` 在 Windows 上把文件按「复制」交给系统。拖放开始时应用启动一个轻量监听进程，等鼠标松开后确定落点（桌面 / 资源管理器窗口），确认目标目录里出现了同大小、同修改时间的副本，才删除源文件。落点不是可识别的文件夹（别的应用 / 取消）时保留源文件，等价于复制。
- **自定义排列**：点标题栏「排列」进入抖动模式，拖动图标换位置；顺序按目录保存在 `%APPDATA%\ios-folder-widget\orders.json`，右键「按名称重新排序」可清除。重命名/删除会同步维护顺序，新文件按默认规则追加。排列模式下拖动只排序，不会拖出文件。
- **地址栏**：标题下那行默认显示当前文件夹路径；选中某个条目时切到该条目的完整路径，点空白取消选中后回到文件夹路径。路径超长时不再省略号截断，而是变成横向滚动，下面出现一条可拖动的滚动条，能拖到任意位置查看/选中复制；实现上是纯文本 `div` + `user-select: text`，不是输入框，改不了。
- **自定义壁纸**：每个 widget 的配置里存 `wallpaper` 路径；选中图片后不再采样桌面，而是直接把图铺满该组件的 mini/panel，模糊降到 10px（桌面壁纸是 26px）；清除后回退桌面壁纸。更换/清除会通过 IPC 广播到窗口即时生效，路径随 `config.json` 持久化，重启恢复。
- **新建文件夹**：右键「新建文件夹」或 `Ctrl+Shift+N`，在**当前目录**（进到子文件夹里就建在子文件夹里）创建真实目录；重名会自动生成「新建文件夹 (2)」，并直接进入内联重命名。新文件夹的图标和已有子文件夹完全一样（九宫格玻璃块）。
- **快捷方式图标**：`.lnk` 不再用 Electron 的通用「白纸 + 箭头」图标，而是让 Windows 的 `SHGetFileInfo`（不带 `USEFILEATTRIBUTES`）解析目标图标；普通文件先用系统缩略图，失败回退文件类型图标，再失败显示白底扩展名兜底块。
- **展开时若面板会出屏**：窗口自动平移让面板完整可见，同时返回偏移量，让小图标保持在屏幕原位（收起时再还原）。
- **磨砂不采样窗口**：和 iOS 一样，模糊的是**壁纸**，不是背后的窗口。所以它应该待在桌面上；被窗口盖住时玻璃里看到的仍是壁纸（这是已知限制，见下）。
- **图标**：图片/视频/PDF 等用系统缩略图（`nativeImage.createThumbnailFromPath`），其余用系统文件图标（`app.getFileIcon`）；子文件夹画成「迷你九宫格」以区分。
- **防抖**：目录用 `fs.watch` 监听，外部改动 250ms 防抖后自动刷新。

## 已知限制

1. **玻璃采样的是壁纸，不是背后窗口**。放在桌面（壁纸）上最像 iPhone；压在别的窗口上时，玻璃里不会出现那个窗口的内容。若要「真玻璃」，可换成 Windows Mica/Acrylic（圆角会被限制成系统 8px）或用 `desktopCapturer` 持续采样屏幕（需要把窗口设为 capture-protected，且更新有延迟）。
2. **拖出「移动」依赖落点可识别**：只识别桌面与已打开的资源管理器窗口。拖到桌面上的文件夹图标（未打开）、或拖进别的应用时，源文件会保留（即复制）。目标文件必须通过 SHA-256 内容校验才会移源；校验通过后源文件进回收站，可以从回收站恢复。
3. **没有焊死在桌面层**。它现在是普通窗口（不占任务栏），会被其它窗口盖住；点它才回到最前。真正「贴在壁纸上、Win+D 不消失」需要把窗口挂到桌面的 `WorkerW` 上，而 Windows 11 24H2 改过桌面窗口结构，需要单独适配。
4. **多显示器壁纸**：目前读的是 `HKCU\Control Panel\Desktop\WallPaper`，每台显示器单独设置壁纸时不会区分；壁纸用 `Fill`（cover）方式绘制，`平铺/居中/跨屏` 不保证一致。
5. **嵌套**：子文件夹可以点进去（iOS 里不允许文件夹套文件夹），这是我们比 iOS 多出来的实用语义。
6. **排序**固定在「文件夹优先 + 名称自然排序」，还没有按类型/时间排序的入口；展开态超过 4×5 是滚动，不是 iOS 的分页圆点。
7. **没有代码签名，也没有自动下载安装更新**：设置里有「检查更新」，会查 GitHub Releases 最新版并打开下载页（需要先在 `package.json` 的 `repository` 填仓库，或设置 `IOS_UPDATE_REPO=owner/repo`）；但不会自动下载/静默安装。安装包未签名，SmartScreen 会提示。
8. **剪贴板只在应用内**：Ctrl+C/X/V 和右键复制/剪切/粘贴只在本工具内部有效，不能和资源管理器互相粘贴；跨应用请用拖放。

## 目录

```
src/main.js            主进程：窗口/托盘/菜单/目录与图标 IPC/拖放移动/尺寸与位置
src/preload.js         安全桥（contextBridge）
src/fsutil.js          目录列举、重名处理、移动、SHA-256 内容校验、文件名校验
src/renderer/          index.html / styles.css / renderer.js（玻璃外观与交互）
test/fsutil.test.js    文件层单测（node --test，7 个用例）
scripts/capture.ps1    真机截图（DPI 感知）+ 裁剪放大
scripts/input.ps1      真鼠标/键盘注入（测试用）
scripts/cdp.mjs        极简 CDP 客户端（eval / screenshot）
scripts/resolve-drop.ps1  拖放落点解析（桌面 / 资源管理器窗口路径）
scripts/extract-icon.ps1  .lnk 目标图标提取（SHGetFileInfo）
scripts/after-pack.js  打包后写 exe 图标/版本（rcedit）
scripts/ensure-electron.js  postinstall 检查 Electron 二进制
scripts/make-tray-icon.ps1 / make-ico.js  重新生成托盘图标
assets/tray.ico        多尺寸托盘图标（16/20/24/32/48/64/256）
assets/icon.png        应用/安装包图标
.github/workflows/build.yml  Windows CI：测试 + 打安装包
```

## 自查

```powershell
pnpm test        # node --test test/fsutil.test.js（7 个用例）
pnpm dist        # Windows 安装包 + 便携版，输出 dist/
```

## 下一步（按价值排序）

1. 代码签名 + 自动下载安装更新（当前只做检查更新 + 打开下载页）。
2. 主进程拆分模块 + 拖放/IPC/配置迁移 E2E 测试 + 桌面层 WorkerW 适配。
3. 应用回收站容量/保留天数设置，支持跨重启的撤销历史列表。
4. 设置窗口补齐图标大小、壁纸裁切/位置、组件管理。
