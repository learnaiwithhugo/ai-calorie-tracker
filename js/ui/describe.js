// describe.js — Describe Meal sheet (DescribeMealView.swift), SPEC-UI.md §10.
// A dumb text collector — fire-and-forget; errors surface later on the pending card.

import * as queue from "../queue.js";
import { openSheet, navBar, wireNavBar } from "./sheet.js";

const CHAR_CAP = 500;
const COUNTER_SHOW_AT = 400;

export function openDescribeMealSheet() {
  openSheet({
    render(panel, close) {
      panel.innerHTML = `
        ${navBar({
          title: "Describe Meal",
          leading: { label: "Cancel" },
          trailing: { label: "Analyze", bold: true, disabled: true },
        })}
        <div class="sheet-panel-body">
          <div class="describe-body">
            <div class="describe-subhead">Describe what you ate and the AI will estimate the calories and macros.</div>
            <textarea class="describe-textarea" id="describe-input" rows="4"
              placeholder="e.g. banana smoothie with two scoops of protein powder and blueberries"></textarea>
            <div class="describe-counter hidden" id="describe-counter"></div>
            <div class="describe-footer-tip">Include quantities where you can — "two scoops", "a handful" — and the estimate gets a lot better.</div>
          </div>
        </div>
      `;

      const textarea = panel.querySelector("#describe-input");
      const counter = panel.querySelector("#describe-counter");
      const analyzeBtn = panel.querySelector('[data-nav="trailing"]');

      textarea.addEventListener("input", () => {
        if (textarea.value.length > CHAR_CAP) {
          textarea.value = textarea.value.slice(0, CHAR_CAP);
        }
        const len = textarea.value.length;
        if (len >= COUNTER_SHOW_AT) {
          counter.classList.remove("hidden");
          counter.textContent = `${len}/${CHAR_CAP}`;
          counter.classList.toggle("at-limit", len >= CHAR_CAP);
        } else {
          counter.classList.add("hidden");
        }
        analyzeBtn.disabled = textarea.value.trim() === "";
      });

      wireNavBar(panel, {
        onLeading: () => close(),
        onTrailing: () => {
          const trimmed = textarea.value.trim();
          if (trimmed === "") return;
          queue.enqueueText(trimmed);
          close();
        },
      });

      // Auto-focus on appear (spec: field is auto-focused).
      setTimeout(() => textarea.focus(), 350);
    },
  });
}
