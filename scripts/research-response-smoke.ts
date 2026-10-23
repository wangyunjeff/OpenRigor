/** Explicitly opt-in: this suite makes three real model calls and keeps their projects. */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

if (!process.argv.includes("--live")) {
  console.log("Opt-in live research suite: pnpm exec tsx scripts/research-response-smoke.ts --live [API URL]");
  process.exit(0);
}
const base = process.argv.find((argument) => /^https?:/.test(argument)) ?? "http://127.0.0.1:8787";
const output = resolve(".openrigor/validation/research-response");
mkdirSync(output, { recursive: true });
const model = "gpt-6.1-sol";
const tasks = [
  {
    id: "literature", name: "科研实测 · 文献对比", expected: ["review.md", "comparison.csv", "references.bib"],
    prompt: `请完成一份可交付的中文科研文献对比，主题是 LoRA 与 QLoRA。原始论文：https://arxiv.org/abs/2106.09685 和 https://arxiv.org/abs/2305.14314 。先用真实计划跟踪三个阶段；尽可能用检索/网页工具核对原始论文，不允许把未查阅的内容说成已核验，不要通过 shell 联网。比较冻结参数、可训练参数、量化、显存条件、推理部署、实验局限。正文含对比表、一条数学公式、实际查阅的引用链接和一个可复现的四步小实验方案，约600中文字，不进行训练、不安装依赖。将完整源稿、对比数据CSV和2条BibTeX写入当前项目的 artifacts/ 目录，分别名为 review.md、comparison.csv、references.bib。最终给出简短结论和三个真实文件的相对Markdown链接，不编造下载链接。若无法联网，明确说明验证限制并使用保守表述。`
  },
  {
    id: "statistics", name: "科研实测 · 数据与图表", expected: ["report.md", "paired-data.csv", "paired-plot.svg", "analysis.py", "statistics.json"],
    prompt: `对以下模拟配对数据做一份可复现分析。这是演示用合成数据，不是临床数据，不做任何医学解释。before=[72,68,75,70,66,74,69,71,73,67,76,70]；after=[76,70,78,74,68,77,72,73,78,69,80,73]。先用真实计划跟踪数据核查、计算、交付三步。运行Python标准库脚本，计算 n、前后均值、差值均值、差值样本标准差、配对差值均值的95% t置信区间（df=11，t临界值2.200985）、Cohen dz和配对t统计量。解释区间与演示数据局限。不要安装依赖，不访问网络。生成一张精致但清晰的英文标注SVG配对散点/连线图（注明Synthetic paired data），并将 artifacts/report.md、artifacts/paired-data.csv、artifacts/paired-plot.svg、artifacts/analysis.py 和 artifacts/statistics.json 写入当前项目。JSON中数字字段使用n,before_mean,after_mean,mean_difference,sd_difference,ci95_lower,ci95_upper,cohen_dz,t_statistic。正文含公式、摘要表和不超过350中文字的解释，末尾用真实相对Markdown链接交付五个文件。`
  },
  {
    id: "design", name: "科研实测 · 实验方案", expected: ["study-plan.md", "experiment-matrix.csv", "annotation-template.csv"],
    prompt: `设计一个小型科研实验：检验检索增强是否能减少科学问答里的无依据陈述。先用真实计划跟踪设计、检查、交付三步。不要联网，不运行模型训练，不安装依赖，不声称已有实验结果。给出可证伪假设、基线与两个消融组、盲评与数据泄漏控制、主要指标（含一个LaTeX公式）、不确定性和失败判据。正文用一个简洁Mermaid流程图展示问题抽样→回答生成→双人盲评→统计分析，并给出四行实验矩阵表。写入 artifacts/study-plan.md、artifacts/experiment-matrix.csv、artifacts/annotation-template.csv；标注模板含question_id,condition,claim_id,evidence_url,supported,annotator，给两条明确标记synthetic的示例，URL留空，不编造文献。最终以约400中文字总结方案并给三个真实文件的相对Markdown链接。`
  }
];

