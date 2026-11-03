# Important alarm implementation plan
Goal: 交付用户确认的正常响铃步数保障模式。
Stack: ES modules, node:test, HTML/Web Audio；无新依赖。
- [x] 行为测试先行，确认缺模块时失败。
- [x] 实现独立状态模块：许可、会话隔离、单步去重、正常关闭限制、8秒应急确认。
- [x] 新建模拟计步/前台响铃验收页，清楚标注模拟。
- [x] 验证浏览器流程、全仓测试及构建。
- [x] 独立审查、文档、补丁、单文件及源码交付，创建待合并PR。
