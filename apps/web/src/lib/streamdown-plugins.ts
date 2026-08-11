import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import type { PluginConfig } from "streamdown";
import { useEffect, useMemo, useState } from "react";

const mermaidFencePattern =
  /(?:^|\r?\n)[ \t]{0,3}(?:`{3,}|~{3,})[ \t]*mermaid(?:[ \t]|$)/im;

type MermaidPlugin = NonNullable<PluginConfig["mermaid"]>;

const baseStreamdownPlugins = { cjk, code, math } satisfies PluginConfig;

let mermaidPluginPromise: Promise<MermaidPlugin | null> | null = null;

const loadMermaidPlugin = (): Promise<MermaidPlugin | null> => {
  mermaidPluginPromise ??= import("@streamdown/mermaid")
    .then(({ mermaid }) => mermaid)
    .catch(() => null);

  return mermaidPluginPromise;
};

export const containsMermaidFence = (text: string | undefined): boolean =>
  typeof text === "string" && mermaidFencePattern.test(text);

export const useStreamdownPlugins = (text: string | undefined): PluginConfig => {
  const hasMermaidFence = containsMermaidFence(text);
  const [mermaidPlugin, setMermaidPlugin] = useState<MermaidPlugin | null>(null);

  useEffect(() => {
    if (!hasMermaidFence) {
      return;
    }

    let isActive = true;
    void loadMermaidPlugin().then((plugin) => {
      if (isActive && plugin) {
        setMermaidPlugin(plugin);
      }
    });

    return () => {
      isActive = false;
    };
  }, [hasMermaidFence]);

  return useMemo(() => {
    if (!hasMermaidFence || !mermaidPlugin) {
      return baseStreamdownPlugins;
    }

    return { ...baseStreamdownPlugins, mermaid: mermaidPlugin };
  }, [hasMermaidFence, mermaidPlugin]);
};
