# 天气触发规则（S03）

版本：v1
状态：**待 A/C 签字**。签字前 B01 的代码改动不合并。
主笔：B　　确认：A、C

---

## 一、这一份要解决什么

现在"要不要因为天气提前叫醒"这件事，在代码里有 4 个地方各算一遍，口径不一致：

| 入口 | 位置 | 判定 |
|---|---|---|
| 首页核心卡 | `src/Dashboard.jsx:83-96` | `commuteWeatherWindow` → `isWet()` |
| 通勤方案 | `src/Dashboard.jsx:313-332` | 同上 + `assess()`（阈值写死 50） |
| 快捷创建 | `src/Dashboard.jsx:334` | 复用上一条 |
| 方案卡 | `src/plan.js` | `wet` 由外部传入 |

本文档定死判定规则，之后所有入口只允许调用同一组纯函数。

---

## 二、四条决定

### 决定 1：触发判定只看降水概率

```
triggered = Number.isFinite(probability) && probability >= threshold
```

**降水量 `amount` 与天气代码 `weather_code` 不参与触发判定**，只用于两件事：

- 生成文案（"小雨""雪""雷暴"）
- 挑选环境音音色（`ambientProfile`）

**理由**：用户设的是"降水概率 80% 才提前"，这是一个他可以理解和调整的数字。如果代码因为 0.1mm 的降水量就提前，用户设的门槛等于失效——这就是 B01 要修的绕过路径。

**这条不接受"但是有雨总该提前"的例外。** 要例外就改门槛，不要藏在代码里。

### 决定 2：概率缺失保留"未知"，不当作 0

| 情况 | `probability` | `affected` | 界面显示 |
|---|---|---|---|
| 上游给了数字 | 该数字 | `prob >= threshold` | `85%` |
| 上游返回 `null` | `null` | `null` | **"天气未知"** |
| 预报里没有这个时段 | 该槽位跳过 | 窗口为空时 `null` | "该时段预报暂缺" |

**禁止**：概率缺失时填 `0`。填 0 会让界面显示"降水概率 0%"，这是在对用户撒谎——我们不知道，不是零。

当前代码 `src/schedule.js:9`、`:43` 就是这么写的（`Number.isFinite(...) ? x : 0`），B01 要改掉。

### 决定 3：强天气不另行触发 —— 需要用户点头

**默认答案：否。** 概率 79%、有雷暴预警，也不自动提前。

**理由**：一旦"有雷暴就无视门槛"，门槛就不再是门槛。用户设 80% 是他自己的判断，产品不能替他做。

**但可以引导**：当窗口内出现 code ≥ 95（雷暴）、或 code = 75/85/86（大雪）时，在首页卡片上显示一行提示：

> 出发时段可能有雷暴，是否临时把门槛从 80% 降到 60%？

点一下才改，**不点就不改**，且只在本次生效，不写入设置。

**这条必须 A/C 明确表态**。如果 A/C 认为强天气应当自动触发，请在这行下面签字改答案，B01 会按签字内容实现，但届时需要在界面上明确写出"强天气会自动提前，不受你的门槛限制"，否则是欺骗用户。

> 待签字：☐ 同意「不自动触发，只提示」　　☐ 改为「强天气自动触发，界面明确说明」

### 决定 4：阈值只有一个来源

```
threshold = commute.threshold ?? prefs.threshold ?? 30
```

- `commute.threshold`：通勤页「降水概率阈值」输入框，范围 1–100 整数
- `prefs.threshold`：设置页「前一晚雨雪提醒」的阈值，**仅作为通勤页未设置时的回落**
- 30：两者都没有时的默认值，只在 `DEFAULT_COMMUTE` 里出现一次

**禁止**：任何函数内部写死 `50`、`30` 之类的数字字面量。当前 `src/live.js:29` 写死 `probability >= 50`，B01 改为由调用方传入。

---

## 三、判定函数契约

B01 之后，全仓只允许通过以下接口判断天气：

```js
// src/schedule.js
export function wetVerdict(slot, threshold)
// 返回 true / false / null（null = 概率未知）
// 唯一实现，全仓不许再手写判定

export function windowVerdict(weather, departure, arrival, threshold)
// 返回 { known, affected, probability, wetHours, snow, severe, coverage }
// known=false 表示窗口内没有可用预报
// affected 为 null 表示概率未知
```

界面层三处（`HourStrip`、`DayBlock`、`ForecastCard`）必须改为调用 `wetVerdict`，不得各自手写。

---

## 四、验收用例（写进 `tests/weather-rules.test.js`）

| # | 门槛 | 概率 | 降水量 | 代码 | 期望 `affected` |
|---|---|---|---|---|---|
| 1 | 80 | 30 | 0.5 | 61 | **false**（当前错误地返回 true） |
| 2 | 80 | 30 | 0 | 61 | **false**（当前错误地返回 true） |
| 3 | 80 | 85 | 0 | 1 | true |
| 4 | 80 | `null` | 0 | 1 | **null**（当前错误地返回 0%） |
| 5 | 30 | 30 | 0 | 1 | true（等于门槛即触发） |
| 6 | 80 | 79 | 5.0 | 95 | **false**（强天气不绕过，除非 A/C 签字改为是） |

第 1、2、4 条是回归用例，对应本次要修的三个绕过路径。

---

## 五、B 侧的 S02 字段确认

`plan` 结果字段（`src/plan.js` 的 `buildPlan` 返回值）与 C 侧存库需求对齐：

| 字段 | 类型 | 说明 | 够不够 |
|---|---|---|---|
| `status` | 枚举 6 值 | 见 `PLAN_STATUS` | ✅ |
| `wakeAt` | number \| null | 主要提前唤醒时刻 | ✅ |
| `departAt` | number \| null | 出发时刻 | ✅ |
| `gapMinutes` | number | 超上限的缺口 | ✅ |
| `threshold` | number | 本次计算用的门槛 | ✅ |
| `reason` | 对象 | 见 B10，含 `text` | 待 B10 改造 |
| `validUntil` | number | 过期时刻 | ✅ |
| `source` | string \| null | 数据来源 | ✅ |
| **`dataVersion`** | string | **缺**，B04 补 | ❌ |
| **`sources`** | 对象 | **缺**，B09 补（哪几项来自接口） | ❌ |
| **`advice`** | string \| null | **缺**，B10 补（千问建议） | ❌ |

C 侧如果要存"这条计划是哪一版数据算出来的"，现在没有字段可用，B04 补上后再接。
