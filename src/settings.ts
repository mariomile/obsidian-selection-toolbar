import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type SelectionToolbarPlugin from "./main";
import { COMMANDS, ALL_IDS } from "./commands/registry";
import type { CustomAction } from "./ai/types";

export type AIOutputMode = "preview" | "direct";

export interface SelectionToolbarSettings {
  /** Empty = all commands, in registry order. */
  enabledCommandIds: string[];
  showDelayMs: number;
  minSelectionLength: number;
  /** Max command buttons in the bar before extras move to a ⋯ menu (0 = all). */
  toolbarMaxButtons: number;

  // AI — via the local Claude Code CLI (subscription).
  aiEnabled: boolean;
  /** Absolute path to the `claude` binary; empty = auto-detect via login shell. */
  claudeCliPath: string;
  /** Model alias, or "default" to use Claude Code's configured model. */
  aiModel: string;
  /** Fast model for "quick" actions (fix grammar, shorten). */
  aiModelQuick: string;
  aiOutputMode: AIOutputMode;
  /** Show a before/after diff in preview mode. */
  aiShowDiff: boolean;
  /** User-defined actions, shown alongside the built-in presets. */
  customActions: CustomAction[];
}

export const DEFAULT_SETTINGS: SelectionToolbarSettings = {
  enabledCommandIds: [],
  showDelayMs: 120,
  minSelectionLength: 1,
  toolbarMaxButtons: 14,

  aiEnabled: true,
  claudeCliPath: "",
  aiModel: "default",
  aiModelQuick: "haiku",
  aiOutputMode: "preview",
  aiShowDiff: true,
  customActions: [],
};

const AI_MODELS: Record<string, string> = {
  default: "Claude Code default",
  opus: "Opus — most capable",
  sonnet: "Sonnet — balanced",
  haiku: "Haiku — fastest",
};

