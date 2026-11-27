# local-mifit · 小米健康（dsh-go 插件）

装上就能用：插件自带运行环境、扫码登录、取数和面板。手机里不需要事先装过 `mifit`，也不需要任何别的项目。

只有一个入口：App 的「全部功能」→「小米健康」。聊天页的插件弹层、加号面板里都不再出现它。

## 功能

| 位置 | 内容 |
| --- | --- |
| 面板「小米健康」 | 状态 → 登录二维码（仅在等待扫码时出现）→ 提示 → 今日步数 / 目标进度 → 最近 7 天柱状图 → 睡眠 · 心率 · 血氧 · 压力 · 体重 → 最近运动 → 「聊天框快捷入口」开关 → 扫码登录 / 刷新数据 |
| 状态条 + 胶囊（默认关闭） | 开关打开后才出现：`今日 N 步 · 睡 7h21m`、胶囊「健康」「刷新健康」 |

面板每 3 秒读一次状态，所以装环境、等扫码、拉数据的过程都会自己往前走。

运动记录带**运动名称**（椭圆机 / 爬楼机 / 户外跑步 …）：小米服务端把运动类型写在记录外层的 `key` 上（如 `elliptical_trainer`），mifit 自带的对照表只有 4 项、其余只留数字，所以副车会在拉取数据时把这个 `key` 另存成 `runtime/data/workout_kinds.json`，插件再按官方 SportType 常量表翻成中英文名。表里没有的类型显示英文原名，连原名也没有才回退成「运动 #编号」。

### 合并与开关

- 登录二维码和健康数据在同一个面板里来回切：等扫码时二维码画在顶部，登录后这一段整块不渲染，不会留下空白。
- 「聊天框快捷入口」默认关闭，输入框上方是干净的。打开后把状态条和两个胶囊写回插件清单；关掉再从清单里移除，下次启动也不会出现。开关状态写在插件的 `package.json` 里（本地仓库因此会显示一个改动）。

## 第一次使用

1. 打开「全部功能」→「小米健康」。首次自动安装运行环境（`mifit` + `qrcode` + `cryptography`，约 48 MB，需要联网；装在插件的 `runtime/site/` 里）。
2. 环境就绪后，面板里自动出现二维码。
3. 用**小米运动健康 App**（或登录了小米账号的手机）扫码并确认。
4. 登录成功后自动拉取最近 7 天，面板出现数据。
5. 之后点「刷新数据」即可更新。

如果小米要求安全确认，完成确认后再点一次「扫码登录」。

## 数据与隐私

- 登录会话由 `mifit` 自己写在 `~/.mifit/session.json`（仅本人可读）。插件只判断它是否存在、是否有效，**不读取、不复制、不上传任何令牌**。
- 健康数据存在 `runtime/data/*.json`（本机已有 `/root/workspace/mifit-data` 时沿用那里）。
- 只会连小米的服务器；插件不向任何第三方发送数据，也没有埋点。

## 依赖

- dsh-go 手机 App（主机需要 `dshGo` 桥接）
- 系统 `python3`（3.12+）和联网能力，用于第一次自动安装

## 安装

```sh
P="${DSH_HOME:-$HOME/.dsh}/dsh-go/plugins/local-mifit"
git clone https://github.com/luotong2333-web/dsh-go-plugin-mifit.git "$P"
dsh plugin --profile web add "$P"
```

装进 profile 的是指向该目录的链接，所以目录不能删。改 `lib/` 里的代码后要在 App 的「引擎」页重启引擎才生效；改 `package.json`（包括面板里的入口开关）App 会自己重读。

## 结构

```
package.json            dshGo 清单（只有「小米健康」一个面板）
cordis.patch.yml        profile 层插入项
lib/index.js            处理函数、面板视图与数据绑定
lib/host.js             路径、状态文件、侧车进程、入口开关
lib/data.js             读导出的 JSON，拼成面板数据
lib/py/mifit_bridge.py  侧车：装环境（setup）、扫码登录（login）、拉数据（fetch）、查状态（status）
runtime/                自动生成，已被 .gitignore 排除
```

## 环境变量

都可不设，默认值见左列。

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `DSH_MIFIT_HOME` | 插件目录下的 `runtime/` | 运行时根目录 |
| `DSH_MIFIT_DATA` | `runtime/data` 或已有的 `/root/workspace/mifit-data` | 导出的 JSON 放哪 |
| `DSH_MIFIT_SESSION` | `~/.mifit` | 会话目录 |
| `DSH_MIFIT_PYTHON` | `python3` | 侧车用的解释器 |
| `DSH_MIFIT_MANIFEST` | 插件自己的 `package.json` | 入口开关改哪份清单（测试用） |
| `DSH_MIFIT_INDEX` | 空（依次试默认源、pypi.org、清华镜像） | pip 安装源 |

## 许可

暂未指定许可证。
