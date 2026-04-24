# 优选IP反查域名

> 项目复刻 [snowfal1/CloudflareCDNFission](https://github.com/snowfal1/CloudflareCDNFission)

输入一个 IP 地址，自动从多个数据源反查出该 IP 上托管的所有域名，可选 DNS 解析发现更多关联 IP。

## 功能

- **多源查询** — 自动轮换 hackertarget、ip138、crt.sh、ipchaxun 四个数据源，结果更全面
- **DNS 解析** — 可选对查到的域名做 DNS 解析，发现更多关联 IP
- **一键复制** — 每个域名独立复制按钮，方便批量导出

## 部署到 Cloudflare Pages

### 前置条件

- 一个 [GitHub](https://github.com) 账号
- 一个 [Cloudflare](https://cloudflare.com) 账号

### 步骤

#### 1. Fork 仓库

访问 [qianxiu203/yx-cf-reverse-ip](https://github.com/qianxiu203/yx-cf-reverse-ip)，点击右上角 **Fork** 将仓库复制到你的 GitHub 账号下。

#### 2. 进入 Cloudflare Pages

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 左侧菜单选择 **Workers & Pages**
3. 点击 **Create** → **Pages** → **Connect to Git**

#### 3. 选择仓库

1. 授权 Cloudflare 访问你的 GitHub
2. 找到你 Fork 的仓库 `yx-cf-reverse-ip`
3. 点击 **Begin setup**

#### 4. 配置构建

| 配置项 | 值 |
|--------|-----|
| **Project name** | 自定义，例如 `cf-reverse-ip` |
| **框架预设** | **无** |
| **构建命令** | 留空 |
| **构建输出目录** | /public |

#### 5. 部署

点击 **Save and Deploy**，等待约 1 分钟，部署完成后 Cloudflare 会分配一个 `<project>.pages.dev` 域名。

### 使用

输入 IP 地址即可查询。IP获取链接例如：https://www.wetest.vip

- 开启 **解析 DNS 发现更多 IP** 会对查到的域名做 DNS 解析，结果显示更多关联 IP
- 每个域名右侧有 **复制** 按钮，点击即可复制该域名

## 技术原理

- 前端：纯静态 HTML + CSS + JS，部署在 Cloudflare Pages
- 后端：Cloudflare Pages Functions，服务端轮换多个数据源执行反向 IP 查询
- DNS 解析：通过 `cloudflare-dns.com` 的 DNS-over-HTTPS API

## 数据来源

- [hackertarget](https://hackertarget.com/reverse-ip-lookup/)
- [ip138](https://site.ip138.com/)
- [crt.sh](https://crt.sh/)
- [ipchaxun](https://ipchaxun.com/)

## License

MIT
