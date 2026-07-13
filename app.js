(function () {
  "use strict";

  const data = window.STOCKGO_STATUS;
  if (!data) {
    document.getElementById("headline").textContent = "狀態資料尚未產生";
    document.getElementById("summary").textContent = "請先執行 stockgo.py dashboard 產生靜態狀態檔。";
    return;
  }

  const labels = {
    current: "正常", building: "建置中", collecting: "收集中", validated: "已驗證",
    complete: "已完成", in_progress: "進行中", waiting: "等待中", delayed: "延遲",
    missing: "缺少", success: "成功", failed: "失敗", running: "執行中",
    not_run: "尚未執行", missed: "今日逾時未完成", late: "今日逾時完成", stale: "執行狀態已失效",
    pending: "今日待完成", upcoming: "今日尚未到時間", unavailable: "摘要不可驗證"
  };
  const dueLabels = {
    complete: "本時段已完成", upcoming: "尚未到排程時間", due: "已到排程時間，期限前",
    overdue: "已超過完成期限", not_scheduled: "今日休市不排程", unknown: "交易日曆不可用"
  };
  const fmt = new Intl.NumberFormat("zh-TW");
  const text = (value, fallback = "—") => value === null || value === undefined || value === "" ? fallback : String(value);
  const esc = value => text(value).replace(/[&<>'"]/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[char]);
  const statusLabel = status => labels[status] || text(status);
  const badge = status => `<span class="badge ${status}">${esc(statusLabel(status))}</span>`;
  const line = (status, value) => `<span class="status-line"><span class="dot ${status}"></span>${esc(value)}</span>`;
  const time = value => value ? new Date(value).toLocaleString("zh-TW", { hour12: false, timeZone: "Asia/Taipei" }) : "—";

  document.getElementById("headline").textContent = data.headline;
  document.getElementById("summary").textContent = data.summary;
  document.getElementById("updated-at").textContent = `最後更新：${time(data.generated_at)}`;
  document.getElementById("public-policy").textContent = data.safety.public_data_policy;

  document.getElementById("stage-summary").innerHTML = data.stages.map((stage, index) => `
    <li class="${stage.status}">
      <div class="stage-title"><span class="stage-index">${index + 1}</span><span>${esc(stage.name)} ${badge(stage.status)}</span></div>
      <small>${esc(stage.description)}</small>
    </li>`).join("");

  const formal = data.formal;
  const p2 = data.p2;
  const pm = p2.metrics;
  const trial = pm.current_trial || { status: "not_registered" };
  const trialProgress = trial.status === "collecting"
    ? `${fmt.format(trial.market_sessions || 0)} 個交易日／${fmt.format(trial.signal_days || 0)} 個訊號日（至少 ${fmt.format(trial.minimum_calendar_months || 0)} 個月、${fmt.format(trial.minimum_signal_days || 0)} 個訊號日）`
    : trial.status === "ready_for_evaluation"
      ? "樣本門檻已滿足，等待固定規格評估"
      : trial.status === "terminal"
        ? "試驗已有不可變結果"
        : "目前版本試驗尚未登記";
  const blockerText = rows => esc(rows.length ? rows.join("；") : "目前沒有阻塞項目");
  document.getElementById("database-comparison").innerHTML = `
    <tr><th>用途</th><td>${esc(formal.role)}</td><td>${esc(p2.role)}</td></tr>
    <tr><th>最新行情</th><td>${line(formal.status, text(formal.latest_market_date))}</td><td>${line(p2.status, text(p2.latest_market_date))}</td></tr>
    <tr><th>關鍵內容</th><td>${fmt.format(formal.datasets.find(x => x.key === "features")?.rows || 0)} 筆 Features；${fmt.format(formal.datasets.find(x => x.key === "labels")?.rows || 0)} 筆舊版 v2 Labels</td><td>${fmt.format(pm.paper_total)} 筆 Paper（目前版本 ${fmt.format(pm.paper_current_protocol)}）；研究 ${fmt.format(pm.trial_results)} / ${fmt.format(pm.trial_plans)} 完成</td></tr>
    <tr><th>目前狀態</th><td>${badge(formal.status)} ${blockerText(formal.blockers)}</td><td>${badge(p2.status)} ${blockerText(p2.blockers)}</td></tr>
    <tr><th>使用原則</th><td>研究、報告與完整性檢查以正式庫為主。</td><td>不可回填成正式庫；只做前瞻證據與驗證。</td></tr>`;

  document.getElementById("freshness-list").innerHTML = formal.datasets.map(row => `
    <div class="freshness-row ${row.status}">
      <strong>${esc(row.label)}</strong>
      <time>${esc(text(row.date))}</time>
      <span>${line(row.status, statusLabel(row.status))}</span>
      <span class="note">${esc(row.note)} · ${fmt.format(row.rows)} 筆</span>
    </div>`).join("");

  document.getElementById("validation-path").innerHTML = data.stages.map((stage, index) => `
    <li class="${stage.status}">
      <span class="stage-index">${stage.status === "complete" ? "✓" : index + 1}</span>
      <strong>${esc(stage.name)} · ${esc(statusLabel(stage.status))}</strong>
      <p>${esc(stage.description)}</p>
    </li>`).join("");

  const metrics = [
    ["Paper（目前 / 全部）", `${fmt.format(pm.paper_current_protocol)} / ${fmt.format(pm.paper_total)}`],
    ["Paper 已結算", pm.paper_settled],
    ["研究（完成 / 登記）", `${fmt.format(pm.trial_results)} / ${fmt.format(pm.trial_plans)}`],
    ["模擬對帳", pm.broker_reconciliations]
  ];
  metrics.splice(3, 0, ["前瞻試驗進度", trialProgress]);
  document.getElementById("evidence-metrics").innerHTML = metrics.map(([name, value]) => `
    <div class="metric"><span>${esc(name)}</span><strong>${esc(typeof value === "number" ? fmt.format(value) : value)}</strong></div>`).join("");

  const alpha = data.alpha_inventory || {
    status: "not_run", conclusion: "歷史因子盤點尚未產生",
    explanation: "尚無可公開的凍結研究結論。", blockers: [],
    next_action: "先完成可重現的因子盤點。"
  };
  const alphaBlockers = Array.isArray(alpha.blockers) ? alpha.blockers : [];
  document.getElementById("alpha-status-line").innerHTML = `${badge(alpha.status)} ${
    alpha.protocol_frozen ? '<span class="protocol-lock">規則已凍結</span>' : ""
  }`;
  document.getElementById("alpha-conclusion").textContent = text(alpha.conclusion);
  document.getElementById("alpha-explanation").textContent = text(alpha.explanation);
  document.getElementById("alpha-as-of").textContent = alpha.as_of
    ? `歷史樣本截至 ${text(alpha.as_of)}${alpha.erratum_reviewed ? "；覆核註記已公開，結論不變" : ""}`
    : "";
  const metricValue = value => value === null || value === undefined ? "—" : fmt.format(value);
  const mlEligibility = alpha.status === "complete" && typeof alpha.ml_candidate_eligible === "boolean"
    ? (alpha.ml_candidate_eligible ? "通過" : "未通過")
    : "—";
  const alphaMetrics = [
    ["形成週數", metricValue(alpha.formation_weeks)],
    ["候選觀測", metricValue(alpha.candidate_rows)],
    ["因子可用 / 登記", `${metricValue(alpha.data_ready_factor_count)} / ${metricValue(alpha.factor_count)}`],
    ["通過因子", metricValue(alpha.passed_factor_count)],
    ["ML 資格", mlEligibility]
  ];
  document.getElementById("alpha-metrics").innerHTML = alphaMetrics.map(([name, value]) => `
    <div class="metric"><span>${esc(name)}</span><strong>${esc(typeof value === "number" ? fmt.format(value) : value)}</strong></div>`).join("");
  document.getElementById("alpha-next-action").textContent = text(alpha.next_action);
  document.getElementById("alpha-blockers").innerHTML = alphaBlockers.length
    ? alphaBlockers.map(item => `<li>${esc(item)}</li>`).join("")
    : "";

  document.getElementById("operation-list").innerHTML = data.operations.map(op => `
    <tr title="${esc(op.purpose)}">
      <td><strong>${esc(op.name)}</strong><br><small>${esc(op.purpose)}</small></td>
      <td>${esc(op.schedule)}</td>
      <td>${line(op.status, statusLabel(op.status))}<br><small>${esc(dueLabels[op.due_state] || "時效狀態未知")}</small></td>
      <td>${time(op.finished_at)}</td>
    </tr>`).join("");

  document.getElementById("next-actions").innerHTML = data.actions.length
    ? data.actions.map(action => `<li><div><strong>${esc(action.title)}</strong><p>${esc(action.detail)}</p></div></li>`).join("")
    : "<li><div><strong>維持每日監控</strong><p>目前沒有新增阻塞項目，繼續累積前瞻證據。</p></div></li>";

  document.getElementById("reload").addEventListener("click", () => window.location.reload());
  const links = Array.from(document.querySelectorAll("nav a"));
  links.forEach(link => link.addEventListener("click", () => {
    links.forEach(item => item.classList.remove("active"));
    link.classList.add("active");
  }));
})();
