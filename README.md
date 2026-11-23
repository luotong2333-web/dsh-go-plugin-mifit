# local-mifit · 小米健康（dsh-go 插件）

在 dsh-go 手机 App 的输入框上方显示今日步数和睡眠，点开还能看一个完整的小米运动健康面板。

数据来自本机 `mifit` 命令行导出的小米运动健康云端只读数据。插件本身不联网，也不上传任何内容。

## 功能

| 位置 | 内容 |
| --- | --- |
| 状态条 | `今日 N 步 · 睡 7h21m`，每 5 分钟刷新；达标变绿，低于目标 40% 变黄 |
| 胶囊「健康」 | 打开「小米健康」面板 |
| 胶囊「刷新健康」 | 依次导出最近 7 天的 7 类数据（最长 45 秒）；失败时保留本地数据并提示 |
| 面板「小米健康」 | 今日步数与目标进度、最近 7 天柱状图、睡眠 / 心率 / 血氧 / 压力 / 体重、最近运动 |

## 依赖

- dsh-go 手机 App（本机引擎自带 `dshGo` 桥接）
- [`mifit`](https://pypi.org/project/mifit/) 0.4.x：只读导出小米运动健康数据

## 安装

```sh
P="${DSH_HOME:-$HOME/.dsh}/dsh-go/plugins/local-mifit"
git clone https://github.com/<you>/dsh-go-plugin-mifit.git "$P"
dsh plugin --profile web add "$P"
```

装进 profile 的是指向该目录的链接，所以目录不能删。改 `lib/` 里的代码后，要在 App 的「引擎」页重启引擎才生效；只改 `package.json` 会自动重读。

## 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DSH_MIFIT_DATA` | `/root/workspace/mifit-data` | `mifit export` 写出的 JSON 目录 |
| `DSH_MIFIT_BIN` | `/root/workspace/.venvs/mifit/bin/mifit` | `mifit` 可执行文件 |

两个都没设时用上面的默认值，换机器时按自己的路径设一下。

## 结构

```
package.json      dshGo 清单（状态条 / 胶囊 / 面板）与 cordis patch
cordis.patch.yml  profile 层插入项
lib/index.js      处理函数、视图拼装
lib/data.js       读 JSON、调 mifit export 刷新
```

## 许可

暂未指定许可证。
