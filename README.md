# local-mifit · 小米健康（dsh-go 插件）

装上就能用：插件自带运行环境、扫码登录、取数和面板。手机里不需要事先装过 `mifit`，也不需要任何别的项目。

第一次打开面板会自己装好依赖并显示二维码，扫码确认后自己把数据拉下来。

## 功能

| 位置 | 内容 |
| --- | --- |
| 状态条 | `今日 N 步 · 睡 7h21m`，每 60 秒刷新；未登录 / 待准备时给提示 |
| 胶囊「健康」 | 打开「小米健康」面板 |
| 胶囊「刷新健康」 | 拉取最近 7 天数据 |
| 加号工具「扫码登录」 | 打开面板并获取登录二维码 |
| 面板「小米健康」 | 二维码 → 状态与提示 → 今日步数 / 目标进度 → 最近 7 天柱状图 → 睡眠 · 心率 · 血氧 · 压力 · 体重 → 最近运动 → 四个按钮（准备环境 / 扫码登录 / 刷新数据 / 重新登录） |

面板每 3 秒读一次状态，所以装环境、等扫码、拉数据的过程都会自己往前走，不用手动刷新。

## 第一次使用

1. 打开「小米健康」面板。首次会自动安装运行环境（`mifit` + `qrcode` + `cryptography`，约 48 MB，需要联网；装在插件的 `runtime/site/` 里）。
2. 环境就绪后自动出现二维码：用**小米运动健康 App**（或登录了小米账号的手机）扫码并确认。
3. 登录成功后自动拉取最近 7 天，面板和状态条出现数据。
4. 之后点「刷新健康」或面板里的「刷新数据」即可更新。

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

装进 profile 的是指向该目录的链接，所以目录不能删。改 `lib/` 里的代码后要在 App 的「引擎」页重启引擎才生效；只改 `package.json` 会自动重读。

## 结构

```
package.json            dshGo 清单（状态条 / 胶囊 / 加号工具 / 面板）
cordis.patch.yml        profile 层插入项
lib/index.js            处理函数、面板视图与数据绑定
lib/host.js             路径、状态文件、侧车进程
lib/data.js             读导出的 JSON，拼成面板数据
lib/py/mifit_bridge.py  侧车：装环境（setup）、扫码登录（login）、拉数据（fetch）、查状态（status）
runtime/                自动生成，已被 .gitignore 排除
```

## 环境变量

都可不设，默认值见左列。

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `DSH_MIFIT_HOME` | 插件目录 | 运行时根目录（`runtime/` 所在处） |
| `DSH_MIFIT_DATA` | `runtime/data` 或已有的 `/root/workspace/mifit-data` | 导出的 JSON 放哪 |
| `DSH_MIFIT_SESSION` | `~/.mifit` | 会话目录 |
| `DSH_MIFIT_PYTHON` | `python3` | 侧车用的解释器 |
| `DSH_MIFIT_INDEX` | 空（依次试默认源、pypi.org、清华镜像） | pip 安装源 |

## 许可

暂未指定许可证。
