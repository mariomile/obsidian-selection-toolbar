import { App, PluginSettingTab, Setting } from "obsidian";
import type SelectionToolbarPlugin from "./main";
import { COMMANDS, ALL_IDS } from "./commands/registry";

export type AIOutputMode = "preview" | "direct";

export interface SelectionToolbarSettings {
  /** Empty = all commands, in registry order. */
  enabledCommandIds: string[];
  showDelayMs: number;
  minSelectionLength: number;

  // AI — via the local Claude Code CLI (subscription).
  aiEnabled: boolean;
  /** Absolute path to the `claude` binary; empty = auto-detect via login shell. */
  claudeCliPath: string;
  /** Model alias, or "default" to use Claude Code's configured model. */
  aiModel: string;
  aiOutputMode: AIOutputMode;
}

export const DEFAULT_SETTINGS: SelectionToolbarSettings = {
  enabledCommandIds: [],
  showDelayMs: 120,
  minSelectionLength: 1,

  aiEnabled: true,
  claudeCliPath: "",
  aiModel: "default",
  aiOutputMode: "preview",
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
    }
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
