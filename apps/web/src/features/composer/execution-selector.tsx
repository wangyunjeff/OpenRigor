import type { ReactElement } from "react";
import {
  BrainCircuit,
  Check,
  ChevronDown,
  HardDrive,
  ShieldCheck,
  SlidersHorizontal,
  User,
  Zap
} from "lucide-react";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorName,
  ModelSelectorSeparator,
  ModelSelectorTrigger
} from "../../components/ai-elements/model-selector";
import {
  effortLabel,
  effortOptions,
  modelLabel,
  modelOptions,
  modelSupportsUltra,
  tokenResearchRoutingProfile,
  type Effort,
  type ModelId,
  type RoutingPreference,
  type RunMode
} from "../../workspace-preferences";

interface ExecutionSelectorProps {
  routing: RoutingPreference;
  model: ModelId;
  effort: Effort;
  mode: RunMode;
  onRoutingChange: (routing: RoutingPreference) => void;
  onModelChange: (model: ModelId) => void;
  onEffortChange: (effort: Effort) => void;
  onModeChange: (mode: RunMode) => void;
}

export function ExecutionSelector({
  routing,
  model,
  effort,
  mode,
  onRoutingChange,
  onModelChange,
  onEffortChange,
  onModeChange
}: ExecutionSelectorProps): ReactElement {
  const routeActive = routing === "tokenresearch";

  return <ModelSelector>
    <ModelSelectorTrigger asChild>
      <button
        type="button"
        className={routeActive ? "model-trigger routing-active" : mode === "ultra" ? "model-trigger ultra-active" : "model-trigger"}
        aria-label={routeActive ? "TokenResearch 智能路由，Sol 主脑与 Luna Max 子 Agent" : `模型 ${modelLabel(model)}，推理强度 ${effortLabel(effort)}${mode === "ultra" ? "，Ultra 模式" : ""}`}
      >
        {routeActive
          ? <><span>TokenResearch</span><span>·</span><span>Sol + Luna Max</span><span className="routing-trigger-badge"><BrainCircuit aria-hidden="true" />路由</span></>
          : <><span>{modelLabel(model)}</span><span>·</span><span>{effortLabel(effort)}</span>{mode === "ultra" ? <span className="ultra-trigger-badge"><Zap aria-hidden="true" />Ultra</span> : null}</>}
        <ChevronDown aria-hidden="true" />
      </button>
    </ModelSelectorTrigger>
    <ModelSelectorContent className="execution-selector-dialog" title="选择模型与运行方式">
      <div className="execution-selector-heading">
        <div><strong>运行配置</strong><small>模型、强度与模式可以连续调整</small></div>
        <span><HardDrive aria-hidden="true" />本地 Codex</span>
      </div>
      <ModelSelectorInput aria-label="搜索模型、推理强度或运行方式" placeholder="搜索模型或运行方式" />
      <ModelSelectorList className="execution-selector-list">
        <ModelSelectorEmpty>没有匹配的配置</ModelSelectorEmpty>
        <ModelSelectorGroup heading="智能路由">
          <ModelSelectorItem className="execution-route-item" value="tokenresearch 智能路由 sol luna max" onSelect={() => onRoutingChange("tokenresearch")}>
            <span className="routing-icon"><BrainCircuit aria-hidden="true" /></span>
            <ModelSelectorName><strong>TokenResearch</strong><small>{tokenResearchRoutingProfile.description}</small><code>Sol Ultra 主脑 / Luna Max 子 Agent</code></ModelSelectorName>
            {routeActive ? <Check aria-hidden="true" /> : null}
          </ModelSelectorItem>
          <ModelSelectorItem className="execution-route-item" value="manual 手动设置" onSelect={() => onRoutingChange("manual")}>
            <span className="routing-icon routing-icon-manual"><SlidersHorizontal aria-hidden="true" /></span>
            <ModelSelectorName><strong>手动设置</strong><small>自行组合模型、推理强度与运行模式</small></ModelSelectorName>
            {!routeActive ? <Check aria-hidden="true" /> : null}
          </ModelSelectorItem>
        </ModelSelectorGroup>

        <ModelSelectorSeparator />
        <ModelSelectorGroup heading="GPT-5.6 模型">
          {modelOptions.map((option) => <ModelSelectorItem className="execution-model-item" value={`${option.label} ${option.description}`} key={option.value} aria-label={`${option.label}${routeActive ? "，选择后切换为手动设置" : ""}`} onSelect={() => onModelChange(option.value)}>
            <span className={`model-orb${option.value === "auto" ? " model-orb-auto" : ""}`} aria-hidden="true">{option.value === "auto" ? "A" : option.value.split("-").at(-1)?.slice(0, 1).toUpperCase()}</span>
            <ModelSelectorName><strong>{option.label}</strong><small>{option.description}</small></ModelSelectorName>
            {!routeActive && model === option.value ? <Check aria-hidden="true" /> : null}
          </ModelSelectorItem>)}
        </ModelSelectorGroup>

        <ModelSelectorSeparator />
        <ModelSelectorGroup className="execution-choice-group" heading={routeActive ? "推理强度 · 路由固定 Max" : mode === "ultra" ? "推理强度 · Ultra 固定 Max" : "推理强度"}>
          <div className="execution-choice-grid effort-choice-grid">
            {effortOptions.map((option) => <ModelSelectorItem className="execution-choice-item" value={`${option.label} ${option.description}`} key={option.value} aria-label={`${option.label}${routeActive ? "，选择后切换为手动设置" : ""}`} disabled={!routeActive && mode === "ultra"} onSelect={() => onEffortChange(option.value)}>
              <strong>{option.label}</strong><small>{option.description}</small>
              {((routeActive && option.value === "max") || (!routeActive && effort === option.value)) ? <Check aria-hidden="true" /> : null}
            </ModelSelectorItem>)}
          </div>
        </ModelSelectorGroup>

        <ModelSelectorSeparator />
        <ModelSelectorGroup className="execution-choice-group" heading="运行模式">
          <div className="execution-choice-grid mode-choice-grid">
            <ModelSelectorItem className="execution-mode-item" value="standard 单 agent" onSelect={() => onModeChange("standard")}>
              <span className="mode-icon"><User aria-hidden="true" /></span><ModelSelectorName><strong>Standard</strong><small>单 Agent 执行</small></ModelSelectorName>
              {!routeActive && mode === "standard" ? <Check aria-hidden="true" /> : null}
            </ModelSelectorItem>
            <ModelSelectorItem className="execution-mode-item ultra-mode-item" value="ultra 多 agent 并行" disabled={!modelSupportsUltra(model)} onSelect={() => onModeChange("ultra")}>
              <span className="mode-icon"><Zap aria-hidden="true" /></span><ModelSelectorName><strong>Ultra</strong><small>{modelSupportsUltra(model) ? "多 Agent 并行探索" : "仅支持 Sol / Terra"}</small></ModelSelectorName>
              {(!routeActive && mode === "ultra") || routeActive ? <Check aria-hidden="true" /> : null}
            </ModelSelectorItem>
          </div>
        </ModelSelectorGroup>
      </ModelSelectorList>
      <div className="execution-selector-footer"><ShieldCheck aria-hidden="true" /><span>工作区可写</span><small>选择后立即生效，面板保持打开</small></div>
    </ModelSelectorContent>
  </ModelSelector>;
}