async function json(path: string, body?: unknown): Promise<any> {
  const response = await fetch(`${base}${path}`, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(value)}`);
  return value;
}

async function run(task: typeof tasks[number]): Promise<unknown> {
  const { project } = await json("/api/projects", { name: task.name, description: "GPT-6.1-Sol 真实科研任务验收；保留报告、数据与源文件。", instructions: "只在当前项目内工作。成果写入 artifacts/。这是功能验收，简洁完成指定任务，不扩展范围。" });
  const accepted = await json("/api/runs", { projectId: project.id, model, effort: "medium", mode: "standard", clientRequestId: `research_${task.id}_${crypto.randomUUID()}`, prompt: task.prompt });
  console.log(JSON.stringify({ task: task.id, projectId: project.id, runId: accepted.runId, model, stage: "started" }));
  writeFileSync(resolve(output, `${task.id}-run.json`), JSON.stringify({ task: task.id, projectId: project.id, runId: accepted.runId, model }, null, 2));
  const deadline = Date.now() + 15 * 60_000;
  let detail: any;
  let previous = "";
  while (Date.now() < deadline) {
    detail = await json(`/api/runs/${accepted.runId}`);
    const progress = `${detail.snapshot.status}:${detail.snapshot.currentStep}`;
    if (progress !== previous) { console.log(JSON.stringify({ task: task.id, status: detail.snapshot.status, step: detail.snapshot.currentStep, events: detail.events.length })); previous = progress; }
    if (["completed", "failed", "cancelled"].includes(detail.snapshot.status)) break;
    const { requests } = await json(`/api/runs/${accepted.runId}/requests`);
    if (requests.length) {
      // Leave any approval/question to the operator. This suite never weakens approval policy.
      console.log(JSON.stringify({ task: task.id, stage: "needs-input", requests: requests.map((request: any) => ({ id: request.id, kind: request.kind, title: request.title })) }));
    }
    await new Promise((done) => setTimeout(done, 3000));
  }
  if (!detail || !["completed", "failed", "cancelled"].includes(detail.snapshot.status)) {
    await json(`/api/runs/${accepted.runId}/cancel`, {});
    throw new Error(`${task.id}: exceeded bounded live-test deadline; cancellation requested`);
  }
  if (detail.snapshot.status !== "completed") throw new Error(`${task.id}: ${detail.snapshot.status} ${JSON.stringify(detail.snapshot.error)}`);
  if (detail.snapshot.model !== model) throw new Error("Unexpected model in snapshot");
  const events = detail.events as any[];
  events.forEach((event, index) => { if (event.sequence !== index + 1) throw new Error("Event sequence gap"); });
  if (events.filter((event) => event.type === "run-finished").length !== 1) throw new Error("Expected exactly one terminal event");
  const files = new Map<string, any>();
  events.filter((event) => event.type === "file").forEach((event) => files.set(event.file.fileId, event.file));
  const verified = [];
  for (const name of task.expected) {
    const file = [...files.values()].find((item) => item.name.split("/").pop() === name);
    if (!file?.downloadUrl) throw new Error(`${task.id}: missing registered downloadable artifact ${name}`);
    const download = await fetch(`${base}${file.downloadUrl}`);
    if (!download.ok) throw new Error(`${name}: download failed`);
    const bytes = Buffer.from(await download.arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (file.sha256 && file.sha256 !== sha256) throw new Error(`${name}: content hash mismatch`);
    verified.push({ name, size: bytes.length, sha256, mimeType: file.mimeType });
    if (name === "statistics.json") {
      const stats = JSON.parse(bytes.toString());
      const expected = { n: 12, before_mean: 70.91666666666667, after_mean: 74, mean_difference: 3.0833333333333335, sd_difference: 0.9962049198956219, ci95_lower: 2.450374970901095, ci95_upper: 3.716291695765572, cohen_dz: 3.095079407614642, t_statistic: 10.721669574897486 };
      for (const [field, value] of Object.entries(expected)) if (typeof stats[field] !== "number" || Math.abs(stats[field] - value) > 0.0001) throw new Error(`Statistical validation failed: ${field}`);
    }
  }
  const result = { task: task.id, projectId: project.id, runId: accepted.runId, model, status: detail.snapshot.status, eventCount: events.length, plans: events.filter((event) => event.type === "plan").length, sources: events.filter((event) => event.type === "source").length, artifacts: verified, usage: events.find((event) => event.type === "run-finished")?.usage };
  writeFileSync(resolve(output, `${task.id}-result.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ task: task.id, stage: "verified", result }));
  return result;
}

// Separate projects prevent one concurrent run from discovering another run's artifacts.
const results = await Promise.allSettled(tasks.map(run));
writeFileSync(resolve(output, "suite-result.json"), JSON.stringify(results, (_key, value) => value instanceof Error ? value.message : value, 2));
if (results.some((result) => result.status === "rejected")) {
  for (const result of results) if (result.status === "rejected") console.error(result.reason);
  process.exitCode = 1;
}
