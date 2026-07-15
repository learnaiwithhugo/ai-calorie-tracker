// today.js — Home tab (TodayView.swift), SPEC-UI.md §5.

import * as store from "../store.js";
import * as queue from "../queue.js";
import { roundDisplay, startOfDay } from "../nutrition.js";
import { icon } from "./icons.js";
import { ringGauge } from "./ring.js";
import { mountEntryRow } from "./entry-row.js";
import { openActionSheet } from "./action-sheet.js";
import { openResultsSheet } from "./results.js";
import { openAddFoodSheet } from "./addfood.js";

const MACRO_DEFS = [
  { key: "proteinG", targetKey: "proteinTargetG", name: "Protein", color: "var(--sc-protein)", track: "rgba(232,93,93,0.18)", icon: "fishFill" },
  { key: "carbsG", targetKey: "carbsTargetG", name: "Carbs", color: "var(--sc-carbs)", track: "rgba(229,160,84,0.18)", icon: "leafFill" },
  { key: "fatG", targetKey: "fatTargetG", name: "Fat", color: "var(--sc-fat)", track: "rgba(107,141,227,0.18)", icon: "dropFill" },
];

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

let swiperPage = 0;
let rowCleanups = [];

export function render(container) {
  rowCleanups.forEach((fn) => fn());
  rowCleanups = [];

  const totals = store.totalsForDay();
  const goals = store.computeGoals();
  const week = store.weekStrip();
  const streakCount = store.streak();
  const water = store.getWaterEntryForDay();
  const recent = store.recentlyUploaded(10);
  const anyPending = recent.some((e) => e.isPending === true);
  const showNotifyBanner = anyPending && !queue.isNotificationAuthorized() && !store.isNotifyBannerDismissed();

  const remaining = goals.targetCalories - totals.calories;
  const overBudget = remaining < 0;

  container.innerHTML = `
    <div class="today-content">
      <div class="today-header">
        <div class="wordmark">${icon("forkKnife", { size: 24 })}<span class="wordmark-text">SnapCal</span></div>
        <div class="streak-pill">${icon("flameFill", { size: 18, color: "var(--sc-streak-flame)" })}<span class="streak-count">${streakCount}</span></div>
      </div>

      ${weekStripHtml(week)}

      <div class="swiper">
        <div class="swiper-track" id="swiper-track" style="transform:translateX(${-swiperPage * 100}%)">
          <div class="swiper-page">${caloriesPageHtml(totals, goals, remaining, overBudget)}</div>
          <div class="swiper-page">${waterPageHtml(water)}</div>
        </div>
      </div>
      <div class="swiper-dots">
        <span class="swiper-dot${swiperPage === 0 ? " active" : ""}" data-dot="0"></span>
        <span class="swiper-dot${swiperPage === 1 ? " active" : ""}" data-dot="1"></span>
      </div>

      <div class="recent-section">
        <h2 class="section-title">Recently uploaded</h2>
        ${showNotifyBanner ? notifyBannerHtml() : ""}
        <div class="recent-list" id="recent-list"></div>
      </div>
      <div class="bottom-safe-spacer"></div>
    </div>
  `;

  wireSwiper(container);
  wireWaterButtons(container);
  wireNotifyBanner(container);

  const recentList = container.querySelector("#recent-list");
  if (recent.length === 0) {
    recentList.innerHTML = `
      <div class="empty-recent">
        <div class="empty-recent-box"></div>
        <div class="empty-recent-caption">Tap + to add your first meal of the day</div>
      </div>
    `;
  } else {
    for (const entry of recent) {
      const cleanup = mountEntryRow(recentList, entry, {
        onTap: (e) => handleRowTap(e, container),
        onDelete: (e) => store.deleteFoodEntry(e.id),
      });
      rowCleanups.push(cleanup);
    }
  }
}