export class SelectionToolbarSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: SelectionToolbarPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // ---- Behaviour ----
    new Setting(containerEl)
      .setName("Show delay")
      .setDesc("Milliseconds to wait after a selection settles before showing the toolbar.")
      .addSlider((s) =>
        s
          .setLimits(0, 500, 10)
          .setValue(this.plugin.settings.showDelayMs)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.showDelayMs = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Minimum selection length")
      .setDesc("Don't show the toolbar for selections shorter than this many characters.")
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.minSelectionLength))
          .onChange(async (v) => {
            const n = Number(v);
            if (!Number.isNaN(n) && n >= 0) {
              this.plugin.settings.minSelectionLength = n;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Max buttons in the bar")
      .setDesc("Beyond this, extra buttons move into a ⋯ overflow menu. 0 = show all in one row.")
      .addSlider((s) =>
        s
          .setLimits(0, 24, 1)
          .setValue(this.plugin.settings.toolbarMaxButtons)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.toolbarMaxButtons = v;
            await this.plugin.saveSettings();
          })
      );

    // ---- Commands ----
    new Setting(containerEl).setName("Commands").setHeading();
    containerEl.createEl("p", {
      text: "Toggle which formatting buttons appear in the toolbar.",
      cls: "setting-item-description",
    });

    for (const cmd of COMMANDS) {
      const enabled = this.isEnabled(cmd.id);
      new Setting(containerEl).setName(cmd.label).addToggle((tg) =>
        tg.setValue(enabled).onChange(async (on) => {
          this.setEnabled(cmd.id, on);
          await this.plugin.saveSettings();
        })
      );
    }

    // ---- AI ----
    new Setting(containerEl).setName("AI text actions").setHeading();
    containerEl.createEl("p", {
      text: "AI actions run through your local Claude Code CLI using your subscription — no API key, no metered API billing. Requires Claude Code installed and signed in (run `claude` once in a terminal).",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("Enable AI actions")
      .setDesc("Show the ✨ button to run Claude on the selected text.")
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.aiEnabled).onChange(async (v) => {
          this.plugin.settings.aiEnabled = v;
          await this.plugin.saveSettings();
          this.display(); // re-render to show/hide dependent fields
        })
      );

    if (this.plugin.settings.aiEnabled) {
      new Setting(containerEl)
        .setName("Claude CLI path")
        .setDesc(
          "Leave empty to auto-detect. If the ✨ button reports 'Claude CLI not found', run `which claude` in your terminal and paste the absolute path here."
        )
        .addText((t) =>
          t
            .setPlaceholder("auto-detect (or /path/to/claude)")
            .setValue(this.plugin.settings.claudeCliPath)
            .onChange(async (v) => {
              this.plugin.settings.claudeCliPath = v.trim();
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("Model")
        .setDesc("Which model to request. 'Default' uses whatever Claude Code is configured to use.")
        .addDropdown((d) => {
          for (const [id, label] of Object.entries(AI_MODELS)) d.addOption(id, label);
          d.setValue(this.plugin.settings.aiModel).onChange(async (v) => {
            this.plugin.settings.aiModel = v;
            await this.plugin.saveSettings();
          });
        });

      new Setting(containerEl)
        .setName("Quick model")
        .setDesc("Faster model used for high-frequency simple edits (Fix grammar, Shorten).")
        .addDropdown((d) => {
          for (const [id, label] of Object.entries(AI_MODELS)) d.addOption(id, label);
          d.setValue(this.plugin.settings.aiModelQuick).onChange(async (v) => {
            this.plugin.settings.aiModelQuick = v;
            await this.plugin.saveSettings();
          });
        });

      new Setting(containerEl)
        .setName("Output mode")
        .setDesc("Preview lets you accept/discard before replacing. Direct streams straight into the editor (Cmd+Z to undo).")
        .addDropdown((d) =>
          d
            .addOption("preview", "Preview, then Accept / Discard")
            .addOption("direct", "Direct streaming replace")
            .setValue(this.plugin.settings.aiOutputMode)
            .onChange(async (v) => {
              this.plugin.settings.aiOutputMode = v as AIOutputMode;
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("Show diff in preview")
        .setDesc("In preview mode, highlight what changed (red = removed, green = added) before you Replace.")
        .addToggle((tg) =>
          tg.setValue(this.plugin.settings.aiShowDiff).onChange(async (v) => {
            this.plugin.settings.aiShowDiff = v;
            await this.plugin.saveSettings();
          })
        );

      const testSetting = new Setting(containerEl)
        .setName("Test connection")
        .setDesc("Run a tiny call to verify Claude is found, logged in, and responding.");
      testSetting.addButton((b) =>
        b.setButtonText("Test").onClick(async () => {
          b.setButtonText("Testing…").setDisabled(true);
          testSetting.setDesc("Running…");
          const res = await this.plugin.runConnectionTest();
          testSetting.setDesc(res.message);
          b.setButtonText("Test").setDisabled(false);
          new Notice(`Selection Toolbar — ${res.ok ? "✓ " : "✗ "}${res.message}`);
        })
      );

      this.renderCustomActions(containerEl);
    }
  }

  private renderCustomActions(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Custom actions").setHeading();
    containerEl.createEl("p", {
      text: "Your own reusable prompts. Each appears as a button in the AI panel. The selected text is sent as content; your prompt is the system instruction.",
      cls: "setting-item-description",
    });

    this.plugin.settings.customActions.forEach((action, i) => {
      const box = containerEl.createDiv({ cls: "selection-custom-action" });

      new Setting(box)
        .setName(`Action ${i + 1}`)
        .addText((t) =>
          t
            .setPlaceholder("Button label — e.g. PRD bullet")
            .setValue(action.label)
            .onChange(async (v) => {
              action.label = v;
              await this.plugin.saveSettings();
            })
        )
        .addExtraButton((b) =>
          b
            .setIcon("trash-2")
            .setTooltip("Delete action")
            .onClick(async () => {
              this.plugin.settings.customActions.splice(i, 1);
              await this.plugin.saveSettings();
              this.display();
            })
        );

      new Setting(box)
        .setName("Prompt (system)")
        .setDesc("What Claude should do with the selected text.")
        .addTextArea((t) => {
          t.setPlaceholder("Rewrite the text as a concise PRD bullet starting with a verb.")
            .setValue(action.system)
            .onChange(async (v) => {
              action.system = v;
              await this.plugin.saveSettings();
            });
          t.inputEl.rows = 3;
          t.inputEl.addClass("selection-custom-prompt");
        });

      new Setting(box)
        .setName("Model")
        .addDropdown((d) => {
          for (const [id, label] of Object.entries(AI_MODELS)) d.addOption(id, label);
          d.setValue(action.model || "default").onChange(async (v) => {
            action.model = v;
            await this.plugin.saveSettings();
          });
        });

      new Setting(box)
        .setName("Ask for an extra input")
        .setDesc("If on, the panel asks for a value (e.g. a target language) before running.")
        .addToggle((tg) =>
          tg.setValue(action.needsInput).onChange(async (v) => {
            action.needsInput = v;
            await this.plugin.saveSettings();
            this.display();
          })
        );

      if (action.needsInput) {
        new Setting(box).setName("Input placeholder").addText((t) =>
          t
            .setPlaceholder("e.g. Target language")
            .setValue(action.inputPlaceholder ?? "")
            .onChange(async (v) => {
              action.inputPlaceholder = v;
              await this.plugin.saveSettings();
            })
        );
      }
    });

    new Setting(containerEl).addButton((b) =>
      b
        .setButtonText("Add custom action")
        .setCta()
        .onClick(async () => {
          this.plugin.settings.customActions.push({
            id: `custom-${Date.now().toString(36)}`,
            label: "",
            system: "",
            needsInput: false,
            model: "default",
          });
          await this.plugin.saveSettings();
          this.display();
        })
    );
  }

  private isEnabled(id: string): boolean {
    const ids = this.plugin.settings.enabledCommandIds;
    return ids.length === 0 || ids.includes(id);
  }

  private setEnabled(id: string, on: boolean): void {
    const current = new Set(
      this.plugin.settings.enabledCommandIds.length === 0
        ? ALL_IDS
        : this.plugin.settings.enabledCommandIds
    );
    if (on) current.add(id);
    else current.delete(id);
    // Persist in registry order.
    this.plugin.settings.enabledCommandIds = ALL_IDS.filter((x) => current.has(x));
  }
}
