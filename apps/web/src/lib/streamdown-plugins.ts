import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import type { PluginConfig } from "streamdown";
import { useEffect, useMemo, useState } from "react";

const mermaidFencePattern =
  /(?:^|\r?\n)[ \t]{0,3}(?:`{3,}|~{3,})[ \t]*mermaid(?:[ \t]|$)/im;

type MermaidPlugin = NonNullable<PluginConfig["mermaid"]>;

// The plugin defaults to display-only dollars. Scientific answers also use
// inline dollars, including normalized LaTeX \(...\) expressions.
const math = createMathPlugin({ singleDollarTextMath: true });
const baseStreamdownPlugins = { cjk, code, math } satisfies PluginConfig;

let mermaidPluginPromise: Promise<MermaidPlugin | null> | null = null;

const loadMermaidPlugin = (): Promise<MermaidPlugin | null> => {
  mermaidPluginPromise ??= import("@streamdown/mermaid")
    .then(({ createMermaidPlugin }) => createMermaidPlugin({ config: {
      theme: "base",
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      themeVariables: {
        primaryColor: "#e1eadc", primaryTextColor: "#213229",
        primaryBorderColor: "#91a38a", lineColor: "#9bad96",
        secondaryColor: "#e9ece6", tertiaryColor: "#d9e2d4", fontSize: "14px"
      }
    } }))
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