function weekStripHtml(week) {
  const todayStart = startOfDay(new Date());
  return `
    <div class="week-strip">
      ${week
        .map((day, i) => {
          const isToday = day.dayStart === todayStart;
          const isFuture = day.dayStart > todayStart;
          const isPastNoLog = !isToday && !isFuture && !day.hasLog;
          const dayNum = new Date(day.dayStart).getDate();
          const circleClasses = ["week-day-circle"];
          if (isToday) circleClasses.push("today");
          else if (day.hasLog) circleClasses.push("logged");
          else circleClasses.push("nolog");
          const numClasses = ["week-day-number"];
          if (isToday) numClasses.push("bold");
          if (isFuture) numClasses.push("future");
          const colClasses = ["week-day-col"];
          if (isFuture) colClasses.push("future");
          else if (isPastNoLog) colClasses.push("past-nolog");
          return `
            <div class="${colClasses.join(" ")}">
              <div class="week-day-label">${WEEKDAY_LABELS[i]}</div>
              <div class="week-day-badge-wrap">
                ${isToday ? '<div class="week-day-today-backdrop"></div>' : ""}
                <div class="${circleClasses.join(" ")}">
                  <div class="${numClasses.join(" ")}">${dayNum}</div>
                </div>
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function caloriesPageHtml(totals, goals, remaining, overBudget) {
  const ringProgress = goals.targetCalories > 0 ? totals.calories / goals.targetCalories : 0;
  const ring = ringGauge({
    size: 96,
    strokeWidth: 12,
    progress: ringProgress,
    color: overBudget ? "var(--sc-red)" : "var(--sc-primary-text)",
    trackColor: "var(--sc-secondary-15)",
    centerHtml: icon("flameFill", { size: 26, color: overBudget ? "var(--sc-red)" : "var(--sc-primary-text)" }),
  });

  const macroTiles = MACRO_DEFS.map((m) => {
    const consumed = totals[m.key] ?? 0;
    const target = goals[m.targetKey] ?? 0;
    const macroRemaining = target - consumed;
    const macroOver = macroRemaining < 0;
    const progress = target > 0 ? consumed / target : 0;
    const miniRing = ringGauge({
      size: 40,
      strokeWidth: 6,
      progress,
      color: macroOver ? "var(--sc-red)" : m.color,
      trackColor: m.track,
      centerHtml: icon(m.icon, { size: 14, color: macroOver ? "var(--sc-red)" : m.color }),
    });
    return `
      <div class="macro-tile card">
        <div class="macro-value${macroOver ? " over" : ""}">${roundDisplay(Math.abs(macroRemaining))}g</div>
        <div class="macro-caption">${m.name} ${macroOver ? "over" : "left"}</div>
        ${miniRing}
      </div>
    `;
  }).join("");

  return `
    <div class="calories-page">
      <div class="calorie-card card">
        <div class="calorie-left">
          <div class="calorie-remaining${overBudget ? " over" : ""}">${roundDisplay(Math.abs(remaining))}</div>
          <div class="calorie-caption">${overBudget ? "Calories over" : "Calories left"}</div>
        </div>
        ${ring}
      </div>
      <div class="macro-row">${macroTiles}</div>
    </div>
  `;
}

function waterPageHtml(water) {
  const glasses = water.glasses ?? 0;
  const progress = Math.min(glasses / 8, 1);
  const ring = ringGauge({
    size: 130,
    strokeWidth: 14,
    progress,
    color: "var(--sc-water)",
    trackColor: "rgba(79,157,241,0.15)",
    centerHtml: icon("dropFill", { size: 30, color: "var(--sc-water)" }),
  });
  return `
    <div class="water-page">
      <div class="water-card card">
        ${ring}
        <div>
          <div class="water-glasses-label">${glasses} glasses</div>
          <div class="water-sub-label">(250 ml each)</div>
        </div>
        <div class="water-buttons">
          <button class="water-round-btn" data-water="minus">${icon("minus", { size: 22, color: "#fff" })}</button>
          <button class="water-round-btn" data-water="plus">${icon("plus", { size: 22, color: "#fff" })}</button>
        </div>
      </div>
    </div>
  `;
}

function notifyBannerHtml() {
  return `
    <div class="notify-banner card">
      ${icon("bell", { size: 16 })}
      <div class="notify-banner-body">
        <div class="notify-banner-text">Get notified when the analysis is done. No need to wait.</div>
        <button class="notify-banner-btn" data-notify-request>Notify Me</button>
      </div>
      <button class="notify-banner-close" data-notify-close>${icon("xmark", { size: 14 })}</button>
    </div>
  `;
}

function wireSwiper(container) {
  const track = container.querySelector("#swiper-track");
  const dots = container.querySelectorAll(".swiper-dot");
  dots.forEach((dot) => {
    dot.addEventListener("click", () => {
      swiperPage = Number(dot.dataset.dot);
      track.style.transform = `translateX(${-swiperPage * 100}%)`;
      dots.forEach((d) => d.classList.toggle("active", Number(d.dataset.dot) === swiperPage));
    });
  });

  let startX = null;
  let dx = 0;
  let dragging = false;
  const wrapper = track.parentElement;

  const start = (e) => {
    startX = (e.touches ? e.touches[0] : e).clientX;
    dragging = true;
    track.style.transition = "none";
  };
  const move = (e) => {
    if (!dragging) return;
    dx = (e.touches ? e.touches[0] : e).clientX - startX;
    const pct = (dx / wrapper.offsetWidth) * 100;
    track.style.transform = `translateX(${-swiperPage * 100 + pct}%)`;
  };
  const end = () => {
    if (!dragging) return;
    dragging = false;
    track.style.transition = "";
    const pct = (dx / wrapper.offsetWidth) * 100;
    if (pct < -20 && swiperPage < 1) swiperPage = 1;
    else if (pct > 20 && swiperPage > 0) swiperPage = 0;
    track.style.transform = `translateX(${-swiperPage * 100}%)`;
    dots.forEach((d) => d.classList.toggle("active", Number(d.dataset.dot) === swiperPage));
    dx = 0;
  };

  wrapper.addEventListener("touchstart", start, { passive: true });
  wrapper.addEventListener("touchmove", move, { passive: true });
  wrapper.addEventListener("touchend", end);
  wrapper.addEventListener("mousedown", start);
  window.addEventListener("mousemove", (e) => dragging && move(e));
  window.addEventListener("mouseup", () => dragging && end());
}

function wireWaterButtons(container) {
  const minus = container.querySelector('[data-water="minus"]');
  const plus = container.querySelector('[data-water="plus"]');
  if (minus) minus.addEventListener("click", () => store.decrementWater());
  if (plus) plus.addEventListener("click", () => store.incrementWater());
}

function wireNotifyBanner(container) {
  const requestBtn = container.querySelector("[data-notify-request]");
  const closeBtn = container.querySelector("[data-notify-close]");
  if (requestBtn) {
    requestBtn.addEventListener("click", async () => {
      await queue.requestNotificationPermission();
      render(container);
    });
  }
  if (closeBtn) {
    closeBtn.addEventListener("click", () => store.setNotifyBannerDismissed(true));
  }
}

/** Row tap routing, shared by Today and History (§5.4.4). */
export function handleRowTap(entry, container) {
  const state = queue.entryState(entry);
  if (state === "pending") return;
  if (state === "failed") {
    openActionSheet({
      title: "Analysis failed",
      message: entry.analysisFailureReason || "Something went wrong during analysis.",
      actions: [
        { label: "Retry", onSelect: () => queue.retry(entry.id) },
        {
          label: "Edit manually",
          onSelect: () => {
            store.updateFoodEntry(entry.id, { analysisFailed: false });
            openAddFoodSheet({ entry: store.getFoodEntry(entry.id) });
          },
        },
        { label: "Delete", destructive: true, onSelect: () => store.deleteFoodEntry(entry.id) },
        { label: "Cancel", cancel: true },
      ],
    });
    return;
  }
  if (entry.analysisItems != null) {
    openResultsSheet(entry);
    return;
  }
  openAddFoodSheet({ entry });
}
