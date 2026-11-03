# Commute workflow implementation plan
Goal: 交付四项已确认的独立功能。
Architecture: 新入口复用五模块，诊断独立纯函数，演示页调用相同入口。
Tech stack: ES modules, node:test, HTML/CSS.
Constraints: 只新增；无新依赖；不自动保存；不声称真机通过。

- [x] 先写行为测试：天气/路线有效期、独立固定、最终缺口、保留较早记录、时间冲突、未知、跨日、幂等、不修改输入。
- [x] 执行并确认新入口未实现时失败。
- [x] 新增 summary 与 workflow，重复执行新旧测试。
- [x] 新增离线场景与交互页面，验证每个场景断言及浏览器交互。
- [x] 接入说明、对照表、补丁、源码包；独立提交，确认原文件无改动。
