// onboarding.js — first-run setup (OnboardingView.swift), SPEC-UI.md §4.
// Shown only when no UserProfile exists yet (app.js decides via a raw localStorage check).

import * as store from "../store.js";
import { resolveUserGoals, roundDisplay } from "../nutrition.js";
import { wireNumericInput } from "./numeric-field.js";
import { icon } from "./icons.js";
import {
  bodyStatsSectionHtml,
  activityLevelSectionHtml,
  goalSectionHtml,
  wireProfileFormFields,
  calculatorEstimateRowsHtml,
} from "./formfields.js";

// Local, not-yet-persisted draft state (defaults per §4.3).
const draft = {
  weightKg: 70,
  heightCm: 170,
  age: 30,
  sex: "male",
  activityLevel: "sedentary",
  targetDeltaKcal: -500,
  customTargetKcal: 2000,
};

let disclosureOpen = false;

export function render(container, onComplete) {
  container.innerHTML = `
    <div class="navbar"><span class="navbar-spacer"></span><div class="navbar-title">SnapCal</div><span class="navbar-spacer"></span></div>
    <div class="ios-form">
      <div class="onboarding-intro">
        <div class="onboarding-title">Let's set up SnapCal</div>
        <div class="onboarding-subtext">Set the daily calorie number you want to hit. Not sure what it should be? The calculator below can work it out for you.</div>
      </div>

      <div class="ios-section">
        <div class="ios-section-header">Your daily calorie target</div>
        <div class="ios-section-body">
          <div class="onboarding-cal-row">
            <input type="text" class="onboarding-cal-input" id="cal-target-input" placeholder="2000" />
            <div class="onboarding-cal-unit">kcal</div>
          </div>
        </div>
      </div>

      <div class="ios-section">
        <div class="ios-section-body">
          <div class="disclosure-header${disclosureOpen ? " open" : ""}" id="disclosure-toggle">
            <span>Not sure? Calculate it from my stats</span>
            <span class="icon chevron">${icon("chevronDown", { size: 16, color: "var(--sc-secondary)" })}</span>
          </div>
        </div>
      </div>

      <div class="disclosure-body${disclosureOpen ? " open" : ""}" id="disclosure-body" style="${disclosureOpen ? "" : "max-height:0;"}">
        ${bodyStatsSectionHtml(draft)}
        ${activityLevelSectionHtml(draft)}
        ${goalSectionHtml(draft)}
        <div class="ios-section">
          <div class="ios-section-header">Calculator estimate</div>
          <div class="ios-section-body">${calculatorEstimateRowsHtml(resolveUserGoals(draft))}</div>
          <div class="ios-section-footer">Estimate based on the Mifflin-St Jeor equation.</div>
          <div style="margin-top:12px;">
            <button class="btn-prominent" id="use-this-estimate">Use this estimate</button>
          </div>
        </div>
      </div>

      <div class="ios-section" style="margin-top:8px;">
        <button class="btn-prominent" id="get-started-btn" ${draft.customTargetKcal > 0 ? "" : "disabled"}>Get started</button>
      </div>
      <div class="bottom-safe-spacer"></div>
    </div>
  `;

  const calInput = container.querySelector("#cal-target-input");
  wireNumericInput(calInput, {
    getValue: () => draft.customTargetKcal,
    decimal: false,
    min: 0,
    max: 20000,
    onCommit: (v) => {
      draft.customTargetKcal = v;
      const btn = container.querySelector("#get-started-btn");
      if (btn) btn.disabled = !(v > 0);
    },
  });

  container.querySelector("#disclosure-toggle").addEventListener("click", () => {
    disclosureOpen = !disclosureOpen;
    render(container, onComplete);
  });

  wireProfileFormFields(container, draft, (patch) => {
    Object.assign(draft, patch);
    render(container, onComplete);
  });

  const useEstimateBtn = container.querySelector("#use-this-estimate");
  if (useEstimateBtn) {
    useEstimateBtn.addEventListener("click", () => {
      const goals = resolveUserGoals(draft);
      draft.customTargetKcal = roundDisplay(goals.computedTargetCalories);
      render(container, onComplete);
    });
  }

  container.querySelector("#get-started-btn").addEventListener("click", () => {
    if (!(draft.customTargetKcal > 0)) return;
    store.setProfile({ ...draft });
    onComplete();
  });
}
