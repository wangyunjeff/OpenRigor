import {
  BookOpen,
  BriefcaseBusiness,
  Bug,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Code2,
  Database,
  FileText,
  FlaskConical,
  Gauge,
  ListTodo,
  MessageSquare,
  Palette,
  PenLine,
  Radar,
  Search,
  ShieldCheck,
  Tags,
  Target,
  WandSparkles,
  type LucideIcon
} from "lucide-react";

export type TabId = "research" | "services" | "engineering" | "marketing" | "management" | "creative";

export interface ExampleTask {
  title: string;
  description: string;
  prompt: string;
  icon: LucideIcon;
  visual?: ExampleVisual;
}

export type ExampleVisual = "research" | "slides" | "chart" | "matrix" | "code" | "terminal" | "brief" | "calendar";

export const companionVisuals: Record<ExampleVisual, ExampleVisual> = {
  research: "chart",
  slides: "brief",
  chart: "matrix",
  matrix: "research",
  code: "terminal",
  terminal: "code",
  brief: "chart",
  calendar: "brief"
};

export const generatedVisualAssets: Record<ExampleVisual, string> = {
  research: "/generated/research-lineage.webp",
  slides: "/generated/research-storyboard.webp",
  chart: "/generated/research-trend.webp",
  matrix: "/generated/evidence-matrix.webp",
  code: "/generated/code-workspace.webp",
  terminal: "/generated/code-workspace.webp",
  brief: "/generated/business-memo.webp",
  calendar: "/generated/experiment-chart.webp"
};

export const tabs: Array<{ id: TabId; label: string }> = [
  { id: "research", label: "科研学术" },
  { id: "services", label: "专业服务" },
  { id: "engineering", label: "工程开发" },
  { id: "marketing", label: "运营市场" },
  { id: "management", label: "经营管理" },
  { id: "creative", label: "创意创作" }
];

export const examples: Record<TabId, ExampleTask[]> = {
  research: [
    { title: "梳理一组论文", description: "提炼研究脉络、方法差异和可验证空白。", prompt: "请检索并梳理这个方向近三年的代表性论文，给出方法对比、证据来源和下一步研究机会。", icon: BookOpen, visual: "research" },
    { title: "准备组会汇报", description: "把材料变成结构清晰、可讲述的演示提纲。", prompt: "请阅读当前工作区的论文材料，整理成一份 15 分钟组会汇报提纲，并标注关键图表。", icon: FileText, visual: "slides" },
    { title: "复核实验结果", description: "检查数据、脚本和结论之间是否一致。", prompt: "请检查项目中的实验脚本和结果，找出可复现性风险，并提出最小修正方案。", icon: FlaskConical, visual: "chart" },
    { title: "搭建文献矩阵", description: "按问题、数据、指标和限制组织阅读记录。", prompt: "请为这批文献建立一个可持续更新的阅读矩阵，包含问题、数据、指标、结论和局限。", icon: Database, visual: "matrix" }
  ],
  services: [
    { title: "审阅一份合同", description: "标出风险条款、缺失项和待确认问题。", prompt: "请审阅工作区中的合同，按风险等级列出条款问题、影响和建议修改。", icon: ShieldCheck, visual: "brief" },
    { title: "做一份尽调摘要", description: "把公开材料压缩成有引用的决策备忘录。", prompt: "请对目标公司做一份尽调摘要，区分已验证事实、推断和待确认信息。", icon: Search, visual: "research" },
    { title: "整理客户访谈", description: "从访谈记录中提取需求、异议和行动项。", prompt: "请整理当前目录的客户访谈记录，提取共性需求、异议、证据和待办事项。", icon: MessageSquare, visual: "matrix" },
    { title: "生成服务方案", description: "从目标和约束出发形成可执行交付计划。", prompt: "请根据这份需求说明生成服务方案、交付里程碑、风险和报价假设。", icon: BriefcaseBusiness, visual: "slides" }
  ],
  engineering: [
    { title: "搭建一个原型", description: "从需求开始，交付可运行的最小版本。", prompt: "请先检查当前项目，然后实现需求中最小可运行的切片，并说明验证步骤。", icon: Code2, visual: "code" },
    { title: "定位一个 bug", description: "复现问题、找到根因并给出可审阅修复。", prompt: "请检查项目中最近的错误日志和相关代码，定位根因，提出并验证一个小范围修复。", icon: Bug, visual: "terminal" },
    { title: "整理技术债", description: "按影响和成本排列真正值得处理的事项。", prompt: "请审计当前代码库的技术债，按用户影响、风险和工作量排序，给出执行顺序。", icon: ListTodo, visual: "matrix" },
    { title: "补齐测试", description: "围绕关键行为补测试并运行验证。", prompt: "请找出当前项目最重要的未覆盖行为，补上聚焦测试并运行相关检查。", icon: CheckCircle2, visual: "terminal" }
  ],
  marketing: [
    { title: "扫描竞品", description: "比较定位、功能、价格和证据强弱。", prompt: "请对这几个竞品做一份证据驱动的对比，覆盖定位、功能、价格和差异化机会。", icon: Radar, visual: "research" },
    { title: "设计内容计划", description: "把业务目标拆成可执行的内容节奏。", prompt: "请根据业务目标制定四周内容计划，包含主题、渠道、负责人和衡量指标。", icon: Calendar, visual: "calendar" },
    { title: "分析用户反馈", description: "聚合反馈主题，区分信号和噪声。", prompt: "请分析工作区中的用户反馈，聚类主题，标出证据和优先级建议。", icon: MessageSquare, visual: "chart" },
    { title: "准备发布清单", description: "在发布前检查内容、链接和风险。", prompt: "请为这次发布创建一份可执行的检查清单，并指出缺失材料。", icon: ClipboardCheck, visual: "brief" }
  ],
  management: [
    { title: "整理经营数据", description: "把分散数据变成可讨论的经营视图。", prompt: "请检查当前经营数据，整理关键指标、异常和需要管理层决定的问题。", icon: Gauge, visual: "chart" },
    { title: "写决策备忘录", description: "清晰呈现选项、取舍和建议。", prompt: "请把这些材料整理成一份决策备忘录，明确选项、取舍、风险和建议。", icon: FileText, visual: "brief" },
    { title: "规划季度目标", description: "把方向拆成可追踪的结果和节奏。", prompt: "请根据现有目标制定季度计划，包含结果指标、依赖关系和复盘节奏。", icon: Target, visual: "calendar" },
    { title: "准备会议材料", description: "让会议聚焦事实、选择和行动。", prompt: "请把这批材料整理成会议议程、背景摘要、决策问题和会后行动项。", icon: Calendar, visual: "slides" }
  ],
  creative: [
    { title: "构思一个故事", description: "从主题和受众出发形成完整创意。", prompt: "请围绕这个主题提出三个故事方向，并展开最有潜力的一版。", icon: WandSparkles, visual: "research" },
    { title: "制作视觉脚本", description: "把想法转成可拍摄、可制作的镜头表。", prompt: "请把这个创意整理成视觉脚本，包含镜头、旁白、节奏和素材需求。", icon: Palette, visual: "slides" },
    { title: "润色一篇文章", description: "保留观点，改善结构、语气和可读性。", prompt: "请在不改变事实和观点的前提下润色这篇文章，并列出重要改动。", icon: PenLine, visual: "research" },
    { title: "做一套命名方案", description: "给出有理由、可筛选的命名候选。", prompt: "请为这个产品提出一组命名候选，说明含义、语气和潜在风险。", icon: Tags, visual: "matrix" }
  ]
};
