import { resolveAIProvider } from "@/providers/ai/registry";
import { detectComputerIntent } from "@/agents/computer/intent";
import { planComputerTask, type PlannedStep } from "@/agents/computer/planner";
import { perceiveScreen } from "@/lib/computer/perception";
import { isAppAllowed } from "@/lib/computer/allowed-apps";

export type LoopDecision = {
  done: boolean;
  needApproval: boolean;
  summary: string;
  steps: PlannedStep[];
  perceptionSummary?: string;
};

type AiNextStep = {
  done?: boolean;
  needApproval?: boolean;
  summary?: string;
  action?: {
    tool?: string;
    purpose?: string;
    payload?: Record<string, unknown>;
  };
};

/**
 * Modell-gesteuerte Planungsschleife. Regex-Intent bleibt Fallback (Unit-Tests).
 */
export async function planComputerLoopStep(input: {
  organizationId: string;
  userRequest: string;
  workspace: string;
  priorSummaries?: string[];
  useVision?: boolean;
}): Promise<LoopDecision> {
  const intent = detectComputerIntent(input.userRequest);
  // Bekannte Intents bleiben deterministisch (Unit-Tests / verify). generic → Modell.
  if (intent.kind !== "none" && intent.kind !== "generic") {
    const steps = planComputerTask({
      kind: intent.kind,
      userRequest: input.userRequest,
      workspace: input.workspace,
    });
    return {
      done: steps.length === 0 && intent.kind !== "resume",
      needApproval: intent.kind === "delete_dangerous",
      summary: `Fallback-Intent ${intent.kind}`,
      steps,
    };
  }

  let perceptionSummary: string | undefined;
  if (input.useVision !== false) {
    const seen = await perceiveScreen({
      organizationId: input.organizationId,
      question: `Ziel des Nutzers: ${input.userRequest}. Was siehst du, und was wäre der nächste sinnvolle UI-Schritt?`,
    });
    if (seen.ok) {
      perceptionSummary = `${seen.perception.summary} | Zustand: ${seen.perception.state}`;
    }
  }

  try {
    const { provider, decision } = await resolveAIProvider(input.organizationId, "master");
    const next = await provider.structuredOutput<AiNextStep>({
      model: decision.model,
      schemaName: "ComputerNextStep",
      schemaDescription:
        '{done:boolean,needApproval:boolean,summary:string,action?:{tool:string,purpose:string,payload:object}} tool einer von application,accessibility,browser,screen,input,filesystem,shell',
      prompt: [
        `Nutzerziel: ${input.userRequest}`,
        perceptionSummary ? `Bildschirm: ${perceptionSummary}` : "Kein Screenshot.",
        input.priorSummaries?.length ? `Bisher: ${input.priorSummaries.slice(-6).join(" | ")}` : "",
        "Wähle höchstens EINEN nächsten Schritt. Bei Freigabe-Bedarf needApproval=true und keine destructive action.",
      ]
        .filter(Boolean)
        .join("\n"),
    });

    if (next.done) {
      return { done: true, needApproval: false, summary: next.summary ?? "Ziel erreicht.", steps: [], perceptionSummary };
    }
    if (next.needApproval) {
      return {
        done: false,
        needApproval: true,
        summary: next.summary ?? "Freigabe nötig.",
        steps: [],
        perceptionSummary,
      };
    }
    const tool = String(next.action?.tool ?? "");
    const payload = (next.action?.payload ?? {}) as Record<string, unknown>;
    const app = String(payload.app ?? payload.name ?? "");
    if (app && !(await isAppAllowed(input.organizationId, app))) {
      return {
        done: false,
        needApproval: true,
        summary: `App „${app}“ steht nicht auf der Freigabeliste.`,
        steps: [],
        perceptionSummary,
      };
    }
    if (!tool) {
      return { done: true, needApproval: false, summary: next.summary ?? "Kein weiterer Schritt.", steps: [], perceptionSummary };
    }
    return {
      done: false,
      needApproval: false,
      summary: next.summary ?? next.action?.purpose ?? "Nächster Schritt",
      perceptionSummary,
      steps: [
        {
          tool: tool as PlannedStep["tool"],
          payload,
          purpose: String(next.action?.purpose ?? next.summary ?? "AI-Schritt"),
          userCommissioned: true,
        },
      ],
    };
  } catch (error) {
    return {
      done: false,
      needApproval: false,
      summary: error instanceof Error ? error.message : "Planung fehlgeschlagen.",
      steps: [],
      perceptionSummary,
    };
  }
}
