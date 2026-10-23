import type { ReactElement } from "react";
import { BrainCircuit, ChevronDown, SlidersHorizontal, Sparkles, User, Zap } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from "../../components/ui/dropdown-menu";
import {
  effortLabel,
  effortOptions,
  modelLabel,
  modelOptions,
  modelSupportsUltra,
  type Effort,
  type ModelId,
  type RoutingPreference,
  type RunMode,
  type RuntimeModel
} from "../../workspace-preferences";

interface ExecutionSelectorProps {
  runtimeModels?: RuntimeModel[];
  routing: RoutingPreference;
  model: ModelId;
  effort: Effort;
  mode: RunMode;
  onRoutingChange: (routing: RoutingPreference) => void;
  onModelChange: (model: ModelId) => void;
  onEffortChange: (effort: Effort) => void;
  onModeChange: (mode: RunMode) => void;
}

export function ExecutionSelector({ runtimeModels = [], routing, model, effort, mode, onRoutingChange, onModelChange, onEffortChange, onModeChange }: ExecutionSelectorProps): ReactElement {
  const routeActive = routing === "tokenresearch";
  const availableModels = runtimeModels.length ? runtimeModels.map((option) => ({ value: option.id, label: option.name })) : modelOptions;
  const selectedModelLabel = runtimeModels.find((option) => option.id === model)?.name ?? modelLabel(model);
  const reasoning = routeActive || mode === "ultra" ? "max" : effort;
  const modeLabel = routeActive ? "Coordinator" : mode === "ultra" ? "Ultra" : "Solo";

  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button type="button" className="model-trigger" aria-label={`Model ${selectedModelLabel}, reasoning ${effortLabel(reasoning)}, mode ${modeLabel}`}>
        <Sparkles aria-hidden="true" />
        <span>{selectedModelLabel}</span><span>·</span><span>{effortLabel(reasoning)}</span>
        {mode === "ultra" ? <span className="execution-trigger-mode">Ultra</span> : null}
        <ChevronDown aria-hidden="true" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent className="execution-popover" side="top" align="start" sideOffset={10} collisionPadding={12}>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="execution-menu-row"><User aria-hidden="true" /><span>Mode</span><small>{modeLabel}</small></DropdownMenuSubTrigger>
        <DropdownMenuPortal><DropdownMenuSubContent className="execution-submenu" sideOffset={6} collisionPadding={12}>
          <DropdownMenuLabel className="execution-menu-label">Execution mode</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={routeActive ? "coordinator" : mode} onValueChange={(value) => { if (value === "coordinator") onRoutingChange("tokenresearch"); else onModeChange(value as RunMode); }}>
            <DropdownMenuRadioItem className="execution-choice" value="standard"><User aria-hidden="true" /><span><strong>Solo</strong><small>One local agent</small></span></DropdownMenuRadioItem>
            <DropdownMenuRadioItem className="execution-choice" value="ultra" disabled={!modelSupportsUltra(model)}><Zap aria-hidden="true" /><span><strong>Ultra</strong><small>{modelSupportsUltra(model) ? "Local Codex Ultra reasoning" : "Available for GPT-5.6 Sol / Terra"}</small></span></DropdownMenuRadioItem>
            <DropdownMenuSeparator className="execution-menu-separator" />
            <DropdownMenuLabel className="execution-menu-label">Advanced</DropdownMenuLabel>
            <DropdownMenuRadioItem className="execution-choice" value="coordinator"><BrainCircuit aria-hidden="true" /><span><strong>Local coordinator guidance</strong><small>Sol Ultra with Luna Max delegation guidance</small></span></DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent></DropdownMenuPortal>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="execution-menu-row"><Sparkles aria-hidden="true" /><span>Model</span><small>{selectedModelLabel}</small></DropdownMenuSubTrigger>
        <DropdownMenuPortal><DropdownMenuSubContent className="execution-submenu execution-model-submenu" sideOffset={6} collisionPadding={12}>
          <DropdownMenuLabel className="execution-menu-label">Local models</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={model} onValueChange={onModelChange}>
            {availableModels.map((option) => <DropdownMenuRadioItem className="execution-choice execution-model-choice" value={option.value} key={option.value}><span className="execution-model-mark" aria-hidden="true">{option.value === "auto" ? "A" : <Sparkles />}</span><span><strong>{option.label}</strong><small>{option.value === "auto" ? "Follow the local runtime default" : option.value}</small></span></DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent></DropdownMenuPortal>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="execution-menu-row"><SlidersHorizontal aria-hidden="true" /><span>Reasoning</span><small>{effortLabel(reasoning)}</small></DropdownMenuSubTrigger>
        <DropdownMenuPortal><DropdownMenuSubContent className="execution-submenu execution-reasoning-submenu" sideOffset={6} collisionPadding={12}>
          <DropdownMenuLabel className="execution-menu-label">Reasoning effort</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={reasoning} onValueChange={(value) => onEffortChange(value as Effort)}>
            {effortOptions.map((option) => <DropdownMenuRadioItem className="execution-choice execution-effort-choice" value={option.value} key={option.value} disabled={!routeActive && mode === "ultra" && option.value !== "max"}><span>{option.label}</span></DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
          {!routeActive && mode === "ultra" ? <p className="execution-menu-note">Ultra uses the Max reasoning budget.</p> : null}
        </DropdownMenuSubContent></DropdownMenuPortal>
      </DropdownMenuSub>
    </DropdownMenuContent>
  </DropdownMenu>;
}
