import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { copyText } from "@/lib/clipboard";
import { useT, type Translate } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { ApiKeyRecord, Region } from "@/lib/types";
import { useGatewayStore } from "@/stores/gateway";

const TOOLS = [
  { key: "cursor", label: "Cursor" },
  { key: "cline", label: "Cline" },
  { key: "continue", label: "Continue" },
  { key: "claude-code", label: "Claude Code" },
  { key: "openwebui", label: "OpenWebUI" },
  { key: "cherry", label: "Cherry Studio" },
] as const;

type ToolKey = (typeof TOOLS)[number]["key"];

/** 取该 region 第一个启用中的 Key 前缀；无启用中的 Key 时返回 null，由渲染处给出占位提示。 */
function representativeKey(keys: ApiKeyRecord[], region: Region): string | null {
  const active = keys.find((key) => key.region === region && !key.revoked);
  return active ? `${active.prefix}…` : null;
}

/**
 * 生成可粘贴的配置片段。
 *
 * `t` 只负责「字段标签 + 值里的自然语言」；片段里的键名（`apiProvider`、
 * `ANTHROPIC_BASE_URL` 等）与工具自身的固定文案（`Cursor → Settings → …`）
 * 一律保持英文 —— 它们是外部工具读取的契约，翻译了反而会粘贴失败。
 */
function snippetFor(t: Translate, tool: ToolKey, baseUrl: string, rootUrl: string, key: string): string {
  switch (tool) {
    case "cursor":
      return [
        "Cursor → Settings → Models → OpenAI API Key",
        "",
        `Override OpenAI Base URL: ${baseUrl}`,
        `API Key:  ${key}`,
        `Model:    ${t("wbStats.gateway.snippet.modelPick")}`,
      ].join("\n");
    case "cline":
      return JSON.stringify(
        {
          apiProvider: "openai",
          openAiBaseUrl: baseUrl,
          openAiApiKey: key,
          openAiModelId: "GLM-5.3",
        },
        null,
        2,
      );
    case "continue":
      return [
        "models:",
        "  - name: WorkBuddy",
        "    provider: openai",
        "    model: GLM-5.3",
        `    apiBase: ${baseUrl}`,
        `    apiKey: ${key}`,
      ].join("\n");
    case "claude-code":
      return [`export ANTHROPIC_BASE_URL=${rootUrl}`, `export ANTHROPIC_AUTH_TOKEN=${key}`].join("\n");
    case "openwebui":
      return [`Base URL: ${baseUrl}`, `API Key:  ${key}`].join("\n");
    case "cherry":
      return [
        `${t("wbStats.gateway.snippet.apiBase")}: ${baseUrl}`,
        `${t("wbStats.gateway.snippet.apiKey")}: ${key}`,
        `${t("wbStats.gateway.snippet.modelPickPlain")}: ${t("wbStats.gateway.snippet.modelPick")}`,
      ].join("\n");
    default:
      return "";
  }
}

/**
 * 接入指引 Tabs（Cursor / Cline / Continue / Claude Code / OpenWebUI / Cherry Studio），带复制按钮（P0-9）。
 *
 * ## 版本由页面传入（受控）
 *
 * 改造前这里自带一个「国内版 Key / 国际版 Key」的 Tabs，与页面上的接入地址、
 * 账号池、模型清单各切各的。现在与 Trae 侧一致：版本在**页头唯一入口**切换，
 * 本组件只按传入的版本取对应 Key（`representativeKey`）。
 */
export function IntegrationGuide({
  baseUrl,
  region,
  className,
}: {
  baseUrl: string;
  region: Region;
  className?: string;
}) {
  const t = useT();
  const keys = useGatewayStore((s) => s.keys);
  const [tool, setTool] = useState<ToolKey>("cursor");
  const [copied, setCopied] = useState(false);

  const rootUrl = baseUrl.replace(/\/v1\/?$/, "");
  const key = representativeKey(keys, region) ?? t("wbStats.gateway.noKeyHint");
  const snippet = snippetFor(t, tool, baseUrl, rootUrl, key);

  async function onCopy() {
    await copyText(snippet, t("wbStats.gateway.codeCopied"));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Card className={cn("gap-0 py-0", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-3">
        {/* 版本不在这里显示也不在这里切：页头切换器是唯一入口（与 Trae 侧同口径）。 */}
        <span className="text-sm font-semibold">{t("wbStats.gateway.guide")}</span>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void onCopy()}>
            {copied ? <Check /> : <Copy />}
            {t("wbStats.gateway.copyCode")}
          </Button>
        </div>
      </div>

      <Tabs value={tool} onValueChange={(value) => setTool(value as ToolKey)}>
        <div className="border-b border-border/60 px-5 py-2">
          <TabsList className="flex-wrap">
            {TOOLS.map((item) => (
              <TabsTrigger key={item.key} value={item.key}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <div className="px-5 py-4">
          <pre className="min-w-0 overflow-x-auto rounded-lg border border-border bg-muted/40 p-4 font-mono text-xs leading-6">
            {snippet}
          </pre>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("wbStats.gateway.streamNote")}
          </p>
        </div>
      </Tabs>
    </Card>
  );
}
