// formfields.js — shared `ProfileFormFields` (Body stats / Activity level / Goal) and
// `CalculatorEstimateRows`, used identically by onboarding.js and profile.js (SPEC-UI.md §3.3, §4.3).
//
// Adaptation note: the native app uses `.pickerStyle(.navigationLink)` (tap pushes a new screen
// with a selection list) for Sex/Activity/Goal. The web clone uses a row styled identically
// (value + chevron) with an invisible native <select> overlaid on top, so tapping still opens the
// platform's native picker UI in one tap without a page push — visually and behaviorally
// equivalent for a single-level choice, without building a second navigation stack.

import { wireNumericInput } from "./numeric-field.js";
import { ACTIVITY_LABELS, SEX_LABELS, roundDisplay } from "../nutrition.js";
import { icon } from "./icons.js";

export const GOAL_OPTIONS = [
  { delta: -500, label: "Lose ~0.5 kg/week" },
  { delta: -250, label: "Lose ~0.25 kg/week" },
  { delta: 0, label: "Maintain weight" },
  { delta: 250, label: "Gain ~0.25 kg/week" },
  { delta: 500, label: "Gain ~0.5 kg/week" },
];

function pickerRow({ id, label, currentLabel, options }) {
  return `
    <div class="ios-row linklike" style="position:relative;">
      <div class="ios-row-label">${label}</div>
      <div class="ios-row-spacer"></div>
      <div class="ios-row-value">${currentLabel}</div>
      <div class="icon chevron">${icon("chevronRight", { size: 14, color: "var(--sc-secondary)" })}</div>
      <select id="${id}" style="position:absolute;inset:0;opacity:0;width:100%;height:100%;">
        ${options.map((o) => `<option value="${o.value}"${o.selected ? " selected" : ""}>${o.label}</option>`).join("")}
      </select>
    </div>
  `;
}

export function bodyStatsSectionHtml(profile) {
  return `
    <div class="ios-section">
      <div class="ios-section-header">Body stats</div>
      <div class="ios-section-body">
        <div class="ios-row">
          <div class="ios-row-label">Weight</div>
          <div class="ios-row-spacer"></div>
          <input type="text" class="numeric-input" id="field-weight" placeholder="kg" />
          <div class="ios-row-unit">kg</div>
        </div>
        <div class="ios-row">
          <div class="ios-row-label">Height</div>
          <div class="ios-row-spacer"></div>
          <input type="text" class="numeric-input" id="field-height" placeholder="cm" />
          <div class="ios-row-unit">cm</div>
        </div>
        <div class="ios-row">
          <div class="ios-row-label">Age</div>
          <div class="ios-row-spacer"></div>
          <input type="text" class="numeric-input" id="field-age" placeholder="years" />
          <div class="ios-row-unit">yrs</div>
        </div>
        ${pickerRow({
          id: "field-sex",
          label: "Sex",
          currentLabel: SEX_LABELS[profile.sex],
          options: Object.entries(SEX_LABELS).map(([value, label]) => ({ value, label, selected: value === profile.sex })),
        })}
      </div>
    </div>
  `;
}

export function activityLevelSectionHtml(profile) {
  return `
    <div class="ios-section">
      <div class="ios-section-header">Activity level</div>
      <div class="ios-section-body">
        ${pickerRow({
          id: "field-activity",
          label: "Activity level",
          currentLabel: ACTIVITY_LABELS[profile.activityLevel],
          options: Object.entries(ACTIVITY_LABELS).map(([value, label]) => ({ value, label, selected: value === profile.activityLevel })),
        })}
      </div>
    </div>
  `;
}

export function goalSectionHtml(profile) {
  const current = GOAL_OPTIONS.find((g) => g.delta === profile.targetDeltaKcal) ?? GOAL_OPTIONS[0];
  return `
    <div class="ios-section">
      <div class="ios-section-header">Goal</div>
      <div class="ios-section-body">
        ${pickerRow({
          id: "field-goal",
          label: "Goal",
          currentLabel: current.label,
          options: GOAL_OPTIONS.map((g) => ({ value: String(g.delta), label: g.label, selected: g.delta === current.delta })),
        })}
      </div>
    </div>
  `;
}

/** Wires Weight/Height/Age numeric fields + Sex/Activity/Goal selects. `onPatch(partialProfile)` persists. */
export function wireProfileFormFields(container, profile, onPatch) {
  const weightInput = container.querySelector("#field-weight");
  const heightInput = container.querySelector("#field-height");
  const ageInput = container.querySelector("#field-age");
  const sexSelect = container.querySelector("#field-sex");
  const activitySelect = container.querySelector("#field-activity");
  const goalSelect = container.querySelector("#field-goal");

  if (weightInput) {
    wireNumericInput(weightInput, {
      getValue: () => profile.weightKg,
      decimal: true,
      min: 0,
      max: 500,
      onCommit: (v) => onPatch({ weightKg: v }),
    });
  }
  if (heightInput) {
    wireNumericInput(heightInput, {
      getValue: () => profile.heightCm,
      decimal: true,
      min: 0,
      max: 300,
      onCommit: (v) => onPatch({ heightCm: v }),
    });
  }
  if (ageInput) {
    wireNumericInput(ageInput, {
      getValue: () => profile.age,
      decimal: false,
      min: 0,
      max: 130,
      onCommit: (v) => onPatch({ age: v }),
    });
  }
  if (sexSelect) sexSelect.addEventListener("change", () => onPatch({ sex: sexSelect.value }));
  if (activitySelect) activitySelect.addEventListener("change", () => onPatch({ activityLevel: activitySelect.value }));
  if (goalSelect) goalSelect.addEventListener("change", () => onPatch({ targetDeltaKcal: Number(goalSelect.value) }));
}

/** CalculatorEstimateRows (§3.4): BMR / TDEE / Estimated target. */
export function calculatorEstimateRowsHtml(goals) {
  return `
    <div class="calc-estimate-row">
      <div class="calc-estimate-label">Estimated BMR</div>
      <div class="calc-estimate-value">${roundDisplay(goals.bmr)} kcal</div>
    </div>
    <div class="calc-estimate-row">
      <div class="calc-estimate-label">Estimated TDEE</div>
      <div class="calc-estimate-value">${roundDisplay(goals.tdee)} kcal</div>
    </div>
    <div class="calc-estimate-row">
      <div class="calc-estimate-label">Estimated target</div>
      <div class="calc-estimate-value target">${roundDisplay(goals.computedTargetCalories)} kcal</div>
    </div>
  `;
}
